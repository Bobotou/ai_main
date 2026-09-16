import { useEffect, useState } from 'react';
import { api } from '../api';
import { Mail, Plus, Refresh, Trash, X, Alert, Sparkle } from './icons';
import type { MailboxAccountDto } from '@ai-mail/shared';

interface Preset {
  provider: string;
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
  hint: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  gmail: 'Gmail', qq: 'QQ 邮箱', '163': '网易 163', outlook: 'Outlook', custom: '其他(IMAP/SMTP)',
};

/** AI 供应商快捷模板(OpenAI 兼容协议) */
const AI_PRESETS = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { label: '月之暗面', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
];

interface AiConfigView {
  configured: boolean;
  baseUrl: string | null;
  apiKeyMasked: string | null;
  modelChat: string | null;
  modelLight: string | null;
  enabled: boolean;
  source: 'database' | 'env' | 'none';
}

interface Props {
  accounts: MailboxAccountDto[];
  refreshKey: number;
  onAccountsChanged: () => void;
  onClose: () => void;
}

/** 统一的设置分区卡片 */
function Section({ icon, title, desc, action, children }: {
  icon: React.ReactNode; title: string; desc: string;
  action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--hairline)] bg-[var(--paper)]">
      <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-5">
        <div>
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--ink-1)]">{icon} {title}</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--ink-3)]">{desc}</p>
        </div>
        {action}
      </div>
      <div className="px-6 pb-5">{children}</div>
    </section>
  );
}

