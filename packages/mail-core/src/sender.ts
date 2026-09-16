// SMTP 发送(nodemailer 封装)
//
// 关键设计:先用 MailComposer 生成一份原始 MIME(raw),然后用同一份 raw
//  1) 交给 SMTP 发送(nodemailer raw 透传模式)
//  2) 由调用方追加到 IMAP「已发送」+ 本地落库
// 保证三处(SMTP/IMAP/本地)看到的是完全相同的邮件。

import nodemailer from 'nodemailer';
// MailComposer 无独立类型声明,nodemailer 内部 API(公开文档认可用法)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MailComposer = require('nodemailer/lib/mail-composer');
import type { SmtpConfig } from './types';

export interface OutgoingEmail {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text?: string;
  /** 附件(内存 Buffer;M2 演进为对象存储引用) */
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  inReplyTo?: string;
  references?: string;
}

export interface SendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  /** 生成的原始 MIME,供追加到 IMAP Sent 与本地落库 */
  raw: Buffer;
}

export function createTransport(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    tls: { rejectUnauthorized: false }, // TODO: M2 提供严格证书校验开关
  });
}

export async function sendEmail(config: SmtpConfig, email: OutgoingEmail): Promise<SendResult> {
  // 生成原始 MIME
  const composer = new MailComposer({
    from: email.from,
    to: email.to,
    cc: email.cc,
    bcc: email.bcc,
    subject: email.subject,
    html: email.html,
    text: email.text,
    attachments: email.attachments,
    inReplyTo: email.inReplyTo,
    references: email.references,
  });
  const raw: Buffer = await composer.compile().build();

  const transport = createTransport(config);
  try {
    const info = await transport.sendMail({
      raw,
      envelope: {
        from: email.from,
        to: [...email.to, ...(email.cc ?? []), ...(email.bcc ?? [])],
      },
    });
    return {
      messageId: info.messageId,
      accepted: info.accepted?.map((a) => (typeof a === 'string' ? a : a.address)) ?? [],
      rejected: info.rejected?.map((a) => (typeof a === 'string' ? a : a.address)) ?? [],
      raw,
    };
  } finally {
    transport.close();
  }
}

/** SMTP 握手测试(接入邮箱时与 IMAP 测试一起做) */
export async function testSmtpConnection(config: SmtpConfig): Promise<{ ok: boolean; error?: string }> {
  const transport = createTransport(config);
  try {
    await transport.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    transport.close();
  }
}
