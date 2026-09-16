// mail-core 类型定义:不依赖任何框架,供 server 的同步/发送 Worker 使用

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean; // true = 993 implicit TLS, false = STARTTLS
  auth: { user: string; pass: string };
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean; // true = 465 implicit TLS, false = STARTTLS (587)
  auth: { user: string; pass: string };
}

export interface ParsedAttachment {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  content: Buffer;
  isInline: boolean;
  contentId?: string;
}

/** mailparser 解析 + 清洗后的标准化邮件 */
export interface ParsedEmail {
  messageId: string | null;
  inReplyTo: string | null;
  subject: string;
  from: { name?: string; address: string } | null;
  to: { name?: string; address: string }[];
  cc: { name?: string; address: string }[];
  date: Date | null;
  bodyText: string;
  bodyHtmlSafe: string | null; // sanitize 后的 HTML,null 表示纯文本邮件
  snippet: string; // 前 200 字,无 AI 摘要时的列表预览
  attachments: ParsedAttachment[];
  raw: Buffer; // 原始 .eml
}

export interface SyncResult {
  mailbox: string;
  newCount: number;
  lastSeenUid: number;
  uidvalidity: number;
}
