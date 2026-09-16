import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import RichEditor from './RichEditor';
import AddressInput from './AddressInput';
import { Sparkle, Clock, X, Plus } from './icons';
import type { ContactDto, MailboxAccountDto, OutgoingAttachment } from '@ai-mail/shared';

interface Props {
  accounts: MailboxAccountDto[];
  /** 从通讯录发起写信时的预设收件人 */
  initialTo?: string | null;
  onClose: () => void;
  onSent: () => void;
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 单附件 25MB

function toAddresses(input: string): { address: string }[] {
  return input.split(/[,;，;]/).map((s) => s.trim()).filter(Boolean).map((address) => ({ address }));
}

function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

export default function Compose({ accounts, initialTo, onClose, onSent }: Props) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [to, setTo] = useState(initialTo ?? '');
  const [cc, setCc] = useState('');
  const [contacts, setContacts] = useState<ContactDto[]>([]);

  // 打开写信框时拉一次通讯录,用于收件人/抄送自动补全
  useEffect(() => {
    api<ContactDto[]>('/api/contacts').then(setContacts).catch(() => setContacts([]));
  }, []);
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [attachments, setAttachments] = useState<OutgoingAttachment[]>([]);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiIntent, setAiIntent] = useState('');
  const [aiError, setAiError] = useState('');
  const [sent, setSent] = useState(false);      // 投递动画:盖戳阶段
  const [closing, setClosing] = useState(false); // 投递动画:信纸飞出阶段
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next: OutgoingAttachment[] = [];
    for (const f of Array.from(files)) {
      if (f.size > MAX_ATTACHMENT_BYTES) {
        setError(`附件「${f.name}」超过 25MB 限制`);
        continue;
      }
      next.push({
        filename: f.name,
        mimeType: f.type || 'application/octet-stream',
        contentBase64: '', // 占位,发送前统一读取
      });
      // 读取内容
      const idx = next.length - 1;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result ?? '');
        next[idx] = { ...next[idx], contentBase64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
      };
      reader.readAsDataURL(f);
    }
    setAttachments((prev) => [...prev, ...next]);
    setError('');
  }

  async function send() {
    setBusy(true); setError('');
    try {
      await api('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          accountId,
          to: toAddresses(to),
          cc: toAddresses(cc),
          subject,
          bodyHtml,
          attachments: attachments.filter((a) => a.contentBase64),
          ...(scheduleMode && scheduleAt ? { scheduledAt: new Date(scheduleAt).toISOString() } : {}),
        }),
      });
      // 投递动画:盖邮戳 → 信纸飞出 → 关闭(定时邮件盖"已排期"戳,日期取计划发送日)
      setSent(true);
      window.setTimeout(() => setClosing(true), 1200);
      window.setTimeout(() => { onSent(); onClose(); }, 1700);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setBusy(false);
    }
  }

  async function aiDraft() {
    if (!aiIntent.trim()) return;
    setAiBusy(true); setAiError('');
    try {
      const { text } = await api<{ text: string }>('/api/ai/draft', {
        method: 'POST',
        body: JSON.stringify({ intent: aiIntent, tone: 'formal' }),
      });
      if (text) setBodyHtml(`<p>${text.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`);
      else setAiError('AI 返回为空,请重试');
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI 生成失败');
    } finally {
      setAiBusy(false);
    }
  }

  const inputCls = 'w-full border-0 border-b border-[var(--hairline)] bg-transparent px-1 py-2 text-[13.5px] text-[var(--ink-1)] placeholder:text-[var(--ink-4)] focus:border-[var(--accent)] focus:outline-none focus:ring-0 transition-colors';

  return (
    <div className="anim-fade-in fixed inset-0 z-20 flex items-center justify-center bg-[rgba(33,40,50,0.32)] backdrop-blur-[2px]" onClick={onClose}>
      <div
        className={`paper relative flex h-[85vh] w-[820px] max-w-[94vw] flex-col overflow-hidden rounded-2xl shadow-[var(--shadow-pop)] ${closing ? 'anim-fly-away' : 'anim-paper-out'} ${sent ? 'pointer-events-none' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 航空信纸边 */}
        <div className="airmail absolute inset-x-0 top-0 z-20 h-[5px]" aria-hidden="true" />

        {/* 投递邮戳:发送成功后盖下 */}
        {sent && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--paper)]/55">
            <div className="anim-stamp flex h-36 w-36 flex-col items-center justify-center rounded-full border-[3px] border-[var(--seal)] [border-style:double]">
              <p className="font-serif text-[21px] font-bold tracking-[0.25em] text-[var(--seal)]">
                {scheduleMode ? '已排期' : '已投递'}
              </p>
              <p className="mt-1.5 text-[10px] tracking-[0.2em] text-[var(--seal)]/70">
                {(scheduleMode && scheduleAt ? new Date(scheduleAt) : new Date()).toLocaleDateString('zh-CN')} · 智能邮箱
              </p>
            </div>
          </div>
        )}

        <header className="flex shrink-0 items-center justify-between border-b border-[var(--hairline)] px-6 py-3.5">
          <h2 className="text-[14px] font-semibold text-[var(--ink-1)]">{scheduleMode ? '定时邮件' : '新邮件'}</h2>
          <button onClick={onClose} aria-label="关闭" className="rounded-md p-1.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink-1)]"><X /></button>
        </header>

        <div className="flex-1 space-y-1 overflow-y-auto overscroll-contain px-6 py-3">
          <div className="flex items-center gap-3">
            <label className="w-14 shrink-0 text-right text-[12.5px] text-[var(--ink-4)]" htmlFor="compose-account">账号</label>
            <select id="compose-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="flex-1 bg-transparent py-2 text-[13.5px] text-[var(--ink-1)] focus:outline-none">
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.address}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <label className="w-14 shrink-0 text-right text-[12.5px] text-[var(--ink-4)]" htmlFor="compose-to">收件人</label>
            <AddressInput
              id="compose-to"
              className={inputCls}
              value={to}
              onChange={setTo}
              contacts={contacts}
              placeholder="输入邮箱,多个收件人用逗号分隔"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="w-14 shrink-0 text-right text-[12.5px] text-[var(--ink-4)]" htmlFor="compose-cc">抄送</label>
            <AddressInput
              id="compose-cc"
              className={inputCls}
              value={cc}
              onChange={setCc}
              contacts={contacts}
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="w-14 shrink-0 text-right text-[12.5px] text-[var(--ink-4)]" htmlFor="compose-subject">主题</label>
            <input id="compose-subject" className={`${inputCls} font-medium`} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="邮件主题" />
          </div>

          {/* AI 代笔 */}
          <div className="!mt-4 rounded-xl bg-[var(--accent-soft)]/60 px-4 py-3">
            <div className="flex gap-2.5">
              <input
                className="field flex-1 border-transparent !bg-[var(--paper)]"
                aria-label="AI 代笔意图"
                placeholder="AI 代笔:说说你的意图,如「婉拒周四的会议,提议改到下周」"
                value={aiIntent} onChange={(e) => setAiIntent(e.target.value)}
              />
              <button className="btn-seal shrink-0" onClick={aiDraft} disabled={aiBusy || !aiIntent.trim()}>
                <Sparkle className={aiBusy ? 'anim-seal-pulse' : ''} /> {aiBusy ? '生成中…' : '生成草稿'}
              </button>
            </div>
            {aiError && <p className="mt-2 px-1 text-[12px] text-[var(--important)]">{aiError}</p>}
          </div>

          {/* 富文本正文(含 AI 润色面板) */}
          <div className="!mt-4">
            <RichEditor content={bodyHtml} onChange={setBodyHtml} />
          </div>

          {/* 附件区 */}
          <div className="!mt-4">
            {attachments.length > 0 && (
              <ul className="mb-2 flex flex-wrap gap-2">
                {attachments.map((a, i) => (
                  <li key={i} className="group flex items-center gap-2 rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[12.5px] text-[var(--ink-2)]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                    <span className="max-w-[200px] truncate">{a.filename}</span>
                    <button
                      className="text-[var(--ink-4)] opacity-0 transition-opacity hover:text-[var(--important)] group-hover:opacity-100"
                      title="移除附件"
                      onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <X className="!h-3.5 !w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--hairline-strong)] px-3.5 py-2 text-[12.5px] text-[var(--ink-3)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-strong)]"
              onClick={() => fileInputRef.current?.click()}
            >
              <Plus className="!h-3.5 !w-3.5" /> 添加附件(单个 ≤ 25MB)
            </button>
            <input
              ref={fileInputRef} type="file" multiple hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
            />
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-4 border-t border-[var(--hairline)] px-6 py-3.5">
          <label className="flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-[var(--ink-2)]">
            <input
              type="checkbox" checked={scheduleMode}
              onChange={(e) => setScheduleMode(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            <Clock className="!h-3.5 !w-3.5" /> 定时发送
          </label>
          {scheduleMode && (
            <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)}
                   className="field !w-auto !py-1.5 !text-[12.5px]" />
          )}
          {attachments.length > 0 && (
            <span className="text-[12px] text-[var(--ink-4)]">{attachments.length} 个附件</span>
          )}
          {error && <p className="text-[12.5px] text-[var(--important)]">{error}</p>}
          <div className="ml-auto flex gap-3">
            <button className="btn-ghost" onClick={onClose}>取消</button>
            <button className="btn-primary" onClick={send} disabled={busy || !to || !accountId || (scheduleMode && !scheduleAt)}>
              {busy ? '提交中…' : scheduleMode ? '安排发送' : '发送'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
