import { clearAuthContext, saveAuthContext } from '@/lib/permissions';

const TOKEN_KEY = 'svb_auth_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  clearAuthContext();
}

export interface LoginResult {
  token: string;
  userName: string;
  role: string;
}

const API_BASE = import.meta.env.VITE_DATASTORE_API_URL ?? '';

/** pageSlug: the page being signed in for; the backend only lets that page's project users in. */
export async function apiLogin(email: string, password: string, pageSlug?: string): Promise<LoginResult> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mail_id: email, password, ...(pageSlug ? { page_slug: pageSlug } : {}) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Login failed: ${text}`);
  }
  const json = await res.json();
  if (json.status !== 'success') throw new Error(json.message ?? 'Login failed');
  const d = json.data;
  const token = d.access ?? d.token;
  if (!token) throw new Error('No token in login response');
  setToken(token);
  saveAuthContext(d);
  return { token, userName: d.user_name ?? d.mail_id, role: d.role ?? '' };
}