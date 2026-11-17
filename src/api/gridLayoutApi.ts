import { getToken } from './authApi';

// Separate endpoint from userInteractionApi.ts on purpose: this saves ONLY
// the react-grid-layout positions ({ lg: [{ i, x, y, w, h }, ...] }), never
// component config/query/state. Rename the path below to match whatever
// route your backend exposes for this resource.
const API_BASE = import.meta.env.VITE_DATASTORE_API_URL ?? 'http://127.0.0.1:8000';

export interface SaveGridLayoutPayload {
  page_name: string;
  layout_data: any;
  label?: string;
  created_by: string | null;
}

export interface SaveGridLayoutResponse {
  status: string;
  data?: {
    id: number;
    page_name: string;
    layout_data: any;
    label: string;
    created_by: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  };
  message?: string;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

export async function saveGridLayout(
  payload: SaveGridLayoutPayload,
): Promise<SaveGridLayoutResponse> {
  const res = await fetch(`${API_BASE}/grid-layout/`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Save failed (${res.status})`);
  }

  const data = await res.json();
  if (data.status && data.status !== 'success') {
    throw new Error(data.message ?? 'Save failed');
  }

  return data;
}