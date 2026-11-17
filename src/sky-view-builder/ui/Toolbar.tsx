import React, { useState } from 'react';
import { registry } from "../core/registry";
import { FileText, Trash2, LayoutTemplate, Database, Layers, X, Search, Bookmark, Pencil } from "lucide-react";
import { useTemplates, deleteTemplate, TEMPLATE_DRAG_PREFIX } from "../core/templateStore";
import { DomainModelPanel } from './DomainModelPanel';

// Status shown on each palette item.
// 'completed'   -> green  (fully implemented, ready to use)
// 'coming-soon' -> yellow (not ready yet)
type PluginStatus = 'completed' | 'coming-soon';

const STATUS_STYLES: Record<PluginStatus, { dot: string; text: string; label: string }> = {
  'completed': {
    dot: 'bg-emerald-500',
    text: 'text-emerald-700',
    label: 'Ready',
  },
  'coming-soon': {
    dot: 'bg-amber-400',
    text: 'text-amber-700',
    label: 'Coming soon',
  },
};

const StatusBadge: React.FC<{ status: PluginStatus }> = ({ status }) => {
  const s = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
};

interface ToolbarProps {
  onAdd: (pluginId: string) => void;
  /** "Edit" on a saved block: drops a linked copy onto the canvas to edit.
   *  Saving that copy replaces the saved block instead of adding a new one. */
  onEditTemplate?: (templateId: string) => void;
  onGenerate?: () => void;
  /**
   * 'docked' (default): a normal in-flow column beside the canvas.
   * 'drawer': used on small viewports — the parent positions it as a
   * slide-over, and a close button is shown in the header.
   */
  variant?: 'docked' | 'drawer';
  onClose?: () => void;
  /** Fires while a touch/pen drag from the palette is in progress (lets a drawer get out of the way). */
  onDraggingChange?: (dragging: boolean) => void;
}

// Custom MIME type used to pass a dragged plugin's id to whatever drop
// target picks it up (main Canvas, or a Page's block area).
export const PLUGIN_DRAG_MIME = 'application/x-skyview-plugin';


// ─── Touch / pen drag fallback ──────────────────────────────────────────────
// Native HTML5 drag-and-drop (draggable + onDragStart) only fires for a real
// MOUSE. It never fires for touch or pen input — which is exactly what Chrome
// DevTools' device/responsive mode ("inspect mode" with the phone/tablet
// toolbar) emulates, and what real tablets/phones send. So the palette looked
// "undraggable" there while working fine in a normal window.
//
// For non-mouse pointers we run our own drag: hold ~180ms (so quick swipes
// still scroll the list), a ghost label follows the finger/cursor, and on
// release we dispatch synthetic `dragover` + `drop` DragEvents (carrying the
// same PLUGIN_DRAG_MIME payload) at whatever is under the pointer. Every
// existing drop target (Canvas, Page, Block, Domain Tabs) already listens
// for exactly those events, so none of them need to change.
const HOLD_MS = 180;
const MOVE_CANCEL_PX = 8;

function fireDragEvent(
  type: 'dragover' | 'dragleave' | 'drop',
  target: Element,
  payload: string,
  x: number,
  y: number
) {
  try {
    const dt = new DataTransfer();
    dt.setData(PLUGIN_DRAG_MIME, payload);
    dt.setData('text/plain', payload);
    dt.dropEffect = 'copy';
    dt.effectAllowed = 'copy';
    target.dispatchEvent(
      new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt })
    );
  } catch {
    /* DataTransfer/DragEvent constructors unsupported — nothing else we can do */
  }
}

