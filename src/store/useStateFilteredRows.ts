import { useMemo, useSyncExternalStore } from 'react';
import { useHub } from './StateHubContext';
import {
  applyStateFilters,
  filterStatePath,
  isActiveStateFilter,
  resolveFilterValue,
  stateBindingId,
  type StateFilter,
  type StateFilterResult,
} from './stateFilters';

/**
 * Narrows `rows` by the CURRENT value of the state variables the filters are
 * bound to, and re-runs automatically when any of those variables change.
 *
 *   const { rows: queried } = useQueriedDomainData(dataSourceId, type, query);
 *   const { rows, pending } = useStateFilteredRows(queried, configs.stateFilters);
 *
 * It composes with (does not replace) the Logic Architect query: the saved
 * query runs first, then live state filters narrow the result further.
 *
 * Built on useSyncExternalStore against StateHub.subscribe(), so:
 *   - it works even if the Table mounts BEFORE the Dropdown that owns the state
 *   - it never misses a change that lands between render and subscribe
 *   - no event name has to be declared by the producing component
 */
export function useStateFilteredRows<T extends Record<string, any>>(
  rows: T[],
  filters: Array<Partial<StateFilter>> | null | undefined
): StateFilterResult<T> {
  const hub = useHub();

  const filtersSig = JSON.stringify(filters ?? []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableFilters = useMemo(() => (filters ?? []) as Array<Partial<StateFilter>>, [filtersSig]);

  const active = useMemo(() => stableFilters.filter(isActiveStateFilter), [stableFilters]);
  const keysSig = active.map(stateBindingId).join('\u0000');

  const subscribe = useMemo(
    () => (notify: () => void) => {
      const unsubscribers = active.map((f) => hub.subscribe(filterStatePath(f), notify));
      return () => unsubscribers.forEach((off) => off());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hub, keysSig]
  );

  // The snapshot is a string so React can compare it by value; an object would
  // be a new reference every call and cause an infinite render loop.
  const getSnapshot = () =>
    JSON.stringify(active.map((f) => resolveFilterValue(f, hub.get(filterStatePath(f))) ?? null));
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(() => {
    const parsed = JSON.parse(snapshot) as unknown[];
    const values: Record<string, unknown> = {};
    active.forEach((f, i) => {
      values[stateBindingId(f)] = parsed[i];
    });
    return applyStateFilters(rows, stableFilters, values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, stableFilters, snapshot]);
}