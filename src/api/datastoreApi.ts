/**
 * Datastore API client for sky-view-builder.
 * In dev, Vite proxies /datastore/* → http://localhost:8000/datastore/*
 * In production, set VITE_DATASTORE_API_URL to the backend origin (no trailing slash).
 */

import { getToken } from './authApi';

const API_BASE = import.meta.env.VITE_DATASTORE_API_URL ?? '';

// ─── Backend wire types ───────────────────────────────────────────────────────

export type BackendFieldType = 'text' | 'number' | 'boolean' | 'date' | 'formattedText' | 'list' | 'string';

export interface BackendSchemaField {
  field_id: string;
  type: BackendFieldType;
  label: string;
  value?: any;
  [key: string]: any;
}

export interface BackendSchemaEntry {
  table_name: string;
  /** Business name typed when the domain was created (table_name is the storage name). */
  label?: string | null;
  schema: BackendSchemaField[];
  db_backend?: 'dynamodb' | 'postgresql';
  versioned?: boolean;
  /** Project / module this domain model belongs to (null / absent = unassigned). */
  project_id?: string | null;
  module_id?: string | null;
}

export interface BackendSchemasListResponse {
  status: string;
  count: number;
  schemas: BackendSchemaEntry[];
}

// ─── Frontend DataSource shape (matches ViewBuilder's DataSource) ──────────────

export interface DataField {
  fieldId: string;
  /** Business label of the attribute (falls back to fieldId when absent). */
  label?: string;
  field_type: string; // 'text' | 'number' | 'boolean' | 'date'
}

/** Which CRUD actions a role has on a specific domain/table */
export interface DomainRole {
  roleId:     number;
  roleName:   string;
  can_create: boolean;
  can_read:   boolean;
  can_update: boolean;
  can_delete: boolean;
}

export interface DataSource {
  name:            string;
  id:              string;
  /** Business name of the domain model — show this in dropdowns; keep id/name as the value. */
  label?:          string;
  availableFields: DataField[];
  db_backend?:     'dynamodb' | 'postgresql';
  versioned?:      boolean;
  /** Project this domain model belongs to — null when it isn't in any project. */
  project_id?:     string | null;
  module_id?:      string | null;
  /** Roles that have at least one permission on this domain */
  roles?:          DomainRole[];
}

// ─── Domain Attribute types ───────────────────────────────────────────────────

export interface DomainAttribute {
  id:              number;
  domain_model_id: string;
  attribute_name:  string;
  created_at:      string | null;
}

export interface DomainAttributesResponse {
  status:          string;
  domain_model_id: string;
  count:           number;
  data:            DomainAttribute[];
}

// ─── Type mapping ─────────────────────────────────────────────────────────────

function backendTypeToFieldType(type: BackendFieldType): string {
  switch (type) {
    case 'text':
    case 'formattedText':
    case 'string':
      return 'text';
    case 'number':  return 'number';
    case 'boolean': return 'boolean';
    case 'date':    return 'date';
    case 'list':    return 'list';
    default:        return 'text';
  }
}

// ─── API ─────────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
               : { 'Content-Type': 'application/json' };
}

function normalizeRows(payload: unknown): Record<string, any>[] {
  if (Array.isArray(payload)) {
    return payload.filter((row): row is Record<string, any> => !!row && typeof row === 'object' && !Array.isArray(row));
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return [payload as Record<string, any>];
  }

  return [];
}

/** Human-readable labels for permission action names */
const ACTION_LABELS: Record<string, string> = {
  view:   'View',
  read:   'Read',
  create: 'Create',
  update: 'Update',
  edit:   'Edit',
  delete: 'Delete',
};

/**
 * Parse a backend error response body and return a clean, user-facing message.
 * Handles the pattern: {"detail":"Permission denied: {resource}:{action}"}
 */
/** FastAPI sends `detail` as a string, OR (422 validation errors) an array of
 *  {loc, msg, type} objects, OR a plain object. Flatten any of them to text so
 *  the UI never shows "[object Object]". */
function stringifyDetail(d: unknown): string {
  if (d == null) return '';
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map(stringifyDetail).filter(Boolean).join('; ');
  if (typeof d === 'object') {
    const o = d as Record<string, any>;
    if (typeof o.msg === 'string') {
      const loc = Array.isArray(o.loc) ? o.loc.filter((x: any) => x !== 'body').join('.') : '';
      return loc ? `${loc}: ${o.msg}` : o.msg;
    }
    if (o.detail != null) return stringifyDetail(o.detail);
    if (o.message != null) {
      // Keep the per-field reasons that usually ride alongside a generic
      // "Validation failed" message, instead of dropping them.
      const fe = extractFieldErrors(o);
      const extra = Object.entries(fe).map(([k, v]) => `${k}: ${v}`).join('; ');
      return extra ? `${stringifyDetail(o.message)} — ${extra}` : stringifyDetail(o.message);
    }
    try { return JSON.stringify(o); } catch { return String(o); }
  }
  return String(d);
}

