// AI 能力实现:分类 / 摘要 / 代笔 / 回复建议 / 语气调整
// 全部经 AiGateway 出站;AI 未配置时优雅降级(返回 null / 不打分类标签)

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AiGateway } from './ai.gateway';
import type { ChatMessage } from './ai.gateway';
import type { AiCategory, AiDraftRequest, AiReplySuggestion, AiRewriteRequest } from '@ai-mail/shared';

/** 交互式 AI 能力(draft/rewrite/suggestions)失败时抛出,让前端看到明确原因 */
export class AiUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'AiUnavailableError';
  }
}

const CATEGORY_SYSTEM = `你是邮件分类器。将邮件分为五类之一,只输出 JSON:{"category":"important|notification|marketing|social|other","priority":1-5}
- important: 需要收件人回复或采取行动的人际邮件(工作沟通、客户询问、私人来信)
- notification: 系统/服务通知(账单、订单、密码重置)
- marketing: 订阅推广、优惠券、产品通讯
- social: 社区、论坛、社交网络通知
- other: 其他
priority: 1=今天必须处理 5=可忽略`;

@Injectable()
export class AiService {
  constructor(
    private prisma: PrismaService,
    private gateway: AiGateway,
  ) {}

  /* ============ 新邮件管道(同步入库后触发) ============ */

  async enqueueForNewMessage(messageId: string) {
    // MVP:同步执行(简单);邮件量大时改为 BullMQ 队列,接口不变
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return;
    await this.classify(messageId);
    await this.summarize(messageId);
  }

  private messageContext(message: {
    subject: string; fromJson: string | null; bodyText: string;
  }): string {
    const from = message.fromJson ? JSON.parse(message.fromJson) : null;
    return [
      `发件人: ${from ? `${from.name ?? ''} <${from.address}>` : '未知'}`,
      `主题: ${message.subject}`,
      `正文:\n${this.gateway.desanitize(message.bodyText.slice(0, 4000))}`,
    ].join('\n');
  }

