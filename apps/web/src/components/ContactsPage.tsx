import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { ContactBook, Plus, X, Trash, Send } from './icons';
import type { ContactDto } from '@ai-mail/shared';

/* ============ 通讯录 ============
   两栏:左列联系人名单(与邮件列表同宽,保持三栏骨架的节奏),
   右侧"信笺卡片"详情。联系人由收发邮件自动收集,也可手动添加。 */

interface Props {
  onWrite: (address: string) => void; // 给该联系人写信
}

export default function ContactsPage({ onWrite }: Props) {
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : '';
    api<ContactDto[]>(`/api/contacts${params}`)
      .then(setContacts)
      .catch(() => setContacts([]))
      .finally(() => setLoading(false));
  }, [search]);

  const selected = contacts.find((c) => c.id === selectedId) ?? null;

  function remove(id: string) {
    api(`/api/contacts/${id}`, { method: 'DELETE' })
      .then(() => {
        setContacts((prev) => prev.filter((c) => c.id !== id));
        if (selectedId === id) setSelectedId(null);
      })
      .catch(() => undefined);
  }

  return (
    <div className="flex min-w-0 flex-1">
      {/* 左列:名单 */}
      <section className="flex w-[380px] shrink-0 flex-col border-r border-[var(--hairline)] bg-[var(--surface)]">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--hairline)] px-5">
          <h2 className="text-[13.5px] font-semibold text-[var(--ink-1)]">联系人</h2>
          <div className="flex items-center gap-1 text-[var(--ink-3)]">
            {!loading && <span className="mr-1 text-[12px] tabular-nums">{contacts.length} 位</span>}
            <button
              onClick={() => { setAdding(true); setSelectedId(null); }}
              className="rounded-md p-1.5 transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--accent-strong)]"
              title="添加联系人"
              aria-label="添加联系人"
            >
              <Plus />
            </button>
          </div>
        </header>

        {/* 搜索 */}
        <div className="shrink-0 border-b border-[var(--hairline)] px-4 py-2.5">
          <input
            className="field !py-1.5 !text-[12.5px]"
            placeholder="搜索姓名或邮箱…"
            aria-label="搜索联系人"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
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

          {!loading && contacts.length === 0 && (
            <Empty
              text={search.trim() ? '没有匹配的联系人' : '收发邮件后,联系人会自动收集到这里;也可以点击右上角 + 手动添加'}
            />
          )}

          {!loading && contacts.length > 0 && (
            <ul>
              {contacts.map((c, i) => {
                const title = c.name || c.email;
                return (
                  <li key={c.id} className="anim-mail-in" style={{ animationDelay: `${Math.min(i, 12) * 22}ms` }}>
                    <button
                      onClick={() => { setSelectedId(c.id); setAdding(false); }}
                      className={`relative flex w-full gap-3 border-b border-[var(--hairline)] px-5 py-3.5 text-left transition-colors hover:bg-[var(--surface-hover)] ${
                        selectedId === c.id ? 'bg-[var(--accent-soft)]' : ''
                      }`}
                    >
                      {selectedId === c.id && <span className="absolute inset-y-0 left-0 w-[3px] bg-[var(--accent)]" />}
                      {/* 信笺式头像:纸底、墨线环、宋体首字 */}
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-[var(--paper)] font-serif text-[14px] font-semibold text-[var(--ink-2)]">
                        {title.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[13px] font-medium text-[var(--ink-1)]">{title}</span>
                          <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--ink-4)]">{lastUsedLabel(c.lastUsedAt)}</span>
                        </div>
                        <p className="mt-0.5 truncate text-[12.5px] text-[var(--ink-3)]">{c.email}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* 右侧:详情 / 添加 */}
      <section className="flex min-w-0 flex-1 flex-col bg-[var(--canvas)]">
        {adding ? (
          <AddContactCard
            onDone={(c) => { setContacts((prev) => [c, ...prev.filter((p) => p.email !== c.email)]); setAdding(false); setSelectedId(c.id); }}
            onCancel={() => setAdding(false)}
          />
        ) : selected ? (
          <ContactDetail
            key={selected.id}
            contact={selected}
            onWrite={onWrite}
            onDelete={() => remove(selected.id)}
            onRenamed={(name) => setContacts((prev) => prev.map((p) => (p.id === selected.id ? { ...p, name } : p)))}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--hairline)] bg-[var(--surface)]">
              <ContactBook className="text-[var(--ink-4)]" />
            </div>
            <p className="text-[13px] text-[var(--ink-3)]">选择一位联系人查看详情</p>
          </div>
        )}
      </section>
    </div>
  );
}

/* ============ 详情:信笺卡片 ============ */

