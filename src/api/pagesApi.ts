import { getToken } from './authApi';

// Talks to the backend /pages routes (app/routers/pages_routes.py).
//
//   Builder : savePageDraft -> publishPage            (needs a login token)
//   Client  : fetchPublishedPage                      (public, no token needed)
//
// Same conventions as templatesApi.ts / gridLayoutApi.ts: absolute API_BASE,
// Bearer token when logged in, { status, data } envelope.
const API_BASE = import.meta.env.VITE_DATASTORE_API_URL ?? 'http://127.0.0.1:8000';

/** Who may view the published page (enforced by the backend). */
export type PageVisibility = 'public' | 'authenticated' | 'restricted';
export interface PageAccess {
  visibility: PageVisibility;
  allowed_emails: string[];
  allowed_roles: string[];
}

export interface PageSummary {
  id: number;
  slug: string;
  title: string;
  published_version: number | null;
  latest_version: number | null;
  has_draft: boolean;
  /** Project the page was published under (null = none). */
  project_id?: number | null;
  updated_at: string;
  visibility: PageVisibility;
  allowed_emails: string[];
  allowed_roles: string[];
}

export interface PageVersionRow {
  id: number;
  page_id: number;
  version: number;
  status: 'draft' | 'published' | 'archived';
  label: string | null;
  document: any;
  slug?: string;
  title?: string;
  access?: PageAccess;
  created_at: string;
  published_at: string | null;
}

export interface PublishedPage {
  slug: string;
  title: string;
  version: number;
  published_at: string | null;
  document: any;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    let msg = fallback;
    try {
      const body = await res.json();
      msg = body.message ?? (typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)) ?? fallback;
    } catch {
      /* keep fallback */
    }
    throw new ApiError(msg || `${fallback} (${res.status})`, res.status);
  }
  const json = await res.json();
  if (json.status && json.status !== 'success') throw new ApiError(json.message ?? fallback, res.status);
  return json.data;
}

export interface AccessOptions {
  roles: { name: string; description?: string | null }[];
  users: { email: string; user_name?: string | null; roles: string[] }[];
}

/** GET /pages/access/options - roles and users from your database, for the access pickers. */
export async function fetchAccessOptions(): Promise<AccessOptions> {
  const res = await fetch(`${API_BASE}/pages/access/options`, { headers: authHeaders() });
  return unwrap<AccessOptions>(res, 'Failed to load roles and users');
}

/** GET /pages/ - every page (builder's "Open page" list). */
export async function listPages(): Promise<PageSummary[]> {
  const res = await fetch(`${API_BASE}/pages/`, { headers: authHeaders() });
  return unwrap<PageSummary[]>(res, 'Failed to list pages');
}

/** GET /pages/{slug}/draft - latest draft, else the published version. */
export async function fetchPageForEditing(slug: string): Promise<PageVersionRow> {
  const res = await fetch(`${API_BASE}/pages/${encodeURIComponent(slug)}/draft`, { headers: authHeaders() });
  return unwrap<PageVersionRow>(res, 'Failed to load page');
}

/** PUT /pages/{slug}/draft - create the page if needed and save the draft. */
export async function savePageDraft(
  slug: string,
  payload: { title: string; document: any; label?: string; access?: PageAccess; project_id?: number },
): Promise<PageVersionRow> {
  const res = await fetch(`${API_BASE}/pages/${encodeURIComponent(slug)}/draft`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return unwrap<PageVersionRow>(res, 'Failed to save draft');
}

/** POST /pages/{slug}/publish - publish the latest draft (or a given version = rollback). */
export async function publishPage(slug: string, version?: number): Promise<PageVersionRow> {
  const res = await fetch(`${API_BASE}/pages/${encodeURIComponent(slug)}/publish`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(version ? { version } : {}),
  });
  return unwrap<PageVersionRow>(res, 'Failed to publish page');
}

/**
 * GET /pages/{slug}/published - what the client renderer loads.
 * Sends the login token when there is one. The backend answers 401 (sign in
 * first), 403 (signed in but not allowed) or 404 (not published) as ApiError.
 */
export async function fetchPublishedPage(slug: string): Promise<PublishedPage> {
  const res = await fetch(`${API_BASE}/pages/${encodeURIComponent(slug)}/published`, {
    headers: authHeaders(),
  });
  return unwrap<PublishedPage>(res, 'Failed to load page');
}