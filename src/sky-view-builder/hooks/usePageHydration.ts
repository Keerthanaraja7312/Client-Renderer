import { useEffect, useRef } from 'react';
import { useHub } from '@/store/StateHubContext';
import type { PageMeta, BlockMeta, ComponentMeta } from '@/store/types';

/**
 * Resolves block refs → BlockMeta and component refs → ComponentMeta,
 * then calls hub.hydratePage() once on mount (or when pageId changes).
 *
 * Usage — drop this into whatever component renders a page:
 *
 *   usePageHydration(pageMeta, blockDefs, componentDefs);
 *
 * Where:
 *   pageMeta      — your page JSON (id, title, layout, blocks[], state)
 *   blockDefs     — map of blockRefId → BlockMeta  (your block JSON files)
 *   componentDefs — map of componentRefId → ComponentMeta (your component JSON files)
 *
 * Example:
 *
 *   import pageMeta      from '@/metadata/pages/customer-dashboard.json';
 *   import searchBlock   from '@/metadata/blocks/search-block.json';
 *   import customerTable from '@/metadata/blocks/customer-table.json';
 *   import countryDrop   from '@/metadata/components/country-dropdown.json';
 *   import stateDrop     from '@/metadata/components/state-dropdown.json';
 *   import searchBtn     from '@/metadata/components/search-button.json';
 *
 *   const blockDefs     = { 'search-block': searchBlock, 'customer-table': customerTable };
 *   const componentDefs = { 'country-dropdown': countryDrop, 'state-dropdown': stateDrop, 'search-button': searchBtn };
 *
 *   usePageHydration(pageMeta, blockDefs, componentDefs);
 *
 * Block reuse:
 *   If the same ref appears twice (e.g. customerSearch and supplierSearch both ref
 *   'search-block'), hydratePage() creates two isolated state namespaces:
 *     customer-dashboard.customerSearch.country
 *     customer-dashboard.supplierSearch.country
 *
 * datasource → dataProvider:
 *   Component JSON may currently carry a `datasource` field.
 *   When you rename it to `dataProvider`, no changes are needed here —
 *   this hook only registers state; data fetching is handled separately
 *   by useComponentData inside each plugin's canvas element.
 */
export function usePageHydration(
  pageMeta: PageMeta,
  blockDefs: Record<string, BlockMeta>,
  componentDefs: Record<string, ComponentMeta>
): void {
  const hub = useHub();

  // Track which page ids have already been hydrated so a re-render
  // caused by unrelated state changes does not re-register nodes.
  const hydratedPages = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!pageMeta?.id) return;

    if (hydratedPages.current.has(pageMeta.id)) return;

    // Validate that every block ref on the page has a definition.
    const missingBlocks = (pageMeta.blocks ?? [])
      .map((b) => b.ref)
      .filter((ref) => !blockDefs[ref]);

    if (missingBlocks.length > 0) {
      console.warn(
        `[usePageHydration] Page "${pageMeta.id}" references unknown block refs:`,
        missingBlocks
      );
    }

    // Validate that every component ref inside each block has a definition.
    const missingComponents: string[] = [];
    for (const blockInstance of pageMeta.blocks ?? []) {
      const blockMeta = blockDefs[blockInstance.ref];
      if (!blockMeta) continue;
      for (const compInstance of blockMeta.components ?? []) {
        if (!componentDefs[compInstance.ref]) {
          missingComponents.push(
            `${blockInstance.ref} → ${compInstance.ref}`
          );
        }
      }
    }

    if (missingComponents.length > 0) {
      console.warn(
        `[usePageHydration] Unknown component refs:`,
        missingComponents
      );
    }

    // Hydrate — registers all page / block / component state nodes into the hub.
    hub.hydratePage(pageMeta, blockDefs, componentDefs);
    hydratedPages.current.add(pageMeta.id);

    // Wire up block-level subscriptions declared in each block's state.subscribes[].
    // When a subscribed event fires, the block's state keys are reset to their
    // default values so child components react accordingly.
    for (const blockInstance of pageMeta.blocks ?? []) {
      const blockMeta = blockDefs[blockInstance.ref];
      if (!blockMeta?.state?.subscribes?.length) continue;

      const ctx = { blockInstanceId: blockInstance.id, pageId: pageMeta.id };

      for (const eventName of blockMeta.state.subscribes) {
        hub.on(eventName, (_payload, _sourcePath) => {
          // Reset block state keys to their defaults when the subscribed event fires.
          // Extend this handler if you need richer behaviour (e.g. re-fetching data).
          if (!blockMeta.state?.values) return;
          for (const [key, defaultValue] of Object.entries(blockMeta.state.values)) {
            const path = `${ctx.pageId}.${ctx.blockInstanceId}.${key}`;
            hub.set(path, defaultValue);
          }
        });
      }
    }
  }, [pageMeta?.id]); // Re-run only when the page changes, not on every render.
}