function usePointerDrag(
  onDraggingChange?: (dragging: boolean) => void
) {
  const suppressClick = React.useRef(false);

  const bind = (payload: string, label: string, enabled = true) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (!enabled || e.pointerType === 'mouse' || e.button > 0) return;

      const el = e.currentTarget;
      const pointerId = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let ghost: HTMLDivElement | null = null;
      let lastTarget: Element | null = null;

      const blockScroll = (ev: TouchEvent) => { if (dragging && ev.cancelable) ev.preventDefault(); };

      const cleanup = () => {
        window.clearTimeout(timer);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('touchmove', blockScroll);
        try { el.releasePointerCapture(pointerId); } catch { /* already released */ }
        ghost?.remove();
        ghost = null;
        if (dragging) onDraggingChange?.(false);
      };

      const timer = window.setTimeout(() => {
        dragging = true;
        onDraggingChange?.(true);
        try { el.setPointerCapture(pointerId); } catch { /* ignore */ }
        ghost = document.createElement('div');
        ghost.textContent = label;
        ghost.style.cssText =
          'position:fixed;z-index:99999;pointer-events:none;padding:6px 12px;border-radius:10px;' +
          'font:600 12px system-ui,sans-serif;color:#fff;background:rgba(16,185,129,.92);' +
          'box-shadow:0 8px 24px rgba(0,0,0,.45);transform:translate(-50%,-140%);' +
          `left:${startX}px;top:${startY}px;`;
        document.body.appendChild(ghost);
      }, HOLD_MS);

      function onMove(ev: PointerEvent) {
        if (!dragging) {
          // Moved before the hold elapsed → the user is scrolling the list.
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_CANCEL_PX) cleanup();
          return;
        }
        if (ghost) { ghost.style.left = `${ev.clientX}px`; ghost.style.top = `${ev.clientY}px`; }
        const t = document.elementFromPoint(ev.clientX, ev.clientY);
        if (lastTarget && lastTarget !== t) fireDragEvent('dragleave', lastTarget, payload, ev.clientX, ev.clientY);
        if (t) fireDragEvent('dragover', t, payload, ev.clientX, ev.clientY);
        lastTarget = t;
      }

      function onUp(ev: PointerEvent) {
        if (dragging) {
          const t = document.elementFromPoint(ev.clientX, ev.clientY);
          if (t) fireDragEvent('drop', t, payload, ev.clientX, ev.clientY);
          else if (lastTarget) fireDragEvent('dragleave', lastTarget, payload, ev.clientX, ev.clientY);
          // The browser may still synthesize a click after a long press.
          suppressClick.current = true;
          window.setTimeout(() => { suppressClick.current = false; }, 400);
        }
        cleanup();
      }

      function onCancel() {
        if (dragging && lastTarget) fireDragEvent('dragleave', lastTarget, payload, startX, startY);
        cleanup();
      }

      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onCancel);
      window.addEventListener('touchmove', blockScroll, { passive: false });
    },
  });

  return { bind, suppressClick };
}

const SHOW_DOMAIN_TAB = false;

