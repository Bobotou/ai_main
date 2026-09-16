// AI 模型接入配置:设置页读写,优先级高于 .env
// API Key 加密存储;读取接口只回脱敏形式(尾 4 位)

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../crypto.service';

export interface AiConfigView {
  configured: boolean;
  baseUrl: string | null;
  apiKeyMasked: string | null; // 如 sk-****abcd
  modelChat: string | null;
  modelLight: string | null;
  enabled: boolean;
  source: 'database' | 'env' | 'none';
}

@Injectable()
export class AiConfigService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
  ) {}

  /** 给 AiGateway 的运行时配置(解密);无库配置时回退 .env */
  async resolve(userId: string): Promise<{ baseUrl: string; apiKey: string; modelChat: string; modelLight: string } | null> {
    const db = await this.prisma.aiConfig.findUnique({ where: { userId } }).catch(() => null);
    if (db?.enabled && db.baseUrl && db.apiKeyEncrypted) {
      return {
        baseUrl: db.baseUrl,
        apiKey: this.crypto.decrypt(db.apiKeyEncrypted),
        modelChat: db.modelChat || db.modelLight,
        modelLight: db.modelLight || db.modelChat,
      };
    }
    if (process.env.AI_PROVIDER_BASE_URL && process.env.AI_PROVIDER_API_KEY) {
      return {
        baseUrl: process.env.AI_PROVIDER_BASE_URL,
        apiKey: process.env.AI_PROVIDER_API_KEY,
        modelChat: process.env.AI_MODEL_CHAT ?? 'gpt-4o-mini',
        modelLight: process.env.AI_MODEL_LIGHT ?? process.env.AI_MODEL_CHAT ?? 'gpt-4o-mini',
      };
    }
    return null;
  }

  async getView(userId: string): Promise<AiConfigView> {
    const db = await this.prisma.aiConfig.findUnique({ where: { userId } }).catch(() => null);
    if (db) {
      let masked: string | null = null;
      try {
        const plain = this.crypto.decrypt(db.apiKeyEncrypted);
        masked = `${plain.slice(0, 3)}****${plain.slice(-4)}`;
      } catch { masked = '****'; }
      return {
        configured: db.enabled && Boolean(db.baseUrl),
        baseUrl: db.baseUrl, apiKeyMasked: masked,
        modelChat: db.modelChat, modelLight: db.modelLight,
        enabled: db.enabled, source: 'database',
      };
    }
    if (process.env.AI_PROVIDER_BASE_URL && process.env.AI_PROVIDER_API_KEY) {
      return {
        configured: true,
        baseUrl: process.env.AI_PROVIDER_BASE_URL,
        apiKeyMasked: '来自 .env 文件',
        modelChat: process.env.AI_MODEL_CHAT ?? null,
        modelLight: process.env.AI_MODEL_LIGHT ?? null,
        enabled: true, source: 'env',
      };
    }
    return { configured: false, baseUrl: null, apiKeyMasked: null, modelChat: null, modelLight: null, enabled: false, source: 'none' };
  }

  async save(userId: string, input: {
    baseUrl: string; apiKey?: string; modelChat: string; modelLight?: string; enabled: boolean;
  }) {
    const existing = await this.prisma.aiConfig.findUnique({ where: { userId } });
    // apiKey 留空 = 保持原有 key 不变
    const apiKeyEncrypted = input.apiKey
      ? this.crypto.encrypt(input.apiKey)
      : existing?.apiKeyEncrypted;
    if (!apiKeyEncrypted) throw new Error('API Key 不能为空');
    await this.prisma.aiConfig.upsert({
      where: { userId },
      update: {
        baseUrl: input.baseUrl, apiKeyEncrypted,
        modelChat: input.modelChat, modelLight: input.modelLight ?? input.modelChat,
        enabled: input.enabled,
      },
      create: {
        userId, baseUrl: input.baseUrl, apiKeyEncrypted,
        modelChat: input.modelChat, modelLight: input.modelLight ?? input.modelChat,
        enabled: input.enabled,
      },
    });
    return this.getView(userId);
  }

  /** 连接测试:调一次最小的 chat 请求 */
  async test(userId: string, input: { baseUrl: string; apiKey?: string; model: string }): Promise<{ ok: boolean; error?: string; models?: string[] }> {
    const resolved = await this.resolve(userId);
    const baseUrl = input.baseUrl.replace(/\/$/, '');
    const apiKey = input.apiKey ?? resolved?.apiKey;
    if (!apiKey) return { ok: false, error: 'API Key 不能为空' };
    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: input.model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (resp.ok) return { ok: true };
      const text = (await resp.text()).slice(0, 200);
      if (resp.status === 401) return { ok: false, error: 'API Key 无效(401)' };
      if (resp.status === 404) return { ok: false, error: '接口地址或模型名不对(404)' };
      return { ok: false, error: `HTTP ${resp.status}: ${text}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
