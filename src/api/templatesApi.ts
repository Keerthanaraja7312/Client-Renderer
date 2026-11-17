import { getToken } from './authApi';

// Backs the "Save as reusable" feature (see ../sky-view-builder/core/templateStore.ts).
// Same conventions as gridLayoutApi.ts: absolute API_BASE (not the vite dev
// proxy), Bearer token when logged in, { status, data } envelope.
const API_BASE = import.meta.env.VITE_DATASTORE_API_URL ?? 'http://127.0.0.1:8000';

export interface SavedTemplateRow {
  id: number;
  name: string;
  plugin_id: string;
  instance: any;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

async function unwrap<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `${fallbackMessage} (${res.status})`);
  }
  const json = await res.json();
  if (json.status && json.status !== 'success') {
    throw new Error(json.message ?? fallbackMessage);
  }
  return json.data;
}

/** GET /saved-templates/ — every saved Page/Block/Component snapshot. */
export async function fetchSavedTemplates(): Promise<SavedTemplateRow[]> {
  const res = await fetch(`${API_BASE}/saved-templates/`, { headers: authHeaders() });
  return unwrap<SavedTemplateRow[]>(res, 'Failed to fetch saved templates');
}

/** POST /saved-templates/ — save a new reusable snapshot. */
export async function createSavedTemplate(payload: {
  name: string;
  plugin_id: string;
  instance: any;
  created_by?: string | null;
}): Promise<SavedTemplateRow> {
  const res = await fetch(`${API_BASE}/saved-templates/`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return unwrap<SavedTemplateRow>(res, 'Failed to save template');
}

/** DELETE /saved-templates/{id} */
export async function deleteSavedTemplate(id: number | string): Promise<void> {
  const res = await fetch(`${API_BASE}/saved-templates/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await unwrap<{ message: string }>(res, 'Failed to delete template');
}

/** PUT /saved-templates/{id} — overwrite an existing snapshot in place. */
export async function updateSavedTemplate(
  id: number | string,
  payload: { name?: string; plugin_id?: string; instance?: any },
): Promise<SavedTemplateRow> {
  const res = await fetch(`${API_BASE}/saved-templates/${id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return unwrap<SavedTemplateRow>(res, 'Failed to update template');
}