export default function SettingsPage({ accounts, refreshKey, onAccountsChanged, onClose }: Props) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api<Preset[]>('/api/accounts/presets').then(setPresets).catch(() => undefined);
  }, []);

  return (
    <div className="anim-fade-in fixed inset-0 z-10 flex items-center justify-center bg-[rgba(33,40,50,0.32)] backdrop-blur-[2px]"
         onClick={onClose}>
      <div className="anim-pop-in relative flex h-[86vh] w-[880px] max-w-[92vw] flex-col overflow-hidden rounded-2xl bg-[var(--canvas)] shadow-[var(--shadow-pop)]"
           onClick={(e) => e.stopPropagation()}>
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--hairline)] bg-[var(--surface)] px-7 py-4">
          <h2 className="text-[15px] font-semibold text-[var(--ink-1)]">设置</h2>
          <button onClick={onClose} aria-label="关闭" className="rounded-md p-1.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink-1)]">
            <X />
          </button>
        </header>

        {/* 内容:统一分区卡片,规整间距 */}
        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-7 py-6">
          <Section
            icon={<Mail />} title="邮箱账号"
            desc="接入你现有的邮箱,通过 IMAP/SMTP 与邮箱服务商直接同步。"
            action={<button className="btn-primary shrink-0" onClick={() => setAdding(true)}><Plus /> 接入邮箱</button>}
          >
            {accounts.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--hairline-strong)] px-6 py-10 text-center">
                <p className="text-[13px] text-[var(--ink-3)]">还没有接入邮箱</p>
                <button className="btn-ghost mt-4" onClick={() => setAdding(true)}>接入第一个邮箱</button>
              </div>
            )}
            {accounts.length > 0 && (
              <ul className="divide-y divide-[var(--hairline)] overflow-hidden rounded-xl border border-[var(--hairline)]">
                {accounts.map((a) => (
                  <li key={a.id} className="flex items-center gap-4 bg-[var(--paper)] px-5 py-3.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${a.lastSyncError ? 'bg-[var(--important)]' : a.syncReady ? 'bg-[var(--success)]' : 'bg-[var(--warning)] animate-pulse'}`}
                          title={a.lastSyncError ? '同步出错' : a.syncReady ? '同步正常' : '首次同步进行中'} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-[var(--ink-1)]">{a.address}</p>
                      <p className="mt-0.5 text-[12px] text-[var(--ink-3)]">
                        {PROVIDER_LABELS[a.provider] ?? a.provider}
                        {a.lastSyncAt && ` · 上次同步 ${new Date(a.lastSyncAt).toLocaleString('zh-CN', { hour12: false })}`}
                      </p>
                      {/* 同步失败:紧凑单行,超出截断,悬停看全文 */}
                      {a.lastSyncError && (
                        <p className="mt-1 flex items-center gap-1.5 text-[12px] text-[var(--important)]"
                           title={a.lastSyncError}>
                          <Alert className="!h-3.5 !w-3.5 shrink-0" />
                          <span className="truncate">{a.lastSyncError.split('\n')[0]}</span>
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {!a.syncReady && !a.lastSyncError && (
                        <span className="mr-1 text-[12px] text-[var(--warning)]">首同步中…</span>
                      )}
                      <button
                        className="rounded-md p-2 text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink-1)]"
                        title="重新同步"
                        onClick={() => api(`/api/accounts/${a.id}/sync`, { method: 'POST' }).then(onAccountsChanged).catch(() => undefined)}
                      >
                        <Refresh />
                      </button>
                      <button
                        className="rounded-md p-2 text-[var(--ink-3)] transition-colors hover:bg-red-50 hover:text-[var(--important)]"
                        title="删除账号"
                        onClick={() => {
                          if (confirm(`确定删除 ${a.address} 吗?本地同步的邮件数据将一并删除。`)) {
                            api(`/api/accounts/${a.id}`, { method: 'DELETE' }).then(onAccountsChanged);
                          }
                        }}
                      >
                        <Trash />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <AiConfigSection />
        </div>

        {adding && (
          <AddAccountForm
            presets={presets}
            onDone={() => { setAdding(false); onAccountsChanged(); }}
            onCancel={() => setAdding(false)}
          />
        )}
      </div>
    </div>
  );
}

/* ============ AI 模型配置 ============ */

function AiConfigSection() {
  const [config, setConfig] = useState<AiConfigView | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api<AiConfigView>('/api/ai/config').then((c) => {
      setConfig(c);
      if (!c.configured) setEditing(true);
    }).catch(() => undefined);
  }, []);

  return (
    <Section
      icon={<Sparkle />} title="AI 模型"
      desc="接入 OpenAI 兼容协议的大模型,用于摘要、分类、代笔等能力。不配置时仍可作纯邮箱使用。"
      action={config?.configured && !editing
        ? <button className="btn-ghost shrink-0" onClick={() => setEditing(true)}>修改配置</button>
        : undefined}
    >
      {config && !editing && (
        <div className="flex items-center gap-4 rounded-xl border border-[var(--hairline)] bg-[var(--paper)] px-5 py-4">
          <span className={`h-2 w-2 shrink-0 rounded-full ${config.enabled ? 'bg-[var(--success)]' : 'bg-[var(--ink-4)]'}`} />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium text-[var(--ink-1)]">
              {config.baseUrl} · {config.modelChat}
            </p>
            <p className="mt-0.5 text-[12px] text-[var(--ink-3)]">
              Key {config.apiKeyMasked}
              {config.source === 'env' && ' · 来自 .env,可在界面配置覆盖'}
              {!config.enabled && ' · 已停用'}
            </p>
          </div>
        </div>
      )}

      {editing && (
        <AiConfigForm
          current={config}
          onSaved={() => { setEditing(false);
            api<AiConfigView>('/api/ai/config').then(setConfig).catch(() => undefined); }}
          onCancel={() => { if (config?.configured) setEditing(false); }}
        />
      )}
    </Section>
  );
}

function AiConfigForm({ current, onSaved, onCancel }: {
  current: AiConfigView | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState(current?.source === 'database' ? current.baseUrl ?? '' : '');
  const [apiKey, setApiKey] = useState('');
  const [modelChat, setModelChat] = useState(current?.modelChat ?? '');
  const [modelLight, setModelLight] = useState(current?.modelLight ?? '');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  async function test() {
    setTesting(true); setError(''); setOkMsg('');
    try {
      const r = await api<{ ok: boolean; error?: string }>('/api/ai/config/test', {
        method: 'POST',
        body: JSON.stringify({ baseUrl, apiKey: apiKey || undefined, model: modelChat || modelLight }),
      });
      if (r.ok) setOkMsg('连接测试通过,可以保存了');
      else setError(r.error ?? '测试失败');
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally { setTesting(false); }
  }

  async function save() {
    setBusy(true); setError('');
    try {
      await api('/api/ai/config', {
        method: 'POST',
        body: JSON.stringify({
          baseUrl, apiKey: apiKey || undefined, modelChat: modelChat || modelLight,
          modelLight: modelLight || modelChat, enabled,
        }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl border border-[var(--hairline)] bg-[var(--paper)] p-5">
      <div className="flex flex-wrap gap-2">
        {AI_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => { setBaseUrl(p.baseUrl); if (!modelChat) setModelChat(p.model); if (!modelLight) setModelLight(p.model); }}
            className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors ${
              baseUrl === p.baseUrl
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)] font-medium'
                : 'border-[var(--hairline)] text-[var(--ink-2)] hover:border-[var(--hairline-strong)]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">API 地址(OpenAI 兼容)</label>
          <input className="field" placeholder="https://api.deepseek.com/v1" value={baseUrl}
                 onChange={(e) => setBaseUrl(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="label">
            API Key{current?.source === 'database' ? '(留空保持不变)' : ''}
          </label>
          <input className="field" type="password" placeholder="sk-…" value={apiKey}
                 onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <div>
          <label className="label">主力模型(代笔/摘要)</label>
          <input className="field" placeholder="deepseek-chat" value={modelChat}
                 onChange={(e) => setModelChat(e.target.value)} />
        </div>
        <div>
          <label className="label">轻量模型(分类,可同主力)</label>
          <input className="field" placeholder="deepseek-chat" value={modelLight}
                 onChange={(e) => setModelLight(e.target.value)} />
        </div>
      </div>

      <label className="mt-4 flex cursor-pointer select-none items-center gap-2 text-[13px] text-[var(--ink-2)]">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}
               className="h-3.5 w-3.5 accent-[var(--accent)]" />
        启用 AI 功能(关闭后摘要、分类、代笔等全部停用)
      </label>

      {okMsg && <p className="mt-3 text-[12.5px] text-[var(--success)]">{okMsg}</p>}
      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3.5 py-2.5 text-[12.5px] text-[var(--important)]">
          <Alert className="mt-0.5 !h-3.5 !w-3.5 shrink-0" /> {error}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-3">
        {current?.configured && <button className="btn-ghost" onClick={onCancel}>取消</button>}
        <button className="btn-ghost" onClick={test} disabled={testing || !baseUrl || !modelChat}>
          {testing ? '测试中…' : '测试连接'}
        </button>
        <button className="btn-primary" onClick={save} disabled={busy || !baseUrl || !modelChat}>
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}

/* ============ 接入表单 ============ */

interface FormState {
  provider: string; address: string; credential: string;
  imapHost: string; imapPort: string; imapTls: boolean;
  smtpHost: string; smtpPort: string; smtpTls: boolean;
}

function AddAccountForm({ presets, onDone, onCancel }: { presets: Preset[]; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<FormState>({
    provider: 'qq', address: '', credential: '',
    imapHost: 'imap.qq.com', imapPort: '993', imapTls: true,
    smtpHost: 'smtp.qq.com', smtpPort: '465', smtpTls: true,
  });
  const [error, setError] = useState<{ stage: string; error?: string; hint?: string } | null>(null);
  const setErr = (e: { ok?: boolean; stage?: string; error?: string; hint?: string } | null) =>
    setError(e ? { stage: e.stage ?? 'unknown', error: e.error, hint: e.hint } : null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  function applyPreset(provider: string) {
    const p = presets.find((x) => x.provider === provider);
    if (p) {
      set({
        provider, imapHost: p.imap.host, imapPort: String(p.imap.port), imapTls: p.imap.secure,
        smtpHost: p.smtp.host, smtpPort: String(p.smtp.port), smtpTls: p.smtp.secure,
      });
    } else {
      set({ provider });
    }
  }

  async function submit() {
    setBusy(true); setErr(null);
    const payload = {
      address: form.address, provider: form.provider, credential: form.credential,
      imapHost: form.imapHost, imapPort: Number(form.imapPort), imapTls: form.imapTls,
      smtpHost: form.smtpHost, smtpPort: Number(form.smtpPort), smtpTls: form.smtpTls,
    };
    try {
      const test = await api<{ ok: boolean; stage?: string; error?: string; hint?: string }>('/api/accounts/test', {
        method: 'POST', body: JSON.stringify(payload),
      });
      if (!test.ok) { setErr(test); return; }
      await api('/api/accounts', { method: 'POST', body: JSON.stringify(payload) });
      onDone();
    } catch (err) {
      const payload = err instanceof Error ? err.message : '请求失败';
      try {
        setErr(JSON.parse(payload.replace(/^[^{]+/, '')));
      } catch {
        setErr({ stage: 'unknown', error: payload });
      }
    } finally {
      setBusy(false);
    }
  }

  const currentPreset = presets.find((p) => p.provider === form.provider);

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(33,40,50,0.32)] backdrop-blur-[2px]">
      <div className="w-[560px] rounded-2xl bg-[var(--paper)] p-7 shadow-[var(--shadow-pop)]">
        <h3 className="text-[15px] font-semibold text-[var(--ink-1)]">接入邮箱</h3>
        <p className="mt-1 text-[12.5px] text-[var(--ink-3)]">选择邮箱类型,填写授权码(不是登录密码),我们会先测试连接再保存。</p>

        <div className="mt-5 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.provider}
              onClick={() => applyPreset(p.provider)}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
                form.provider === p.provider
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)] font-medium'
                  : 'border-[var(--hairline)] text-[var(--ink-2)] hover:border-[var(--hairline-strong)]'
              }`}
            >
              {PROVIDER_LABELS[p.provider] ?? p.provider}
            </button>
          ))}
        </div>

        {currentPreset?.hint && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[#8a6116]">
            {currentPreset.hint}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">邮箱地址</label>
            <input className="field" placeholder="you@example.com" value={form.address}
                   onChange={(e) => set({ address: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="label">授权码 / 密码</label>
            <input className="field" type="password" placeholder="在邮箱设置中生成的授权码"
                   value={form.credential} onChange={(e) => set({ credential: e.target.value })} />
          </div>
          <div>
            <label className="label">IMAP 服务器</label>
            <input className="field" value={form.imapHost} onChange={(e) => set({ imapHost: e.target.value })} />
          </div>
          <div>
            <label className="label">IMAP 端口</label>
            <input className="field" value={form.imapPort} onChange={(e) => set({ imapPort: e.target.value })} />
          </div>
          <div>
            <label className="label">SMTP 服务器</label>
            <input className="field" value={form.smtpHost} onChange={(e) => set({ smtpHost: e.target.value })} />
          </div>
          <div>
            <label className="label">SMTP 端口</label>
            <input className="field" value={form.smtpPort} onChange={(e) => set({ smtpPort: e.target.value })} />
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg bg-red-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-[var(--important)]">
            <Alert className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">
                {error.stage === 'imap' ? 'IMAP 连接失败' : error.stage === 'smtp' ? 'SMTP 连接失败' : '连接失败'}
              </p>
              {error.hint && <p className="mt-0.5 text-[var(--important)]/80">{error.hint}</p>}
              {!error.hint && error.error && <p className="mt-0.5 text-[var(--important)]/80">{error.error}</p>}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button className="btn-ghost" onClick={onCancel}>取消</button>
          <button className="btn-primary" disabled={busy || !form.address || !form.credential} onClick={submit}>
            {busy ? '测试连接中…' : '测试并保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
