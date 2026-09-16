// 同步服务:文件夹校准 → 首次全量同步(流式入库) → 增量同步(IDLE 优先,轮询兜底)
// 对应技术架构 §4
//
// 同步范围:收件箱 + 已发送(Sent);垃圾/草稿等文件夹按需在 M2 扩展

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AccountsService } from '../accounts/accounts.service';
import { MessagesService } from '../messages/messages.service';
import {
  createImapClient, listFolders, parseEmail, startIdleListener, syncMailbox,
} from '@ai-mail/mail-core';

const SYNC_FOLDER_TYPES = ['inbox', 'sent'] as const;

@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(SyncService.name);
  /** accountId → 停止函数 */
  private stoppers = new Map<string, () => void>();
  private shuttingDown = false;
  /** 已启动监听的账号(周期性发现新账号,避免与 AccountsModule 循环依赖) */
  private discoverTimer?: ReturnType<typeof setInterval>;

  constructor(
    private prisma: PrismaService,
    private accounts: AccountsService,
    private messages: MessagesService,
  ) {}

  async onModuleInit() {
    await this.discoverAndStartAll();
    this.discoverTimer = setInterval(() => {
      if (!this.shuttingDown) this.discoverAndStartAll().catch(() => undefined);
    }, 30_000);
  }

  private async discoverAndStartAll() {
    const accounts = await this.prisma.mailboxAccount.findMany({
      where: { id: { notIn: [...this.stoppers.keys()] } },
      select: { id: true, userId: true, address: true },
    });
    for (const account of accounts) {
      // 占位防止重复启动
      this.stoppers.set(account.id, () => undefined);
      this.startAccount(account.id, account.userId).catch((e) => {
        this.logger.error(`账号 ${account.address} 同步启动失败: ${e instanceof Error ? e.message : e}`);
      });
    }
  }

  async onModuleDestroy() {
    this.shuttingDown = true;
    if (this.discoverTimer) clearInterval(this.discoverTimer);
    for (const stop of this.stoppers.values()) stop();
  }

  async startAccount(accountId: string, userId: string) {
    await this.reconcileFolders(userId, accountId);
    await this.fullSyncIfNeeded(userId, accountId);
    await this.startIncremental(userId, accountId);
  }

  /* ============ 文件夹校准 ============ */

  /**
   * 用 IMAP special-use 属性校准文件夹的真实路径。
   * 各服务商命名不同(如 QQ 的已发送是 "Sent Messages",Gmail 是 "[Gmail]/Sent Mail"),
   * 不能写死。账号创建时的默认记录会在这一步被修正/补齐。
   */
  private async reconcileFolders(userId: string, accountId: string) {
    const { imap, account } = await this.accounts.getForWorker(userId, accountId);
    const client = createImapClient(imap);
    await client.connect();
    try {
      const folders = await listFolders(client);
      const bySpecialUse = new Map(
        folders.filter((f) => f.specialUse).map((f) => [f.specialUse as string, f.path]),
      );
      const targets: { type: string; specialUse: string; fallback?: string }[] = [
        { type: 'inbox', specialUse: '\\Inbox', fallback: 'INBOX' },
        { type: 'sent', specialUse: '\\Sent' },
        { type: 'drafts', specialUse: '\\Drafts' },
        { type: 'trash', specialUse: '\\Trash' },
      ];
      for (const t of targets) {
        const path = bySpecialUse.get(t.specialUse) ?? t.fallback;
        if (!path) continue;
        const existing = await this.prisma.folder.findFirst({ where: { accountId, folderType: t.type } });
        if (existing?.name === path) continue;
        // 路径变了:删除空的旧记录再建新记录;有邮件的旧记录保留(列表按 folderType 联合查询)
        if (existing) {
          const count = await this.prisma.message.count({ where: { folderId: existing.id } });
          if (count === 0) {
            await this.prisma.folder.delete({ where: { id: existing.id } }).catch(() => undefined);
          }
        }
        await this.prisma.folder.upsert({
          where: { accountId_name: { accountId, name: path } },
          update: { folderType: t.type },
          create: { accountId, name: path, folderType: t.type },
        });
      }
      this.logger.log(`${account.address} 文件夹校准完成: ${folders.map((f) => f.path).join(' | ')}`);
    } finally {
      try { client.close(); } catch { /* 未连接时忽略 */ }
    }
  }

  /* ============ 同步执行 ============ */

  private async setSyncError(accountId: string, error: string | null) {
    await this.prisma.mailboxAccount
      .update({ where: { id: accountId }, data: { lastSyncError: error } })
      .catch(() => undefined);
  }

  /**
   * 同步单个文件夹。full=true 为全量(受 SYNC_FULL_LIMIT 限制),
   * 流式入库:每封邮件拉到即入库,界面可以看到邮件渐进出现。
   */
  private async syncFolder(userId: string, accountId: string, folderType: string, full: boolean): Promise<number> {
    const { account, imap } = await this.accounts.getForWorker(userId, accountId);
    const folder = await this.prisma.folder.findFirst({ where: { accountId, folderType } });
    if (!folder) return 0;
    if (full && account.syncReady && folder.lastSeenUid > 0) return 0; // 已做过首同步

    const client = createImapClient(imap);
    await client.connect();
    try {
      const cursor = full ? null : { uidvalidity: folder.uidvalidity ?? 0, lastSeenUid: folder.lastSeenUid };
      let ingested = 0;
      const result = await syncMailbox(client, folder.name, cursor, {
        limit: full ? Number(process.env.SYNC_FULL_LIMIT ?? 20000) : null,
        onMessage: async (uid, raw) => {
          await this.ingestOne(accountId, folder.id, uid, raw);
          ingested += 1;
          // 每 25 封存一次游标:长同步中断可续传,不必从头再来
          if (ingested % 25 === 0) {
            await this.prisma.folder
              .update({ where: { id: folder.id }, data: { lastSeenUid: uid } })
              .catch(() => undefined);
          }
        },
      });
      await this.prisma.folder.update({
        where: { id: folder.id },
        data: { uidvalidity: result.uidvalidity, lastSeenUid: result.lastSeenUid },
      });
      if (result.newCount > 0) {
        this.logger.log(`${account.address} ${folder.name}: ${result.newCount} 封${full ? '(全量)' : '新'}`);
      }
      // 同步成功:清除历史错误(有失败先例且已恢复时不再吓用户)
      if (account.lastSyncError) await this.setSyncError(accountId, null);
      return result.newCount;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.setSyncError(accountId, `「${folder.name}」同步失败: ${message}`);
      this.logger.warn(`${account.address} ${folder.name} 同步失败: ${message}`);
      return 0;
    } finally {
      try { client.close(); } catch { /* 未连接时忽略 */ }
    }
  }

  /** 首次接入后的全量同步 */
  private async fullSyncIfNeeded(userId: string, accountId: string) {
    for (const type of SYNC_FOLDER_TYPES) {
      await this.syncFolder(userId, accountId, type, true);
    }
    await this.prisma.mailboxAccount
      .update({ where: { id: accountId }, data: { syncReady: true, lastSyncAt: new Date() } })
      .catch(() => undefined);
  }

  /** 增量同步一次(收件箱 + 已发送) */
  private async incrementalSync(userId: string, accountId: string): Promise<number> {
    let count = 0;
    for (const type of SYNC_FOLDER_TYPES) {
      count += await this.syncFolder(userId, accountId, type, false);
    }
    await this.prisma.mailboxAccount
      .update({ where: { id: accountId }, data: { lastSyncAt: new Date() } })
      .catch(() => undefined);
    return count;
  }

  private async ingestOne(accountId: string, folderId: string, uid: number, raw: Buffer) {
    try {
      const parsed = await parseEmail(raw);
      await this.messages.storeParsedMessage(accountId, folderId, uid, parsed);
    } catch (err) {
      this.logger.warn(`邮件入库失败 uid=${uid}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** 增量通道:IDLE 优先,失败降级为轮询 */
  private async startIncremental(userId: string, accountId: string) {
    this.stoppers.get(accountId)?.();
    const { account, imap } = await this.accounts.getForWorker(userId, accountId);
    const client = createImapClient(imap);

    try {
      await client.connect();
      const stop = await startIdleListener(client, 'INBOX', () => {
        this.incrementalSync(userId, accountId).catch((e) =>
          this.logger.warn(`${account.address} IDLE 触发的增量同步失败: ${e instanceof Error ? e.message : e}`),
        );
      });
      this.stoppers.set(accountId, () => stop());
      this.logger.log(`${account.address} IDLE 监听已启动`);
    } catch (err) {
      this.logger.warn(`${account.address} IDLE 不可用(${err instanceof Error ? err.message : err}),降级为轮询`);
      try { client.close(); } catch { /* 未连接时忽略 */ }
      const interval = Number(process.env.SYNC_POLL_INTERVAL ?? 120) * 1000;
      const timer = setInterval(() => {
        if (this.shuttingDown) return;
        this.incrementalSync(userId, accountId).catch(() => undefined);
      }, interval);
      this.stoppers.set(accountId, () => clearInterval(timer));
    }
  }

  /** 手动「立即同步」入口(设置页/刷新按钮) */
  async syncNow(userId: string, accountId: string) {
    const account = await this.prisma.mailboxAccount.findFirst({ where: { id: accountId, userId } });
    if (!account) return { newCount: 0 };
    if (!account.syncReady) {
      await this.startAccount(accountId, userId); // 从未同步过 → 全量
      return { newCount: -1 };
    }
    const count = await this.incrementalSync(userId, accountId);
    return { newCount: count };
  }
}
