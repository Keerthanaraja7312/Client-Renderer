import { useEffect } from 'react';
import { useHub } from '@/store/StateHubContext';
import type { StateScope } from '@/store/types';

/**
 * Call this inside any leaf plugin canvas component to register
 * its state keys into a global component namespace.
 *
 * The path built is: global.components.componentId.stateKey
 *
 * Usage inside a plugin canvas element:
 *
 *   const MyDropdownCanvas = ({ configs }) => {
 *     useComponentState({
 *       componentId: id,
 *       stateKeys: { selectedValue: null, loading: false },
 *       publishes: ['countryChanged'],
 *     });
 *     ...
 *   }
 */

interface UseComponentStateOptions {
  /** Globally unique component instance id. */
  componentId: string;
  /** { stateKey: defaultValue } */
  stateKeys: Record<string, unknown>;
  publishes?: string[];
  subscribes?: string[];
  pageId?: string;
  blockInstanceId?: string;
  scope?: StateScope;
}

export function useComponentState({
  componentId,
  stateKeys,
  publishes = [],
  subscribes = [],
  pageId,
  blockInstanceId,
  scope = 'component',
}: UseComponentStateOptions) {
  const hub = useHub();

  useEffect(() => {
    if (!componentId || scope !== 'component') return;

    const registeredPaths: string[] = [];

    for (const [key, defaultValue] of Object.entries(stateKeys)) {
      const path = `global.components.${componentId}.${key}`;
      registeredPaths.push(path);
      if (!hub.getNode(path)) {
        hub.registerComponentState(
          {
            id: key,
            state: {
              scope: 'component',
              values: { [key]: defaultValue },
              publishes,
              subscribes,
            },
          },
          { componentId, blockInstanceId: blockInstanceId ?? '', pageId: pageId ?? '' }
        );
      }
    }

    // Clean up on unmount (block deleted, or this component instance is
    // otherwise going away) — without this, the path stays in the hub
    // forever, showing up as a live-looking option (e.g. in the State
    // dropdown) with stale data long after the block that owned it is gone.
    return () => {
      for (const path of registeredPaths) {
        hub.removeNode(path);
      }
    };
  }, [componentId, hub, JSON.stringify(stateKeys), JSON.stringify(publishes), JSON.stringify(subscribes), blockInstanceId, pageId, scope]);

  /**
   * Reads the current hub value for a state key in this component's context.
   * path: global.components.componentId.key
   */
  const getState = (key: string): unknown => {
    return hub.getResolved(key, { componentId, blockInstanceId, pageId });
  };

  /**
   * Writes a value to the hub and fires any published events.
   */
  const setState = (key: string, value: unknown) => {
    if (scope === 'block' && blockInstanceId) {
      hub.set(`global.blocks.${blockInstanceId}.${key}`, value);
      return;
    }
    if (scope === 'page' && pageId) {
      hub.set(`global.pages.${pageId}.${key}`, value);
      return;
    }
    if (scope === 'global') {
      hub.set(`global.shared.${key}`, value);
      return;
    }
    hub.set(`global.components.${componentId}.${key}`, value);
  };

  /**
   * Full resolved path for a key — useful for subscribing to events.
   */
  const getPath = (key: string) => {
    if (scope === 'block' && blockInstanceId) return `global.blocks.${blockInstanceId}.${key}`;
    if (scope === 'page' && pageId) return `global.pages.${pageId}.${key}`;
    if (scope === 'global') return `global.shared.${key}`;
    return `global.components.${componentId}.${key}`;
  };

  return { getState, setState, getPath, hub };
}