/**
 * Query Builder API client.
 * In dev, Vite proxies /query-builder/* → http://localhost:8000/query-builder/*
 * In production, set VITE_DATASTORE_API_URL (same backend origin as datastoreApi.ts).
 */
import { getToken } from './authApi';

const API_BASE = import.meta.env.VITE_DATASTORE_API_URL ?? '';

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

async function apiFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders(), ...init });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.detail ?? parsed.message ?? text;
    } catch { /* fall through */ }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json();
}

// ─── Wire types (mirror the backend's Pydantic models) ─────────────────────

export type Cardinality = 'OneToOne' | 'OneToMany' | 'ManyToOne' | 'ManyToMany';

export interface Relationship {
  id: number;
  from_dmo: string;
  to_dmo: string;
  from_field: string;
  to_field: string;
  cardinality: Cardinality;
  label?: string | null;
  created_at?: string;
}

export interface QueryField {
  dmo: string;
  field: string;
  aggregation?: string | null; // SUM | COUNT | AVG | MIN | MAX | COUNT DISTINCT
  alias?: string | null;
}

export interface QueryFilter {
  dmo: string;
  field: string;
  operator?: string; // = != > < >= <= LIKE ILIKE IN "NOT IN"
  value?: any;
}

// ─── Nested AND/OR filter tree ──────────────────────────────────────────────
// Mirrors backend FilterConditionNode / FilterGroupNode
// (routers/query_builder_routes.py). `filter_tree` takes precedence over
// the legacy flat `filters` when both are present on a payload.

export interface FilterConditionNode {
  type: 'condition';
  dmo: string;
  field: string;
  operator?: string;
  value?: any;
}

export interface FilterGroupNode {
  type: 'group';
  operator: 'AND' | 'OR';
  children: FilterNode[];
}

export type FilterNode = FilterConditionNode | FilterGroupNode;

export interface QueryGroupBy {
  dmo: string;
  field: string;
}

export interface QueryHaving {
  dmo: string;
  field: string;
  aggregation?: string | null;
  operator?: string;
  value?: any;
}

export interface QuerySort {
  dmo?: string;
  field?: string;
  alias?: string;
  direction?: 'ASC' | 'DESC';
}

export interface QueryDefinitionPayload {
  name?: string | null;
  objects: string[];
  fields: QueryField[];
  filters?: QueryFilter[];       // legacy flat AND-only filters (still accepted server-side)
  filter_tree?: FilterNode;      // nested AND/OR — wins over `filters` if both are set
  groupBy?: QueryGroupBy[];
  having?: QueryHaving[];
  sort?: QuerySort[];
}

export interface PreviewResult {
  status: string;
  sql: string;
  params: any[];
}

export interface ExecuteResult {
  status: string;
  query_definition_id: number;
  sql: string;
  row_count: number;
  data: Record<string, any>[];
}

export interface SavedQueryDefinition {
  id: number;
  name: string | null;
  created_by: string | null;
  created_at: string;
  version: number;
}


export interface DomainObject {
  name: string;
  fields: { name: string; type: string | null; label: string | null }[];
}

// ─── Relationships ──────────────────────────────────────────────────────────

/** GET /query-builder/relationships — the full join graph */
export async function fetchRelationships(): Promise<Relationship[]> {
  const res = await apiFetch('/query-builder/relationships');
  return res.data ?? [];
}

/** GET /query-builder/relationships/{dmo} — edges touching one domain object */
export async function fetchRelationshipsFor(dmo: string): Promise<Relationship[]> {
  const res = await apiFetch(`/query-builder/relationships/${encodeURIComponent(dmo)}`);
  return res.data ?? [];
}

/** POST /query-builder/relationships — define a join edge */
export async function createRelationship(payload: {
  from_dmo: string;
  to_dmo: string;
  from_field: string;
  to_field: string;
  cardinality: Cardinality;
  label?: string;
}): Promise<{ id: number }> {
  return apiFetch('/query-builder/relationships', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteRelationship(id: number): Promise<void> {
  await apiFetch(`/query-builder/relationships/${id}`, { method: 'DELETE' });
}

// ─── Query preview / execute ────────────────────────────────────────────────

/** POST /query-builder/preview — resolve joins + generate SQL only, no execution */
export async function previewQuery(payload: QueryDefinitionPayload): Promise<PreviewResult> {
  return apiFetch('/query-builder/preview', { method: 'POST', body: JSON.stringify(payload) });
}

/** POST /query-builder/execute — generate, save, and run the query */
export async function executeQuery(payload: QueryDefinitionPayload): Promise<ExecuteResult> {
  return apiFetch('/query-builder/execute', { method: 'POST', body: JSON.stringify(payload) });
}

/** GET /query-builder/definitions — list saved query definitions */
// export async function fetchQueryDefinitions(): Promise<SavedQueryDefinition[]> {
//   const res = await apiFetch('/query-builder/definitions');
//   return res.data ?? [];
// }

export async function fetchQueryDefinitions() {
  const result = await apiFetch('/query-builder/definitions');

  // return (result.data ?? []).map((q: any) => ({
  //   id: String(q.id),
  //   name: q.name || `Query ${q.id}`,
  //   type: "query",
  //   availableFields: []
  // }));
  return result.data.map((q:any)=>({
    id:q.id,
    name:q.name,
    type:"query",
    availableFields:[]
 }));
}


/** GET /query-builder/definitions/{id} — load one saved query definition */
export async function fetchQueryDefinition(
  id: number
): Promise<{ id: number; name: string | null; query_json: QueryDefinitionPayload }> {
  const res = await apiFetch(`/query-builder/definitions/${id}`);
  return res.data;
}



/** GET /query-builder/objects — all domain objects with their fields */
export async function fetchDomainObjects(): Promise<DomainObject[]> {
  const res = await apiFetch('/query-builder/objects');
  return res.data ?? [];
}

export async function executeSavedQuery(id: string | number) {
  const res = await apiFetch(
    `/query-builder/definitions/${id}/execute`,
    {
      method: "POST",
    }
  );

  return res.data;
}