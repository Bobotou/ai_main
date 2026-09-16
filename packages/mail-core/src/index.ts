export * from './types';
export * from './connection';
export * from './parser';
export * from './sync';
export * from './sender';

/** 常见邮箱的 IMAP/SMTP 预设模板(接入页引导用) */
export const PROVIDER_PRESETS: Record<string, {
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
  hint: string;
}> = {
  gmail: {
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    hint: '需在 Google 账号开启两步验证并生成「应用专用密码」。OAuth 接入将在 M2 提供。',
  },
  qq: {
    imap: { host: 'imap.qq.com', port: 993, secure: true },
    smtp: { host: 'smtp.qq.com', port: 465, secure: true },
    hint: '在 QQ 邮箱「设置 → 账户」开启 IMAP/SMTP 服务,使用生成的授权码。',
  },
  '163': {
    imap: { host: 'imap.163.com', port: 993, secure: true },
    smtp: { host: 'smtp.163.com', port: 465, secure: true },
    hint: '在 163 邮箱「设置 → POP3/SMTP/IMAP」开启服务,使用授权码。',
  },
  outlook: {
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
    hint: 'Microsoft 个人账户已逐步禁用基础认证,建议等待 M2 的 OAuth 接入。',
  },
};
