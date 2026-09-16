import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { ContactDto, EmailAddress } from '@ai-mail/shared';

/** 自动收集时单次扫描历史邮件的上限(按时间倒序),避免超大邮箱全表扫描 */
const BACKFILL_SCAN_LIMIT = 3000;

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) {}

  /* ============ 查询 ============ */

  /** 列表(按最近往来排序);首次访问(表空)时从历史邮件回填 */
  async list(userId: string, q?: string): Promise<ContactDto[]> {
    const count = await this.prisma.contact.count({ where: { userId } });
    if (count === 0) await this.backfillFromHistory(userId);

    const where = {
      userId,
      ...(q?.trim() ? {
        OR: [
          { email: { contains: q.trim(), mode: 'insensitive' as const } },
          { name: { contains: q.trim(), mode: 'insensitive' as const } },
        ],
      } : {}),
    };
    const rows = await this.prisma.contact.findMany({
      where,
      orderBy: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    return rows.map((c) => this.toDto(c));
  }

  /* ============ 手动管理 ============ */

  async create(userId: string, email: string, name?: string): Promise<ContactDto> {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@')) throw new BadRequestException('邮箱地址无效');
    const contact = await this.prisma.contact.upsert({
      where: { userId_email: { userId, email: normalized } },
      update: { name: name?.trim() || undefined, source: 'manual' },
      create: { userId, email: normalized, name: name?.trim() || null, source: 'manual' },
    });
    return this.toDto(contact);
  }

  async update(userId: string, id: string, name: string | null): Promise<ContactDto> {
    const contact = await this.prisma.contact.findFirst({ where: { id, userId } });
    if (!contact) throw new NotFoundException('联系人不存在');
    const updated = await this.prisma.contact.update({
      where: { id },
      data: { name: name?.trim() || null },
    });
    return this.toDto(updated);
  }

  async remove(userId: string, id: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id, userId } });
    if (!contact) throw new NotFoundException('联系人不存在');
    await this.prisma.contact.delete({ where: { id } });
  }

  /* ============ 自动收集 ============ */

  /** 收发邮件落库时调用:upsert 联系人,补全姓名、累加使用次数、刷新最近往来 */
  async harvest(userId: string, addresses: EmailAddress[], usedAt: Date) {
    for (const addr of addresses) {
      const email = addr.address?.trim().toLowerCase();
      if (!email || !email.includes('@')) continue;
      await this.prisma.contact.upsert({
        where: { userId_email: { userId, email } },
        update: {
          // 已有手动填写的名字时不被覆盖;auto 来源则补全/更新名字
          name: addr.name?.trim() || undefined,
          usageCount: { increment: 1 },
          ...(usedAt ? { lastUsedAt: usedAt } : {}),
        },
        create: {
          userId, email,
          name: addr.name?.trim() || null,
          source: 'auto',
          usageCount: 1,
          lastUsedAt: usedAt,
        },
      });
    }
  }

  /** 历史回填:扫描已有收发邮件的地址字段(收件取 from,发件取 to/cc) */
  async backfillFromHistory(userId: string) {
    const rows = await this.prisma.message.findMany({
      where: { account: { userId } },
      orderBy: { sentAt: 'desc' },
      take: BACKFILL_SCAN_LIMIT,
      select: { direction: true, fromJson: true, toJson: true, ccJson: true, sentAt: true },
    });

    // 聚合:同一地址取最新往来时间/累计次数/任一非空姓名
    const agg = new Map<string, { name?: string; count: number; lastUsedAt: Date }>();
    const collect = (addr: EmailAddress | undefined | null, usedAt: Date) => {
      const email = addr?.address?.trim().toLowerCase();
      if (!addr || !email || !email.includes('@')) return;
      const cur = agg.get(email);
      if (cur) {
        cur.count += 1;
        if (!cur.name && addr.name?.trim()) cur.name = addr.name.trim();
        if (usedAt > cur.lastUsedAt) cur.lastUsedAt = usedAt;
      } else {
        agg.set(email, { name: addr.name?.trim() || undefined, count: 1, lastUsedAt: usedAt });
      }
    };

    for (const row of rows) {
      const from = this.parseOne(row.fromJson);
      const to = this.parseMany(row.toJson);
      const cc = this.parseMany(row.ccJson);
      // 收到的信记对方(from);发出的信记收件人(to + cc)
      if (row.direction === 'out') {
        for (const addr of [...to, ...cc]) collect(addr, row.sentAt);
      } else if (from) {
        collect(from, row.sentAt);
      }
    }

    for (const [email, info] of agg) {
      await this.prisma.contact.upsert({
        where: { userId_email: { userId, email } },
        update: { usageCount: { increment: info.count } },
        create: {
          userId, email,
          name: info.name ?? null,
          source: 'auto',
          usageCount: info.count,
          lastUsedAt: info.lastUsedAt,
        },
      });
    }
  }

  /* ============ 工具 ============ */

  private parseOne(json: string | null): EmailAddress | null {
    const arr = this.parseMany(json);
    return arr[0] ?? null;
  }

  private parseMany(json: string | null): EmailAddress[] {
    if (!json) return [];
    try {
      const v = JSON.parse(json);
      if (Array.isArray(v)) return v as EmailAddress[];
      if (v && typeof v === 'object') return [v as EmailAddress];
      return [];
    } catch {
      return [];
    }
  }

  private toDto(c: {
    id: string; email: string; name: string | null; source: string;
    usageCount: number; lastUsedAt: Date | null; createdAt: Date;
  }): ContactDto {
    return {
      id: c.id,
      email: c.email,
      name: c.name,
      source: c.source === 'manual' ? 'manual' : 'auto',
      usageCount: c.usageCount,
      lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    };
  }
}
