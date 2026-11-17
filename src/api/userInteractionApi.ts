import { getToken } from './authApi';

const API_BASE = import.meta.env.VITE_DATASTORE_API_URL ?? 'http://127.0.0.1:8000';

export interface SaveUserInteractionPayload {
  page_name: string;
  page_data: any;
  label?: string;
  created_by: string | null;
}

export interface SaveUserInteractionResponse {
  status: string;
  data?: {
    id: number;
    page_name: string;
    page_data: any;
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

export async function saveUserInteraction(
  payload: SaveUserInteractionPayload,
): Promise<SaveUserInteractionResponse> {
  const res = await fetch(`${API_BASE}/user-interaction/`, {
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