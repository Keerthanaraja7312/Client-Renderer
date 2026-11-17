import { useCallback, useSyncExternalStore } from 'react';
import { useHub } from '../../store/StateHubContext';
import type { StatePath } from './types';

/**
 * Reactively reads a StateHub path — re-renders the calling component
 * whenever hub.set()/setResolved() writes to this exact path, via the
 * hub.subscribe() added alongside this hook.
 *
 * Built on useSyncExternalStore rather than a manual useEffect+useState
 * pair deliberately: this is the correct React 18 primitive for
 * subscribing to state that lives outside React (a plain class instance
 * here), and it's what avoids the exact "Maximum update depth exceeded"
 * class of bug we hit earlier with an ad-hoc Zustand selector — as long as
 * getSnapshot() returns a stable reference when nothing has changed. Since
 * hub.get(path) returns the same node.value reference until set() is
 * called again, that's satisfied here without needing any extra memoing.
 *
 *   const branches = useHubValue(path); // re-renders live as it changes
 */
export function useHubValue(path: StatePath | undefined): unknown {
  const hub = useHub();

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!path) return () => {};
      return hub.subscribe(path, onStoreChange);
    },
    [hub, path]
  );

  const getSnapshot = useCallback(() => {
    if (!path) return undefined;
    return hub.get(path);
  }, [hub, path]);

  return useSyncExternalStore(subscribe, getSnapshot);
}