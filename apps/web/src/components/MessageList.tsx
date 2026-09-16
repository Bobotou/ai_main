import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Refresh, Sparkle, Clock } from './icons';
import type { MailboxAccountDto, MessageListItemDto, MessageListQuery, ScheduledSendDto } from '@ai-mail/shared';
import type { View } from '../App';

const CATEGORY_LABELS: Record<string, string> = {
  important: '重要', notification: '通知', marketing: '营销', social: '社交', other: '其他',
};

function avatarText(name: string | undefined, address: string): string {
  const src = name?.trim() || address;
  // 取第一个字符;中文取汉字,英文取大写首字母
  return src.charAt(0).toUpperCase();
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5);
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

interface Props {
  view: View;
  query: MessageListQuery;
  selectedId: string | null;
  onSelect: (id: string) => void;
  refreshKey: number;
  onRefresh: () => void;
  accounts: MailboxAccountDto[];
}

const PAGE_SIZE = 50;

export default function MessageList({ view, query, selectedId, onSelect, refreshKey, onRefresh, accounts }: Props) {
  const [items, setItems] = useState<MessageListItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [scheduled, setScheduled] = useState<ScheduledSendDto[]>([]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const isScheduled = 'folder' in view && view.folder === 'scheduled';
  const hasMore = !isScheduled && items.length < total;

  // 视图/刷新变化:回到第一页重新拉取
  useEffect(() => {
    setLoading(true);
    if (isScheduled) {
      api<ScheduledSendDto[]>('/api/messages/scheduled')
        .then(setScheduled).catch(() => setScheduled([])).finally(() => setLoading(false));
      return;
    }
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => { if (v !== undefined) params.set(k, String(v)); });
    params.set('page', '1');
    params.set('pageSize', String(PAGE_SIZE));
    api<{ items: MessageListItemDto[]; total: number }>(`/api/messages?${params}`)
      .then((r) => { setItems(r.items); setTotal(r.total); })
      .catch(() => { setItems([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [view, query, refreshKey]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      Object.entries(query).forEach(([k, v]) => { if (v !== undefined) params.set(k, String(v)); });
      params.set('page', String(page + 1));
      params.set('pageSize', String(PAGE_SIZE));
      const r = await api<{ items: MessageListItemDto[]; total: number }>(`/api/messages?${params}`);
      setItems((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...r.items.filter((m) => !seen.has(m.id))];
      });
      setTotal(r.total);
      setPage((p) => p + 1);
    } catch { /* 网络错误时保留现状,可再次滚动触发 */ }
    finally { setLoadingMore(false); }
  };

  // 无限滚动:哨兵进入视口时加载下一页
  useEffect(() => {
    if (isScheduled || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isScheduled, loading, hasMore, loadingMore, page, view, query]);

  const title = 'contacts' in view
    ? '联系人'
    : 'search' in view
    ? `搜索「${view.search}」`
    : 'category' in view
      ? `${CATEGORY_LABELS[view.category] ?? view.category}邮件`
      : { inbox: '收件箱', sent: '已发送', starred: '星标邮件', scheduled: '定时发送' }[view.folder];

  const accountById = new Map(accounts.map((a) => [a.id, a.address]));

  return (
    <section className="flex w-[380px] shrink-0 flex-col border-r border-[var(--hairline)] bg-[var(--surface)]">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--hairline)] px-5">
        <h2 className="text-[13.5px] font-semibold text-[var(--ink-1)]">{title}</h2>
        <div className="flex items-center gap-1 text-[var(--ink-3)]">
          {!loading && !isScheduled && <span className="mr-1 text-[12px] tabular-nums">{items.length} 封</span>}
          <button onClick={onRefresh} aria-label="刷新" className="rounded-md p-1.5 transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink-1)]" title="刷新">
            <Refresh />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="space-y-4 p-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex animate-pulse gap-3">
                <div className="h-9 w-9 shrink-0 rounded-full bg-[var(--hairline)]" />
                <div className="flex-1 space-y-2 py-0.5">
                  <div className="h-3 w-2/5 rounded bg-[var(--hairline)]" />
                  <div className="h-3 w-4/5 rounded bg-[var(--hairline)]" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && isScheduled && (
          scheduled.length === 0
            ? <Empty text="没有待发送的定时邮件" />
            : scheduled.map((s, i) => (
                <div key={s.id} className="anim-mail-in group border-b border-[var(--hairline)] px-5 py-4 transition-colors hover:bg-[var(--surface-hover)]" style={{ animationDelay: `${Math.min(i, 12) * 22}ms` }}>
                  <div className="flex items-center gap-2">
                    <Clock className="text-[var(--ink-4)]" />
                    <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[var(--ink-1)]">{s.subject || '(无主题)'}</p>
                  </div>
                  <p className="mt-1 truncate text-[12.5px] text-[var(--ink-3)]">收件人 {s.to.map((t) => t.address).join(', ')}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[12px] tabular-nums text-[var(--accent-strong)]">
                      {new Date(s.scheduledAt).toLocaleString('zh-CN', { hour12: false })}
                    </span>
                    <button
                      className="rounded-md px-2 py-1 text-[12px] text-[var(--ink-4)] opacity-0 transition-opacity hover:bg-red-50 hover:text-[var(--important)] group-hover:opacity-100"
                      onClick={() => api(`/api/messages/scheduled/${s.id}`, { method: 'DELETE' }).then(onRefresh)}
                    >
                      取消发送
                    </button>
                  </div>
                </div>
              ))
        )}

        {!loading && !isScheduled && (
          items.length === 0
            ? <Empty text={accounts.length === 0 ? '接入邮箱后,邮件会出现在这里' : '暂无邮件'} />
            : <ul>
                {items.map((m, i) => {
                  const name = m.from ? (m.from.name ?? m.from.address) : '未知';
                  const addr = m.from?.address ?? '';
                  return (
                    <li key={m.id} className="anim-mail-in" style={{ animationDelay: `${Math.min(i, 12) * 22}ms` }}>
                      <button
                        onClick={() => onSelect(m.id)}
                        className={`relative flex w-full gap-3 border-b border-[var(--hairline)] px-5 py-3.5 text-left transition-colors hover:bg-[var(--surface-hover)] ${
                          selectedId === m.id ? 'bg-[var(--accent-soft)]' : ''
                        }`}
                      >
                        {selectedId === m.id && <span className="absolute inset-y-0 left-0 w-[3px] bg-[var(--accent)]" />}
                        {/* 信笺式头像:纸底、墨线环、宋体首字 */}
                        <div
                          className="mt-0.5 flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-[var(--paper)] font-serif text-[14px] font-semibold text-[var(--ink-2)]"
                        >
                          {avatarText(m.from?.name, addr)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className={`truncate text-[13px] ${m.isRead ? 'text-[var(--ink-2)]' : 'font-semibold text-[var(--ink-1)]'}`}>
                              {name}
                              {accounts.length > 1 && (
                                <span className="ml-1.5 align-middle text-[11px] font-normal text-[var(--ink-4)]">
                                  {accountById.get(m.accountId)?.split('@')[1] ?? ''}
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--ink-4)]">{timeLabel(m.sentAt)}</span>
                          </div>
                          <p className={`mt-0.5 truncate text-[13px] ${m.isRead ? 'text-[var(--ink-2)]' : 'font-medium text-[var(--ink-1)]'}`}>
                            {m.subject}
                          </p>
                          <p className="mt-1 flex items-center gap-1.5 text-[12px] leading-snug">
                            {m.aiSummary ? (
                              <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-[var(--seal-soft)] px-1 py-px text-[10.5px] font-medium text-[var(--seal)]">
                                <Sparkle className="!h-2.5 !w-2.5" /> AI
                              </span>
                            ) : null}
                            <span className={`truncate ${m.isRead ? 'text-[var(--ink-4)]' : 'text-[var(--ink-3)]'}`}>{m.snippet}</span>
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
        )}

        {/* 无限滚动哨兵 + 底部状态 */}
        {!loading && !isScheduled && (
          <div ref={sentinelRef} className="px-5 py-4 text-center text-[12px] text-[var(--ink-4)]">
            {loadingMore
              ? '加载中…'
              : hasMore
                ? '' // 哨兵静默等待进入视口
                : items.length > 0 && '已显示全部邮件'}
          </div>
        )}
      </div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--surface-hover)]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" />
        </svg>
      </div>
      <p className="text-[12.5px] text-[var(--ink-3)]">{text}</p>
    </div>
  );
}
