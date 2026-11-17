import React, { useState, useEffect, useRef } from 'react';
import { Layers, ChevronDown, ChevronRight, Move, Trash2 } from 'lucide-react';

import GridLayout, { Responsive, WidthProvider, type Layout } from 'react-grid-layout/legacy';
import { BLOCK_BREAKPOINTS, BLOCK_COLS, buildBlockLayouts } from '@/sky-view-builder/ui/responsiveGrid';
import { findFreeSpot, requiredGridAreaSize, type Rect } from '@/sky-view-builder/ui/blockPlacement';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import type { ViewBuilderPlugin, ComponentInstance } from '@/sky-view-builder/core/plugin';
import { registry } from '@/sky-view-builder/core/registry';
import { useHub } from '@/store/StateHubContext';
import { PLUGIN_DRAG_MIME } from '@/sky-view-builder/ui/Toolbar';
import { InlineEditableText } from '@/sky-view-builder/ui/InlineEditableText';
import { registerBlockDropTarget, findBlockDropTargetAt } from '@/sky-view-builder/ui/blockDropRegistry';
import { resolveDroppedTemplate } from '@/sky-view-builder/core/templateStore';
import { useDomainData } from '@/data/DataProvider';
import { withVisualStyle, StyledSurface, useVisualStyle } from '@/sky-view-builder/styles/withVisualStyle';
import type { WithVisualStyleConfigs } from '@/sky-view-builder/styles/withVisualStyle';
import { canViewSource } from '../lib/permissions';
// ─── Types ────────────────────────────────────────────────────────────────────

export type StateKeyDef = { key: string; defaultValue: string };



export type BlockConfigs = WithVisualStyleConfigs & {
  blockId: string;
  /** Optional display label shown in the Block's own header row (editor only). Falls back to "Block" when empty. */
  title?: string;
  layout: 'horizontal' | 'vertical';
  layoutMode?: 'freeform' | 'auto';
  /** Grid row scale of the saved layout (2 = 20px rows). Missing = old 40px rows, upgraded once on load. */
  gridScale?: number;
  /** Leave unset to inherit the parent Page's background color automatically. */
  bgColor?: string;
  x?: number;
  y?: number;
  /** Explicit size in px. Leave unset (0) to size naturally (fill wrapper). */
  width?: number;
  height?: number;
  stateKeys: StateKeyDef[];
  publishes: string[];
  subscribes: string[];
  components: ComponentInstance[];     // child component instances
  blocks: ComponentInstance[];         // nested child blocks
  // injected by PagePlugin when rendering
  _pageId?: string;
  _pageBgColor?: string;
};

export const DEFAULT_COMPONENT_WIDTH = 220;
export const DEFAULT_COMPONENT_HEIGHT = 120;
const DEFAULT_BLOCK_WIDTH = 280;
const DEFAULT_BLOCK_HEIGHT = 160;
const FREEFORM_GAP = 12;
const SNAP_SIZE = 12;

// Preview/published pages use the responsive grid (re-flows with the block's own
// width). The designer keeps the plain grid so editing always happens on the wide layout.

/** Elements that must keep their normal behaviour (typing, clicking, resizing) and never start a drag. */
const NO_DRAG_SELECTOR =
  'input,textarea,select,button,a,label,[contenteditable="true"],[role="button"],[role="slider"],.no-drag,.rgl-resize-handle';
const isNoDragTarget = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest(NO_DRAG_SELECTOR);

const ResponsiveGridLayout = WidthProvider(Responsive);
// Designer grid: width is MEASURED from its container and follows it when the block is
// resized (a one-off read of the container during render goes stale).
const DesignGridLayout = WidthProvider(GridLayout);


// react-grid-layout config (auto-layout mode only)
const GRID_COLS = 12;
// Rows are half as tall as before (20px, 6px gap) so a component can end close to
// where its content ends instead of being rounded up to a 52px step.
// Layouts saved with the old 40px rows are doubled once (see GRID_SCALE_KEY).
const GRID_ROW_HEIGHT = 20;
const GRID_MARGIN: [number, number] = [12, 6];
const GRID_SCALE = 2;

// Grid-unit (cols/rows) sizing per plugin type — separate from the pixel
// sizing used in freeform mode.
const isSingleLine = (pluginId: string) => pluginId.includes('breadcrumb');

function getDefaultGridSize(pluginId: string): { w: number; h: number } {
  if (['data-table', 'cards-table', 'recent-candidates-plugin', 'table-plugin', 'domain-list'].includes(pluginId)) return { w: 6, h: 14 };
  if (pluginId === 'info-cards') return { w: 12, h: 8 };
  if (pluginId === 'sidebar') return { w: 6, h: 18 };
  if (isSingleLine(pluginId)) return { w: 6, h: 2 };
  if (pluginId === 'search-button') return { w: 3, h: 2 };
  if (pluginId === 'label' || pluginId === 'checkbox' || pluginId === 'toggle-button') return { w: 4, h: 2 };
  // label + input: about 54px, i.e. 3 rows (72px) instead of 2 old rows (92px)
  if (pluginId === 'text-box' || pluginId === 'generic-dropdown') return { w: 4, h: 3 };
  return { w: 6, h: 6 };
}

export const snap = (value: number) => Math.max(0, Math.round(value / SNAP_SIZE) * SNAP_SIZE);
export function getDefaultComponentSize(pluginId: string) {
  if (['data-table', 'cards-table', 'recent-candidates-plugin', 'table-plugin', 'domain-list'].includes(pluginId)) return { width: 620, height: 300 };
  if (pluginId === 'info-cards') return { width: 600, height: 170 };
  if (pluginId === 'sidebar') return { width: 520, height: 420 };
  if (pluginId === 'search-button') return { width: 140, height: 64 };
  if (pluginId === 'label' || pluginId === 'checkbox' || pluginId === 'toggle-button') return { width: 160, height: 64 };
  if (pluginId === 'generic-dropdown') return { width: 220, height: 64 };
  return { width: DEFAULT_COMPONENT_WIDTH, height: DEFAULT_COMPONENT_HEIGHT };
}

// Per-plugin minimum size — components can grow freely but never shrink
// below the size they need to stay usable (e.g. a Table needs room for a
// header + a few rows).
export function getMinComponentSize(pluginId: string): { minW: number; minH: number } {
  if (['data-table', 'cards-table', 'recent-candidates-plugin', 'table-plugin', 'domain-list'].includes(pluginId)) {
    return { minW: 320, minH: 220 };
  }
  if (pluginId === 'info-cards') return { minW: 240, minH: 100 };
  if (pluginId === 'sidebar') return { minW: 240, minH: 200 };
  if (pluginId === 'search-button') return { minW: 100, minH: 48 };
  if (pluginId === 'label' || pluginId === 'checkbox' || pluginId === 'toggle-button') return { minW: 100, minH: 48 };
  if (pluginId === 'generic-dropdown') return { minW: 140, minH: 48 };
  return { minW: 100, minH: 60 };
}

function componentRect(component: ComponentInstance) {
  return {
    x: component.configs?.x ?? FREEFORM_GAP,
    y: component.configs?.y ?? FREEFORM_GAP,
    width: component.configs?.width || DEFAULT_COMPONENT_WIDTH,
    height: component.configs?.height || DEFAULT_COMPONENT_HEIGHT,
  };
}