/** Pull a {field: reason} map out of the shapes backends commonly use:
 *  {errors:{f:msg}}, {errors:[{field|loc, message|msg}]}, FastAPI [{loc,msg}],
 *  or any of those nested under `detail`. */
export function extractFieldErrors(body: any): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (v: any) => {
    if (!v) return;
    if (Array.isArray(v)) {
      for (const it of v) {
        if (!it || typeof it !== 'object') continue;
        const msg = it.msg ?? it.message ?? it.error;
        const key = it.field ?? it.field_id ?? (Array.isArray(it.loc) ? it.loc.filter((x: any) => x !== 'body').join('.') : it.loc);
        if (key && typeof msg === 'string') out[String(key)] = msg;
      }
    } else if (typeof v === 'object') {
      for (const [k, m] of Object.entries(v)) {
        out[k] = typeof m === 'string' ? m : stringifyDetail(m);
      }
    }
  };
  if (body && typeof body === 'object') {
    visit(body.errors);
    visit(body.field_errors);
    if (Array.isArray(body.detail)) visit(body.detail);
    else if (body.detail && typeof body.detail === 'object') {
      visit(body.detail.errors);
      visit(body.detail.field_errors);
    }
  }
  return out;
}

function parseErrorMessage(status: number, text: string): string {
  let detail = text;
  try {
    const parsed = JSON.parse(text);
    detail = stringifyDetail(parsed.detail ?? parsed.message ?? text);
  } catch { /* fall through to raw text */ }

  if (status === 403) {
    const m = detail.match(/Permission denied:\s*([^:]+):(\w+)/i);
    if (m) {
      const resource = m[1].trim();
      const action   = m[2].toLowerCase();
      const label    = ACTION_LABELS[action] ?? (action.charAt(0).toUpperCase() + action.slice(1));
      return `PERMISSION_DENIED::${label} permission is not granted for "${resource}"`;
    }
    return `PERMISSION_DENIED::${detail || 'You do not have permission to perform this action'}`;
  }

  if (status === 401) return 'Session expired — please sign in again';

  return detail || `Request failed (${status})`;
}

async function apiFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: authHeaders(),
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    const err: any = new Error(parseErrorMessage(res.status, text));
    try { err.fieldErrors = extractFieldErrors(JSON.parse(text)); } catch { /* not JSON */ }
    throw err;
  }
  return res.json();
}

/** GET /datastore/schemas — list all registered domain schemas */
export async function fetchAllSchemas(): Promise<BackendSchemasListResponse> {
  return apiFetch('/datastore/schemas');
}

// ─── Plain domain name → this project's table ────────────────────────────────
// Tables are stored per project as "<Name>__<projectId>" (Output__31, User__31),
// while link fields, junction tables and relations only carry the plain name
// ("Output", "User31"). A plain name can therefore also hit another project's
// unsuffixed table (e.g. project 30's "Output"). Every row / schema call below
// maps the name to the table of the project currently selected in the top bar.
let _schemaNamesCache: { at: number; list: Promise<{ table_name: string; project_id?: string | null }[]> } | null = null;
function _schemaNames() {
  if (!_schemaNamesCache || Date.now() - _schemaNamesCache.at > 30_000) {
    const list = apiFetch('/datastore/schemas')
      .then(r => (Array.isArray(r?.schemas) ? r.schemas : []))
      .catch(() => { _schemaNamesCache = null; return []; });
    _schemaNamesCache = { at: Date.now(), list };
  }
  return _schemaNamesCache.list;
}
// The published client runs on its own origin, so it has no 'svb_current_project'
// in localStorage (that key is only written by the builder). It sets the page's
// project here instead, and every table lookup below then resolves plain names
// ("Output", "Task") to that project's tables ("Output__31") exactly like the builder.
let _activeProject: string | null = null;
export function setActiveProject(id: string | number | null | undefined): void {
  const next = id != null && String(id) !== '' && String(id) !== '__none__' ? String(id) : null;
  if (next === _activeProject) return;
  _activeProject = next;
  _schemaNamesCache = null;
}
export function getActiveProject(): string | null {
  return _activeProject;
}
function _currentProject(): string | null {
  if (_activeProject) return _activeProject;
  try {
    const v = localStorage.getItem('svb_current_project');
    return v && v !== '__none__' ? v : null;
  } catch { return null; }
}

