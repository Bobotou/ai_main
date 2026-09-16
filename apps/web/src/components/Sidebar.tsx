import type { MailboxAccountDto } from '@ai-mail/shared';
import type { View } from '../App';
import { Inbox, Send, Star, Clock, Sparkle, Bell, Tag, Stack, Mail, ComposeIcon, ContactBook } from './icons';

const CATEGORY_LABELS: Record<string, string> = {
  important: '重要', notification: '通知', marketing: '营销', social: '社交', other: '其他',
};

const FOLDERS: { key: 'inbox' | 'sent' | 'starred' | 'scheduled'; label: string; Icon: typeof Inbox }[] = [
  { key: 'inbox', label: '收件箱', Icon: Inbox },
  { key: 'sent', label: '已发送', Icon: Send },
  { key: 'starred', label: '星标邮件', Icon: Star },
  { key: 'scheduled', label: '定时发送', Icon: Clock },
];

interface Props {
  accounts: MailboxAccountDto[];
  view: View;
  onSelect: (v: View) => void;
  onCompose: () => void;
}

export default function Sidebar({ accounts, view, onSelect, onCompose }: Props) {
  const viewKey = 'contacts' in view ? 'contacts'
    : 'folder' in view ? view.folder
    : 'category' in view ? `cat:${view.category}`
    : 'search';
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-[var(--hairline)] bg-[var(--surface)]">
      <div className="px-4 py-4">
        <button onClick={onCompose} className="btn-primary w-full">
          <ComposeIcon /> 写信
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <p className="px-3 pb-1.5 pt-2 text-[11.5px] font-medium tracking-wide text-[var(--ink-4)]">智能视图</p>
        {[
          { key: 'important', label: '重要', Icon: Sparkle },
          { key: 'notification', label: '通知', Icon: Bell },
          { key: 'marketing', label: '营销', Icon: Tag },
          { key: 'social', label: '社交', Icon: Stack },
          { key: 'other', label: '其他', Icon: Mail },
        ].map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => onSelect({ category: key })}
            className={`nav-item ${viewKey === `cat:${key}` ? 'active' : ''}`}
          >
            <Icon /> {label}
          </button>
        ))}

        <p className="px-3 pb-1.5 pt-4 text-[11.5px] font-medium tracking-wide text-[var(--ink-4)]">文件夹</p>
        {FOLDERS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => onSelect({ folder: key })}
            className={`nav-item ${viewKey === key ? 'active' : ''}`}
          >
            <Icon /> {label}
          </button>
        ))}

        <p className="px-3 pb-1.5 pt-4 text-[11.5px] font-medium tracking-wide text-[var(--ink-4)]">通讯录</p>
        <button
          onClick={() => onSelect({ contacts: true })}
          className={`nav-item ${viewKey === 'contacts' ? 'active' : ''}`}
        >
          <ContactBook /> 联系人
        </button>

        <p className="px-3 pb-1.5 pt-4 text-[11.5px] font-medium tracking-wide text-[var(--ink-4)]">账号</p>
        {accounts.length === 0 && (
          <p className="px-3 py-1 text-[12px] leading-relaxed text-[var(--ink-4)]">
            尚未接入邮箱,点击右上角设置接入
          </p>
        )}
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] text-[var(--ink-2)]">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.syncReady ? 'bg-[var(--success)]' : 'bg-[var(--warning)] animate-pulse'}`}
                  title={a.syncReady ? '同步正常' : '首同步进行中'} />
            <span className="truncate" title={a.address}>{a.address}</span>
          </div>
        ))}
      </nav>
    </aside>
  );
}
