import { useState } from 'react';
import { api } from '../api';

export default function Login({ onLoggedIn }: { onLoggedIn: (token: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await api<{ accessToken: string }>(`/api/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      onLoggedIn(result.accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-[var(--canvas)]">
      {/* 背景:邮政绿与朱砂各一枚安静的光晕,呼应信笺色板 */}
      <div
        className="pointer-events-none absolute -top-40 right-[-10%] h-[520px] w-[520px] rounded-full opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(13,107,63,0.15) 0%, rgba(13,107,63,0) 70%)' }}
      />
      <div
        className="pointer-events-none absolute bottom-[-20%] left-[-8%] h-[420px] w-[420px] rounded-full opacity-50 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(185,58,43,0.08) 0%, rgba(185,58,43,0) 70%)' }}
      />

      <form onSubmit={submit} className="paper relative w-[400px] max-w-[90vw] overflow-hidden rounded-2xl p-9 shadow-[var(--shadow-pop)] ring-1 ring-[var(--hairline)]">
        {/* 航空信封红白蓝斜纹边 */}
        <div className="airmail absolute inset-x-0 top-0 h-[5px]" aria-hidden="true" />
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] font-serif text-[15px] font-bold text-white">邮</div>
          <div>
            <h1 className="font-serif text-[18px] font-semibold tracking-tight text-[var(--ink-1)]">智能邮箱</h1>
            <p className="text-[12px] text-[var(--ink-3)]">读得省心 · 写得顺手</p>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="login-email">邮箱</label>
          <input
            id="login-email"
            type="email" value={email} required autoComplete="email" spellCheck={false}
            onChange={(e) => setEmail(e.target.value)}
            className="field mb-4"
            placeholder="you@example.com"
          />
          <label className="label" htmlFor="login-password">密码</label>
          <input
            id="login-password"
            type="password" value={password} required minLength={8}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
            placeholder={mode === 'login' ? '你的密码' : '至少 8 位'}
          />
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-[var(--important)]">{error}</p>}

        <button type="submit" disabled={busy} className="btn-primary mt-6 w-full !py-2.5">
          {busy ? '请稍候…' : mode === 'login' ? '登录' : '创建账号'}
        </button>

        <button
          type="button"
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
          className="mt-5 w-full text-center text-[12.5px] text-[var(--ink-3)] transition-colors hover:text-[var(--accent-strong)]"
        >
          {mode === 'login' ? '还没有账号?注册一个' : '已有账号?直接登录'}
        </button>
      </form>
    </div>
  );
}