/** The table to use for `name` in the currently selected project (or `name` itself). */
export async function resolveTableName(name: string): Promise<string> {
  const project = _currentProject();
  if (!project || !name) return name;
  const list = await _schemaNames();
  if (list.length === 0) return name;
  const lc = name.toLowerCase();
  const inProject = list.filter(s => s.project_id != null && String(s.project_id) === project);
  // already a table of this project
  if (inProject.some(s => s.table_name === name)) return name;
  // "<name>__<project>", else the same name with underscores dropped ("User31" → "User__31")
  const hit =
    inProject.find(s => s.table_name.toLowerCase() === `${lc}__${project}`) ??
    inProject.find(s => s.table_name.replace(/_/g, '').toLowerCase() === lc);
  return hit ? hit.table_name : name;
}

export interface DomainSchemaResult {
  /** The table actually read (a plain domain name is mapped to the project's table). */
  table_name?: string;
  schema:     BackendSchemaField[];
  db_backend: 'dynamodb' | 'postgresql';
  versioned?: boolean;
}


/**
 * Collect the domain names a field is linked to, whatever shape the backend
 * (or the Domain Model Configurator export) uses, and expose them as the flat
 * `relatedDomains: string[]` array that the form builder understands.
 *
 * Handles e.g.
 *   { type: 'domain_model', related_domain_model: { linked_with: ['A','B'] } }
 *   { type: 'domain_model', linked_with: 'A' }
 *   { relatedDomains: ['A','B'] }  /  { linkedDomains: [...] }  /  { datasource: ['A','B'] }
 */
export function normalizeSchemaField<T extends Record<string, any>>(f: T): T {
  if (!f || typeof f !== 'object') return f;
  const nested = f.related_domain_model ?? f.relatedDomainModel ?? {};
  const candidates: unknown[] = [
    f.relatedDomains, f.related_domains, f.linkedDomains, f.linked_domains,
    f.linked_with, f.linkedWith, f.domains,
    nested.linked_with, nested.linkedWith, nested.domains, nested.related_domains,
    Array.isArray(f.datasource) ? f.datasource : undefined,
  ];
  const names: string[] = [];
  for (const c of candidates) {
    const list = Array.isArray(c) ? c : typeof c === 'string' ? c.split(/[,;]/) : [];
    for (const x of list) {
      const n = typeof x === 'string' ? x : (x && typeof x === 'object' ? (x.table_name ?? x.name ?? x.domain) : '');
      if (typeof n === 'string' && n.trim()) names.push(n.trim());
    }
  }
  const unique = Array.from(new Set(names));
  if (unique.length === 0) return f;
  const out: any = { ...f, relatedDomains: unique };
  // single linked domain → keep the flat name other plugins already read
  if (unique.length === 1 && !out.relatedDomain) out.relatedDomain = unique[0];
  return out as T;
}

/** GET /datastore/schemas/{table_name} — get schema + db_backend for one domain table */
export async function fetchDomainSchema(tableName: string): Promise<DomainSchemaResult> {
  tableName = await resolveTableName(tableName);
  const res = await apiFetch(`/datastore/schemas/${encodeURIComponent(tableName)}`);
  if (res.status !== 'success') throw new Error(res.message ?? 'Failed to fetch schema');
  return {
    table_name: tableName,
    schema:     (res.schema ?? []) as BackendSchemaField[],
    db_backend: res.db_backend ?? 'dynamodb',
    versioned:  !!res.versioned,
  };
}

/** GET /datastore/{table_name}/rows — fetch all rows for a domain table */
export async function fetchDomainRows(tableName: string): Promise<Record<string, any>[]> {
  tableName = await resolveTableName(tableName);
  const res = await apiFetch(`/datastore/${encodeURIComponent(tableName)}/rows`);
  if (res.status !== 'success') throw new Error(res.message ?? 'Failed to fetch rows');
  return normalizeRows(res.data);
}

export async function fetchArchivedRows(tableName: string): Promise<Record<string, any>[]> {
  tableName = await resolveTableName(tableName);
  const res = await apiFetch(`/datastore/${encodeURIComponent(tableName)}/archived`);
  if (res.status !== 'success') throw new Error(res.message ?? 'Failed to fetch archived rows');
  return normalizeRows(res.data);
}

