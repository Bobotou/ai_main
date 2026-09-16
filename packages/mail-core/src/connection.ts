// IMAP 连接管理与连接测试

import { ImapFlow } from 'imapflow';
import type { ImapConfig } from './types';

export interface ConnectionTestResult {
  ok: boolean;
  error?: string;
  hint?: string;
}

/** 建立一个 IMAP 连接(调用方负责 connect/ logout) */
export function createImapClient(config: ImapConfig): ImapFlow {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    logger: false,
    tls: { rejectUnauthorized: false }, // TODO: M2 提供严格证书校验开关
  });
}

/** SMTP 握手测试前的 IMAP 文件夹枚举(带 special-use 属性,用于识别「已发送」等特殊文件夹) */
export interface FolderInfo {
  path: string;
  specialUse?: string; // '\\Inbox' | '\\Sent' | '\\Drafts' | '\\Trash' | ...
  delimiter?: string;
}

/** 列出服务器上的全部文件夹 */
export async function listFolders(client: ImapFlow): Promise<FolderInfo[]> {
  const list = await client.list();
  return list.map((f) => ({ path: f.path, specialUse: f.specialUse || undefined, delimiter: f.delimiter }));
}

/** IMAP 登录测试(接入邮箱时用),给出可读的失败原因 */
export async function testImapConnection(config: ImapConfig): Promise<ConnectionTestResult> {
  const client = createImapClient(config);
  try {
    await client.connect();
    await client.mailboxOpen('INBOX');
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let hint: string | undefined;
    if (/AUTH|LOGIN|credential|password/i.test(message)) {
      hint = '账号或授权码错误。QQ/163 邮箱需使用「授权码」而非登录密码,请在邮箱设置中开启 IMAP 并生成授权码。';
    } else if (/timeout|ECONNREFUSED|ENOTFOUND/.test(message)) {
      hint = '无法连接服务器,请检查服务器地址与端口。';
    }
    return { ok: false, error: message, hint };
  } finally {
    try { client.close(); } catch { /* 未连接时忽略 */ }
  }
}
