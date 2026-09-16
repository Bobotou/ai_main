// AI 网关:所有 LLM 调用的唯一出口(对应技术架构 §5.2)
// 职责:配置检查(AI 未配置自动降级) · 脱敏 · 缓存 · 用量记录
//
// 设计约束:本文件不得绕过。任何新增 AI 能力都必须经过 callChat()。

import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AiConfigService } from './ai-config.service';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  /** 轻任务(分类等)用 light 模型 */
  light?: boolean;
  /** JSON 模式:响应按 JSON 解析,失败返回 null */
  json?: boolean;
  temperature?: number;
  /** 关联的邮件 id(审计) */
  messageId?: string;
  userId: string;
  /** 任务类型(审计与用量统计) */
  jobType: string;
  /** 缓存 TTL(毫秒);0 表示不缓存 */
  cacheTtlMs?: number;
}

export interface ChatResult {
  content: string;
  cached: boolean;
  promptTokens: number;
  completionTokens: number;
}

/** 剥离推理模型的思考块:
 *  - 成对 <think>…</think>(Qwen3/GLM 等)
 *  - 只有闭合标签 "思考…</think>正文"(DeepSeek-R1 的实际输出形态)
 *  - 未闭合 <think>… 全是思考(流被截断),返回空
 */
function stripThinking(text: string): string {
  const lower = text.toLowerCase();
  const closeIdx = lower.lastIndexOf('</think>');
  if (closeIdx !== -1) {
    // 无论有无开头标签,取最后一个 </think> 之后的部分(即正式回答)
    return text.slice(closeIdx + '</think>'.length).trim();
  }
  if (/<think>/i.test(text)) return ''; // 只有开头:思考被截断,无正式回答
  return text.trim(); // 无思考块,原样返回
}

/** 发送给 LLM 前的脱敏(对应技术架构 §8.3):剥离签名块,掩码验证码 */
function sanitizeForLlm(text: string): string {
  return text
    // 常见签名分隔
    .split(/\n--\s*\n/)[0]
    .replace(/\b\d{4,8}\b/g, (m) => (m.length >= 4 && m.length <= 8 ? '******' : m));
}

@Injectable()
export class AiGateway {
  private logger = new Logger(AiGateway.name);
  /** 配置快照(短缓存,保存配置后 5s 内生效) */
  private configCache = new Map<string, { at: number; value: Awaited<ReturnType<AiConfigService['resolve']>> }>();

  constructor(
    private prisma: PrismaService,
    private aiConfig: AiConfigService,
  ) {}

  /** 是否已配置(每用户;未配置时 AI 功能静默降级) */
  async isEnabled(userId: string): Promise<boolean> {
    return (await this.getConfig(userId)) !== null;
  }

  private async getConfig(userId: string) {
    const hit = this.configCache.get(userId);
    if (hit && Date.now() - hit.at < 5_000) return hit.value;
    const value = await this.aiConfig.resolve(userId);
    this.configCache.set(userId, { at: Date.now(), value });
    return value;
  }

  /** 供 AiService 在入 prompt 前统一调用 */
  desanitize = sanitizeForLlm;

  async callChat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResult | null> {
    const config = await this.getConfig(options.userId);
    if (!config) return null; // AI 未配置:静默降级

    const cacheKey = createHash('sha256')
      .update(JSON.stringify({ m: messages, o: { light: options.light, json: options.json } }))
      .digest('hex');

    // 缓存命中
    if (options.cacheTtlMs) {
      const hit = await this.prisma.aiCache.findUnique({ where: { cacheKey } });
      if (hit && hit.expiresAt > new Date()) {
        const r = JSON.parse(hit.resultJson) as ChatResult;
        return { ...r, cached: true };
      }
    }

    const job = await this.prisma.aiJob.create({
      data: { userId: options.userId, messageId: options.messageId, jobType: options.jobType, status: 'running' },
    });

    try {
      const model = options.light ? config.modelLight : config.modelChat;
      const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
      const startedAt = Date.now();
      this.logger.log(`→ [${options.jobType}] model=${model} msgs=${messages.length}${options.messageId ? ` message=${options.messageId}` : ''}`);
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.3,
          ...(options.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!resp.ok) {
        const body = (await resp.text()).slice(0, 300);
        throw new Error(`LLM HTTP ${resp.status} @ ${url} model=${model}: ${body}`);
      }
      const data = (await resp.json()) as {
        choices: { message: { content: string } }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      let content = stripThinking(data.choices[0]?.message?.content ?? '');
      if (options.json) {
        // 容错:剥离 markdown 代码围栏
        content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      }
      const result: ChatResult = {
        content,
        cached: false,
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
      };
      this.logger.log(
        `← [${options.jobType}] ${Date.now() - startedAt}ms tokens=${result.promptTokens}+${result.completionTokens} chars=${content.length}`,
      );

      await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: 'done', model,
          promptTokens: result.promptTokens, completionTokens: result.completionTokens,
        },
      });
      if (options.cacheTtlMs) {
        await this.prisma.aiCache.upsert({
          where: { cacheKey },
          update: { resultJson: JSON.stringify(result), expiresAt: new Date(Date.now() + options.cacheTtlMs) },
          create: {
            cacheKey, userId: options.userId, resultJson: JSON.stringify(result),
            expiresAt: new Date(Date.now() + options.cacheTtlMs),
          },
        });
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`✗ [${options.jobType}] 调用失败: ${message}`);
      await this.prisma.aiJob.update({
        where: { id: job.id },
        data: { status: 'failed', error: message },
      }).catch(() => undefined);
      return null;
    }
  }

  /** 每日 token 预算检查(超预算时调用方应降级,如只处理未读邮件) */
  async withinBudget(userId: string): Promise<boolean> {
    const budget = Number(process.env.AI_DAILY_TOKEN_BUDGET ?? 2_000_000);
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const agg = await this.prisma.aiJob.aggregate({
      where: { userId, createdAt: { gte: dayStart }, status: 'done' },
      _sum: { promptTokens: true, completionTokens: true },
    });
    return (agg._sum.promptTokens ?? 0) + (agg._sum.completionTokens ?? 0) < budget;
  }
}
