// 定时发送执行器:BullMQ 延时队列 → 到点经 SMTP 发送 → 追加 IMAP「已发送」+ 本地落库
// 失败指数退避重试(对应技术架构 §4.4)
// 注意:延时任务的「取消」在 API 侧通过置 cancelled 状态 + 移除 job 实现

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { PrismaService } from '../prisma.service';
import { AccountsService } from '../accounts/accounts.service';
import { MessagesService } from '../messages/messages.service';
import { appendToMailbox, createImapClient, parseEmail, sendEmail } from '@ai-mail/mail-core';

interface SendJobData {
  scheduledSendId: string;
}

@Injectable()
export class ScheduledWorker implements OnModuleInit {
  private logger = new Logger(ScheduledWorker.name);

  constructor(
    private prisma: PrismaService,
    private accounts: AccountsService,
    private messages: MessagesService,
  ) {}

  onModuleInit() {
    new Worker<SendJobData>(
      'send',
      async (job) => this.execute(job.data.scheduledSendId),
      { connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' }, concurrency: 3 },
    );
  }

  private async execute(scheduledSendId: string) {
    const record = await this.prisma.scheduledSend.findUnique({ where: { id: scheduledSendId } });
    if (!record || record.status !== 'pending') return; // 已取消/已发送

    try {
      const { account, smtp, imap } = await this.accounts.getForWorker(record.userId, record.accountId);
      const payload = JSON.parse(record.payloadJson) as {
        to: { address: string }[]; cc?: { address: string }[]; bcc?: { address: string }[];
        subject: string; bodyHtml: string;
        attachments?: { filename: string; mimeType: string; contentBase64: string }[];
      };
      const result = await sendEmail(smtp, {
        from: account.address,
        to: payload.to.map((t) => t.address),
        cc: payload.cc?.map((t) => t.address),
        bcc: payload.bcc?.map((t) => t.address),
        subject: payload.subject,
        html: payload.bodyHtml,
        attachments: payload.attachments?.map((a) => ({
          filename: a.filename,
          contentType: a.mimeType,
          content: Buffer.from(a.contentBase64, 'base64'),
        })),
      });

      await this.prisma.scheduledSend.update({
        where: { id: scheduledSendId },
        data: { status: 'sent', sentMessageIdHeader: result.messageId, lastError: null },
      });

      // 发送成功后的归档:追加 IMAP「已发送」+ 本地落库(失败不影响发送结果)
      await this.archiveSent(record.accountId, imap, account.address, result.raw).catch((e) => {
        this.logger.warn(`已发送归档失败(不影响发送): ${e instanceof Error ? e.message : e}`);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryCount = record.retryCount + 1;
      if (retryCount < 3) {
        // 指数退避重试
        await this.prisma.scheduledSend.update({
          where: { id: scheduledSendId },
          data: { retryCount, lastError: message },
        });
        throw new Error(message); // 抛出让 BullMQ 按退避策略重试
      }
      await this.prisma.scheduledSend.update({
        where: { id: scheduledSendId },
        data: { status: 'failed', lastError: message },
      });
      this.logger.error(`定时发送失败(已重试 3 次): ${message}`);
    }
  }

  /** 追加到 IMAP Sent 文件夹 + 写入本地库(direction=out) */
  private async archiveSent(accountId: string, imap: { host: string; port: number; secure: boolean; auth: { user: string; pass: string } }, fromAddress: string, raw: Buffer) {
    // 1. 本地落库
    const sentFolder = await this.prisma.folder.findFirst({ where: { accountId, folderType: 'sent' } });
    if (sentFolder) {
      const parsed = await parseEmail(raw);
      await this.messages.storeParsedMessage(accountId, sentFolder.id, null, parsed, {
        direction: 'out',
        isRead: true,
      });
    }

    // 2. 追加到 IMAP「已发送」(部分服务商 SMTP 已自动保存,重复追加由 messageId 去重兜底)
    const client = createImapClient(imap);
    await client.connect();
    try {
      await appendToMailbox(client, sentFolder?.name ?? 'Sent', raw);
    } finally {
      try { client.close(); } catch { /* 未连接时忽略 */ }
    }
  }
}
