// 前后端共享类型 —— API DTO / 枚举 / 事件
// 修改后需保证 server 与 web 均通过 typecheck

/* ============ 枚举(字符串联合类型,兼容 Node 原生类型剥离加载) ============ */

/** AI 智能分类(对应 PRD §5.1.2) */
export type AiCategory = 'important' | 'notification' | 'marketing' | 'social' | 'other';

/** 定时发送状态 */
export type ScheduledStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

/** AI 任务类型 */
export type AiJobType = 'summarize' | 'classify' | 'embed' | 'extract' | 'draft' | 'rewrite';

/* ============ 实体 DTO ============ */

export interface MailboxAccountDto {
  id: string;
  address: string;
  provider: string;
  /** 首次全量同步是否完成 */
  syncReady: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
}

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface MessageListItemDto {
  id: string;
  accountId: string;
  threadId: string;
  from: EmailAddress | null;
  subject: string;
  /** 列表摘要行:优先 AI 摘要,回退正文截断 */
  snippet: string;
  aiCategory: AiCategory | null;
  aiSummary: string | null;
  sentAt: string;
  isRead: boolean;
  isStarred: boolean;
  hasAttachments: boolean;
  direction: 'in' | 'out';
}

export interface AttachmentDto {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** 内联附件(正文中的图片)不展示在附件列表 */
  isInline: boolean;
}

export interface ExtractedCardDto {
  type: 'event' | 'task' | 'bill' | 'parcel' | 'otp';
  payload: Record<string, unknown>;
  confidence: number;
}

export interface MessageDetailDto extends MessageListItemDto {
  to: EmailAddress[];
  cc: EmailAddress[];
  bodyText: string;
  bodyHtmlSafe: string | null;
  attachments: AttachmentDto[];
  aiSummaryPoints: string[] | null;
  extractedCards: ExtractedCardDto[];
}

export interface ScheduledSendDto {
  id: string;
  subject: string;
  to: EmailAddress[];
  scheduledAt: string;
  status: ScheduledStatus;
  lastError: string | null;
}

/* ============ 通讯录 ============ */

export interface ContactDto {
  id: string;
  email: string;
  /** 展示名,可能为空 */
  name: string | null;
  /** auto:收发邮件自动收集;manual:用户手动添加 */
  source: 'auto' | 'manual';
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ContactCreateRequest {
  email: string;
  name?: string;
}

export interface ContactUpdateRequest {
  name?: string;
}

/* ============ 请求体 ============ */

export interface CreateAccountRequest {
  address: string;
  authType: 'password';
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
  /** 授权码/密码,仅传输,服务端加密存储 */
  credential: string;
}

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  /** base64 编码的附件内容 */
  contentBase64: string;
}

export interface SendMessageRequest {
  accountId: string;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  bodyHtml: string;
  /** 未提供则立即发送;提供则为定时发送 */
  scheduledAt?: string; // ISO 时间
  attachments?: OutgoingAttachment[];
}

export interface AiDraftRequest {
  /** 用户意图说明,如「婉拒周四的会议」 */
  intent: string;
  tone?: 'formal' | 'friendly' | 'concise' | 'apologetic';
  language?: string;
  /** 回复场景下引用的原邮件上下文 */
  contextMessageId?: string;
  /** 多轮修改时的历史草稿 */
  previousDraft?: string;
  followUpInstruction?: string;
}

export interface AiRewriteRequest {
  text: string;
  action: 'formal' | 'friendly' | 'concise' | 'polite' | 'translate'
    // 场景化润色(RichEditor 的 AI 润色面板)
    | 'confident' | 'polish' | 'expand' | 'reply-positive' | 'reply-decline' | 'to-en' | 'to-zh';
  targetLanguage?: string;
  contextMessageId?: string;
}

/* ============ AI 响应 ============ */

export interface AiReplySuggestion {
  text: string;
  label: string;
}

export interface AiUsageSummary {
  periodStart: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  callsByType: Record<string, number>;
}

/* ============ 查询 ============ */

export interface MessageListQuery {
  accountId?: string;
  folder?: 'inbox' | 'sent' | 'drafts' | 'archived' | 'trash' | 'starred';
  category?: AiCategory;
  q?: string;
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
}
