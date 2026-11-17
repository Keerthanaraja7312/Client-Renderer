import type { ComponentInstance } from '@/sky-view-builder/core/plugin';

// The data attribute each Block's components-area DOM node carries, so
// `findBlockDropTargetAt` can identify (via elementFromPoint + walking up
// the DOM) which block, if any, the cursor is currently over.
export const DROP_BLOCK_ATTR = 'data-drop-block-id';

interface BlockDropTarget {
  /** The block's own components-area DOM node — used to translate a
   *  client (viewport) point into that block's local drop coordinates. */
  element: HTMLElement;
  /** Adds an already-existing component instance (dragged in from a
   *  different block) into this block, at the given client (viewport)
   *  point. Implemented per-block in blockplugin.tsx. */
  addExistingComponent: (instance: ComponentInstance, clientX: number, clientY: number) => void;
}

// Every currently-mounted, currently-open Block registers itself here
// while mounted (see the useEffect in BlockCanvas), keyed by its blockId.
// Plain module-level singleton, same pattern as other cross-cutting drag
// state in this codebase (e.g. Toolbar's PLUGIN_DRAG_MIME convention) —
// there's no need for React context just to look this up at mouseup time.
const targets = new Map<string, BlockDropTarget>();

export function registerBlockDropTarget(blockId: string, target: BlockDropTarget): () => void {
  targets.set(blockId, target);
  return () => {
    // Only clear if we're still the registered target for this id — guards
    // against a stale unmount cleanup clobbering a newer registration
    // (e.g. React briefly mounting two instances during a fast update).
    if (targets.get(blockId) === target) targets.delete(blockId);
  };
}

/**
 * Finds whichever registered block's dropzone the given client point is
 * over, if any, excluding `excludeBlockId` (normally the block the
 * component being dragged already lives in — dropping back onto itself
 * isn't a "move").
 */
export function findBlockDropTargetAt(
  clientX: number,
  clientY: number,
  excludeBlockId?: string
): { blockId: string; target: BlockDropTarget } | null {
  // elementFromPoint alone only returns the SINGLE topmost element at this
  // pixel — which, mid-drag, is the component being dragged itself (it's
  // still a DOM child of its original block, just visually following the
  // cursor via a CSS transform). Walking up from it only ever finds the
  // source block, which is excluded, so the real target underneath was
  // never actually checked. elementsFromPoint returns every element
  // stacked at this pixel in z-order, so we can walk past the dragged item
  // to whatever block is genuinely underneath it.
  const stack = document.elementsFromPoint(clientX, clientY);

  for (const el of stack) {
    let node: HTMLElement | null = el as HTMLElement | null;
    while (node) {
      const blockId = node.getAttribute?.(DROP_BLOCK_ATTR);
      if (blockId && blockId !== excludeBlockId) {
        const target = targets.get(blockId);
        if (target) return { blockId, target };
      }
      node = node.parentElement;
    }
  }

  return null;
}