// API client:统一鉴权与错误处理

const BASE = '';

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('aimail_token');
  return token ? { authorization: `Bearer ${token}` } : {};
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...authHeaders(), ...options.headers },
  });
  if (resp.status === 401) {
    localStorage.removeItem('aimail_token');
    window.dispatchEvent(new Event('aimail:unauthorized'));
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new ApiError(resp.status, body.message ?? `请求失败 (${resp.status})`);
  }
  return resp.json() as Promise<T>;
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem('aimail_token', token);
  else localStorage.removeItem('aimail_token');
}

export function isLoggedIn(): boolean {
  return Boolean(localStorage.getItem('aimail_token'));
}
