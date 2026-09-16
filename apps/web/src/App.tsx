import { useEffect, useMemo, useState } from 'react';
import { api, isLoggedIn, setToken } from './api';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import MessageList from './components/MessageList';
import MessageView from './components/MessageView';
import Compose from './components/Compose';
import SettingsPage from './components/SettingsPage';
import ContactsPage from './components/ContactsPage';
import { Search, Settings } from './components/icons';
import type { MailboxAccountDto, MessageListQuery } from '@ai-mail/shared';

// TipTap 需要的样式(段落/标题/列表/引用/代码块的优雅默认)
import './rich-text.css';

export type View =
  | { folder: 'inbox' | 'sent' | 'starred' | 'scheduled' }
  | { category: string }
  | { search: string }
  | { contacts: true };

export default function App() {
  const [logged, setLogged] = useState(isLoggedIn());
  const [accounts, setAccounts] = useState<MailboxAccountDto[]>([]);
  const [view, setView] = useState<View>({ folder: 'inbox' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeTo, setComposeTo] = useState<string | null>(null); // 从通讯录发起写信时的预设收件人
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const handler = () => setLogged(false);
    window.addEventListener('aimail:unauthorized', handler);
    return () => window.removeEventListener('aimail:unauthorized', handler);
  }, []);

  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    if (!logged) return;
    api<MailboxAccountDto[]>('/api/accounts').then(setAccounts).catch(() => undefined);
  }, [logged, refreshKey]);

  if (!logged) {
    return <Login onLoggedIn={(t) => { setToken(t); setLogged(true); }} />;
  }

  // 用 useMemo 稳定引用:否则每次渲染(如点击邮件改变 selectedId)都会生成新 query 对象,
  // 触发 MessageView/MessageList 的 effect 依赖变化,导致列表整列重新拉取(表现为点击时列表闪动)
  const listQuery: MessageListQuery = useMemo(() => 'contacts' in view
    ? {} // 通讯录视图不走邮件列表查询
    : 'search' in view
    ? { q: view.search }
    : 'category' in view
      ? { category: view.category as MessageListQuery['category'] }
      : view.folder === 'scheduled'   // 定时队列走独立接口,不传 folder
        ? {}
        : { folder: view.folder },
    [view]);
  return (
    <div className="flex h-full flex-col">
      {/* 航空信封红白蓝斜纹:整个产品的标志性边 */}
      <div className="airmail h-[5px] shrink-0" aria-hidden="true" />
      {/* 顶栏 */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[var(--hairline)] bg-[var(--surface)] px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent)] font-serif text-[13px] font-bold text-white">邮</div>
          <span className="font-serif text-[15.5px] font-semibold tracking-tight text-[var(--ink-1)]">智能邮箱</span>
        </div>
        <div className="relative ml-2 w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-4)]" />
          <input
            className="field !py-1.5 pl-9"
            placeholder="搜索邮件…"
            aria-label="搜索邮件"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && searchText.trim()) { setView({ search: searchText.trim() }); setSelectedId(null); } }}
          />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="rounded-lg p-2 text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink-1)]"
            title="设置"
            aria-label="设置"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings />
          </button>
        </div>
      </header>

      {/* 主体三栏 */}
      <div className="flex min-h-0 flex-1">
        <Sidebar
          accounts={accounts}
          view={view}
          onSelect={(v) => { setView(v); setSelectedId(null); }}
          onCompose={() => { setComposeTo(null); setComposing(true); }}
        />
        {'contacts' in view ? (
          <ContactsPage
            onWrite={(address) => { setComposeTo(address); setComposing(true); }}
          />
        ) : (
          <>
            <MessageList
              view={view}
              query={listQuery}
              selectedId={selectedId}
              onSelect={setSelectedId}
              refreshKey={refreshKey}
              onRefresh={refresh}
              accounts={accounts}
            />
            <MessageView
              messageId={selectedId}
              onClose={() => setSelectedId(null)}
              onReplied={refresh}
            />
          </>
        )}
        {composing && (
          <Compose accounts={accounts} initialTo={composeTo} onClose={() => setComposing(false)} onSent={refresh} />
        )}
        {settingsOpen && (
          <SettingsPage
            accounts={accounts}
            refreshKey={refreshKey}
            onAccountsChanged={refresh}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