/** PUT /datastore/{table_name}/row/{id} — update an existing row */
export async function updateDomainRow(
  tableName: string,
  recordId: string,
  data: Record<string, any>,
): Promise<{ status: string; record_id?: string; message?: string; versioned?: boolean; previous_id?: string }> {
  tableName = await resolveTableName(tableName);
  return apiFetch(`/datastore/${encodeURIComponent(tableName)}/row/${encodeURIComponent(recordId)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** DELETE /datastore/{table_name}/row/{id} — delete a row */
export async function deleteDomainRow(
  tableName: string,
  recordId: string,
): Promise<{ status: string; record_id?: string; message?: string }> {
  tableName = await resolveTableName(tableName);
  return apiFetch(`/datastore/${encodeURIComponent(tableName)}/row/${encodeURIComponent(recordId)}`, {
    method: 'DELETE',
  });
}

/** POST /datastore/{table_name}/row/{id}/restore — bring an archived row back */
export async function restoreDomainRow(
  tableName: string,
  recordId: string,
): Promise<{ status: string; record_id?: string; message?: string }> {
  tableName = await resolveTableName(tableName);
  return apiFetch(`/datastore/${encodeURIComponent(tableName)}/row/${encodeURIComponent(recordId)}/restore`, {
    method: 'POST',
  });
}

/**
 * DELETE /datastore/schemas/{table_name} — delete a whole domain model.
 * The backend removes, in one transaction: the table (and its data when
 * dropTable is true), the datastore_schemas row, every domain_attributes row
 * for the domain (attribute_translations cascade), and its relationships/ABAC rules.
 */
export async function deleteDomainModel(
  tableName: string,
  dropTable = true,
): Promise<{ status: string; table_name?: string; table_dropped?: boolean; message?: string }> {
  return apiFetch(
    `/datastore/schemas/${encodeURIComponent(tableName)}?drop_table=${dropTable ? 'true' : 'false'}`,
    { method: 'DELETE' },
  );
}

// ─── Schema field shape used for domain create/update ─────────────────────────

export interface DomainSchemaField {
  field_id: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'formattedText' | 'list';
  label: string;
  value?: any;
  placeholder?: string;
  validations?: Array<{ type: string; value?: any; message: string }>;
  [key: string]: any;
}

/**
 * POST /datastore/create — create or update a domain table + save its schema.
 */
export async function createDomain(params: {
  table_name: string;
  schema: DomainSchemaField[];
  db_backend?: 'dynamodb' | 'postgresql';
  versioned?: boolean;
}): Promise<{ status: string; table_name?: string; message?: string; versioned?: boolean }> {
  return apiFetch('/datastore/create', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/** POST /datastore/{table_name}/row — submit a new row to a domain table */
export async function submitFormRow(
  tableName: string,
  row: Record<string, any>,
): Promise<{ status: string; record_id?: string; message?: string; errors?: Record<string, string> }> {
  tableName = await resolveTableName(tableName);
  return apiFetch(`/datastore/${encodeURIComponent(tableName)}/row`, {
    method: 'POST',
    body: JSON.stringify(row),
  });
}

/** GET /datastore/config — get the active DB backend */
export async function getDatastoreConfig(): Promise<{ db_backend: 'dynamodb' | 'postgresql' }> {
  const res = await apiFetch('/datastore/config');
  return res;
}

/** POST /datastore/config — switch the active DB backend at runtime */
export async function setDatastoreBackend(
  backend: 'dynamodb' | 'postgresql',
): Promise<{ status: string; db_backend: string; message?: string }> {
  return apiFetch('/datastore/config', {
    method: 'POST',
    body: JSON.stringify({ db_backend: backend }),
  });
}

/**
 * A junction table (auto-created for a many-to-many "list" relation, named
 * `${domainA}_${domainB}` by convention — see formplugin.tsx's junctionTable
 * step) is detected structurally rather than by name, since a domain's own
 * name could coincidentally contain an underscore too: every field besides
 * the standard system columns is itself a foreign key (ends in "Id"), with
 * nothing else — no real content of its own. That's exactly what a pure
 * link table looks like and a real domain never does.
 */
const JUNCTION_SYSTEM_FIELDS = new Set([
  'id', 'created_at', 'updated_at', 'deleted_at',
  'isActive', 'fromDate', 'toDate', 'versionOf',
]);

function isJunctionTable(schema: BackendSchemaField[]): boolean {
  const real = schema.filter(f => !JUNCTION_SYSTEM_FIELDS.has(f.field_id));
  if (real.length < 2) return false;
  return real.every(f => f.field_id.endsWith('Id'));
}

/**
 * Fetch all domain schemas and convert them to the ViewBuilder DataSource format.
 * Junction tables are excluded — they exist purely to back a many-to-many
 * "list" field and were never meant to be picked as a component's own data
 * source in the Data Provider panel.
 */
export async function fetchAvailableDataSources(): Promise<DataSource[]> {
  const response: BackendSchemasListResponse = await fetchAllSchemas();

  if (response.status !== 'success' || !Array.isArray(response.schemas)) {
    throw new Error((response as any).message ?? response.status ?? 'Failed to load schemas');
  }

  return response.schemas
    .filter(entry => !isJunctionTable(entry.schema ?? []))
    .map((entry): DataSource => ({
    name: entry.table_name,
    id: entry.table_name,
    label: entry.label?.trim() || undefined,
    availableFields: entry.schema.map((field): DataField => ({
      fieldId: field.field_id,
      label: field.label?.trim() || undefined,
      field_type: backendTypeToFieldType(field.type),
    })),
    db_backend: entry.db_backend ?? 'postgresql',
    versioned:  entry.versioned ?? false,
    project_id: entry.project_id != null ? String(entry.project_id) : null,
    module_id:  entry.module_id  != null ? String(entry.module_id)  : null,
  }));
}

/** What to show for a domain in a dropdown: its label, else its storage name. */
export function domainDisplayName(d: { label?: string | null; name?: string; table_name?: string }): string {
  return d.label?.trim() || d.name || d.table_name || '';
}

/** What to show for an attribute in a dropdown: its label, else its field id. */
export function fieldDisplayName(f: { label?: string | null; fieldId: string }): string {
  return f.label?.trim() || f.fieldId;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export interface Project {
  id:           string;
  name:         string;
  description?: string | null;
}

/** GET /projects — list all projects (used to scope the domain model pickers) */
export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${API_BASE}/projects`, { headers: authHeaders() });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    // An HTML reply means the request hit the dev server / SPA fallback, not the API.
    throw new Error(
      "Couldn't load projects: /projects returned a web page instead of JSON. " +
      "Add a /projects proxy to the backend in vite.config (like /datastore), or set VITE_DATASTORE_API_URL.",
    );
  }
  if (!res.ok) throw new Error(parseErrorMessage(res.status, text));
  const list = Array.isArray(body) ? body : body?.data;
  if (!Array.isArray(list)) throw new Error(body?.message ?? 'Failed to load projects');
  return list.map((p: any): Project => ({ id: String(p.id), name: p.name, description: p.description ?? null }));
}