export const Toolbar: React.FC<ToolbarProps> = ({ onAdd, onEditTemplate, onGenerate, variant = 'docked', onClose, onDraggingChange }) => {
  const isDrawer = variant === 'drawer';
  const pointerDrag = usePointerDrag(onDraggingChange);
  const [tab, setTab] = useState<'components' | 'blocks' | 'domains'>('components');
  const templates = useTemplates();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const orderedPlugins = [...registry.getAllPlugins()].sort((a, b) => {
    const priority: Record<string, number> = {
      'page-plugin': 0,
      'block-plugin': 1,
    };

    const priorityA = priority[a.id] ?? 2;
    const priorityB = priority[b.id] ?? 2;

    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.toolbar.name.localeCompare(b.toolbar.name);
  });
  const visiblePlugins = q
    ? orderedPlugins.filter(p => `${p.toolbar.name} ${p.pluginType}`.toLowerCase().includes(q))
    : orderedPlugins;
  const visibleTemplates = q
    ? templates.filter(t => t.name.toLowerCase().includes(q))
    : templates;

  const searchBox = (placeholder: string) => (
  <div className="relative mb-4 sm:mb-6">
    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
    <input
      type="text"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-8 text-xs outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary/50"
    />
    {query && (
      <button
        type="button"
        onClick={() => setQuery('')}
        aria-label="Clear search"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    )}
  </div>
  );

  return (
    // Widths are capped by the viewport so the palette can never be wider
    // than the screen (the Domain Models tab used to be a hard 700px).
    // min-h-0 + overflow-hidden lets the inner lists scroll instead of being
    // clipped when the window is short (e.g. DevTools docked at the bottom).
    <aside className={`border-r border-border h-full min-h-0 overflow-hidden flex flex-col shrink-0 transition-[width] ${
      isDrawer ? 'bg-card shadow-2xl' : 'bg-card/50'
    } ${
      tab === 'domains'
        ? (isDrawer ? 'w-[min(700px,100vw)]' : 'w-[min(700px,50vw)]')
        : (isDrawer ? 'w-[min(18rem,100vw)]' : 'w-56 xl:w-64')
    }`}>

      {/* Brand header — matches the "SKY VIEW" logo row in the reference UI */}
      <div className="p-3 sm:p-4 border-b border-border flex items-center gap-2 sm:gap-3 shrink-0">
        <div className="p-2 bg-primary rounded-lg shrink-0">
          <div className="w-5 h-5 flex items-center justify-center text-primary-foreground font-black text-xs">SV</div>
        </div>
        <h1 className="font-black text-sm tracking-tighter uppercase flex-1 truncate">SKIODE</h1>

        {/* Tab pills — switch between the component palette and domain models */}
        <div className="flex items-center bg-secondary rounded-xl p-0.5 shrink-0">
          <button
            onClick={() => setTab('components')}
            title="Components"
            className={`p-1.5 rounded-lg transition-all ${tab === 'components' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground/50 hover:text-foreground'}`}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setTab('blocks')}
            title="Saved Blocks"
            className={`relative p-1.5 rounded-lg transition-all ${tab === 'blocks' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground/50 hover:text-foreground'}`}
          >
            <Bookmark className="w-3.5 h-3.5" />
          </button>
          {/* Domain Models tab hidden for now — set SHOW_DOMAIN_TAB to true to bring it back */}
          {SHOW_DOMAIN_TAB && (
            <button
              onClick={() => setTab('domains')}
              title="Domain Models"
              className={`p-1.5 rounded-lg transition-all ${tab === 'domains' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground/50 hover:text-foreground'}`}
            >
              <Database className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {isDrawer && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close palette"
            className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background/80 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Domain Model Manager (includes Domain View Configuration) ── */}
      {SHOW_DOMAIN_TAB && tab === 'domains' && (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <div className="px-5 py-3 border-b border-border/40 shrink-0">
            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Domain Models</p>
            <p className="text-[10px] text-muted-foreground/40 mt-0.5">Create schemas and configure how each domain is viewed</p>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <DomainModelPanel />
          </div>
        </div>
      )}

      {/* ── Saved Blocks ── */}
      {tab === 'blocks' && (
      <div className="p-4 sm:p-6 flex-1 min-h-0 overflow-y-auto pb-24">
        <p className="text-[10px] uppercase font-bold text-muted-foreground mb-3 tracking-widest">
          Saved Blocks{templates.length > 0 ? ` (${templates.length})` : ''}
        </p>
        {templates.length === 0 ? (
          <p className="text-xs text-muted-foreground/70">
            No saved blocks yet. Save a block from the canvas and it will show up here to drag into any page.
          </p>
        ) : (
          <>
            {searchBox("Search saved blocks…")}
            {visibleTemplates.length === 0 && (
              <p className="text-xs text-muted-foreground/70">No saved blocks match “{query}”.</p>
            )}
          <div className="grid grid-cols-1 gap-3">
            {visibleTemplates.map(t => {
              const plugin = registry.getPlugin(t.pluginId);
              return (
                <div key={t.id} className="relative group">
                  <button
                    draggable
                    {...pointerDrag.bind(TEMPLATE_DRAG_PREFIX + t.id, t.name)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(PLUGIN_DRAG_MIME, TEMPLATE_DRAG_PREFIX + t.id);
                      e.dataTransfer.setData('text/plain', TEMPLATE_DRAG_PREFIX + t.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    title={`Drag "${t.name}" into a page or block to reuse it`}
                    className="flex items-center gap-3 p-3 pr-8 rounded-xl border border-border bg-card transition-all text-sm w-full text-left hover:bg-secondary cursor-grab active:cursor-grabbing active:scale-95"
                  >
                    <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-secondary group-hover:bg-primary/10 group-hover:text-primary transition-colors shrink-0">
                      {plugin
                        ? (typeof plugin.toolbar.element === 'function' ? <plugin.toolbar.element /> : plugin.toolbar.element)
                        : <LayoutTemplate className="w-4 h-4" />}
                    </div>
                    <div className="flex flex-col gap-0.5 min-w-0 pr-6">
                      <span className="font-medium truncate">{t.name}</span>
                      <span className="text-[10px] text-muted-foreground truncate">{plugin?.toolbar.name ?? t.pluginId}</span>
                    </div>
                  </button>
                  {onEditTemplate && (
                    <button
                      type="button"
                      title="Edit saved block — opens it on the canvas; saving replaces it"
                      aria-label={`Edit ${t.name}`}
                      onClick={(e) => { e.stopPropagation(); onEditTemplate(t.id); }}
                      className="absolute top-1.5 right-7 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 p-1 rounded text-muted-foreground/60 hover:text-primary transition-opacity">
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    title="Delete saved block"
                    onClick={(e) => { e.stopPropagation(); deleteTemplate(t.id); }}
                    className="absolute top-1.5 right-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 p-1 rounded text-muted-foreground/50 hover:text-destructive transition-opacity">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
          </>
        )}
      </div>
      )}

      {/* ── Component Palette ── */}
      {tab === 'components' && (
      <>
      <div className="border-b border-border p-3 shrink-0">
        <button
          onClick={() => onGenerate?.()}
          title="Generate JSON"
          className="group flex w-full items-center gap-3 rounded-xl border border-border/70 bg-gradient-to-br from-primary/10 via-background to-secondary/70 px-3 py-3 text-left transition-all hover:border-primary/30 hover:bg-primary/10 hover:shadow-sm"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">Generate JSON</div>
            <div className="text-[11px] text-muted-foreground">Export the current view layout</div>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-primary/70">Open</span>
        </button>
      </div>

      <div className="p-4 sm:p-6 flex-1 min-h-0 overflow-y-auto pb-24">
        <p className="text-[10px] uppercase font-bold text-muted-foreground mb-3 tracking-widest">Component Palette</p>
        {searchBox("Search components…")}
        {q && visiblePlugins.length === 0 && (
          <p className="text-xs text-muted-foreground/70">No components match “{query}”.</p>
        )}
        <div className="grid grid-cols-1 gap-3">
          {visiblePlugins.map(plugin => {
            // Falls back to 'completed' if a plugin hasn't been tagged yet.
            const status: PluginStatus = plugin.status ?? 'completed';
            const isComingSoon = status === 'coming-soon';

            return (
              <button
                key={plugin.id}
                draggable={!isComingSoon}
                onDragStart={(e) => {
                  if (isComingSoon) {
                    e.preventDefault();
                    return;
                  }
                  e.dataTransfer.setData(PLUGIN_DRAG_MIME, plugin.id);
                  // Fallback for drop targets that only read plain text
                  e.dataTransfer.setData('text/plain', plugin.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                {...pointerDrag.bind(plugin.id, plugin.toolbar.name, !isComingSoon)}
                onClick={() => { if (pointerDrag.suppressClick.current) return; if (!isComingSoon) onAdd(plugin.id); }}
                disabled={isComingSoon}
                className={`flex items-center gap-3 p-3 rounded-xl border border-border bg-card transition-all text-sm group text-left active:scale-95 ${
                  isComingSoon
                    ? 'opacity-60 cursor-not-allowed'
                    : 'hover:bg-secondary cursor-grab active:cursor-grabbing'
                }`}
              >
                <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-secondary group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                  {typeof plugin.toolbar.element === 'function'
                    ? <plugin.toolbar.element />
                    : plugin.toolbar.element}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{plugin.toolbar.name}</span>
                  <span className="text-[10px] text-muted-foreground">{plugin.pluginType}</span>
                  <StatusBadge status={status} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
      </>
      )}
    </aside>
  );
};