const gridRectOf = (c: ComponentInstance): Rect | null => {
  const g: any = c.configs || {};
  return typeof g.gridX === 'number' && typeof g.gridY === 'number' && Number.isFinite(g.gridY)
    ? { x: g.gridX, y: g.gridY, w: g.gridW ?? 1, h: g.gridH ?? 1 }
    : null;
};

/**
 * Where a dropped component goes in the block's grid.
 *  - wide enough for its own minimum size (never squeezed below it);
 *  - never overlapping, and never pushing, a neighbour: it takes the nearest
 *    free spot beside it, narrows to fit a gap, or goes below.
 */
function planGridPlacement(
  pluginId: string,
  dropX: number,
  dropY: number,
  areaWidth: number,
  existing: ComponentInstance[]
): { gridX: number; gridY: number; gridW: number; gridH: number } {
  const def = getDefaultGridSize(pluginId);
  const colWidth = Math.max(1, (areaWidth - GRID_MARGIN[0] * (GRID_COLS + 1)) / GRID_COLS);
  const { minW: minPxW } = getMinComponentSize(pluginId);
  const minCols = Math.min(GRID_COLS, Math.max(1, Math.ceil((minPxW + GRID_MARGIN[0]) / (colWidth + GRID_MARGIN[0]))));
  const w = Math.min(GRID_COLS, Math.max(def.w, minCols));
  const wantX = Math.max(0, Math.min(Math.round(dropX / (colWidth + GRID_MARGIN[0])), GRID_COLS - w));
  const wantY = Math.max(0, Math.round(dropY / (GRID_ROW_HEIGHT + GRID_MARGIN[1])));
  const taken = existing.map(gridRectOf).filter((r): r is Rect => r !== null);
  const spot = findFreeSpot(taken, { x: wantX, y: wantY, w, h: def.h }, GRID_COLS, minCols);
  return { gridX: spot.x, gridY: spot.y, gridW: spot.w, gridH: spot.h };
}

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
type ResizeHandle = ResizeCorner | 'n' | 's' | 'e' | 'w';
// ─── Sync block-level state keys into StateHub ────────────────────────────────

function useBlockState(pageId: string, blockId: string, stateKeys: StateKeyDef[], publishes: string[]) {
  const hub = useHub();
  useEffect(() => {
    if (!pageId || !blockId || !stateKeys.length) return;
    hub.registerBlockState(
      {
        id: blockId,
        state: {
          scope: 'block',
          values: Object.fromEntries(stateKeys.map(s => [s.key, s.defaultValue ?? null])),
          publishes,
        },
      },
      { blockInstanceId: blockId, pageId }
    );
  }, [pageId, blockId, JSON.stringify(stateKeys), JSON.stringify(publishes)]);
}

// ─── Reusable four-corner resize handles ──────────────────────────────────────
// Shared visual + drag logic used by both the Block and each Component, so
// resizing behaves identically everywhere: opposite corner stays anchored,
// width/height clamp to a minimum, and x/y only move on the corners that own them.