// ─── Audit Log API ────────────────────────────────────────────────────────────

export interface AuditLog {
  id: number;
  request_id: string;
  user_id: string | null;
  event: string | null;
  payload: Record<string, any> | null;
  created_at: string;
}

export interface ErrorLog {
  id: number;
  request_id: string;
  user_id: string | null;
  event: string | null;
  payload: Record<string, any> | null;
  created_at: string;
}

/** GET /audit/logs — fetch audit logs with optional limit */
export async function fetchAuditLogs(limit = 50): Promise<AuditLog[]> {
  const res = await apiFetch(`/audit/logs?limit=${limit}`);
  return res.data ?? [];
}

/** GET /audit/errors — fetch error logs with optional limit */
export async function fetchErrorLogs(limit = 50): Promise<ErrorLog[]> {
  const res = await apiFetch(`/audit/errors?limit=${limit}`);
  return res.data ?? [];
}

/** GET /audit/logs/{request_id} — find one specific request by ID */
export async function fetchLogByRequestId(requestId: string): Promise<AuditLog> {
  const res = await apiFetch(`/audit/logs/${encodeURIComponent(requestId)}`);
  return res.data;
}

// ─── Domain Attributes API ────────────────────────────────────────────────────

/**
 * POST /datastore/domain-attributes
 * Save a single attribute (field) belonging to a domain model.
 * Called whenever a field is added, edited, or a new domain is created.
 */
export async function apiSaveAttribute(
  domainModelId: string,
  attributeName: string,
): Promise<{ status: string; message?: string }> {
  return apiFetch('/datastore/domain-attributes', {
    method: 'POST',
    body: JSON.stringify({
      domain_model_id: domainModelId,
      attribute_name:  attributeName,
    }),
  });
}

/**
 * GET /datastore/domain-attributes/{domain_model_id}
 * List all attributes recorded for a domain model.
 */
export async function apiListDomainAttributes(
  domainModelId: string,
): Promise<DomainAttributesResponse> {
  return apiFetch(`/datastore/domain-attributes/${encodeURIComponent(domainModelId)}`);
}