import { Fragment, useState, useRef, useContext } from 'react';
import { FileText, Trash2, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import type { ViewBuilderPlugin, ComponentInstance } from '@/sky-view-builder/core/plugin';
import { registry } from '@/sky-view-builder/core/registry';
import { usePageHydration } from '@/sky-view-builder/hooks/usePageHydration';
import { PLUGIN_DRAG_MIME } from '@/sky-view-builder/ui/Toolbar';
import { InlineEditableText } from '@/sky-view-builder/ui/InlineEditableText';
import { resolveDroppedTemplate } from '@/sky-view-builder/core/templateStore';
import { NavEmbedContext } from '@/sky-view-builder/core/navigation';
import type { BlockMeta, ComponentMeta, PageMeta } from '@/store/types';
import { canViewSource } from '@/lib/permissions';
import { withVisualStyle, StyledSurface, useVisualStyle } from '@/sky-view-builder/styles/withVisualStyle';
import type { WithVisualStyleConfigs } from '@/sky-view-builder/styles/withVisualStyle';

export type PageConfigs = WithVisualStyleConfigs & {
  pageId: string;
  title: string;
  /** @deprecated no longer used to arrange blocks — blocks are freely positioned
   *  via their own x/y now. Kept only so old saved configs don't break. */
  layout: 'vertical' | 'horizontal';

  /** Page-level background color. Blocks inherit this by default unless they set their own. */
  bgColor?: string;
  dataSourceId?: string | number | null;
  type?: 'table' | 'query';

  /**
   * The resolved page metadata JSON.
   * In the builder, this is loaded from your metadata/pages/*.json file
   * and stored in configs so it travels with the saved canvas state.
   */
  pageMeta?: PageMeta;

  /**
   * Resolved block definitions map: blockRefId → BlockMeta.
   * Populated when the page is configured in the builder.
   */
  blockDefs?: Record<string, BlockMeta>;

  /**
   * Resolved component definitions map: componentRefId → ComponentMeta.
   * Populated when the page is configured in the builder.
   */
  componentDefs?: Record<string, ComponentMeta>;

  blocks: ComponentInstance[];   // visual block instances on the canvas
  _pageId?: string;              // injected by parent (not set by user)
};

const DEFAULT_BLOCK_WIDTH = 280;
const DEFAULT_BLOCK_HEIGHT = 160;

// Plugins that are placed DIRECTLY on the page (no wrapping Block). They are
// stored in configs.blocks like a Block, positioned with the same x/y/width/
// height configs, and get their own move / resize / delete chrome in BlockSlot.
const STANDALONE_PLUGIN_SIZES: Record<string, { width: number; height: number }> = {
  sidebar: { width: 280, height: 420 },
};
const isStandalonePlugin = (pluginId: string) => pluginId in STANDALONE_PLUGIN_SIZES;

// ─── Block slot rendered inside the page ─────────────────────────────────────

function BlockSlot({
  blockInstance,
  pageId,
  pageBgColor,
  onUpdate,
  onRemove,
  isPreview,
  selectedId,
  onSelect,
}: {
  blockInstance: ComponentInstance;
  pageId: string;
  pageBgColor?: string;
    onUpdate: (u: ComponentInstance | ((prev: ComponentInstance) => ComponentInstance)) => void;
  onRemove: () => void;
  isPreview?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const [isMoving, setIsMoving] = useState(false);
  const plugin = registry.getPlugin(blockInstance.pluginId);
  if (!plugin) {
    return (
      <div className="text-xs text-muted-foreground italic p-2">
        Plugin "{blockInstance.pluginId}" not found
      </div>
    );
  }
  const Component = plugin.canvas.element;
  const isSelected = selectedId === blockInstance.id;

  // Free-drag move: grabbing the handle drags the block anywhere on the page,
  // like a sticky note. Position lives in the block's own configs.x/y so it
  // travels with the block regardless of where it's rendered.
  const standalone = isStandalonePlugin(blockInstance.pluginId);

  // Resize for standalone components (real Blocks have their own resize
  // handles inside BlockCanvas). axis: which edges the handle moves.
  const handleResizeStart = (axis: { x?: boolean; y?: boolean }) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const start = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      w: (blockInstance.configs as any)?.width || DEFAULT_BLOCK_WIDTH,
      h: (blockInstance.configs as any)?.height || DEFAULT_BLOCK_HEIGHT,
    };
    const handleMove = (ev: MouseEvent) => {
      onUpdate((prev) => ({
        ...prev,
        configs: {
          ...prev.configs,
          ...(axis.x ? { width: Math.max(48, Math.round(start.w + ev.clientX - start.mouseX)) } : {}),
          ...(axis.y ? { height: Math.max(120, Math.round(start.h + ev.clientY - start.mouseY)) } : {}),
        },
      }));
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  const handleMoveStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const start = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      blockX: (blockInstance.configs as any)?.x ?? 0,
      blockY: (blockInstance.configs as any)?.y ?? 0,
    };

    setIsMoving(true);

    const handleMove = (ev: MouseEvent) => {
      const dx = ev.clientX - start.mouseX;
      const dy = ev.clientY - start.mouseY;
      onUpdate({
        ...blockInstance,
        configs: {
          ...blockInstance.configs,
          x: Math.max(0, Math.round(start.blockX + dx)),
          y: Math.max(0, Math.round(start.blockY + dy)),
        },
      });
    };

    const handleUp = () => {
      setIsMoving(false);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  return (
    <div
      // Grab the block anywhere on its body to move it. Typing/clicking in
      // inputs, buttons and links is left alone; presses on a component inside
      // the block never reach here (the block's component area keeps them).
      onMouseDown={isPreview ? undefined : (e) => {
        e.stopPropagation(); // never let the Page grid grab the press instead
        const t = e.target as Element;
        if (t.closest('input,textarea,select,button,a,label,[contenteditable="true"],[role="button"],.no-drag,.rgl-resize-handle')) return;
        handleMoveStart(e);
      }}
      className={`relative group/block h-full w-full rounded-lg transition-colors ${
        !isPreview ? 'cursor-grab active:cursor-grabbing' : ''
      } ${
        isSelected ? 'ring-2 ring-primary' : ''
      } ${isMoving ? 'opacity-60 shadow-2xl z-50' : ''}`}
      onClick={(e) => {
        // Stop here so the Page (or an outer Block) doesn't get re-selected instead.
        e.stopPropagation();
        onSelect?.(blockInstance.id);
      }}
    >
      {!isPreview && (
        <>
          {/* Drag handle — only this part is draggable, so clicking/typing
              inside the block's own content never accidentally starts a drag. */}
          <div
            onMouseDown={handleMoveStart}
            title="Drag to move"
            className="absolute -top-2 left-1/2 -translate-x-1/2 z-10 flex h-5 w-6 cursor-grab active:cursor-grabbing items-center justify-center rounded-full bg-card border border-border text-muted-foreground/50 opacity-0 group-hover/block:opacity-100 hover:text-foreground hover:border-primary/50 transition-all"
          >
            <GripVertical className="w-3 h-3" />
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              if (standalone || window.confirm('Delete this block? This removes everything inside it too.')) {
                onRemove();
              }
            }}
            title="Delete block"
            // Sits inside the block's header row, clear of BOTH neighbors it
            // used to collide with: the top-center drag handle (left-1/2), and
            // the Block's own "ne" resize-corner handle, which the inner
            // BlockCanvas renders at this same edge (right-2 top-2, 16px,
            // z-20 — see RESIZE_CORNERS in blockplugin.tsx). right-9 clears
            // that corner's footprint with a visible gap instead of stacking
            // on top of it.
            className="absolute top-2 right-2 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-card/90 border border-border text-muted-foreground/50 opacity-0 group-hover/block:opacity-100 hover:text-destructive hover:border-destructive transition-all"
          >
            <Trash2 className="w-2.5 h-2.5" />
          </button>

          {standalone && (
            <>
              <div onMouseDown={handleResizeStart({ x: true })} title="Resize width"
                className="absolute right-[-5px] top-1/2 z-20 h-8 w-2 -translate-y-1/2 cursor-ew-resize rounded-full bg-primary/70 opacity-0 group-hover/block:opacity-100 transition-opacity" />
              <div onMouseDown={handleResizeStart({ y: true })} title="Resize height"
                className="absolute bottom-[-5px] left-1/2 z-20 h-2 w-8 -translate-x-1/2 cursor-ns-resize rounded-full bg-primary/70 opacity-0 group-hover/block:opacity-100 transition-opacity" />
              <div onMouseDown={handleResizeStart({ x: true, y: true })} title="Resize"
                className="absolute bottom-[-6px] right-[-6px] z-20 h-3.5 w-3.5 cursor-nwse-resize rounded-md border border-primary bg-primary/80 opacity-0 group-hover/block:opacity-100 transition-opacity" />
            </>
          )}
        </>
      )}
      <div className={`h-full w-full ${standalone ? '' : 'p-1'}`}>
        <Component
          id={blockInstance.id}
          configs={{
            ...blockInstance.configs,
            _pageId: pageId,
            // Injected so the Block can fall back to the Page's color when it
            // hasn't set its own bgColor. Same pattern as _pageId above.
            _pageBgColor: pageBgColor,
          }}
          componentDataSchema={blockInstance.componentDataSchema}
          query={blockInstance.query}
          dataSourceId={blockInstance.dataSourceId}
          type={blockInstance.type}
          isPreview={isPreview}
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

// ─── Page Canvas ──────────────────────────────────────────────────────────────

function PageCanvas({
  configs,
  updateConfigs,
  isPreview,
  selectedId,
  onSelect,
  onDeleteSelf,
}: {
  configs: PageConfigs;
   updateConfigs?: (c: Partial<PageConfigs> | ((prev: PageConfigs) => Partial<PageConfigs>)) => void;
  isPreview?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onDeleteSelf?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navEmbed = useContext(NavEmbedContext);

  const pageId      = configs.pageId    || 'page';
  const blocks      = configs.blocks    ?? [];
  const pageMeta    = configs.pageMeta;
  const blockDefs   = configs.blockDefs   ?? {};
  const componentDefs = configs.componentDefs ?? {};

  // ── Core change: hydrate the full Page → Block → Component state tree
  // into the StateHub as soon as this page canvas mounts.
  // If pageMeta is not yet set (builder mode, not yet configured), this is a no-op.
  usePageHydration(
    pageMeta ?? { id: pageId, blocks: [] },
    blockDefs,
    componentDefs
  );

  const updateBlock = (i: number, u: ComponentInstance | ((prev: ComponentInstance) => ComponentInstance)) =>
  updateConfigs?.((prevPageConfigs: PageConfigs) => {
    const next = {
      blocks: (prevPageConfigs.blocks ?? []).map((b, idx) =>
        idx === i ? (typeof u === 'function' ? u(b) : u) : b
      ),
    };
    console.log('[HOP 2: updateBlock]', JSON.stringify(next).includes('"options"') ? 'OPTIONS PRESENT' : 'options MISSING');
    return next;
  });

  const removeBlock = (i: number) =>
    updateConfigs?.({ blocks: blocks.filter((_, idx) => idx !== i) });

  // ── Drag & drop: let a palette item be dropped straight onto the page,
  // landing wherever the cursor released it — sticky-note style placement.
  const addBlockFromDroppedPlugin = (pluginId: string, dropX: number, dropY: number) => {
    // Only pages aren't droppable onto a page. Blocks and regular components are.
    if (pluginId === 'page-plugin') return;

    const x = Math.max(0, Math.round(dropX - DEFAULT_BLOCK_WIDTH / 2));
    const y = Math.max(0, Math.round(dropY - 20));
    const instanceId = `block-${Math.random().toString(36).substring(2, 9)}`;

    // A saved Block/Component template dropped here: place it directly
    // (if it's a Block) or wrap it in a fresh Block (if it's a loose leaf
    // component) — same shape the non-template paths below produce, just
    // pre-populated from the saved snapshot instead of blank defaults.
    const template = resolveDroppedTemplate(pluginId);
    if (template) {
      if (template.pluginId === 'block-plugin') {
        const placed: ComponentInstance = {
          ...template,
          configs: { ...(template.configs as any), x, y },
        };
        const updatedPageMeta = {
          id: configs.pageMeta?.id ?? pageId,
          ...configs.pageMeta,
          blocks: [...(configs.pageMeta?.blocks ?? []), { id: placed.id, ref: 'block-plugin' }],
        };
        updateConfigs?.({ blocks: [...blocks, placed], pageMeta: updatedPageMeta });
        onSelect?.(placed.id);
        return;
      }

      // A saved Page can't live inside another Page.
      if (template.pluginId === 'page-plugin') return;

      // A saved standalone component (e.g. Sidebar, with all its menus): place
      // it directly on the page — no wrapper Block.
      if (isStandalonePlugin(template.pluginId)) {
        const w = (template.configs as any)?.width || STANDALONE_PLUGIN_SIZES[template.pluginId].width;
        const placed: ComponentInstance = {
          ...template,
          configs: {
            ...(template.configs as any),
            x: Math.max(0, Math.round(dropX - w / 2)),
            y,
          },
        };
        updateConfigs?.({ blocks: [...blocks, placed] });
        onSelect?.(placed.id);
        return;
      }

      const newBlock: ComponentInstance = {
        id: instanceId,
        pluginId: 'block-plugin',
        configs: {
          blockId: instanceId,
          layout: 'vertical',
          x,
          y,
          width: DEFAULT_BLOCK_WIDTH,
          height: DEFAULT_BLOCK_HEIGHT,
          stateKeys: [],
          publishes: [],
          subscribes: [],
          components: [template],
        },
        query: {},
        componentDataSchema: {},
        dataSourceId: null,
        type: 'table',
      };
      const updatedPageMeta = {
        id: configs.pageMeta?.id ?? pageId,
        ...configs.pageMeta,
        blocks: [...(configs.pageMeta?.blocks ?? []), { id: instanceId, ref: 'block-plugin' }],
      };
      updateConfigs?.({ blocks: [...blocks, newBlock], pageMeta: updatedPageMeta });
      onSelect?.(instanceId);
      return;
    }

    const plugin = registry.getPlugin(pluginId);
    if (!plugin) return;

    // Standalone component (e.g. Sidebar): place it directly on the page,
    // no wrapper Block.
    if (isStandalonePlugin(pluginId)) {
      const size = STANDALONE_PLUGIN_SIZES[pluginId];
      const defaults: Record<string, any> = {};
      plugin.settings.forEach((s) => {
        defaults[s.field_id] = s.defaultValue;
      });
      const standaloneId = `${pluginId}-${Math.random().toString(36).substring(2, 8)}`;
      const standalone: ComponentInstance = {
        id: standaloneId,
        pluginId,
        configs: {
          ...defaults,
          x: Math.max(0, Math.round(dropX - size.width / 2)),
          y: Math.max(0, Math.round(dropY - 20)),
          width: size.width,
          height: size.height,
        },
        query: {},
        componentDataSchema: plugin.componentDataSchema ? { ...plugin.componentDataSchema } : {},
        dataSourceId: null,
        type: null,
      };
      updateConfigs?.({ blocks: [...blocks, standalone] });
      onSelect?.(standaloneId);
      return;
    }

    // Dropping a Block directly: add it as-is, empty, using its own defaults.
    if (pluginId === 'block-plugin') {
      const defaults: Record<string, any> = {};
      plugin.settings.forEach((s) => {
        defaults[s.field_id] = s.defaultValue;
      });

      const newBlock: ComponentInstance = {
        id: instanceId,
        pluginId: 'block-plugin',
        configs: {
          ...defaults,
          
          blockId: instanceId,
          layout: defaults.layout ?? 'vertical',
          x,
          y,
          width: defaults.width || DEFAULT_BLOCK_WIDTH,
          height: defaults.height || DEFAULT_BLOCK_HEIGHT,
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

      const updatedPageMeta = {
        id: configs.pageMeta?.id ?? pageId,
        ...configs.pageMeta,
        blocks: [...(configs.pageMeta?.blocks ?? []), { id: instanceId, ref: 'block-plugin' }],
      };

      updateConfigs?.({ blocks: [...blocks, newBlock], pageMeta: updatedPageMeta });
      // Select the newly created block so the SettingsPanel shows and
      // the user can immediately choose a data context (table/query).
      onSelect?.(instanceId);
      return;
    }

    // Dropping a regular component: wrap it in a fresh block.
    const childId = `${pluginId}-${Math.random().toString(36).substring(2, 8)}`;

    const defaults: Record<string, any> = {};
    plugin.settings.forEach((s) => {
      defaults[s.field_id] = s.defaultValue;
    });

    const childComponents: ComponentInstance[] = [{
      id: childId,
      pluginId,
      configs: defaults,
      query: {},
      componentDataSchema: plugin.componentDataSchema ? { ...plugin.componentDataSchema } : {},
      dataSourceId: null,
      type: null,
    }];

    const newBlock: ComponentInstance = {
      id: instanceId,
      pluginId: 'block-plugin',
      configs: {
        blockId: instanceId,
        layout: 'vertical',
        x,
        y,
        width: DEFAULT_BLOCK_WIDTH,
        height: DEFAULT_BLOCK_HEIGHT,
        stateKeys: [],
        publishes: [],
        subscribes: [],
        components: childComponents,
      },
      query: {},
      componentDataSchema: {},
      dataSourceId: null,
      type: 'table',
    };

    const updatedPageMeta = {
      id: configs.pageMeta?.id ?? pageId,
      ...configs.pageMeta,
      blocks: [...(configs.pageMeta?.blocks ?? []), { id: instanceId, ref: 'block-plugin' }],
    };

    updateConfigs?.({ blocks: [...blocks, newBlock], pageMeta: updatedPageMeta });
    // Select the newly created wrapper block so the user can configure its
    // data context right away.
    onSelect?.(instanceId);
  };

  return (
        <StyledSurface className="w-full h-full" updateConfigs={updateConfigs} styleId={pageId} isPreview={isPreview}>
        <div
      className={`w-full h-full rounded-xl p-3 flex flex-col gap-3 transition-colors ${
        isPreview ? '' : 'border border-dashed'
      } ${
        isDragOver ? 'border-primary bg-primary/10' : 'border-blue-500/40 bg-blue-500/5'
      }`}
      onDragOver={(e) => {
        if (isPreview) return;
        if (!e.dataTransfer.types.includes(PLUGIN_DRAG_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setIsDragOver(true);
        // Auto-expand a collapsed page so the drop target becomes visible
        if (!open) setOpen(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDragOver(false);
        e.stopPropagation();
      }}
      onDrop={(e) => {
        if (isPreview) return;
        const pluginId = e.dataTransfer.getData(PLUGIN_DRAG_MIME) || e.dataTransfer.getData('text/plain');
        setIsDragOver(false);
        if (!pluginId) return;
        e.preventDefault();
        e.stopPropagation(); // don't let the outer Canvas also handle this drop
        const rect = containerRef.current?.getBoundingClientRect();
        const dropX = rect ? e.clientX - rect.left : 20;
        const dropY = rect ? e.clientY - rect.top : 20;
        addBlockFromDroppedPlugin(pluginId, dropX, dropY);
      }}
    >

      {/* Header — pure editor chrome (collapse toggle), hidden entirely in preview */}
      {!isPreview && (
        // div[role=button], not <button>: the title is an <input> while being
        // renamed, and inputs inside a real <button> don't take focus/clicks
        // reliably (Firefox) and Space would re-trigger the button.
        <div
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
          <FileText className="w-4 h-4 text-blue-500/60 shrink-0" />
          <InlineEditableText
            value={configs.title ?? ''}
            placeholder="Page"
            onCommit={(title) => updateConfigs?.({ title })}
            className="font-bold text-blue-600/80 uppercase tracking-widest flex-1"
            inputClassName="text-xs font-bold uppercase tracking-widest"
          />
          <span className="text-[10px] font-mono text-muted-foreground/50 mr-1">{pageId}</span>
          {onDeleteSelf && (
            <span
              role="button"
              title="Delete page"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm('Delete this page? This removes everything inside it too.')) onDeleteSelf();
              }}
              className="flex h-5 w-5 items-center justify-center rounded-full text-destructive hover:bg-destructive/10 mr-1"
            >
              <Trash2 className="w-3 h-3" />
            </span>
          )}
          {open
            ? <ChevronDown className="w-3 h-3 text-muted-foreground/40" />
            : <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
          }
        </div>
      )}

      {isPreview && configs.title && (
        <h2 className="text-lg font-semibold uppercase tracking-wide px-1 shrink-0">{configs.title}</h2>
      )}

      {open && (
        // Freeform canvas: every block is absolutely positioned via its own
        // configs.x/y (top-left corner) and configs.width/height, so blocks
        // behave like sticky notes — drop or drag them anywhere, no list order.
          <div ref={containerRef} className="relative flex-1 w-full min-h-0 overflow-auto">
          {blocks.length === 0 && !isPreview && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg border border-dashed border-border/60 text-center text-[11px] text-muted-foreground/50">
              Drag a component here to add it to this page
            </div>
          )}
          {blocks.map((block, i) => {
            if (isPreview && !canViewSource(block.dataSourceId, block.type)) return null;
            const bx = (block.configs as any)?.x ?? 20;
            const by = (block.configs as any)?.y ?? 20;
            const bw = (block.configs as any)?.width || DEFAULT_BLOCK_WIDTH;
            const bh = (block.configs as any)?.height || DEFAULT_BLOCK_HEIGHT;

            // Preview: the page this sidebar currently opens is shown to its RIGHT,
            // filling the rest of this page - like a real application shell.
            const linkedPage = isPreview && block.pluginId === 'sidebar' ? navEmbed?.embeds[block.id] : undefined;

            return (
              <Fragment key={block.id}>
              {linkedPage && (
                <div
                  key={linkedPage.id}
                  className="absolute overflow-auto"
                  style={{ left: bx + bw + 8, top: by, right: 0, bottom: 0 }}
                >
                  {navEmbed!.render(linkedPage)}
                </div>
              )}
              <div
                className="absolute"
                style={{ left: bx, top: by, width: bw, height: bh }}
              >
                <BlockSlot
                  blockInstance={block}
                  pageId={pageId}
                  pageBgColor={configs.bgColor}
                  onUpdate={u => updateBlock(i, u)}
                  onRemove={() => removeBlock(i)}
                  isPreview={isPreview}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
              </div>
              </Fragment>
            );
          })}
         </div>
      )}
    </div>
    </StyledSurface>
  );
}

// ─── Plugin export ────────────────────────────────────────────────────────────

export const PagePlugin: ViewBuilderPlugin<PageConfigs> = withVisualStyle({
  id: 'page-plugin',
  pluginType: 'layout',
  toolbar: {
    name: 'Page',
    element: () => <FileText className="w-4 h-4" />,
    toolTip: 'Page container — holds blocks and page-level state',
  },
  canvas: {
    element: ({ configs, updateConfigs, isPreview, selectedId, onSelect, onDeleteSelf }) => (
      <PageCanvas
        configs={configs}
        updateConfigs={updateConfigs}
        isPreview={isPreview}
        selectedId={selectedId}
        onSelect={onSelect}
        onDeleteSelf={onDeleteSelf}
      />
    ),
  },
  settings: [
    { field_id: 'pageId', label: 'Page ID', type: 'text', defaultValue: 'my-page' },
    { field_id: 'title',  label: 'Title',   type: 'text', defaultValue: 'My Page' },
  ],
  componentDataSchema: {},
});