// Custom resize handle for react-grid-layout — RGL requires a forwardRef
// component so its internal react-resizable wrapper can attach drag
// listeners directly to this DOM node. Supports all handle axes RGL offers
// (n/s/e/w/ne/nw/se/sw) so components can be resized from any edge/corner.
//
// Positioning uses inline `style`, NOT Tailwind's translate-x/y utility
// classes. Those utilities require Tailwind's `transform` utility to be
// active; if it's missing/purged, `-translate-x-1/2`/`-translate-y-1/2`
// silently no-op and the n/s/e/w handles land in the wrong place (or become
// effectively unusable) — which looks exactly like "width resizes fine but
// height never changes." Inline styles have no such dependency.
const RGL_HANDLE_STYLE: Record<string, React.CSSProperties> = {
  s: { bottom: -6, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' },
  n: { top: -6, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' },
  e: { right: -6, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' },
  w: { left: -6, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' },
  se: { bottom: -6, right: -6, cursor: 'nwse-resize' },
  sw: { bottom: -6, left: -6, cursor: 'nesw-resize' },
  ne: { top: -6, right: -6, cursor: 'nesw-resize' },
  nw: { top: -6, left: -6, cursor: 'nwse-resize' },
};

const RGLResizeHandle = React.forwardRef<
  HTMLDivElement,
  {
    handleAxis?: string;
    style?: React.CSSProperties;
    onMouseDown?: (e: React.MouseEvent) => void;
    onMouseUp?: (e: React.MouseEvent) => void;
    onTouchEnd?: (e: React.TouchEvent) => void;
  }
>(({ handleAxis = 'se', style, onMouseDown, onMouseUp, onTouchEnd, ...rest }, ref) => (
  <div
    ref={ref}
    className="rgl-resize-handle absolute z-30 h-4 w-4 rounded-lg border border-primary bg-primary/80 shadow-md hover:scale-110 transition-transform"
    style={{ ...RGL_HANDLE_STYLE[handleAxis], ...style }}
    // stopPropagation FIRST, then still call react-resizable's own handler
    // (destructured above, not spread via ...rest) so resizing itself still
    // works — this just stops the mousedown from also bubbling up to the
    // outer Page-level grid's `draggableHandle=".group"`, which otherwise
    // treats any click inside the enclosing card (including this handle,
    // nested arbitrarily deep) as "drag the whole Block/Page item".
    onMouseDown={(e) => {
      e.stopPropagation();
      onMouseDown?.(e);
    }}
    onMouseUp={(e) => {
      e.stopPropagation();
      onMouseUp?.(e);
    }}
    onTouchEnd={(e) => {
      e.stopPropagation();
      onTouchEnd?.(e);
    }}
    {...rest}
  />
));
RGLResizeHandle.displayName = 'RGLResizeHandle';

const RESIZE_CORNERS: { corner: ResizeCorner; pos: string; cursor: string }[] = [
  { corner: 'nw', pos: 'left-2 top-2', cursor: 'cursor-nwse-resize' },
  { corner: 'ne', pos: 'right-2 top-2', cursor: 'cursor-nesw-resize' },
  { corner: 'sw', pos: 'left-2 bottom-2', cursor: 'cursor-nesw-resize' },
  { corner: 'se', pos: 'right-2 bottom-2', cursor: 'cursor-nwse-resize' },
];

// Page-style handles: 8 squares centred on the border (4 corners + 4 edge
// midpoints), same look as the Page's grid handles.
const FRAME_HANDLES: { handle: ResizeHandle; style: React.CSSProperties }[] = [
  { handle: 'n',  style: { top: -6, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' } },
  { handle: 's',  style: { bottom: -6, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' } },
  { handle: 'e',  style: { right: -6, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' } },
  { handle: 'w',  style: { left: -6, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' } },
  { handle: 'nw', style: { top: -6, left: -6, cursor: 'nwse-resize' } },
  { handle: 'ne', style: { top: -6, right: -6, cursor: 'nesw-resize' } },
  { handle: 'sw', style: { bottom: -6, left: -6, cursor: 'nesw-resize' } },
  { handle: 'se', style: { bottom: -6, right: -6, cursor: 'nwse-resize' } },
];

function ResizeHandles({
  onResizeStart,
  isResizing,
  variant = 'corners',
}: {
  onResizeStart: (handle: ResizeHandle) => (e: React.MouseEvent) => void;
  isResizing: boolean;
  variant?: 'corners' | 'frame';
}) {
  if (variant === 'frame') {
    return (
      <>
        {FRAME_HANDLES.map(({ handle, style }) => (
          <div
            key={handle}
            role="presentation"
            onMouseDown={onResizeStart(handle)}
            title="Drag to resize"
            style={style}
            className={`rgl-resize-handle absolute z-30 h-4 w-4 rounded-lg border border-primary bg-primary/80 shadow-md transition-transform hover:scale-110 ${isResizing ? 'scale-110' : ''}`}
          />
        ))}
      </>
    );
  }
  return (
    <>
      {RESIZE_CORNERS.map(({ corner, pos, cursor }) => (
        <button
          key={corner}
          type="button"
          onMouseDown={onResizeStart(corner)}
          title="Drag to resize"
          aria-label={`Drag to resize (${corner})`}
          className={`absolute ${pos} z-20 h-4 w-4 ${cursor} rounded-lg border border-primary bg-primary/15 text-primary shadow-sm transition-all duration-150 ${
            isResizing ? 'opacity-100 scale-105' : 'opacity-90 hover:opacity-100 hover:scale-105'
          }`}
        >
          <span className="block h-full w-full rounded-[inherit] bg-gradient-to-br from-primary/20 to-transparent" />
        </button>
      ))}
    </>
  );
}

// ─── Component slot rendered inside Block ─────────────────────────────────────

export function ComponentSlot({
  compInstance,
  pageId,
  blockId,
  inheritedDataSourceId,
  inheritedType,
  inheritedQuery,
  onUpdate,
  onRemove,
  isPreview,
  selectedId,
  onSelect,
  isAutoLayout,
  containerSize,
}: {
  compInstance: ComponentInstance;
  pageId: string;
  blockId: string;
  inheritedDataSourceId?: string | number | null;
  inheritedType?: string | null;
  inheritedQuery?: Record<string, any>;
  onUpdate: (u: ComponentInstance | ((prev: ComponentInstance) => ComponentInstance)) => void;
  onRemove: () => void;
  isPreview?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  isAutoLayout?: boolean;
  containerSize?: { width: number; height: number };
}) {
  const [isMoving, setIsMoving] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const plugin = registry.getPlugin(compInstance.pluginId);
  if (!plugin) {
    return (
      <div className="text-xs text-muted-foreground italic p-2">
        Plugin "{compInstance.pluginId}" not found
      </div>
    );
  }
  const Component = isPreview && plugin.previewRender ? plugin.previewRender : plugin.canvas.element;
  const isSelected = selectedId === compInstance.id;

  const resolvedDataSourceId = compInstance.dataSourceId ?? inheritedDataSourceId ?? null;
  const resolvedType = compInstance.type ?? inheritedType ?? null;
  const resolvedQuery = (compInstance.query && Object.keys(compInstance.query).length > 0)
    ? compInstance.query
    : inheritedQuery;

  // Free-drag move within the block — grab the handle, drag anywhere, position
  // writes straight to the component's own configs.x/y so it travels with it.
  // No overlap check here: components are allowed to overlap freely, and the
  // drop position is always respected exactly (only clamped to the container
  // bounds so it doesn't get dragged fully outside the block).
  const handleMoveStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const start = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      compX: (compInstance.configs as any)?.x ?? 0,
      compY: (compInstance.configs as any)?.y ?? 0,
    };

    setIsMoving(true);

    const handleMove = (ev: MouseEvent) => {
      const dx = ev.clientX - start.mouseX;
      const dy = ev.clientY - start.mouseY;
      const compWidth = (compInstance.configs as any)?.width || DEFAULT_COMPONENT_WIDTH;
      const compHeight = (compInstance.configs as any)?.height || DEFAULT_COMPONENT_HEIGHT;
      const maxX = containerSize ? Math.max(0, containerSize.width - compWidth) : Infinity;
      const maxY = containerSize ? Math.max(0, containerSize.height - compHeight) : Infinity;
      onUpdate({
        ...compInstance,
        configs: {
          ...compInstance.configs,
          x: Math.min(maxX, snap(start.compX + dx)),
          y: Math.min(maxY, snap(start.compY + dy)),
        },
      });
    };

    const handleUp = (ev: MouseEvent) => {
      setIsMoving(false);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);

      // If the cursor is over a DIFFERENT block's drop area when released,
      // relocate the component there instead of just repositioning it
      // in-place. (Dropped back inside its own block, or over empty
      // canvas/page area with no registered block underneath, falls
      // through to the plain in-place move already applied by handleMove
      // above.)
      const dropTarget = findBlockDropTargetAt(ev.clientX, ev.clientY, blockId);
      if (dropTarget) {
        dropTarget.target.addExistingComponent(compInstance, ev.clientX, ev.clientY);
        onRemove();
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  // Four-corner resize — same anchored-opposite-corner behavior as the Block.
  // Clamped only to a per-plugin minimum size (so e.g. a Table never shrinks
  // below usable), with no upper bound other than the container edge.
  const handleResizeStart = (corner: ResizeHandle) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = containerRef.current?.getBoundingClientRect();
    const { minW, minH } = getMinComponentSize(compInstance.pluginId);
    const start = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      width: (compInstance.configs as any)?.width || rect?.width || DEFAULT_COMPONENT_WIDTH,
      height: (compInstance.configs as any)?.height || rect?.height || DEFAULT_COMPONENT_HEIGHT,
      left: (compInstance.configs as any)?.x ?? 0,
      top: (compInstance.configs as any)?.y ?? 0,
    };

    const affectsLeft = corner === 'nw' || corner === 'sw';
    const affectsTop = corner === 'nw' || corner === 'ne';

    setIsResizing(true);

    const handleMove = (ev: MouseEvent) => {
      const dx = ev.clientX - start.mouseX;
      const dy = ev.clientY - start.mouseY;

      const rawWidth = affectsLeft ? start.width - dx : start.width + dx;
      const rawHeight = affectsTop ? start.height - dy : start.height + dy;
      const maxWidth = containerSize ? containerSize.width - (affectsLeft ? 0 : start.left) : Infinity;
      const maxHeight = containerSize ? containerSize.height - (affectsTop ? 0 : start.top) : Infinity;
      const newWidth = Math.min(maxWidth, Math.max(minW, snap(rawWidth)));
      const newHeight = Math.min(maxHeight, Math.max(minH, snap(rawHeight)));

      const configUpdates: Record<string, number> = { width: newWidth, height: newHeight };
      if (affectsLeft) configUpdates.x = snap(start.left + (start.width - newWidth));
      if (affectsTop) configUpdates.y = snap(start.top + (start.height - newHeight));

      onUpdate({
        ...compInstance,
        configs: { ...compInstance.configs, ...configUpdates },
      });
    };

    const handleUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  return (
    <div
      ref={containerRef}
      
            data-comp-slot=""
      // Grab the component anywhere on its body to move it. Free layout moves
      // it with our own handler; auto layout lets react-grid-layout do it via
      // the `rgl-drag-handle` class (draggableCancel skips inputs/buttons).
      onMouseDown={!isPreview && !isAutoLayout ? (e) => { if (!isNoDragTarget(e.target)) handleMoveStart(e); } : undefined}
      className={`relative group/comp group/resize h-full w-full rounded-md transition-colors overflow-visible ${
        !isPreview ? (isAutoLayout ? 'rgl-drag-handle cursor-grab active:cursor-grabbing' : 'cursor-grab active:cursor-grabbing') : ''
      } ${
        isMoving ? 'opacity-60 shadow-2xl z-50' : ''
      } ${isResizing ? 'select-none' : ''}`}
      onClick={(e) => {
        // Stop here so the parent Block (or Page) doesn't steal the selection.
        e.stopPropagation();
        onSelect?.(compInstance.id);
      }}
    >
      {!isPreview && (
        <>
          {/* Component name chip: shows the component's own title (same
              `title` setting as the config panel) or the plugin name, and is
              renamed by double-clicking. Stays visible while editing. */}
          <span className={`absolute -top-2 left-2 z-10 ${isRenaming ? 'flex' : 'hidden group-hover/comp:block'} max-w-[85%] rounded-full border border-border bg-secondary px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-muted-foreground shadow-sm`}>
            <InlineEditableText
              value={(compInstance.configs as any)?.title ?? ''}
              placeholder={plugin.toolbar.name}
              onCommit={(title) => onUpdate({ ...compInstance, configs: { ...compInstance.configs, title } })}
              onEditingChange={setIsRenaming}
              className="block truncate"
              inputClassName="text-[9px] font-bold uppercase tracking-wider w-32"
            />
          </span>

          {/* Move handle, delete button, and resize handles are gated by
              isSelected — they only render once this component is actually
              selected (a deliberate click), and disappear as soon as
              selection moves elsewhere (e.g. clicking empty canvas space,
              which clears selectedId). This keeps the canvas uncluttered
              instead of showing adjustment UI on every component at once. */}
          {isSelected && (
            <>
              {/* Drag handle strip — a wider grab area (not just the small Move
                  icon) spanning the top edge, so the component is easy to pick up
                  from almost anywhere along its top without needing to hit a tiny
                  target. Clicking/typing inside the component's own content still
                  never starts a drag since only this strip is draggable.
                  Positioned well above the box (top: -32px) rather than -top-2,
                  so it doesn't share pixel space with the resize handles' `n`
                  handle (top: -6px, z-30) — they were sitting on top of each
                  other and the resize handle (higher z-index) was winning
                  every click, making the drag pill effectively unclickable. */}
              <div
                onMouseDown={isAutoLayout ? undefined : handleMoveStart}
                title="Drag to move"
                style={{ top: -32, left: '50%', transform: 'translateX(-50%)' }}
                className={`absolute z-10 flex h-5 w-6 items-center justify-center rounded-full bg-card border border-border text-muted-foreground/50 hover:text-foreground hover:border-primary/50 transition-all ${
                  isAutoLayout ? 'rgl-drag-handle cursor-grab active:cursor-grabbing' : 'cursor-grab active:cursor-grabbing'
                }`}
              >
                <Move className="w-3 h-3" />
              </div>
              {/* Wider invisible drag strip along the whole top edge — RGL only
                  needs an element with the `rgl-drag-handle` class anywhere
                  inside the item, so this extends the grabbable area without
                  changing the visual pill above. Also raised to match, and
                  kept a couple px shorter than the resize handle's vertical
                  reach so it doesn't intercept clicks meant for `nw`/`ne`. */}
              {isAutoLayout && (
                <div
                  className="rgl-drag-handle absolute left-0 right-0 h-5 cursor-grab active:cursor-grabbing z-[9]"
                  style={{ top: -32 }}
                />
              )}

              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                title="Delete"
                // Sits inside the component's own box (not floating out by the
                // resize handles, which cluster around top:-6/right:-6) so a
                // slightly-off grab at the corner while resizing can no longer
                // land on this button instead.
                className="absolute top-1 right-1 z-40 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg transition-colors hover:bg-destructive/90"
              >
                <Trash2 className="h-3 w-3" />
              </button>

              {!isAutoLayout && <ResizeHandles onResizeStart={handleResizeStart} isResizing={isResizing} />}
            </>
          )}
        </>
      )}
      <div className="h-full w-full p-1">
        <Component
          id={compInstance.id}
          configs={{
            ...compInstance.configs,
            // pass context down so component can resolve its state path
            _pageId: pageId,
            _blockId: blockId,
          }}
          componentDataSchema={compInstance.componentDataSchema}
          query={resolvedQuery}
          dataSourceId={resolvedDataSourceId}
          type={resolvedType}
          isPreview={isPreview}
          stateIO={compInstance.state}
          selectedId={selectedId}
          onSelect={onSelect}
          updateConfigs={(partial: any) =>
            onUpdate((prev) => ({
              ...prev,
              configs: {
                ...prev.configs,
                ...(typeof partial === 'function' ? partial(prev.configs) : partial),
              },
            }))
          }
        />
      </div>
    </div>
  );
}

// ─── Block Canvas ─────────────────────────────────────────────────────────────

function BlockCanvas({
  configs,
  updateConfigs,
  isPreview,
  selectedId,
  onSelect,
  dataSourceId,
  dataSourceType,
  type,
  query,
  inheritedDataSourceId,
  inheritedType,
  inheritedQuery,
}: {
  configs: BlockConfigs;
    updateConfigs?: (c: Partial<BlockConfigs> | ((prev: BlockConfigs) => Partial<BlockConfigs>)) => void;
  isPreview?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  dataSourceId?: string | number | null;
  dataSourceType?: string | null;
  type?: string | null;
  query?: Record<string, any>;
  inheritedDataSourceId?: string | number | null;
  inheritedType?: string | null;
  inheritedQuery?: Record<string, any>;
}) {
  const [open, setOpen] = useState(true);
  const [isResizing, setIsResizing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const componentsAreaRef = useRef<HTMLDivElement>(null);
  // The width the component grid really has (not the block's outer box, which includes padding).
  const getGridAreaWidth = () => componentsAreaRef.current?.clientWidth || containerRef.current?.clientWidth || 960;

  const pageId     = configs._pageId   || 'page';
  const blockId    = configs.blockId   || 'block';
  const stateKeys  = configs.stateKeys ?? [];
  const components = configs.components ?? [];
  const blocks     = configs.blocks ?? [];
  const publishes  = configs.publishes  ?? [];
  // Responsive grid is the safe default for a Block's contents. Switch to
  // Freeform only when a page specifically needs manual positioning.
  const isAutoLayout = configs.layoutMode !== 'freeform';

  // Falls back to the Page's color when the Block hasn't set its own.
  const { style: visualStyle } = useVisualStyle();

  const resolvedDataSourceId = dataSourceId ?? inheritedDataSourceId ?? null;
  const sourceType = type ?? dataSourceType ?? inheritedType ?? 'table';
  const resolvedQuery = query && Object.keys(query).length > 0 ? query : inheritedQuery;

  // A Block owns a shared table/query context. Loading it here means children
  // can inherit the source immediately; no separate data-provider component is
  // needed in the page layout.
  const { rows: contextRows, loading: isContextLoading, error: contextError } = useDomainData(
    resolvedDataSourceId,
    sourceType
  );

  useBlockState(pageId, blockId, stateKeys, publishes);

  // Places an EXISTING component instance (dragged in from another block —
  // see the cross-block move support on the Move handle below) at the
  // given drop point. Mirrors addComponent's placement math for a fresh
  // drop, but keeps the instance's id/configs/data-binding intact instead
  // of creating a new one — moving a component must not reset its
  // settings. Uses the functional form of updateConfigs (reads the LATEST
  // components array at commit time) rather than closing over the
  // `components` variable from this render, since this function is also
  // called from the drop-target registration below, which can't
  // re-register on every keystroke/edit just to keep that closure fresh.
  const addExistingComponent = (instance: ComponentInstance, dropX: number, dropY: number) => {
    const plugin = registry.getPlugin(instance.pluginId);
    const defaultSize = plugin ? getDefaultComponentSize(instance.pluginId) : { width: DEFAULT_COMPONENT_WIDTH, height: DEFAULT_COMPONENT_HEIGHT };
    const width = (instance.configs as any)?.width || defaultSize.width;
    const height = (instance.configs as any)?.height || defaultSize.height;
    const x = snap(Math.max(0, dropX - width / 2));
    const y = snap(Math.max(0, dropY - 20));

    let placed: ComponentInstance = {
      ...instance,
      configs: { ...instance.configs, x, y, width, height },
    };

    const areaWidth = getGridAreaWidth();
    updateConfigs?.((prev: BlockConfigs) => {
      const list = prev.components ?? [];
      const next = isAutoLayout
        ? { ...placed, configs: { ...placed.configs, ...planGridPlacement(instance.pluginId, dropX, dropY, areaWidth, list) } }
        : placed;
      return { components: [...list, next] };
    });
  };

  // Registers this (open) block as a cross-block drop target, keyed by its
  // blockId, so a component being dragged out of a DIFFERENT block can
  // find and land in this one on mouseup. Re-registers when blockId,
  // layout mode, or open/closed state change; addExistingComponent itself
  // is safe to call from a stale closure since it commits via the
  // functional updateConfigs form above.
  useEffect(() => {
    if (!componentsAreaRef.current) return;
    return registerBlockDropTarget(blockId, {
      element: componentsAreaRef.current,
      addExistingComponent: (instance, clientX, clientY) => {
        const rect = componentsAreaRef.current?.getBoundingClientRect();
        const dropX = rect ? clientX - rect.left : 12;
        const dropY = rect ? clientY - rect.top : 12;
        addExistingComponent(instance, dropX, dropY);
      },
    });
  }, [blockId, isAutoLayout, open]);

  // Keep the Block big enough that what is inside always fits: tall enough
  // for the rows used, wide enough for the widest component's minimum size.
  const growKey = components
    .map((c) => `${c.id}:${(c.configs as any)?.gridX}:${(c.configs as any)?.gridY}:${(c.configs as any)?.gridW}:${(c.configs as any)?.gridH}`)
    .join('|');
  useEffect(() => {
    if (isPreview || !isAutoLayout || !open || components.length === 0) return;
    const box = containerRef.current;
    const area = componentsAreaRef.current;
    if (!box || !area) return;
    const rects = components.map(gridRectOf).filter((r): r is Rect => r !== null);
    const need = requiredGridAreaSize(
      rects,
      components.map((c) => getMinComponentSize(c.pluginId).minW),
      GRID_ROW_HEIGHT,
      GRID_MARGIN
    );
    const wantWidth = Math.ceil(need.width + (box.clientWidth - area.clientWidth));
    const wantHeight = Math.ceil(need.height + (box.clientHeight - area.clientHeight));
    const patch: Partial<BlockConfigs> = {};
    if (need.width > 0 && wantWidth > (configs.width || box.clientWidth)) patch.width = wantWidth;
    if (need.height > 0 && wantHeight > (configs.height || box.clientHeight)) patch.height = wantHeight;
    if (Object.keys(patch).length) updateConfigs?.(patch);
    // configs.width / height are here on purpose: shrinking the Block by hand below what
    // its components need snaps it back, so a component is never left outside the Block.
  }, [growKey, open, isAutoLayout, isPreview, configs.width, configs.height]);

  // A component that has just been dropped may need more rows than its default
  // (a chart, tabs, a table). Measure it ONCE, give it those rows, and let the
  // Block grow to hold them (effect above). One-shot on purpose: measuring again
  // after every layout change feeds back on itself and makes the Block balloon.
  const seenIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = components.map((c) => c.id);
    if (seenIdsRef.current === null) {
      seenIdsRef.current = new Set(ids); // components already in the block are left as they are
      return;
    }
    const fresh = ids.filter((id) => !seenIdsRef.current!.has(id));
    fresh.forEach((id) => seenIdsRef.current!.add(id));
    if (!fresh.length || isPreview || !isAutoLayout || !open) return;

    const fitted = new Set<string>();
    const measure = () => {
      const area = componentsAreaRef.current;
      if (!area) return;
      const rowsFor = new Map<string, number>();
      fresh.forEach((id) => {
        if (fitted.has(id)) return;
        const cell = area.querySelector<HTMLElement>(`[data-comp-id="${id}"]`);
        if (!cell) return;
        const over = cell.scrollHeight - cell.clientHeight;
        if (over > 2) {
          rowsFor.set(id, Math.min(32, Math.ceil((cell.clientHeight + over + GRID_MARGIN[1]) / (GRID_ROW_HEIGHT + GRID_MARGIN[1]))));
          fitted.add(id);
        }
      });
      if (!rowsFor.size) return;
      updateConfigs?.((prev: BlockConfigs) => ({
        components: (prev.components ?? []).map((c) => {
          const rows = rowsFor.get(c.id);
          const cur = (c.configs as any)?.gridH ?? 0;
          return rows && rows > cur ? { ...c, configs: { ...c.configs, gridH: rows } } : c;
        }),
      }));
    };
    // Charts size themselves after they mount, so look again a moment later.
    const timers = [window.setTimeout(measure, 200), window.setTimeout(measure, 800)];
    return () => timers.forEach(window.clearTimeout);
  }, [growKey, open, isAutoLayout, isPreview]);

  // One-time: layouts saved with the old 40px rows get their rows doubled.
  useEffect(() => {
    if (configs.gridScale === GRID_SCALE) return;
    updateConfigs?.((prev: BlockConfigs) => ({
      gridScale: GRID_SCALE,
      components: (prev.components ?? []).map((c) => {
        const g: any = c.configs || {};
        return {
          ...c,
          configs: {
            ...c.configs,
            ...(typeof g.gridY === 'number' ? { gridY: g.gridY * 2 } : {}),
            ...(typeof g.gridH === 'number' ? { gridH: g.gridH * 2 } : {}),
          },
        };
      }),
    } as any));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addComponent = (pluginId: string, dropX: number, dropY: number) => {
    // A saved template dropped here: a Block template goes straight into
    // `blocks` (nested blocks are always freeform-positioned, same as the
    // fresh-block branch below); a leaf-component template goes into
    // `components`, sized/gridded the same way a fresh drop would be.
    const template = resolveDroppedTemplate(pluginId);

    if (template?.pluginId === 'block-plugin') {
      const placed: ComponentInstance = {
        ...template,
        configs: {
          ...(template.configs as any),
          x: snap(dropX - DEFAULT_BLOCK_WIDTH / 2),
          y: snap(dropY - 20),
        },
      };
      updateConfigs?.({ blocks: [...blocks, placed] });
      return;
    }

    const effectivePluginId = template ? template.pluginId : pluginId;
    const plugin = registry.getPlugin(effectivePluginId);
    if (!plugin) return;

    const defaults: any = {};
    plugin.settings.forEach(s => { defaults[s.field_id] = s.defaultValue; });

    if (!template && pluginId === 'block-plugin') {
      const blockId = `block-${Math.random().toString(36).substring(2, 9)}`;
      const newBlock: ComponentInstance = {
        id: blockId,
        pluginId: 'block-plugin',
        configs: {
          blockId,
          layout: 'vertical',
          layoutMode: 'auto',
          x: snap(dropX - DEFAULT_BLOCK_WIDTH / 2),
          y: snap(dropY - 20),
          width: DEFAULT_BLOCK_WIDTH,
          height: DEFAULT_BLOCK_HEIGHT,
          stateKeys: [],
          publishes: [],
          subscribes: [],
          components: [],
          blocks: [],
        },
        query: {},
        componentDataSchema: {},
        dataSourceId: null,
        type: 'table',
      };
      updateConfigs?.({ blocks: [...blocks, newBlock] });
      return;
    }

    if (!template && pluginId === 'page-plugin') return;

    const defaultSize = getDefaultComponentSize(effectivePluginId);
    // Drop position is used as-is (snapped) — no overlap-avoidance shuffle.
    // Components may overlap freely; this just clamps to the top-left of the
    // drop point so the whole component appears under the cursor.
    let x = snap(Math.max(0, dropX - defaultSize.width / 2));
    let y = snap(Math.max(0, dropY - 20));

    const newComp: ComponentInstance = template
      ? {
          ...template,
          configs: {
            ...(template.configs as any),
            x,
            y,
            width: (template.configs as any)?.width || defaultSize.width,
            height: (template.configs as any)?.height || defaultSize.height,
          },
        }
      : {
          id: Math.random().toString(36).substring(2, 7),
          pluginId,
          configs: {
            ...defaults,
            x,
            y,
            width: defaults.width || defaultSize.width,
            height: defaults.height || defaultSize.height,
          },
          query: {},
          componentDataSchema: { ...plugin.componentDataSchema },
          dataSourceId: null,
          type: null,
        };

    if (isAutoLayout) {
      // Convert the exact drop pixel position into a grid cell, using the
      // same column-width math the `gridLayout` memo below uses, so a
      // component actually lands in the row/column you released the mouse
      // over — instead of the old behavior of inserting it near whichever
      // existing item was vertically closest and letting RGL auto-place it
      // at the top via y: Infinity, which ignored the drop position entirely.
      newComp.configs = {
        ...newComp.configs,
        ...planGridPlacement(effectivePluginId, dropX, dropY, getGridAreaWidth(), components),
      };
      updateConfigs?.({ components: [...components, newComp] });
    } else {
      updateConfigs?.({ components: [...components, newComp] });
    }
  };

    const updateComponent = (i: number, u: ComponentInstance | ((prev: ComponentInstance) => ComponentInstance)) => {
    updateConfigs?.((prevBlockConfigs: BlockConfigs) => ({
      components: (prevBlockConfigs.components ?? []).map((c, idx) =>
        idx === i ? (typeof u === 'function' ? u(c) : u) : c
      ),
    }));
  };
  const removeComponent = (id: string) =>
    updateConfigs?.((prevBlockConfigs: BlockConfigs) => ({
      components: (prevBlockConfigs.components ?? []).filter(c => c.id !== id),
    }));

  // Builds the react-grid-layout layout array from each component's stored
  // grid position/size, so RGL and our component state stay in sync.
  const gridLayout: Layout[] = components.map((comp, i) => {
    const g: any = comp.configs || {};
    const def = getDefaultGridSize(comp.pluginId);

    // Convert this plugin's real minimum px size (same source freeform mode
    // uses) into grid units, so the resize floor matches what THIS component
    // actually needs instead of a flat 2x2 floor applied to everything.
    const { minW: minPxW, minH: minPxH } = getMinComponentSize(comp.pluginId);
    const gridAreaWidth = getGridAreaWidth();
    const colWidth = (gridAreaWidth - GRID_MARGIN[0] * (GRID_COLS + 1)) / GRID_COLS;
    const minGridW = Math.min(GRID_COLS, Math.max(1, Math.ceil((minPxW + GRID_MARGIN[0]) / (colWidth + GRID_MARGIN[0]))));
    const minGridH = Math.max(1, Math.ceil((minPxH + GRID_MARGIN[1]) / (GRID_ROW_HEIGHT + GRID_MARGIN[1])));

    return {
      i: comp.id,
      x: typeof g.gridX === 'number' ? g.gridX : (i * def.w) % GRID_COLS,
      y: typeof g.gridY === 'number' ? g.gridY : Infinity, // Infinity = auto-place at bottom on first render
      w: typeof g.gridW === 'number' ? g.gridW : def.w,
      // A one-line component (Breadcrumbs) always gets exactly one row, so its
      // green cell never reserves empty rows that push the next component down.
      h: isSingleLine(comp.pluginId) ? 2 : (typeof g.gridH === 'number' ? g.gridH : def.h),
      maxH: isSingleLine(comp.pluginId) ? 2 : undefined,
      minW: minGridW,
      minH: isSingleLine(comp.pluginId) ? 2 : minGridH,
      // The grid's own resizeHandles/resizeHandle props (below) apply to
      // EVERY item — there's no other way to scope the handles to only the
      // selected component. Per-item isResizable/resizeHandles overrides
      // let unselected items opt out entirely, so adjustment handles only
      // ever show on whichever component you've actually clicked.
      isResizable: !isPreview && comp.id === selectedId,
      resizeHandles: comp.id === selectedId ? (['s', 'w', 'e', 'n', 'sw', 'nw', 'ne', 'se'] as const) : [],
    };
  });

  // Children of the block's grid — shared by the designer grid and the responsive preview grid.
  const gridChildren = components.map((comp, i) => (isPreview && !canViewSource(comp.dataSourceId ?? resolvedDataSourceId, comp.type ?? sourceType)) ? null : (
    <div key={comp.id} data-comp-id={comp.id} className={`h-full w-full ${comp.id === selectedId ? 'z-40 relative' : ''}`}>
      <ComponentSlot
        compInstance={comp}
        pageId={pageId}
        blockId={blockId}
        inheritedDataSourceId={dataSourceId}
        inheritedType={type ?? dataSourceType ?? null}
        inheritedQuery={query}
        onUpdate={u => updateComponent(i, u)}
        onRemove={() => removeComponent(comp.id)}
        isPreview={isPreview}
        selectedId={selectedId}
        onSelect={onSelect}
        isAutoLayout={isAutoLayout}
      />
    </div>
  ));

  // Fires on drag AND resize — write every item's new position/size back
  // into its component's configs.
  const handleGridLayoutChange = (newLayout: Layout[]) => {
    updateConfigs?.((prevBlockConfigs: BlockConfigs) => ({
      components: (prevBlockConfigs.components ?? []).map(comp => {
        const item = newLayout.find(l => l.i === comp.id);
        if (!item) return comp;
        return {
          ...comp,
          configs: { ...comp.configs, gridX: item.x, gridY: item.y, gridW: item.w, gridH: item.h },
        };
      }),
    }));
  };
  const updateBlock = (i: number, u: ComponentInstance | ((prev: ComponentInstance) => ComponentInstance)) => {
    updateConfigs?.((prevBlockConfigs: BlockConfigs) => ({
      blocks: (prevBlockConfigs.blocks ?? []).map((b, idx) =>
        idx === i ? (typeof u === 'function' ? u(b) : u) : b
      ),
    }));
  };
  const removeBlock = (i: number) =>
    updateConfigs?.({ blocks: blocks.filter((_, idx) => idx !== i) });

  // ── Manual resize from any of the four corners. The opposite corner stays
  // anchored: dragging the top-left corner grows the box up-and-left while
  // the bottom-right corner doesn't move, and so on. Width/height are clamped
  // to a minimum; if a corner that owns x/y hits that minimum, the position
  // stops moving at exactly the point where the box would start shrinking
  // below the minimum, so it never overshoots or jumps.
  const handleResizeStart = (corner: ResizeHandle) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = containerRef.current?.getBoundingClientRect();
    const start = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      width: configs.width || rect?.width || 280,
      height: configs.height || rect?.height || 120,
      left: configs.x ?? 0,
      top: configs.y ?? 0,
    };

    const affectsLeft = corner === 'nw' || corner === 'sw' || corner === 'w';
    const affectsTop = corner === 'nw' || corner === 'ne' || corner === 'n';
    // Edge handles (n/s/e/w) change only one dimension.
    const changesWidth = corner !== 'n' && corner !== 's';
    const changesHeight = corner !== 'e' && corner !== 'w';

    setIsResizing(true);

    const handleMove = (ev: MouseEvent) => {
      const dx = ev.clientX - start.mouseX;
      const dy = ev.clientY - start.mouseY;

      const rawWidth = affectsLeft ? start.width - dx : start.width + dx;
      const rawHeight = affectsTop ? start.height - dy : start.height + dy;
      const newWidth = changesWidth ? Math.max(120, snap(rawWidth)) : start.width;
      const newHeight = changesHeight ? Math.max(60, snap(rawHeight)) : start.height;

      const updates: Partial<BlockConfigs> = {};
      if (changesWidth) updates.width = newWidth;
      if (changesHeight) updates.height = newHeight;
      if (affectsLeft) updates.x = snap(start.left + (start.width - newWidth));
      if (affectsTop) updates.y = snap(start.top + (start.height - newHeight));

      updateConfigs?.(updates);
    };

    const handleUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  return (
        <StyledSurface className="h-full w-full" updateConfigs={updateConfigs} styleId={`${pageId}.${blockId}`} isPreview={isPreview}>
        <div
      ref={containerRef}
      className={`relative group/resize h-full w-full rounded-lg p-2 flex flex-col gap-2 box-border ${
        isResizing ? 'select-none' : ''
      }`}
      style={{
        width: '100%',
        height: '100%',
      }}
      onDragOver={(e) => {
        if (isPreview) return;
        if (!e.dataTransfer.types.includes(PLUGIN_DRAG_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDragOver(false);
        e.stopPropagation();
      }}
      onDragEnd={() => setIsDragOver(false)}
      onDrop={(e) => {
        if (isPreview) return;
        const pluginId = e.dataTransfer.getData(PLUGIN_DRAG_MIME);
        setIsDragOver(false);
        if (!pluginId) return;
        if (pluginId === 'page-plugin') return;
        e.preventDefault();
        e.stopPropagation();
        const rect = componentsAreaRef.current?.getBoundingClientRect();
        const dropX = rect ? e.clientX - rect.left : 12;
        const dropY = rect ? e.clientY - rect.top : 12;
        addComponent(pluginId, dropX, dropY);
      }}
    >
      {/* Editor-only header */}
      {!isPreview && <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }
        }}
        className="flex items-center gap-2 w-full text-left shrink-0 cursor-pointer"
      >
        <Layers className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
        <InlineEditableText
          value={configs.title ?? ''}
          placeholder="Block"
          onCommit={(title) => updateConfigs?.({ title })}
          className="font-bold text-muted-foreground/70 uppercase tracking-widest flex-1"
          inputClassName="text-xs font-bold uppercase tracking-widest"
        />
        {dataSourceId && (
            <span className={`font-semibold ${contextError ? 'text-destructive' : 'text-primary/80'}`}>
            {contextError
              ? 'Data error'
              : isContextLoading
                ? 'Loading data…'
                : `${contextRows.length} rows · ${sourceType}`}
          </span>
        )}
        {open ? <ChevronDown className="w-3 h-3 text-muted-foreground/40" /> : <ChevronRight className="w-3 h-3 text-muted-foreground/40" />}
      </div>}

      {isPreview && configs.title && (
        <h3 className="text-sm font-semibold uppercase tracking-wide px-1 shrink-0">{configs.title}</h3>
      )}

      {open && (
        // Components — freeform canvas: every component is absolutely
        // positioned via its own configs.x/y/width/height, and gets added ONLY
        // by dragging a plugin here directly from the palette.
        <div
          ref={componentsAreaRef}
          data-drop-block-id={blockId}
          className={`${isAutoLayout ? 'overflow-hidden' : 'relative overflow-auto'} flex-1 min-h-[100px] rounded-md transition-colors ${
            isDragOver ? 'outline-dashed outline-2 outline-primary/60 -outline-offset-2 bg-primary/5' : ''
          }`}
          style={!isPreview && !isAutoLayout ? { backgroundImage: 'radial-gradient(color-mix(in oklab, var(--primary) 35%, transparent) 1px, transparent 1px)', backgroundSize: `${SNAP_SIZE}px ${SNAP_SIZE}px` } : undefined}
          // Stops here, not on the Block's outer container: this element
          // sits BETWEEN the inner (component-level) grid and the outer
          // Page-level grid in the DOM tree. A mousedown on a component's
          // drag/resize handle still bubbles up through and triggers the
          // inner grid's own native drag/resize listener first (that
          // listener is on an ancestor closer to the click target, so it
          // always fires before this one). Stopping propagation *here*
          // then prevents that same event from continuing further up to
          // the outer Page-level grid's draggableHandle=".group" listener,
          // which was otherwise treating any click anywhere in the Block's
          // body as "drag the whole Block". The Block's own header row
          // (rendered as a sibling, outside this div) is deliberately left
          // unguarded, so it still works as the Block's own drag handle.
          onMouseDown={(e) => {
            // Presses on a component stay with that component. Presses on the
            // empty area bubble up so the Block can be dragged from there too
            // (the Block's own handler stops them before the Page grid).
            if ((e.target as Element).closest('[data-comp-slot],.react-grid-item')) e.stopPropagation();
          }}
          onDragOver={(e) => {
            if (isPreview) return;
            if (!e.dataTransfer.types.includes(PLUGIN_DRAG_MIME)) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
            setIsDragOver(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setIsDragOver(false);
            e.stopPropagation();
          }}
          onDragEnd={() => setIsDragOver(false)}
          onDrop={(e) => {
            if (isPreview) return;
            const pluginId = e.dataTransfer.getData(PLUGIN_DRAG_MIME);
            setIsDragOver(false);
            if (!pluginId) return;
            if (pluginId === 'page-plugin') return;
            e.preventDefault();
            e.stopPropagation();
            const rect = componentsAreaRef.current?.getBoundingClientRect();
            const dropX = rect ? e.clientX - rect.left : 12;
            const dropY = rect ? e.clientY - rect.top : 12;
            addComponent(pluginId, dropX, dropY);
          }}
        >
          {components.length === 0 && blocks.length === 0 && !isPreview && (
            <div className="flex items-center justify-center h-24 rounded-md border border-dashed border-border/60 text-center text-[11px] text-muted-foreground/50">
              Drag a block or component here
            </div>
          )}

          {blocks.map((nestedBlock, i) => {
            if (isPreview && !canViewSource(nestedBlock.dataSourceId, nestedBlock.type)) return null;
            const blockX = (nestedBlock.configs as any)?.x ?? 12;
            const blockY = (nestedBlock.configs as any)?.y ?? 12;
            const blockWidth = (nestedBlock.configs as any)?.width || DEFAULT_BLOCK_WIDTH;
            const blockHeight = (nestedBlock.configs as any)?.height || DEFAULT_BLOCK_HEIGHT;
            return (
              <div
                key={nestedBlock.id}
                className={isAutoLayout ? 'relative min-w-0 mb-3' : 'absolute'}
                style={
                  isAutoLayout
                    ? { minHeight: (nestedBlock.configs as any)?.height || 240 }
                    : { left: blockX, top: blockY, width: blockWidth, height: blockHeight }
                }
              >
                <BlockCanvas
                  configs={nestedBlock.configs}
                  updateConfigs={(partial: any) => updateBlock(i, (prev) => ({
                    ...prev,
                    configs: {
                      ...prev.configs,
                      ...(typeof partial === 'function' ? partial(prev.configs) : partial),
                    },
                  }))}
                  isPreview={isPreview}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  dataSourceId={nestedBlock.dataSourceId}
                  dataSourceType={nestedBlock.type ?? null}
                  type={nestedBlock.type ?? null}
                  query={nestedBlock.query}
                  inheritedDataSourceId={resolvedDataSourceId}
                  inheritedType={sourceType}
                  inheritedQuery={resolvedQuery}
                />
                {!isPreview && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm('Delete this block? This removes everything inside it too.')) {
                        removeBlock(i);
                      }
                    }}
                    title="Delete block"
                    className="absolute top-1 right-1 z-40 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg transition-colors hover:bg-destructive/90"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}

          {isAutoLayout ? (
            components.length > 0 && (isPreview ? (
              <ResponsiveGridLayout
                className="layout"
                layouts={buildBlockLayouts(gridLayout)}
                breakpoints={BLOCK_BREAKPOINTS}
                cols={BLOCK_COLS}
                rowHeight={GRID_ROW_HEIGHT}
                margin={GRID_MARGIN}
                autoSize
                compactType={null}
                preventCollision={false}
                isDraggable={false}
                isResizable={false}
              >
                {gridChildren}
              </ResponsiveGridLayout>
            ) : (
              <DesignGridLayout
                measureBeforeMount
                className="layout"
                layout={gridLayout}
                cols={GRID_COLS}
                rowHeight={GRID_ROW_HEIGHT}
                margin={GRID_MARGIN}
                autoSize
                // No auto-compaction: a dropped/dragged component stays
                // exactly where it was released instead of being reflowed.
                compactType={null}
                // A component can sit right beside another but never on top of it,
                // and never pushes it down: a move/resize that would collide is refused.
                preventCollision
                isDraggable={!isPreview}
                isResizable={!isPreview}
                resizeHandles={['s', 'w', 'e', 'n', 'sw', 'nw', 'ne', 'se']}
                resizeHandle={<RGLResizeHandle />}
                draggableHandle=".rgl-drag-handle"
                draggableCancel={NO_DRAG_SELECTOR}
                onLayoutChange={isPreview ? undefined : handleGridLayoutChange}
                // RGL only knows about the grid it belongs to, so a drag that
                // ends over a DIFFERENT block's drop area (registered via
                // registerBlockDropTarget) needs to be handled manually here:
                // hand the component's data off to that block and remove it
                // from this one. Dropped back inside this same block (or over
                // empty space with no registered target) just falls through
                // to the normal in-grid reposition already applied by
                // onLayoutChange above.
                onDragStop={isPreview ? undefined : (_layout, oldItem, _newItem, _placeholder, e) => {
                  const dropTarget = findBlockDropTargetAt(e.clientX, e.clientY, blockId);
                  if (!dropTarget) return;
                  const comp = components.find(c => c.id === oldItem.i);
                  if (!comp) return;
                  dropTarget.target.addExistingComponent(comp, e.clientX, e.clientY);
                  removeComponent(comp.id);
                }}
              >
                {gridChildren}
              </DesignGridLayout>
            ))
          ) : (
            components.map((comp, i) => (isPreview && !canViewSource(comp.dataSourceId ?? resolvedDataSourceId, comp.type ?? sourceType)) ? null : (
              <div
                key={comp.id}
                className={`absolute ${comp.id === selectedId ? 'z-40' : ''}`}
                style={{
                  left: (comp.configs as any)?.x ?? 12,
                  top: (comp.configs as any)?.y ?? 12,
                  width: (comp.configs as any)?.width || DEFAULT_COMPONENT_WIDTH,
                  height: (comp.configs as any)?.height || DEFAULT_COMPONENT_HEIGHT,
                }}
              >
                <ComponentSlot
                  compInstance={comp}
                  pageId={pageId}
                  blockId={blockId}
                  inheritedDataSourceId={dataSourceId}
                  inheritedType={type ?? dataSourceType ?? null}
                  inheritedQuery={query}
                  onUpdate={u => updateComponent(i, u)}
                  onRemove={() => removeComponent(comp.id)}
                  isPreview={isPreview}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  isAutoLayout={isAutoLayout}
                  containerSize={{
                    width: componentsAreaRef.current?.clientWidth || 0,
                    height: componentsAreaRef.current?.clientHeight || 0,
                  }}
                />
              </div>
            ))
          )}
        </div>
      )}

      {!isPreview && <ResizeHandles variant="frame" onResizeStart={handleResizeStart} isResizing={isResizing} />}
    </div>
    </StyledSurface>
  );
}

// ─── Plugin export ────────────────────────────────────────────────────────────

export const BlockPlugin: ViewBuilderPlugin<BlockConfigs> = withVisualStyle({
  id: 'block-plugin',
  pluginType: 'layout',
  toolbar: {
    name: 'Block',
    element: () => <Layers className="w-4 h-4" />,
    toolTip: 'Block — holds components and block-level state',
  },
  canvas: {
    element: ({ configs, updateConfigs, isPreview, selectedId, onSelect, dataSourceId, type, query }) => (
      <BlockCanvas
        configs={configs}
        updateConfigs={updateConfigs}
        isPreview={isPreview}
        selectedId={selectedId}
        onSelect={onSelect}
        dataSourceId={dataSourceId}
        dataSourceType={type ?? null}
        type={type ?? null}
        query={query}
      />
    ),
  },
  settings: [
    { field_id: 'title', label: 'Title', type: 'text', defaultValue: '' },
    
    { field_id: 'layoutMode', label: 'Child layout mode', type: 'select', enum: ['auto', 'freeform'], defaultValue: 'auto' },
    
  ],
  componentDataSchema: {},
});