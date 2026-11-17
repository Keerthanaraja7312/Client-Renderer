/**
 * Roles & Permissions API client.
 * All calls go to the local FastAPI backend via the Vite proxy / VITE_DATASTORE_API_URL.
 */

import { getToken } from './authApi';

const API_BASE = import.meta.env.VITE_DATASTORE_API_URL ?? '';

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
               : { 'Content-Type': 'application/json' };
}

const ACTION_LABELS: Record<string, string> = {
  view: 'View', read: 'Read', create: 'Create',
  update: 'Update', edit: 'Edit', delete: 'Delete',
};

function parseErrorMessage(status: number, text: string): string {
  let detail = text;
  try {
    const parsed = JSON.parse(text);
    detail = parsed.detail ?? parsed.message ?? text;
  } catch { /* fall through */ }

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
    throw new Error(parseErrorMessage(res.status, text));
  }
  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Role {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  permissions?: ResourcePermission[];
}

export interface ResourcePermission {
  resource: string;
  can_create: boolean;
  can_read: boolean;
  can_update: boolean;
  can_delete: boolean;
}

// ─── Role CRUD ────────────────────────────────────────────────────────────────

export async function fetchRoles(): Promise<Role[]> {
  const res = await apiFetch('/roles/');
  return res.roles ?? [];
}

export async function createRole(name: string, description?: string): Promise<Role> {
  const res = await apiFetch('/roles/', {
    method: 'POST',
    body: JSON.stringify({ name, description: description ?? '' }),
  });
  return res.role;
}

export async function fetchRole(roleId: number): Promise<Role> {
  const res = await apiFetch(`/roles/${roleId}`);
  return res.role;
}

export async function updateRole(roleId: number, name: string, description: string): Promise<Role> {
  const res = await apiFetch(`/roles/${roleId}`, {
    method: 'PUT',
    body: JSON.stringify({ name, description }),
  });
  return res.role;
}

export async function deleteRole(roleId: number): Promise<void> {
  await apiFetch(`/roles/${roleId}`, { method: 'DELETE' });
}

// ─── Permissions ─────────────────────────────────────────────────────────────

export async function fetchRolePermissions(roleId: number): Promise<ResourcePermission[]> {
  const res = await apiFetch(`/roles/${roleId}/permissions`);
  return res.permissions ?? [];
}

/** Set permission for ONE resource on a role. */
export async function setResourcePermission(
  roleId: number,
  resource: string,
  perms: Omit<ResourcePermission, 'resource'>,
): Promise<ResourcePermission> {
  return apiFetch(`/roles/${roleId}/permissions/${encodeURIComponent(resource)}`, {
    method: 'PUT',
    body: JSON.stringify(perms),
  });
}

/** Replace ALL permissions for a role in one call. */
export async function bulkSetPermissions(
  roleId: number,
  permissions: ResourcePermission[],
): Promise<void> {
  await apiFetch(`/roles/${roleId}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ permissions }),
  });
}

/** Which roles can access a given resource (domain). */
export async function fetchRolesForResource(resource: string): Promise<any[]> {
  const res = await apiFetch(`/roles/resource/${encodeURIComponent(resource)}`);
  return res.roles ?? [];
}

// ─── Reliable domain-scoped role fetch ───────────────────────────────────────

export interface DomainRoleAccess {
  id:          number;
  name:        string;
  description: string;
  can_create:  boolean;
  can_read:    boolean;
  can_update:  boolean;
  can_delete:  boolean;
}

/**
 * Fetch ALL roles and their CRUD access for a specific domain/resource.
 *
 * Uses the same two-step pattern as App.tsx (proven to work):
 *   1. GET /roles/          → list of all roles
 *   2. GET /roles/{id}/permissions → permissions per role (in parallel)
 *
 * Returns every role — those with no permissions have all flags false.
 * Roles where every flag is false are still included so the UI can show
 * "no access" rows instead of hiding them.
 */
export async function fetchRolesForDomain(resource: string): Promise<DomainRoleAccess[]> {
  // Step 1 — all roles
  const roles = await fetchRoles();
  if (roles.length === 0) return [];

  // Step 2 — permissions for every role in parallel
  const allPerms = await Promise.all(
    roles.map(role =>
      fetchRolePermissions(role.id).catch(() => [] as ResourcePermission[])
    )
  );

  // Step 3 — merge: find each role's entry for this specific resource
  return roles.map((role, i) => {
    const perm = allPerms[i].find(p => p.resource === resource);
    return {
      id:          role.id,
      name:        role.name,
      description: role.description ?? '',
      can_create:  perm?.can_create  ?? false,
      can_read:    perm?.can_read    ?? false,
      can_update:  perm?.can_update  ?? false,
      can_delete:  perm?.can_delete  ?? false,
    };
  });
}
