// IMAP 同步引擎:全量首同步 + 增量同步(IDLE / 轮询)
//
// 同步模型(对应技术架构 §4):
//  - 每账号每文件夹维护 (uidvalidity, lastSeenUid) 游标
//  - uidvalidity 变化 → 文件夹重置,全量重拉
//  - 流式入库:onMessage 回调逐封处理,不把整批邮件堆在内存里
//    (全量同步 2 万封时,一次性缓存全部 raw 可能压垮进程)
//  - IDLE 不可用时由调用方降级为定时轮询同一函数

import type { ImapFlow } from 'imapflow';
import type { SyncResult } from './types';

export interface SyncCursor {
  uidvalidity: number;
  lastSeenUid: number;
}

export interface SyncOptions {
  /** 最多拉取多少封(全量首同步的上限;增量不限) */
  limit?: number | null;
  /** 每封新邮件的回调:边拉边处理(入库),返回 Promise 时等待完成再拉下一封 */
  onMessage?: (uid: number, raw: Buffer) => void | Promise<void>;
}

/**
 * 同步单个文件夹:自 lastSeenUid 之后的新邮件通过 onMessage 逐封交给调用方。
 * 游标由调用方持久化,本函数保持无状态、可重入。
 */
export async function syncMailbox(
  client: ImapFlow,
  mailbox: string,
  cursor: SyncCursor | null,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const lock = await client.getMailboxLock(mailbox);
  let newCount = 0;
  let lastSeenUid = cursor?.lastSeenUid ?? 0;

  try {
    const status = await client.status(mailbox, { uidValidity: true } as never) as { uidValidity?: number | bigint };
    // imapflow 的 uidValidity 是 BigInt,Prisma Int 字段不吃,统一转 Number
    const uidvalidity = Number(status?.uidValidity ?? 0);

    // 服务器重置了文件夹(uidvalidity 变化) → 从头拉
    const startUid = cursor && cursor.uidvalidity === uidvalidity ? cursor.lastSeenUid + 1 : 1;
    const range = `${Math.max(1, startUid)}:*`;

    for await (const msg of client.fetch({ uid: range } as never, { uid: true, source: true } as never)) {
      if (!msg.source) continue;
      // range 为 uid:* 时即使无新邮件,服务器也可能返回游标邮件本身,过滤旧 UID
      if (cursor && cursor.uidvalidity === uidvalidity && msg.uid <= cursor.lastSeenUid) continue;
      if (options.limit && newCount >= options.limit) break;
      await options.onMessage?.(msg.uid, Buffer.from(msg.source));
      newCount += 1;
      lastSeenUid = Math.max(lastSeenUid, msg.uid);
    }

    return { mailbox, newCount, lastSeenUid, uidvalidity };
  } finally {
    lock.release();
  }
}

/** 把一封原始邮件追加到指定 IMAP 文件夹(如发送成功后写入「已发送」) */
export async function appendToMailbox(
  client: ImapFlow,
  mailbox: string,
  raw: Buffer,
  flags: string[] = ['\\Seen'],
): Promise<void> {
  await client.append(mailbox, raw, flags);
}

/**
 * 常驻 IDLE 监听。onNewMail 触发后调用方通常调用 syncMailbox 增量拉取。
 * 返回 stop 函数;连接断开时自动重连(退避),由调用方决定彻底停止。
 */
export async function startIdleListener(
  client: ImapFlow,
  mailbox: string,
  onNewMail: () => void,
): Promise<() => void> {
  let stopped = false;
  const lock = await client.getMailboxLock(mailbox);

  (async () => {
    while (!stopped) {
      try {
        await new Promise<void>((resolve) => {
          client.once('close', resolve);
          const timer = setInterval(() => {
            // 每 29 分钟 NOOP 一次,维持 IDLE 并触发服务端推送
            client.noop().catch(() => undefined);
          }, 29 * 60 * 1000);
          const cleanup = () => { clearInterval(timer); resolve(); };
          // imapflow 收到新邮件会自动结束 IDLE 并触发此事件
          client.on('exists', () => { cleanup(); onNewMail(); });
        });
      } catch {
        // 忽略,进入重连循环
      }
      if (stopped) break;
      // 连接断开:imapflow 自动重连,等待后重开邮箱继续 IDLE
      await new Promise((r) => setTimeout(r, 5000));
      try {
        await client.mailboxOpen(mailbox);
      } catch {
        // 重连失败则继续等待
      }
    }
  })();

  return () => {
    stopped = true;
    try { lock.release(); } catch { /* 已释放 */ }
  };
}
