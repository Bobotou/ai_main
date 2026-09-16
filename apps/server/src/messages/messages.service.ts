import { createHash } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type {
  MessageDetailDto, MessageListItemDto, MessageListQuery, SendMessageRequest,
} from '@ai-mail/shared';
import type { ParsedEmail } from '@ai-mail/mail-core';
import { AiService } from '../ai/ai.service';
import { ContactsService } from '../contacts/contacts.service';

const FOLDER_TYPES: Record<string, string[]> = {
  inbox: ['inbox'], sent: ['sent'], drafts: ['drafts'], archived: ['archived'], trash: ['trash'],
};

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private ai: AiService,
    private contacts: ContactsService,
  ) {}

  /* ============ 同步入库(供 SyncService 调用) ============ */

  private normalizeSubject(subject: string): string {
    return subject.toLowerCase().replace(/^((re|fw|fwd|回复|转发)\s*:\s*)+/i, '').trim();
  }

  private participantsHash(parsed: ParsedEmail): string {
    const parts = [parsed.from?.address, ...parsed.to.map((t) => t.address)].filter(Boolean).sort();
    return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
  }

  /** 同步引擎拉到的新邮件入库:解析 → 去重 → 归并会话 → 存库 → 触发 AI 管道
   *  uid 为 null 时(如 SMTP 发送后直接落库),由 messageIdHeader 去重兜底 */
  async storeParsedMessage(
    accountId: string,
    folderId: string,
    uid: number | null,
    parsed: ParsedEmail,
    opts: { direction?: 'in' | 'out'; isRead?: boolean } = {},
  ): Promise<string> {
    const account = await this.prisma.mailboxAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException();

    // 去重:同一账号同一文件夹同 UID(同步重跑);或同 messageId(本地落库 ↔ IMAP 回拉)
    if (uid !== null) {
      const dupByUid = await this.prisma.message.findFirst({ where: { accountId, folderId, uid } });
      if (dupByUid) return dupByUid.id;
    }
    if (parsed.messageId) {
      const dupByMessageId = await this.prisma.message.findFirst({
        where: { accountId, messageIdHeader: parsed.messageId },
      });
      if (dupByMessageId) return dupByMessageId.id;
    }

    const sentAt = parsed.date ?? new Date();

    // 会话归并:同 normalized subject + 参与人集合
    const existingThreadId = await this.findThreadId(
      account.userId, this.normalizeSubject(parsed.subject), this.participantsHash(parsed),
    );
    const thread = existingThreadId
      ? await this.prisma.thread.update({
          where: { id: existingThreadId },
          data: { lastMessageAt: sentAt, messageCount: { increment: 1 } },
        })
      : await this.prisma.thread.create({
          data: {
            userId: account.userId,
            subjectNorm: this.normalizeSubject(parsed.subject),
            participantsHash: this.participantsHash(parsed),
            lastMessageAt: sentAt,
            messageCount: 1,
          },
        });

    const message = await this.prisma.message.create({
      data: {
        accountId, folderId, threadId: thread.id,
        direction: opts.direction ?? 'in',
        messageIdHeader: parsed.messageId,
        fromJson: JSON.stringify(parsed.from),
        toJson: JSON.stringify(parsed.to),
        ccJson: JSON.stringify(parsed.cc),
        subject: parsed.subject,
        snippet: parsed.snippet,
        bodyText: parsed.bodyText,
        bodyHtmlSafe: parsed.bodyHtmlSafe,
        sentAt,
        sizeBytes: parsed.raw.length,
        uid,
        isRead: opts.isRead ?? false,
      },
    });

    for (const att of parsed.attachments) {
      // MVP:内联附件(图片)直接 base64 存 contentId 引用太重,先落盘到 data/attachments
      const filePath = att.content.length > 0 ? await this.saveAttachment(accountId, message.id, att) : null;
      await this.prisma.attachment.create({
        data: {
          messageId: message.id, filename: att.filename, mimeType: att.mimeType,
          sizeBytes: att.sizeBytes, isInline: att.isInline, contentId: att.contentId, filePath,
        },
      });
    }

    // 触发 AI 管道(分类 → 摘要;AI 未配置时自动跳过)
    await this.ai.enqueueForNewMessage(message.id);

    // 通讯录自动收集:收到的信记发件人,发出的信记收件人(失败不影响入库)
    await this.contacts
      .harvest(account.userId, opts.direction === 'out' ? [...parsed.to, ...parsed.cc] : parsed.from ? [parsed.from] : [], sentAt)
      .catch(() => undefined);
    return message.id;
  }

  private async findThreadId(userId: string, subjectNorm: string, participantsHash: string): Promise<string | null> {
    const existing = await this.prisma.thread.findFirst({
      where: { userId, subjectNorm, participantsHash },
      orderBy: { lastMessageAt: 'desc' },
    });
    return existing?.id ?? null;
  }

  private async saveAttachment(accountId: string, messageId: string, att: { filename: string; content: Buffer }): Promise<string> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const dir = path.join(process.cwd(), 'data', 'attachments', accountId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${messageId}-${att.filename.replace(/[\/\\]/g, '_')}`);
    await fs.writeFile(filePath, att.content);
    return filePath;
  }

  /* ============ 查询 ============ */

  async list(userId: string, query: MessageListQuery): Promise<{ items: MessageListItemDto[]; total: number }> {
    const folderTypes = query.folder ? FOLDER_TYPES[query.folder] ?? ['inbox'] : undefined;
    const where = {
      account: { userId },
      ...(folderTypes ? { folder: { folderType: { in: folderTypes } } } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.category ? { aiCategory: query.category } : {}),
      ...(query.unreadOnly ? { isRead: false } : {}),
      ...(query.folder === 'starred' ? { isStarred: true } : {}),
      ...(query.q ? {
        OR: [
          { subject: { contains: query.q, mode: 'insensitive' as const } },
          { bodyText: { contains: query.q, mode: 'insensitive' as const } },
          { fromJson: { contains: query.q, mode: 'insensitive' as const } },
        ],
      } : {}),
    };
    // 注意:starred 是跨文件夹的,上面的 folderTypes 需让路
    if (query.folder === 'starred') delete (where as Record<string, unknown>).folder;

    const pageSize = Math.min(query.pageSize ?? 50, 100);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.message.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        skip: ((query.page ?? 1) - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { labels: true } } },
      }),
      this.prisma.message.count({ where }),
    ]);
    return { items: rows.map((m) => this.toListDto(m)), total };
  }

  async get(userId: string, id: string): Promise<MessageDetailDto> {
    const message = await this.prisma.message.findFirst({
      where: { id, account: { userId } },
      include: { attachments: true },
    });
    if (!message) throw new NotFoundException('邮件不存在');
    return {
      ...this.toListDto(message),
      to: this.parseAddr(message.toJson),
      cc: this.parseAddr(message.ccJson),
      bodyText: message.bodyText,
      bodyHtmlSafe: message.bodyHtmlSafe,
      attachments: message.attachments.map((a) => ({
        id: a.id, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes, isInline: a.isInline,
      })),
      aiSummaryPoints: null, // M2:要点清单
      extractedCards: [],    // M2:信息提取卡片
    };
  }

  async markRead(userId: string, id: string, isRead: boolean) {
    await this.prisma.message.updateMany({ where: { id, account: { userId } }, data: { isRead } });
  }

  async star(userId: string, id: string, isStarred: boolean) {
    await this.prisma.message.updateMany({ where: { id, account: { userId } }, data: { isStarred } });
  }

  /** 用户纠正 AI 分类(PRD §5.1.2 反馈回流) */
  async correctCategory(userId: string, id: string, category: string) {
    await this.prisma.message.updateMany({
      where: { id, account: { userId } },
      data: { aiCategory: category },
    });
    // TODO M2:写入反馈表,生成同 sender 局部规则
  }

  /* ============ 发送 ============ */

  async send(userId: string, req: SendMessageRequest): Promise<{ id?: string; scheduled: boolean }> {
    const payload = {
      to: req.to, cc: req.cc ?? [], bcc: req.bcc ?? [], subject: req.subject, bodyHtml: req.bodyHtml,
      attachments: req.attachments ?? [],
    };
    const scheduledAt = req.scheduledAt ? new Date(req.scheduledAt) : new Date();
    const job = await this.prisma.scheduledSend.create({
      data: {
        userId, accountId: req.accountId,
        payloadJson: JSON.stringify(payload),
        scheduledAt,
        status: 'pending',
      },
    });
    const { Queue } = await import('bullmq');
    const queue = new Queue('send', { connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' } });
    if (req.scheduledAt) {
      const delay = Math.max(0, scheduledAt.getTime() - Date.now());
      await queue.add('scheduled', { scheduledSendId: job.id }, { delay, jobId: `scheduled-${job.id}` });
    } else {
      await queue.add('scheduled', { scheduledSendId: job.id }, { jobId: `scheduled-${job.id}` });
    }
    await queue.close();
    return { id: job.id, scheduled: Boolean(req.scheduledAt) };
  }

  async listScheduled(userId: string) {
    const rows = await this.prisma.scheduledSend.findMany({
      where: { userId, status: 'pending' },
      orderBy: { scheduledAt: 'asc' },
    });
    return rows.map((r) => {
      const payload = JSON.parse(r.payloadJson) as { to: { address: string }[]; subject: string };
      return {
        id: r.id, subject: payload.subject, to: payload.to,
        scheduledAt: r.scheduledAt.toISOString(), status: r.status, lastError: r.lastError,
      };
    });
  }

  async cancelScheduled(userId: string, id: string) {
    const job = await this.prisma.scheduledSend.findFirst({ where: { id, userId } });
    if (!job) throw new NotFoundException();
    if (job.status !== 'pending') throw new NotFoundException('仅待发送的邮件可取消');
    await this.prisma.scheduledSend.update({ where: { id }, data: { status: 'cancelled' } });
    const { Queue } = await import('bullmq');
    const queue = new Queue('send', { connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' } });
    await queue.remove(`scheduled-${id}`);
    await queue.close();
  }

  /** 附件下载:返回文件流 + 元信息(校验归属) */
  async getAttachment(userId: string, messageId: string, attachmentId: string) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, messageId, message: { account: { userId } } },
    });
    if (!attachment) throw new NotFoundException('附件不存在');
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = attachment.filePath
      ?? path.join(process.cwd(), 'data', 'attachments', messageId, attachment.filename);
    let content: Buffer;
    try {
      content = await fs.readFile(filePath);
    } catch {
      throw new NotFoundException('附件文件缺失(可能早于本功能同步,重新同步可恢复)');
    }
    return { attachment, content };
  }

  /* ============ DTO ============ */

  private parseAddr(json: string | null): { name?: string; address: string }[] {
    if (!json) return [];
    try {
      const v = JSON.parse(json);
      // fromJson 存的是单个地址对象,toJson/ccJson 存的是数组;统一归一为数组
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') return [v];
      return [];
    } catch {
      return [];
    }
  }

  private toListDto(m: {
    id: string; accountId: string; threadId: string | null; fromJson: string | null;
    subject: string; snippet: string; aiCategory: string | null; aiSummary: string | null;
    sentAt: Date; isRead: boolean; isStarred: boolean; direction: string;
    attachments?: unknown[];
  }): MessageListItemDto {
    return {
      id: m.id, accountId: m.accountId, threadId: m.threadId ?? '',
      from: this.parseAddr(m.fromJson)[0] ?? null,
      subject: m.subject,
      snippet: m.aiSummary ?? m.snippet,
      aiCategory: (m.aiCategory as MessageListItemDto['aiCategory']) ?? null,
      aiSummary: m.aiSummary,
      sentAt: m.sentAt.toISOString(),
      isRead: m.isRead, isStarred: m.isStarred,
      hasAttachments: (m.attachments?.length ?? 0) > 0,
      direction: m.direction as 'in' | 'out',
    };
  }
}
