import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../crypto.service';
import { PROVIDER_PRESETS, testImapConnection, testSmtpConnection } from '@ai-mail/mail-core';
import type { ImapConfig, SmtpConfig } from '@ai-mail/mail-core';
import type { MailboxAccountDto } from '@ai-mail/shared';

@Injectable()
export class AccountsService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
  ) {}

  /** 常见邮箱预设(接入页引导) */
  presets() {
    return Object.entries(PROVIDER_PRESETS).map(([provider, preset]) => ({
      provider,
      imap: preset.imap,
      smtp: preset.smtp,
      hint: preset.hint,
    }));
  }

  private imapConfig(account: { imapHost: string; imapPort: number; imapTls: boolean; address: string; credentialsEncrypted: string }): ImapConfig {
    return {
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapTls,
      auth: { user: account.address, pass: this.crypto.decrypt(account.credentialsEncrypted) },
    };
  }

  smtpConfig(account: { smtpHost: string; smtpPort: number; smtpTls: boolean; address: string; credentialsEncrypted: string }): SmtpConfig {
    return {
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpTls,
      auth: { user: account.address, pass: this.crypto.decrypt(account.credentialsEncrypted) },
    };
  }

  /** IMAP + SMTP 双测试(保存前调用) */
  async testConnection(userId: string, input: {
    address: string; credential: string;
    imapHost: string; imapPort: number; imapTls: boolean;
    smtpHost: string; smtpPort: number; smtpTls: boolean;
  }) {
    const imap = await testImapConnection({
      host: input.imapHost, port: input.imapPort, secure: input.imapTls,
      auth: { user: input.address, pass: input.credential },
    });
    if (!imap.ok) return { ok: false, stage: 'imap', error: imap.error, hint: imap.hint };
    const smtp = await testSmtpConnection({
      host: input.smtpHost, port: input.smtpPort, secure: input.smtpTls,
      auth: { user: input.address, pass: input.credential },
    });
    if (!smtp.ok) return { ok: false, stage: 'smtp', error: smtp.error };
    return { ok: true };
  }

  async create(userId: string, input: {
    address: string; provider: string; credential: string;
    imapHost: string; imapPort: number; imapTls: boolean;
    smtpHost: string; smtpPort: number; smtpTls: boolean;
  }) {
    const test = await this.testConnection(userId, input);
    if (!test.ok) throw new BadRequestException(test);
    const account = await this.prisma.mailboxAccount.create({
      data: {
        userId,
        address: input.address,
        provider: input.provider,
        imapHost: input.imapHost, imapPort: input.imapPort, imapTls: input.imapTls,
        smtpHost: input.smtpHost, smtpPort: input.smtpPort, smtpTls: input.smtpTls,
        credentialsEncrypted: this.crypto.encrypt(input.credential),
      },
    });
    // 创建默认文件夹记录,全量同步由队列异步执行(SyncService 监听新账号)
    for (const [name, type] of [['INBOX', 'inbox'], ['Sent', 'sent'], ['Drafts', 'drafts'], ['Trash', 'trash']] as const) {
      await this.prisma.folder.create({ data: { accountId: account.id, name, folderType: type } });
    }
    return this.toDto(account);
  }

  async list(userId: string): Promise<MailboxAccountDto[]> {
    const accounts = await this.prisma.mailboxAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return accounts.map((a) => this.toDto(a));
  }

  /** 给内部模块(同步/发送 Worker)用:带解密后的连接配置 */
  async getForWorker(userId: string, accountId: string) {
    const account = await this.prisma.mailboxAccount.findFirst({ where: { id: accountId, userId } });
    if (!account) throw new NotFoundException('邮箱账号不存在');
    return { account, imap: this.imapConfig(account), smtp: this.smtpConfig(account) };
  }

  async remove(userId: string, id: string) {
    const account = await this.prisma.mailboxAccount.findFirst({ where: { id, userId } });
    if (!account) throw new NotFoundException('邮箱账号不存在');
    await this.prisma.mailboxAccount.delete({ where: { id } });
  }

  private toDto(a: {
    id: string; address: string; provider: string; syncReady: boolean;
    lastSyncAt: Date | null; lastSyncError: string | null; createdAt: Date;
  }): MailboxAccountDto {
    return {
      id: a.id, address: a.address, provider: a.provider,
      syncReady: a.syncReady, lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
      lastSyncError: a.lastSyncError ?? null,
      createdAt: a.createdAt.toISOString(),
    };
  }
}
