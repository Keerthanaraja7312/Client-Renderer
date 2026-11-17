import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import appData from './appData.json';
import { fetchDomainRows } from '@/api/datastoreApi';
import { applyQueryFilters } from '../local-plugins/applyQueryFilters';
import { executeSavedQuery } from '@/api/queryBuilderApi';
import { useHubValue } from '../sky-view-builder/store/useHubValue';
import type { StatePath } from '@/store/types';

/**
 * The shape of the whole JSON store. Add new top-level keys to appData.json
 * and they show up here automatically — no other code needs to change.
 */
export type AppData = typeof appData;
export type DatasetKey = keyof AppData;

// ─── Live domain data (queried from the backend, scoped by the query the ───
// Query Builder / Logic Architect saved for a given dataSourceId) ───────────
interface DomainEntry {
  rows: Record<string, any>[];
  loading: boolean;
  error: string | null;
  /** bumped on every fetch so callers relying on referential identity re-render */
  version: number;
}

const EMPTY_DOMAIN_ENTRY: DomainEntry = { rows: [], loading: false, error: null, version: 0 };

interface DataProviderContextValue {
  /** The full JSON store, as-is */
  data: AppData;
  /** Read one dataset by key, e.g. getDataset('customers') */
  getDataset: <K extends DatasetKey>(key: K) => AppData[K];
  /** Replace one dataset at runtime (in-memory only — does not touch the JSON file) */
  setDataset: <K extends DatasetKey>(key: K, value: AppData[K]) => void;
  /** Reset everything back to the original appData.json contents */
  reset: () => void;

  /** Live domain rows cache, keyed by dataSourceId. Shared across every plugin instance. */
  domainCache: Record<string, DomainEntry>;
  /** Ensures rows for a dataSourceId are fetched (no-op if already loaded/loading). */
  ensureDomainRows: (dataSourceId: string, sourceType: string) => void;
  /** Forces a re-fetch, bypassing the cache (e.g. after a row insert/edit elsewhere). */
  refetchDomainRows: (dataSourceId: string, sourceType: string) => void;
}

const DataProviderContext = createContext<DataProviderContextValue | null>(null);

/**
 * Wrap your app (or just the view-builder) with this once, near the root,
 * the same way StateHubProvider is used. Every component below it can then
 * call useDataset(...) for static demo data, or useDomainData(...) for real
 * backend-queried rows, instead of keeping its own hardcoded/duplicated
 * fetch logic.
 *
 * <DataProvider>
 *   <StateHubProvider hub={stateHub}>
 *     <ViewBuilder ... />
 *   </StateHubProvider>
 * </DataProvider>
 */
