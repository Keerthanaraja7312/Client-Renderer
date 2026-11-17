/**
 * domainDataStore — cached domain-row data for grids/tables.
 *
 * Deliberately separate from formStore (../../store/formStore). That store
 * models one concern — "a form currently being filled out" (field values,
 * touched/dirty, validation) — keyed by "domain.field" paths. This store
 * models a different one — "rows fetched from a domain table for display,
 * cached so switching tabs/components doesn't force a refetch" — keyed by
 * an arbitrary cache key chosen by the caller (see below). Mixing the two
 * would make both harder to reason about and collide on keying conventions.
 *
 * Cache key convention: callers choose their own key. A plain domain name
 * (e.g. "branch") is fine when the caller wants the full unfiltered row set
 * for that domain — multiple call sites CAN share a cache entry this way if
 * they legitimately want the same data. Give it a suffix (e.g.
 * "branch:doctor-tab") when the caller wants its own, unshared cache entry
 * scoped to itself, even though the underlying domain is the same.
 */
import { create } from "zustand";
import { useShallow } from "zustand/shallow";

export interface DomainSchemaField {
  field_id: string;
  type: string;
  label?: string;
  [key: string]: any;
}

interface DomainDataState {
  rows:    Record<string, Record<string, any>[]>;
  schema:  Record<string, DomainSchemaField[]>;
  loading: Record<string, boolean>;
  error:   Record<string, string | null>;

  setRows:    (key: string, rows: Record<string, any>[]) => void;
  setSchema:  (key: string, schema: DomainSchemaField[]) => void;
  setLoading: (key: string, value: boolean) => void;
  setError:   (key: string, error: string | null) => void;
  /** Drop a cached entry entirely — e.g. when a domain is deleted. */
  clear:      (key: string) => void;
}

export const useDomainDataStore = create<DomainDataState>()((set) => ({
  rows: {},
  schema: {},
  loading: {},
  error: {},

  setRows(key, rows) {
    set((s) => ({ rows: { ...s.rows, [key]: rows } }));
  },
  setSchema(key, schema) {
    set((s) => ({ schema: { ...s.schema, [key]: schema } }));
  },
  setLoading(key, value) {
    set((s) => ({ loading: { ...s.loading, [key]: value } }));
  },
  setError(key, error) {
    set((s) => ({ error: { ...s.error, [key]: error } }));
  },
  clear(key) {
    set((s) => {
      const rows = { ...s.rows };    delete rows[key];
      const schema = { ...s.schema };  delete schema[key];
      const loading = { ...s.loading }; delete loading[key];
      const error = { ...s.error };   delete error[key];
      return { rows, schema, loading, error };
    });
  },
}));

// ── Selectors ────────────────────────────────────────────────────────────

// Stable constants reused across calls — critical detail. Returning a
// fresh `[]` literal inline (e.g. `s.schema[key] ?? []`) creates a new
// array reference on every single selector invocation. React 18's
// useSyncExternalStore (what Zustand's hook uses internally) calls the
// selector during render to verify a stable snapshot; a selector that
// never returns the same reference twice looks like it's "always
// changing," which triggers React to re-render, re-check, see another
// new reference, and repeat — surfacing as "Maximum update depth
// exceeded." Reusing one shared constant (same pattern as EMPTY_OPTIONS
// in the existing formStore/selectors.ts) avoids this entirely.
const EMPTY_SCHEMA: DomainSchemaField[] = [];

/** Returns the cached rows for `key`, or null if never loaded. Stable
 *  reference unless that key's rows actually change — safe to depend on
 *  in effects without needing useShallow (a single array value, not an
 *  object built fresh per render). */
export function useDomainRows(key: string | undefined) {
  return useDomainDataStore((s) => (key ? s.rows[key] ?? null : null));
}

export function useDomainSchema(key: string | undefined) {
  return useDomainDataStore((s) => (key ? s.schema[key] ?? EMPTY_SCHEMA : EMPTY_SCHEMA));
}

/** Bundles loading+error+rows together — object literal per render, so
 *  useShallow is required (same reasoning as useFieldUI in the form store:
 *  without it, every store update would re-render every consumer). Note
 *  useShallow alone isn't enough if the INNER values are themselves
 *  unstable references — schema below reuses EMPTY_SCHEMA for the same
 *  reason as useDomainSchema above. */
export function useDomainData(key: string | undefined) {
  return useDomainDataStore(
    useShallow((s) => ({
      rows:    key ? s.rows[key] ?? null : null,
      schema:  key ? s.schema[key] ?? EMPTY_SCHEMA : EMPTY_SCHEMA,
      loading: key ? s.loading[key] ?? false : false,
      error:   key ? s.error[key] ?? null : null,
    }))
  );
}