function ContactDetail({ contact, onWrite, onDelete, onRenamed }: {
  contact: ContactDto;
  onWrite: (address: string) => void;
  onDelete: () => void;
  onRenamed: (name: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(contact.name ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState('');
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) nameInputRef.current?.focus();
  }, [editing]);

  async function saveName() {
    setError('');
    try {
      const updated = await api<ContactDto>(`/api/contacts/${contact.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      onRenamed(updated.name);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
  }

  const title = contact.name || contact.email;

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain">
      {/* 信笺卡片:航空信封边 + 素纸 */}
      <div className="paper anim-paper-out relative mx-auto mt-8 max-w-[560px] overflow-hidden rounded-2xl shadow-[var(--shadow-pop)]">
        <div className="airmail absolute inset-x-0 top-0 h-[5px]" aria-hidden="true" />
        <div className="px-8 pb-7 pt-10">
          {/* 头部:头像 + 宋体姓名 */}
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 select-none items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-[var(--paper)] font-serif text-[22px] font-semibold text-[var(--ink-2)]">
              {title.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              {editing ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={nameInputRef}
                    id="contact-name"
                    className="field !py-1.5 font-serif !text-[18px]"
                    value={name}
                    placeholder="姓名(可选)"
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditing(false); }}
                  />
                  <button className="btn-primary !px-3.5 !py-1.5" onClick={saveName}>保存</button>
                  <button className="btn-ghost !px-3 !py-1.5" onClick={() => setEditing(false)}>取消</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="truncate font-serif text-[20px] font-semibold text-[var(--ink-1)]">
                    {contact.name || <span className="text-[var(--ink-3)]">未命名</span>}
                  </h1>
                  <button
                    onClick={() => { setName(contact.name ?? ''); setEditing(true); }}
                    className="shrink-0 rounded-md px-2 py-1 text-[12px] text-[var(--ink-4)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink-1)]"
                  >
                    编辑
                  </button>
                </div>
              )}
              <p className="mt-1.5 break-all text-[13px] text-[var(--ink-2)]">{contact.email}</p>
              {error && <p className="mt-1 text-[12px] text-[var(--important)]">{error}</p>}
            </div>
          </div>

          {/* 往来信息:来自信封上的收寄记录 */}
          <dl className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--hairline)]">
            <div className="bg-[var(--paper)] px-4 py-3">
              <dt className="text-[11.5px] text-[var(--ink-4)]">来源</dt>
              <dd className="mt-1 text-[13px] font-medium text-[var(--ink-1)]">
                {contact.source === 'manual' ? '手动添加' : '自动收集'}
              </dd>
            </div>
            <div className="bg-[var(--paper)] px-4 py-3">
              <dt className="text-[11.5px] text-[var(--ink-4)]">往来邮件</dt>
              <dd className="mt-1 text-[13px] font-medium tabular-nums text-[var(--ink-1)]">{contact.usageCount} 封</dd>
            </div>
            <div className="bg-[var(--paper)] px-4 py-3">
              <dt className="text-[11.5px] text-[var(--ink-4)]">最近往来</dt>
              <dd className="mt-1 text-[13px] font-medium text-[var(--ink-1)]">
                {contact.lastUsedAt ? new Date(contact.lastUsedAt).toLocaleDateString('zh-CN') : '—'}
              </dd>
            </div>
          </dl>

          {/* 操作 */}
          <div className="mt-6 flex items-center justify-end gap-3">
            {confirmingDelete ? (
              <>
                <span className="mr-auto text-[12.5px] text-[var(--important)]">删除后可由往来邮件重新自动收集</span>
                <button className="btn-ghost" onClick={() => setConfirmingDelete(false)}>再想想</button>
                <button className="btn-primary !bg-[var(--seal)] hover:!bg-[#a03123]" onClick={onDelete}>确认删除</button>
              </>
            ) : (
              <>
                <button className="btn-ghost hover:!border-[var(--seal)] hover:!text-[var(--seal)]" onClick={() => setConfirmingDelete(true)}>
                  <Trash className="!h-3.5 !w-3.5" /> 删除
                </button>
                <button className="btn-primary" onClick={() => onWrite(contact.email)}>
                  <Send className="!h-3.5 !w-3.5" /> 写信
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ 添加联系人 ============ */

function AddContactCard({ onDone, onCancel }: {
  onDone: (c: ContactDto) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!email.trim()) return;
    setBusy(true); setError('');
    try {
      const created = await api<ContactDto>('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined }),
      });
      onDone(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    } finally { setBusy(false); }
  }

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain">
      <div className="paper anim-paper-out relative mx-auto mt-8 max-w-[560px] overflow-hidden rounded-2xl shadow-[var(--shadow-pop)]">
        <div className="airmail absolute inset-x-0 top-0 h-[5px]" aria-hidden="true" />
        <div className="px-8 pb-7 pt-9">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-[18px] font-semibold text-[var(--ink-1)]">添加联系人</h2>
            <button onClick={onCancel} aria-label="取消添加" className="rounded-md p-1.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink-1)]">
              <X />
            </button>
          </div>
          <p className="mt-1.5 text-[12.5px] text-[var(--ink-3)]">收发邮件时会自动记住对方,这里用于补充常用联系人</p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="new-contact-email">邮箱地址</label>
              <input
                id="new-contact-email"
                className="field"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              />
            </div>
            <div>
              <label className="label" htmlFor="new-contact-name">姓名(可选)</label>
              <input
                id="new-contact-name"
                className="field"
                placeholder="怎么称呼对方"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              />
            </div>
            {error && <p className="text-[12.5px] text-[var(--important)]">{error}</p>}
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button className="btn-ghost" onClick={onCancel}>取消</button>
            <button className="btn-primary" onClick={submit} disabled={busy || !email.trim()}>
              {busy ? '添加中…' : '添加'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ 工具 ============ */

function lastUsedLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return '今天';
  if (d.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(d);
  }
  return `${d.getFullYear()}`;
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--surface-hover)]">
        <ContactBook className="text-[var(--ink-4)]" />
      </div>
      <p className="max-w-[240px] text-[12.5px] leading-relaxed text-[var(--ink-3)]">{text}</p>
    </div>
  );
}
