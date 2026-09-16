import { useEffect, useState } from 'react';
import { api } from '../api';
import { Sparkle, X, Star, Trash, Send } from './icons';
import type { AiReplySuggestion, AttachmentDto, MessageDetailDto } from '@ai-mail/shared';

interface Props {
  messageId: string | null;
  onClose: () => void;
  onReplied: () => void;
}

export default function MessageView({ messageId, onClose }: Props) {
  const [message, setMessage] = useState<MessageDetailDto | null>(null);
  const [suggestions, setSuggestions] = useState<AiReplySuggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [replyTo, setReplyTo] = useState<{ subject: string; to: string; messageId: string } | null>(null);

  useEffect(() => {
    setMessage(null); setSuggestions([]); setReplyTo(null);
    if (!messageId) return;
    setLoading(true);
    api<MessageDetailDto>(`/api/messages/${messageId}`)
      .then((m) => {
        setMessage(m);
        api(`/api/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ isRead: true }) }).catch(() => undefined);
      })
      .catch(() => setMessage(null))
      .finally(() => setLoading(false));
  }, [messageId]);

  if (!messageId) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-3 bg-[var(--canvas)]">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--hairline)] bg-[var(--surface)]">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" />
          </svg>
        </div>
        <p className="text-[13px] text-[var(--ink-3)]">选择一封邮件开始阅读</p>
      </section>
    );
  }
  if (loading) return <section className="flex-1 bg-[var(--canvas)]" />;
  if (!message) {
    return (
      <section className="flex flex-1 items-center justify-center bg-[var(--canvas)] text-[13px] text-[var(--ink-3)]">
        邮件加载失败
      </section>
    );
  }

  const html = message.bodyHtmlSafe ?? message.bodyText.replace(/\n/g, '<br>');

  async function loadSuggestions() {
    setSuggestLoading(true); setSuggestError('');
    try {
      setSuggestions(await api<AiReplySuggestion[]>(`/api/ai/messages/${messageId}/suggestions`, { method: 'POST' }));
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : '获取失败');
    } finally { setSuggestLoading(false); }
  }

  async function generateSummary(force = false) {
    setSummarizing(true); setSummaryError('');
    try {
      await api(`/api/ai/messages/${messageId}/summarize${force ? '?force=1' : ''}`, { method: 'POST' });
      // 重新拉取邮件以显示新生成的摘要
      const m = await api<MessageDetailDto>(`/api/messages/${messageId}`);
      setMessage(m);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : '生成失败');
    } finally { setSummarizing(false); }
  }

  /** 附件下载:带鉴权 fetch → blob → 保存 */
  async function downloadAttachment(att: AttachmentDto) {
    setDownloadError('');
    try {
      const token = localStorage.getItem('aimail_token');
      const resp = await fetch(`/api/messages/${messageId}/attachments/${att.id}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.message ?? `下载失败 (${resp.status})`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err instanceof Error ? `${att.filename}:${err.message}` : '下载失败');
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[var(--canvas)]">
      {/* 工具条 */}
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-[var(--hairline)] bg-[var(--surface)] px-4">
        <button
          className="btn-ghost !px-3 !py-1.5 !text-[12.5px]"
          onClick={() => message && setReplyTo({
            subject: message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`,
            to: message.from?.address ?? '',
            messageId: message.id,
          })}
        >
          <Send className="!h-3.5 !w-3.5" /> 回复
        </button>
        <div className="ml-1 flex items-center gap-0.5 text-[var(--ink-3)]">
          <button className="rounded-md p-1.5 transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--seal)]" title="星标" aria-label="星标"
                  onClick={() => api(`/api/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ isStarred: !message.isStarred }) }).catch(() => undefined)}>
            <Star key={String(message.isStarred)} className={message.isStarred ? 'anim-star-pop fill-[var(--seal)] text-[var(--seal)]' : ''} />
          </button>
          <button className="rounded-md p-1.5 transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--important)]" title="删除" aria-label="删除">
            <Trash />
          </button>
        </div>
        <button onClick={onClose} aria-label="关闭" className="ml-auto rounded-md p-1.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink-1)]">
          <X />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-8 py-7">
          {/* 邮件头:信笺式头像 + 宋体主题 + 邮戳式日期 */}
          <div className="flex items-start gap-4">
            <div className="mt-1 flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-[var(--paper)] font-serif text-[15px] font-semibold text-[var(--ink-2)]">
              {(message.from?.name ?? message.from?.address ?? '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-serif text-[19px] font-semibold leading-snug text-balance text-[var(--ink-1)]">{message.subject}</h1>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--ink-3)]">
                <span className="font-medium text-[var(--ink-2)]">{message.from?.name ?? ''}</span>
                {' <'}{message.from?.address}{'>'} · {new Date(message.sentAt).toLocaleString('zh-CN', { hour12: false })}
                <br />
                收件人 {message.to.map((t) => t.address).join(', ')}
              </p>
            </div>
            <div
              className="postmark anim-stamp-soft mt-1 shrink-0"
              style={{ animationDelay: '220ms' }}
              title={new Date(message.sentAt).toLocaleString('zh-CN', { hour12: false })}
              aria-hidden="true"
            >
              <b>{new Date(message.sentAt).getMonth() + 1}月{new Date(message.sentAt).getDate()}日</b>
              <span>{String(new Date(message.sentAt).getHours()).padStart(2, '0')}:{String(new Date(message.sentAt).getMinutes()).padStart(2, '0')}</span>
            </div>
          </div>

          {/* AI 摘要 */}
          {message.aiSummary ? (
            <div className="paper mt-5 rounded-xl border border-[var(--seal-ring)] p-4">
              <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--seal)]">
                <Sparkle className="!h-3.5 !w-3.5" /> AI 摘要
                <button
                  className="ml-auto rounded-md px-1.5 py-0.5 font-normal text-[var(--ink-4)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink-1)]"
                  title="重新生成摘要"
                  onClick={() => generateSummary(true)} disabled={summarizing}
                >
                  {summarizing ? '生成中…' : '重新生成'}
                </button>
              </p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">{message.aiSummary}</p>
            </div>
          ) : (
            <div className="mt-5">
              <button
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--paper)] px-3.5 py-1.5 text-[12.5px] text-[var(--ink-2)] transition-colors hover:border-[var(--seal)] hover:text-[var(--seal)] disabled:opacity-50"
                onClick={() => generateSummary()} disabled={summarizing}
              >
                <Sparkle className={`!h-3.5 !w-3.5 ${summarizing ? 'anim-seal-pulse' : ''}`} />
                {summarizing ? '生成中…(约数秒)' : '生成 AI 摘要'}
              </button>
              {summaryError && <p className="mt-2 text-[12px] text-[var(--important)]">{summaryError}</p>}
            </div>
          )}

          {/* 智能回复建议 */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {suggestions.length === 0 ? (
              <button
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--paper)] px-3.5 py-1.5 text-[12.5px] text-[var(--ink-2)] transition-colors hover:border-[var(--seal)] hover:text-[var(--seal)]"
                onClick={loadSuggestions} disabled={suggestLoading}
              >
                <Sparkle className={`!h-3.5 !w-3.5 ${suggestLoading ? 'anim-seal-pulse' : ''}`} />
                {suggestLoading ? '生成中…' : '获取回复建议'}
              </button>
            ) : (
              suggestions.map((s, i) => (
                <button
                  key={i}
                  className="max-w-full rounded-full bg-[var(--paper)] px-3.5 py-1.5 text-[12.5px] text-[var(--ink-2)] shadow-[0_1px_2px_rgba(33,40,50,0.05)] ring-1 ring-[var(--hairline)] transition-[box-shadow] hover:ring-[var(--seal)]"
                  title={s.text}
                  onClick={() => message && setReplyTo({
                    subject: message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`,
                    to: message.from?.address ?? '',
                    messageId: message.id,
                  })}
                >
                  <span className="font-medium text-[var(--seal)]">{s.label}</span>
                  <span className="ml-1.5 text-[var(--ink-3)]">{s.text.slice(0, 20)}…</span>
                </button>
              ))
            )}
            {suggestError && <span className="text-[12px] text-[var(--important)]">{suggestError}</span>}
          </div>

          {/* 正文 */}
          {/* 正文:素纸(颗粒纸纹,无横线) */}
          <div className="paper mt-6 overflow-hidden rounded-xl ring-1 ring-[var(--hairline)]">
            <iframe
              title="email-body"
              sandbox=""
              className="email-body h-[min(62vh,600px)] w-full"
              srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:20px 24px;background:transparent;color:#212832;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.75;overflow-wrap:break-word}img{max-width:100%}img[data-blocked-src]{display:none}a{color:#0d6b3f}blockquote{margin:0;padding-left:14px;border-left:3px solid #e5e2d6;color:#4b535c}</style></head><body>${html}</body></html>`}
            />
          </div>

          {/* 附件(内联图片不展示) */}
          {message.attachments.filter((a) => !a.isInline).length > 0 && (
            <div className="mt-5">
              <p className="mb-2.5 text-[12px] font-medium text-[var(--ink-3)]">
                {message.attachments.filter((a) => !a.isInline).length} 个附件
              </p>
              <div className="flex flex-wrap gap-2.5">
                {message.attachments.filter((a) => !a.isInline).map((a) => (
                  <button
                    key={a.id}
                    onClick={() => downloadAttachment(a)}
                    className="flex items-center gap-2.5 rounded-lg border border-[var(--hairline)] bg-[var(--paper)] px-3.5 py-2.5 text-left transition-colors hover:border-[var(--accent)]"
                    title={`下载 ${a.filename}`}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                    <div>
                      <p className="text-[12.5px] font-medium text-[var(--ink-1)]">{a.filename}</p>
                      <p className="text-[11px] text-[var(--ink-4)]">{Math.ceil(a.sizeBytes / 1024)} KB · 点击下载</p>
                    </div>
                  </button>
                ))}
              </div>
              {downloadError && <p className="mt-2 text-[12px] text-[var(--important)]">{downloadError}</p>}
            </div>
          )}
        </div>
      </div>

      {/* 回复浮层 */}
      {replyTo && message && (
        <QuickReply
          to={replyTo.to}
          subject={replyTo.subject}
          contextMessageId={replyTo.messageId}
          onClose={() => setReplyTo(null)}
          onSent={onClose}
        />
      )}
    </section>
  );
}

/* ============ 快速回复浮层 ============ */

function QuickReply({ to, subject, contextMessageId, onClose, onSent }: {
  to: string; subject: string; contextMessageId: string;
  onClose: () => void; onSent: () => void;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [intent, setIntent] = useState('');
  const [sent, setSent] = useState(false);       // 投递动画:盖戳阶段
  const [closing, setClosing] = useState(false); // 投递动画:信纸飞出阶段

  async function aiDraft() {
    if (!intent.trim()) return;
    setAiBusy(true);
    try {
      const { text } = await api<{ text: string }>('/api/ai/draft', {
        method: 'POST',
        body: JSON.stringify({ intent, contextMessageId, tone: 'formal' }),
      });
      if (text) {
        const div = document.createElement('div');
        div.innerHTML = text;
        setBody(div.textContent ?? text);
      }
    } catch (err) {
      // AI 失败时在意图输入框下给出提示
      console.error('AI 代笔失败:', err);
    } finally { setAiBusy(false); }
  }

  async function send() {
    const accounts = await api<MailboxAccountDtoLite[]>('/api/accounts');
    if (accounts.length === 0) return;
    setBusy(true);
    try {
      await api('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          accountId: accounts[0].id,
          to: [{ address: to }],
          subject,
          bodyHtml: `<div>${body.replace(/\n/g, '<br>')}</div>`,
        }),
      });
      // 投递动画:盖邮戳 → 信纸飞出 → 关闭
      setSent(true);
      window.setTimeout(() => setClosing(true), 1150);
      window.setTimeout(() => { onSent(); }, 1650);
    } finally { setBusy(false); }
  }

  return (
    <div className="anim-fade-in absolute inset-0 z-10 flex items-end justify-center bg-[rgba(33,40,50,0.18)]" onClick={onClose}>
      <div
        className={`paper relative mb-8 flex w-[680px] max-w-[92vw] flex-col overflow-hidden rounded-2xl shadow-[var(--shadow-pop)] ${closing ? 'anim-fly-away' : 'anim-paper-out'} ${sent ? 'pointer-events-none' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 航空信纸边 */}
        <div className="airmail absolute inset-x-0 top-0 z-20 h-[5px]" aria-hidden="true" />

        {/* 投递邮戳:发送成功后盖下 */}
        {sent && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--paper)]/55">
            <div className="anim-stamp flex h-28 w-28 flex-col items-center justify-center rounded-full border-[3px] border-[var(--seal)] [border-style:double]">
              <p className="font-serif text-[17px] font-bold tracking-[0.25em] text-[var(--seal)]">已投递</p>
              <p className="mt-1 text-[9.5px] tracking-[0.2em] text-[var(--seal)]/70">
                {new Date().toLocaleDateString('zh-CN')} · 智能邮箱
              </p>
            </div>
          </div>
        )}

        <header className="flex items-center justify-between border-b border-[var(--hairline)] px-6 py-3">
          <h3 className="text-[13.5px] font-semibold text-[var(--ink-1)]">回复 · {to}</h3>
          <button onClick={onClose} aria-label="关闭" className="rounded-md p-1.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-hover)]"><X /></button>
        </header>
        <div className="space-y-3 px-6 py-4">
          <div className="flex gap-2">
            <input
              className="field flex-1 !text-[12.5px]"
              placeholder="AI 代笔:说说你的意图,如「确认收到,周五前给结果」"
              value={intent} onChange={(e) => setIntent(e.target.value)}
            />
            <button className="btn-seal shrink-0 !py-1.5" onClick={aiDraft} disabled={aiBusy || !intent.trim()}>
              <Sparkle className={`!h-3.5 !w-3.5 ${aiBusy ? 'anim-seal-pulse' : ''}`} /> {aiBusy ? '生成中…' : '生成'}
            </button>
          </div>
          <textarea
            className="field email-body paper-ruled h-40 resize-none"
            placeholder="正文…"
            value={body} onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <footer className="flex justify-end gap-3 border-t border-[var(--hairline)] px-6 py-3">
          <button className="btn-ghost" onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={send} disabled={busy || !body.trim()}>发送</button>
        </footer>
      </div>
    </div>
  );
}

type MailboxAccountDtoLite = { id: string };