export function DataProvider({
  children,
  initialData,
}: {
  children: ReactNode;
  /** Optional overrides merged over appData.json on first mount (e.g. server-fetched data) */
  initialData?: Partial<AppData>;
}) {
  const [data, setData] = useState<AppData>(() => ({
    ...(appData as AppData),
    ...(initialData as AppData),
  }));

  const getDataset = useCallback(
    <K extends DatasetKey>(key: K) => data[key],
    [data]
  );

  const setDataset = useCallback(<K extends DatasetKey>(key: K, value: AppData[K]) => {
    setData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    setData(appData as AppData);
  }, []);

  // ── Live domain data cache ────────────────────────────────────────────
  const [domainCache, setDomainCache] = useState<Record<string, DomainEntry>>({});
  // Tracks in-flight fetches so concurrent callers (e.g. a Data Table and a
  // Dropdown both pointed at the same dataSourceId) share one network call
  // instead of firing one each.
  const inFlight = useRef<Set<string>>(new Set());

  // const fetchAndStore = useCallback((dataSourceId: string) => {
  //   inFlight.current.add(dataSourceId);
  //   setDomainCache((prev) => ({
  //     ...prev,
  //     [dataSourceId]: {
  //       rows: prev[dataSourceId]?.rows ?? [],
  //       loading: true,
  //       error: null,
  //       version: prev[dataSourceId]?.version ?? 0,
  //     },
  //   }));

  //   fetchDomainRows(dataSourceId)
  //     .then((rows) => {
  //       setDomainCache((prev) => ({
  //         ...prev,
  //         [dataSourceId]: {
  //           rows,
  //           loading: false,
  //           error: null,
  //           version: (prev[dataSourceId]?.version ?? 0) + 1,
  //         },
  //       }));
  //     })
  //     .catch((err) => {
  //       setDomainCache((prev) => ({
  //         ...prev,
  //         [dataSourceId]: {
  //           rows: prev[dataSourceId]?.rows ?? [],
  //           loading: false,
  //           error: err instanceof Error ? err.message : 'Failed to load data',
  //           version: (prev[dataSourceId]?.version ?? 0) + 1,
  //         },
  //       }));
  //     })
  //     .finally(() => {
  //       inFlight.current.delete(dataSourceId);
  //     });
  // }, []);
  const fetchAndStore = useCallback(
  (
    dataSourceId: string,
    sourceType: string
  ) => {
    const cacheKey = `${sourceType}:${dataSourceId}`;
    inFlight.current.add(cacheKey);

    setDomainCache((prev) => ({
      ...prev,
      [cacheKey]: {
        rows: prev[cacheKey]?.rows ?? [],
        loading: true,
        error: null,
        version: prev[cacheKey]?.version ?? 0,
      },
    }));

    const fetchRows =
      sourceType === "table"
        ? fetchDomainRows(dataSourceId)
        : executeSavedQuery(dataSourceId);

    fetchRows
      .then((rows) => {
        setDomainCache((prev) => ({
          ...prev,
          [cacheKey]: {
            rows,
            loading: false,
            error: null,
            version: (prev[cacheKey]?.version ?? 0) + 1,
          },
        }));
      })
      .catch((err) => {
        setDomainCache((prev) => ({
          ...prev,
          [cacheKey]: {
            rows: prev[cacheKey]?.rows ?? [],
            loading: false,
            error:
              err instanceof Error
                ? err.message
                : "Failed to load data",
            version: (prev[cacheKey]?.version ?? 0) + 1,
          },
        }));
      })
      .finally(() => {
        inFlight.current.delete(cacheKey);
      });
  },
  []
);

  // const ensureDomainRows = useCallback(
  //   (dataSourceId: string,  sourceType: string) => {
  //     if (!dataSourceId) return;
  //     if (inFlight.current.has(dataSourceId)) return;
  //     if (domainCache[dataSourceId] && !domainCache[dataSourceId].error) return;
  //     fetchAndStore(dataSourceId, sourceType);
  //   },
  //   [domainCache, fetchAndStore]
  // );

  // const refetchDomainRows = useCallback(
  //   (dataSourceId: string, sourceType: string) => {
  //     if (!dataSourceId) return;
  //     if (inFlight.current.has(dataSourceId)) return;
  //     fetchAndStore(dataSourceId, sourceType);
  //   },
  //   [fetchAndStore]
  // );

  const ensureDomainRows = useCallback(
    (dataSourceId: string, sourceType: string) => {
      if (!dataSourceId) return;
      const cacheKey = `${sourceType}:${dataSourceId}`;
      if (inFlight.current.has(cacheKey)) return;
      if (domainCache[cacheKey] && !domainCache[cacheKey].error) return;
      fetchAndStore(dataSourceId, sourceType);
    },
    [domainCache, fetchAndStore]
  );

  const refetchDomainRows = useCallback(
    (dataSourceId: string, sourceType: string) => {
      if (!dataSourceId) return;
      const cacheKey = `${sourceType}:${dataSourceId}`;
      if (inFlight.current.has(cacheKey)) return;
      fetchAndStore(dataSourceId, sourceType);
    },
    [fetchAndStore]
  );

  const value = useMemo(
    () => ({ data, getDataset, setDataset, reset, domainCache, ensureDomainRows, refetchDomainRows }),
    [data, getDataset, setDataset, reset, domainCache, ensureDomainRows, refetchDomainRows]
  );

  return (
    <DataProviderContext.Provider value={value}>
      {children}
    </DataProviderContext.Provider>
  );
}

/** Low-level access to the whole context (data + getters/setters) */
export function useDataProvider(): DataProviderContextValue {
  const ctx = useContext(DataProviderContext);
  if (!ctx) throw new Error('useDataProvider must be used inside <DataProvider>');
  return ctx;
}

/**
 * The hook most components should use — subscribes to one dataset only,
 * so a component reading "customers" won't re-render when "clinics" changes.
 *
 *   const customers = useDataset('customers');
 *   const states = useDataset('states')[country] ?? [];
 */
export function useDataset<K extends DatasetKey>(key: K): AppData[K] {
  const { data } = useDataProvider();
  return data[key];
}