  async classify(messageId: string): Promise<AiCategory | null> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return null;
    const result = await this.gateway.callChat(
      [
        { role: 'system', content: CATEGORY_SYSTEM },
        { role: 'user', content: this.messageContext(message) },
      ],
      {
        userId: (await this.prisma.message.findUnique({ where: { id: messageId }, select: { account: { select: { userId: true } } } }))!.account.userId,
        jobType: 'classify', light: true, json: true, messageId, cacheTtlMs: 0,
      },
    );
    if (!result) return null;
    try {
      const parsed = JSON.parse(result.content) as { category: AiCategory; priority: number };
      const valid = ['important', 'notification', 'marketing', 'social', 'other'].includes(parsed.category);
      if (!valid) return null;
      await this.prisma.message.update({
        where: { id: messageId },
        data: { aiCategory: parsed.category, aiPriority: parsed.priority },
      });
      return parsed.category;
    } catch {
      return null;
    }
  }

  async summarize(messageId: string, force = false): Promise<string | null> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId }, select: { subject: true, fromJson: true, bodyText: true, aiSummary: true, account: { select: { userId: true } } },
    });
    if (!message || (!force && message.aiSummary)) return message?.aiSummary ?? null;
    const result = await this.gateway.callChat(
      [
        { role: 'system', content: '用中文把这封邮件总结成 1~2 句话,直说要点(谁、要什么、何时截止),不要寒暄。' },
        { role: 'user', content: this.messageContext(message) },
      ],
      { userId: message.account.userId, jobType: 'summarize', messageId, cacheTtlMs: 7 * 24 * 3600 * 1000 },
    );
    if (!result) return null;
    await this.prisma.message.update({
      where: { id: messageId },
      data: { aiSummary: result.content, aiSummaryGeneratedAt: new Date() },
    });
    return result.content;
  }

  /* ============ 写侧能力(同步接口,请求-响应) ============ */

  async draft(userId: string, req: AiDraftRequest): Promise<string | null> {
    let context = '';
    if (req.contextMessageId) {
      const m = await this.prisma.message.findFirst({
        where: { id: req.contextMessageId, account: { userId } },
      });
      if (m) context = `\n\n原邮件上下文:\n${this.messageContext(m)}`;
    }
    const messages: ChatMessage[] = req.previousDraft && req.followUpInstruction
      ? [
          { role: 'system', content: this.draftSystem(req) },
          { role: 'user', content: `请按以下要求修改草稿:\n${req.followUpInstruction}\n\n当前草稿:\n${req.previousDraft}` },
        ]
      : [{ role: 'system', content: this.draftSystem(req) }, { role: 'user', content: `意图:${req.intent}${context}` }];

    const result = await this.gateway.callChat(messages, { userId, jobType: 'draft', temperature: 0.5 });
    if (!result) throw new AiUnavailableError(await this.unavailableReason(userId));
    return result.content;
  }

  private draftSystem(req: AiDraftRequest): string {
    const tone = { formal: '正式、专业', friendly: '友好、自然', concise: '简洁、直入主题', apologetic: '诚恳、致歉' }[req.tone ?? 'formal'];
    return `你是邮件代笔助手。根据用户意图写一封完整的${req.language ? req.language : ''}邮件正文(HTML),语气${tone}。只输出正文本身,不要主题行,不要解释。${
      req.previousDraft ? '这是修改任务,保留原意。' : ''
    }`;
  }

  async replySuggestions(userId: string, messageId: string): Promise<AiReplySuggestion[]> {
    const m = await this.prisma.message.findFirst({ where: { id: messageId, account: { userId } } });
    if (!m) throw new NotFoundException('邮件不存在');
    const result = await this.gateway.callChat(
      [
        { role: 'system', content: `针对这封邮件给出 3 条可直接发送的简短中文回复候选,覆盖不同态度(如确认/询问/婉拒)。只输出 JSON:{"suggestions":[{"label":"6字内标签","text":"回复正文"}]}` },
        { role: 'user', content: this.messageContext(m) },
      ],
      { userId, jobType: 'draft', json: true, messageId },
    );
    if (!result) throw new AiUnavailableError(await this.unavailableReason(userId));
    try {
      return (JSON.parse(result.content) as { suggestions: AiReplySuggestion[] }).suggestions.slice(0, 3);
    } catch {
      throw new AiUnavailableError('AI 返回的回复建议格式异常,请重试或更换模型');
    }
  }

  async rewrite(userId: string, req: AiRewriteRequest): Promise<string> {
    const instruction: Record<AiRewriteRequest['action'], string> = {
      formal: '改写得更正式、专业',
      friendly: '改写得更友好、自然',
      concise: '改写得更简洁,删除冗余',
      polite: '改写得更委婉、得体',
      confident: '改写得更笃定、有说服力,去掉犹豫和过度道歉',
      polish: '修正错别字与语病,优化措辞,不改变原意与语气',
      expand: '适度扩写,补充细节与过渡,让内容更完整,但不要注水',
      'reply-positive': '以同意/接受对方请求的方向改写,给出积极的确认',
      'reply-decline': '以婉拒对方请求的方向改写,给出得体的理由和替代方案(如适用)',
      'to-en': '翻译为地道的英文商务邮件,保持结构与语气',
      'to-zh': '翻译为自然的简体中文,保持结构与语气',
      translate: `翻译为${req.targetLanguage ?? '英文'},保持语气与格式`,
    };
    // 回复场景带上原邮件上下文,润色更贴合对话
    let context = '';
    if (req.contextMessageId) {
      const m = await this.prisma.message.findFirst({
        where: { id: req.contextMessageId, account: { userId } },
      });
      if (m) context = `\n\n正在回复的原邮件(供参考,不要复述):\n主题:${m.subject}\n${m.bodyText.slice(0, 1500)}`;
    }
    const result = await this.gateway.callChat(
      [
        { role: 'system', content: `你是邮件润色助手。${instruction[req.action]}。保留段落结构,只输出改写后的文本,不要解释。` },
        { role: 'user', content: this.gateway.desanitize(req.text) + context },
      ],
      { userId, jobType: 'rewrite' },
    );
    if (!result) throw new AiUnavailableError(await this.unavailableReason(userId));
    return result.content;
  }

  /** 给交互接口的用户可读失败原因(区分「未配置」与「配置了但调用失败」) */
  private async unavailableReason(userId: string): Promise<string> {
    if (!(await this.gateway.isEnabled(userId))) {
      return '尚未配置 AI 模型,请到「设置 → AI 模型」接入';
    }
    return 'AI 调用失败,请检查设置中的 API 地址/Key/模型名是否正确(可在设置页点「测试连接」验证)';
  }

  /** AI 用量统计(设置页) */
  async usage(userId: string) {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const jobs = await this.prisma.aiJob.findMany({ where: { userId, createdAt: { gte: dayStart } } });
    const callsByType: Record<string, number> = {};
    for (const j of jobs) callsByType[j.jobType] = (callsByType[j.jobType] ?? 0) + 1;
    return {
      periodStart: dayStart.toISOString(),
      promptTokens: jobs.reduce((s, j) => s + (j.promptTokens ?? 0), 0),
      completionTokens: jobs.reduce((s, j) => s + (j.completionTokens ?? 0), 0),
      estimatedCostUsd: 0, // TODO: 按模型价格表计算
      callsByType,
    };
  }
}
