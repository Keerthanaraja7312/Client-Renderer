const CTX_KEY = 'svb_auth_ctx';
const API_BASE = import.meta.env.VITE_DATASTORE_API_URL ?? '';

export interface AuthContext {
  role: string;
  roles: string[];
  permissions: { resource: string; action: string }[];
}

export type Action = 'create' | 'view' | 'edit' | 'delete';

// Backend action names that mean the same thing.
const SYNONYMS: Record<Action, string[]> = {
  create: ['create'],
  view: ['view', 'read'],
  edit: ['edit', 'update'],
  delete: ['delete'],
};

const ADMIN_ROLES = ['PRODUCT_ADMIN', 'ORG_ADMIN'];

export function saveAuthContext(d: any): void {
  try {
    const ctx: AuthContext = {
      role: String(d?.role ?? ''),
      roles: Array.isArray(d?.roles) ? d.roles.map((r: any) => (typeof r === 'string' ? r : r?.name)).filter(Boolean) : [],
      permissions: Array.isArray(d?.permissions) ? d.permissions : [],
    };
    localStorage.setItem(CTX_KEY, JSON.stringify(ctx));
  } catch {
    /* storage unavailable: can() then allows everything and the backend decides */
  }
}

export function clearAuthContext(): void {
  try { localStorage.removeItem(CTX_KEY); } catch { /* ignore */ }
}

function readCtx(): AuthContext | null {
  try {
    const raw = localStorage.getItem(CTX_KEY);
    return raw ? (JSON.parse(raw) as AuthContext) : null;
  } catch {
    return null;
  }
}

/** For the ?debug=perms box: what the client currently believes about the user. */
export function describeAuth(): string {
  let token = false;
  try { token = !!localStorage.getItem('svb_auth_token'); } catch { /* ignore */ }
  const ctx = readCtx();
  return JSON.stringify(
    { signedIn: token, role: ctx?.role ?? null, roles: ctx?.roles ?? null, permissions: ctx?.permissions ?? null,
      canCreateClient: can('Client', 'create'), canEditClient: can('Client', 'edit'), canDeleteClient: can('Client', 'delete') },
    null, 2,
  );
}

/** Re-read roles and permissions from the backend. Safe to call without a token. */
export async function refreshAuthContext(token: string | null): Promise<void> {
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const json = await res.json();
    if (json?.status === 'success' && json.data) saveAuthContext(json.data);
  } catch {
    /* keep the stored context */
  }
}

/**
 * Can the signed-in user do `action` on the domain model `table`?
 * Returns true when nobody is signed in (e.g. the builder's preview). A signed-in user
 * with no stored context gets false, so nothing is shown that was not confirmed.
 */
export function can(table: string | null | undefined, action: Action): boolean {
  if (!table) return true;
  const ctx = readCtx();
  if (!ctx) {
    // Nobody signed in (builder preview): nothing to restrict. Signed in but the
    // permissions were never stored (session from before this feature): hide the
    // actions until they load, instead of showing everything.
    try { return !localStorage.getItem('svb_auth_token'); } catch { return true; }
  }
  if (ADMIN_ROLES.includes(ctx.role)) return true;
  const t = String(table).toLowerCase();
  const wanted = SYNONYMS[action];
  return ctx.permissions.some(
    (p) => String(p.resource).toLowerCase() === t && wanted.includes(String(p.action).toLowerCase()),
  );
}

/**
 * Should a component bound to this data source be shown at all?
 * Table sources need `view` on that table; no source, or a query source, is not
 * restricted here (the backend still decides when the data is requested).
 */
export function canViewSource(dataSourceId: string | number | null | undefined, type?: string | null): boolean {
  if (dataSourceId === null || dataSourceId === undefined || dataSourceId === '') return true;
  if (type && type !== 'table') return true;
  return can(String(dataSourceId), 'view');
}