/**
 * Companion setter, split out so components that only need to read data
 * don't have to pull in setDataset from useDataProvider directly.
 *
 *   const setCustomers = useSetDataset('customers');
 *   setCustomers(prev => [...prev, newRow]);
 */
export function useSetDataset<K extends DatasetKey>(key: K) {
  const { data, setDataset } = useDataProvider();
  return useCallback(
    (updater: AppData[K] | ((prev: AppData[K]) => AppData[K])) => {
      const next =
        typeof updater === 'function'
          ? (updater as (prev: AppData[K]) => AppData[K])(data[key])
          : updater;
      setDataset(key, next);
    },
    [data, key, setDataset]
  );
}

/**
 * The hook plugins use for LIVE backend data. Every plugin instance pointed
 * at the same dataSourceId shares one fetch and one cache entry — a Data
 * Table and a Dropdown both bound to "clinic" only trigger one network call
 * between them, and both re-render together when it resolves.
 *
 * Also handles sourceType: "state" — the "State" option in the Data
 * Provider panel. In that case `dataSourceId` isn't a domain/query id at
 * all, it's a StatePath string (e.g. "global.components.block-abc.
 * input.rows") picked from another block's live output. Reading it goes
 * through useHubValue (reactive — re-renders when that block's state
 * changes) instead of the domainCache/backend-fetch path entirely; no
 * network request happens for a state-bound source.
 *
 *   const { rows, loading, error } = useDomainData(dataSourceId);
 *   const { rows, loading, error } = useDomainData(statePath, 'state');
 */
export function useDomainData(dataSourceId?: string | number | null,  sourceType: string = "table"): {
  rows: Record<string, any>[];
  loading: boolean;
  error: string | null;
} {
  const { domainCache, ensureDomainRows } = useDataProvider();
  const isState = sourceType === 'state';

  // Hooks must run unconditionally on every render regardless of
  // sourceType — this is a no-op (returns undefined) whenever isState is
  // false, since statePath is undefined in that case.
  const statePath: StatePath | undefined = isState && dataSourceId != null ? String(dataSourceId) as StatePath : undefined;
  const stateValue = useHubValue(statePath);

  const key = !isState && dataSourceId != null ? `${sourceType}:${String(dataSourceId)}` : '';

  useEffect(() => {
    if (isState || !key) return;
    ensureDomainRows(String(dataSourceId), sourceType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, isState]);

  if (isState) {
    // A bound state value can be a full rows array (e.g. another Data
    // Grid's `input.rows`) or a single record (e.g. a `selectedRow`) —
    // normalize either shape into the same {rows, loading, error} contract
    // every existing consumer already expects, so no plugin needs new
    // branching just to support "State" as a source.
    if (stateValue == null) return EMPTY_DOMAIN_ENTRY;
    const rows: Record<string, any>[] = Array.isArray(stateValue)
      ? (stateValue as Record<string, any>[])
      : typeof stateValue === 'object'
        ? [stateValue as Record<string, any>]
        : [];
    return { rows, loading: false, error: null };
  }

  if (!key) return EMPTY_DOMAIN_ENTRY;
  return domainCache[key] ?? EMPTY_DOMAIN_ENTRY;
}

/**
 * Same as useDomainData, but also applies the query saved by the Logic
 * Architect (sky-view-builder's QueryField / Query Builder) for this
 * instance — the same "queried from Query Builder" filter shape that used
 * to be applied ad-hoc inside each plugin.
 *
 *   const { rows, allRows, loading, error } = useQueriedDomainData(dataSourceId, query);
 */
export function useQueriedDomainData(
  dataSourceId: string | number | null | undefined,
  sourceTypeOrQuery: string | any,
  maybeQuery?: any
): {
  rows: Record<string, any>[];
  allRows: Record<string, any>[];
  loading: boolean;
  error: string | null;
} {
  // Backwards-compatible caller support:
  // - old callers: useQueriedDomainData(dataSourceId, query)
  // - new callers: useQueriedDomainData(dataSourceId, sourceType, query)
  let sourceType = 'table';
  let query: any = undefined;

  if (typeof sourceTypeOrQuery === 'string') {
    sourceType = sourceTypeOrQuery;
    query = maybeQuery;
  } else {
    query = sourceTypeOrQuery;
  }

  const { rows: allRows, loading, error } = useDomainData(
    dataSourceId,
    sourceType
  );

  const rows = useMemo(
    () => applyQueryFilters(allRows, query),
    [allRows, query]
  );

  return { rows, allRows, loading, error };
}