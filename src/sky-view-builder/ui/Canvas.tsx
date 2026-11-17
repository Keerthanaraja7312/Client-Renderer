import React, { useState, useMemo } from "react"
import { Responsive, WidthProvider } from "react-grid-layout/legacy"
import { registry, type ComponentInstance } from "../index"
import { Move, Trash2 } from "lucide-react"
import { PLUGIN_DRAG_MIME } from "./Toolbar"
import { ensureLayoutsForInstances } from "./gridLayout"
import { TEMPLATE_DRAG_PREFIX } from "../core/templateStore"
import { useNavVisibleInstances, NavEmbedContext } from "../core/navigation"
import { canViewSource } from "../../lib/permissions"

// Import required Grid Layout styles
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"

const ResponsiveGridLayout = WidthProvider(Responsive)

// ─── Multi-directional resize handle ───────────────────────────────────────
// Same handle react-grid-layout uses inside BlockCanvas's nested grid: a
// small draggable square positioned per-axis (n/s/e/w/ne/nw/se/sw). RGL
// requires a forwardRef component so its internal react-resizable wrapper
// can attach drag listeners directly to this DOM node. Passing all 8 axes
// to `resizeHandles` on the grid gives every side and every corner its own
// handle, instead of only the default bottom-right corner.
// Inline styles (not Tailwind translate-x/y classes) — positioning must not
// depend on whether the `transform` utility is enabled/purged in this
// project's Tailwind config. Without it, -translate-x-1/2/-translate-y-1/2
// silently no-op and the n/s/e/w handles land at the wrong spot (or
// effectively unusable), which looks exactly like "width resizes fine but
// height never changes."
const RGL_HANDLE_STYLE: Record<string, React.CSSProperties> = {
  s: { bottom: -6, left: "50%", transform: "translateX(-50%)", cursor: "ns-resize" },
  n: { top: -6, left: "50%", transform: "translateX(-50%)", cursor: "ns-resize" },
  e: { right: -6, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" },
  w: { left: -6, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" },
  se: { bottom: -6, right: -6, cursor: "nwse-resize" },
  sw: { bottom: -6, left: -6, cursor: "nesw-resize" },
  ne: { top: -6, right: -6, cursor: "nesw-resize" },
  nw: { top: -6, left: -6, cursor: "nwse-resize" },
}

const RGLResizeHandle = React.forwardRef<
  HTMLDivElement,
  {
    handleAxis?: string;
    style?: React.CSSProperties;
    onMouseDown?: (e: React.MouseEvent) => void;
    onMouseUp?: (e: React.MouseEvent) => void;
    onTouchEnd?: (e: React.TouchEvent) => void;
  }
>(({ handleAxis = "se", style, onMouseDown, onMouseUp, onTouchEnd, ...rest }, ref) => (
  <div
    ref={ref}
    className="rgl-resize-handle absolute z-30 h-4 w-4 rounded-lg border border-primary bg-primary/80 shadow-md hover:scale-110 transition-transform"
    style={{ ...RGL_HANDLE_STYLE[handleAxis], ...style }}
    // stopPropagation FIRST, then still call react-resizable's own handler:
    // this Page-level resize handle is itself a descendant of the outer
    // .group div (the same element ResponsiveGridLayout's own
    // draggableHandle=".group" listens on for DRAG). Without stopping
    // propagation here, a mousedown on the handle bubbles up and gets
    // claimed by the grid's own drag-initiation logic instead of
    // react-resizable's resize logic — same root cause BlockCanvas.tsx's
    // own RGLResizeHandle already guards against.
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
))

RGLResizeHandle.displayName = "RGLResizeHandle"

interface CanvasProps {
  instances: ComponentInstance[]
  selectedId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onChange: (updater: (prev: ComponentInstance[]) => ComponentInstance[]) => void
  layouts: any
  onLayoutChange: (allLayouts: any) => void
  isPreview?: boolean
  /** Called with a pluginId when a palette item is dropped directly onto the canvas */
  onDropPlugin?: (pluginId: string) => void
}

export const Canvas: React.FC<CanvasProps> = ({
  instances,
  selectedId,
  onSelect,
  onDelete,
  onChange,
  layouts,
  onLayoutChange,
  isPreview = false,
  onDropPlugin,
}) => {
  const [isDragOver, setIsDragOver] = useState(false)

  // Sidebar navigation: in preview, Pages linked from a sidebar menu are shown
  // one at a time (the active one). Design mode always renders every page.
  const { visible: navVisibleInstances, filtered: navFiltered, templateIds, embeds } = useNavVisibleInstances(instances, isPreview)
  // Published page: hide components bound to a table the signed-in user may not view.
  const shownInstances = useMemo(
    () => (isPreview ? navVisibleInstances.filter((i) => canViewSource(i.dataSourceId, i.type)) : navVisibleInstances),
    [navVisibleInstances, isPreview]
  )

  // Layout is taken straight from props/storage — no synthetic row
  // reservation for "open" popovers/panels. Any component that needs to
  // show extra content while open (e.g. a dropdown's option list) should
  // render that content as an absolutely-positioned overlay instead of
  // requesting extra grid rows. This keeps manual resize (the drag handles)
  // fully authoritative: nothing else mutates `h`/`w` behind the user's back.
  const baseLayouts = useMemo(() => {
    const base = ensureLayoutsForInstances(layouts, shownInstances)
    if (!templateIds.size) return base
    // A saved page opened from the sidebar has no saved grid slot: put it right
    // beside the sidebar (same row), filling the remaining columns.
    const COLS: Record<string, number> = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }
    const sidebar = instances.find((i) => i.pluginId === "sidebar")
    const out: typeof base = { ...base }
    for (const [bp, items] of Object.entries(base)) {
      const cols = COLS[bp] ?? 12
      const sb = sidebar ? items.find((it) => it.i === sidebar.id) : undefined
      const x = sb ? Math.min(sb.x + sb.w, cols - 1) : 0
      const y = sb ? sb.y : 0
      out[bp] = items.map((it) =>
        templateIds.has(it.i) ? { ...it, x, y, w: Math.max(1, cols - x), minW: 1 } : it
      )
    }
    return out
  }, [layouts, shownInstances, templateIds, instances])

  const handleDragOver = (e: React.DragEvent) => {
    if (isPreview || !onDropPlugin) return
    if (!e.dataTransfer.types.includes(PLUGIN_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear when actually leaving the canvas, not when moving between children
    if (e.currentTarget === e.target) setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    if (isPreview || !onDropPlugin) return
    const pluginId = e.dataTransfer.getData(PLUGIN_DRAG_MIME) || e.dataTransfer.getData("text/plain")
    setIsDragOver(false)
    if (!pluginId) return
    // Saved templates (a whole Page/Sidebar with everything inside) arrive as
    // `__template__:<id>`; ViewBuilder.addComponent validates what they contain.
    if (pluginId !== 'page-plugin' && pluginId !== 'sidebar' && !pluginId.startsWith(TEMPLATE_DRAG_PREFIX)) return
    e.preventDefault()
    onDropPlugin(pluginId)
  }

  // Renders one instance's plugin component. Shared by the grid and by Pages that
  // embed their sidebar's linked page beside it (see NavEmbedContext).
  const renderInstance = (inst: ComponentInstance) => {
      const plugin = registry.getPlugin(inst.pluginId)
      if (!plugin)
        return (
          <div className="text-xs text-muted-foreground italic">
            Plugin missing
          </div>
        )
      const Component =
        isPreview && plugin.previewRender
          ? plugin.previewRender
          : plugin.canvas.element
      return (
        <Component
          id={inst.id}
          configs={inst.configs}
          componentDataSchema={inst.componentDataSchema}
          query={inst.query}
          dataSourceId={inst.dataSourceId}
          type={inst?.type}
          isPreview={isPreview}
          stateIO={inst.state}
          // Pass selection context down so nested Blocks/Components
          // (rendered inside the plugin's own canvas element) can
          // report clicks and highlight themselves when selected.
          selectedId={selectedId}
          onSelect={onSelect}
          onDeleteSelf={() => onDelete(inst.id)}
          updateConfigs={(partial: any) =>
            onChange((currentInstances) =>
              currentInstances.map((i) =>
                i.id === inst.id
                  ? { ...i, configs: { ...i.configs, ...(typeof partial === 'function' ? partial(i.configs) : partial) } }
                  : i
              )
            )
          }
        />
      )
  }

  // Prepare default layout items for any instance that doesn't have one yet
  const gridItems = shownInstances.map((inst) => {
    return (
      <div
        key={inst.id}
        onClick={(e) => {
          e.stopPropagation()
          onSelect(inst.id)
        }}
        className={`group relative border transition-all ${
          isPreview ? "" : "cursor-grab active:cursor-grabbing"
        } ${
          selectedId === inst.id
            ? "z-10 border-primary bg-card shadow-2xl"
            : isPreview
              ? "border-transparent"
              : "border-border bg-card/40 hover:border-primary/30"
        }`}
      >
        {/*
          overflow-visible (not overflow-hidden): components that need to
          show floating content while "open" (e.g. a dropdown's option
          panel) render it as an absolutely-positioned overlay that pops
          out of this box. We no longer reserve extra grid rows for that
          content, so it must not be clipped by this wrapper.
        */}
        <div className="relative h-full w-full overflow-visible p-1">
          {renderInstance(inst)}
        </div>

        {/* Visual Label */}
        {!isPreview && (
          <span
            className={`absolute -top-3 left-6 rounded-full px-2.5 py-1 text-[9px] font-black tracking-wider uppercase transition-all ${
              selectedId === inst.id
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                : "hidden border border-border bg-secondary text-muted-foreground shadow-md group-hover:block"
            }`}
          >
            {registry.getPlugin(inst.pluginId)?.toolbar.name || "Component"}
          </span>
        )}

        {/* Delete Action */}
        {selectedId === inst.id && (
          <button
            title="Delete"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onDelete(inst.id)
            }}
            className="absolute top-2 right-2 z-40 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg transition-colors hover:bg-destructive/90"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}

        {/* Note: the old single visual-only bottom-right indicator has been
            removed — RGL now renders a real, draggable handle on every side
            and corner via `resizeHandles`/`resizeHandle` below, so a static
            decorative dot here would be redundant and could sit on top of
            the real n/e/s/w handles. */}
      </div>
    )
  })

  return (
    <main
      className={`min-w-0 flex-1 overflow-y-auto p-1 ${isPreview ? "" : "pb-24"} transition-colors ${isDragOver ? "bg-primary/5 outline-dashed outline-2 outline-primary/40 -outline-offset-4" : ""}`}
      style={{ scrollbarGutter: "stable" }}
      onClick={() => onSelect("")}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {instances.length === 0 ? (
        <div className={`mx-auto mt-20 flex h-80 max-w-3xl flex-col items-center justify-center rounded-xl border border-dashed text-muted-foreground backdrop-blur-sm transition-colors ${isDragOver ? "border-primary bg-primary/5" : "border-border bg-card/20"}`}>
          <Move className="mb-4 h-10 w-10 animate-pulse opacity-10" />
          <p className="text-sm font-medium">Your canvas is empty</p>
          <p className="mt-1 px-12 text-center text-[11px] opacity-40">
            Drag a Page from the palette onto the canvas first, then add blocks/components inside that page.
          </p>
        </div>
      ) : (
        <NavEmbedContext.Provider value={{ embeds, render: renderInstance }}>
        <ResponsiveGridLayout
          className="layout"
          layouts={baseLayouts}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
          rowHeight={100}
          draggableHandle=".group" // Allow dragging by the card container
          isDraggable={!isPreview}
          isResizable={!isPreview}
          // All four corners + all four edges get their own handle, same as
          // BlockCanvas's nested grid — not just the default bottom-right.
          resizeHandles={isPreview ? [] : ["s", "w", "e", "n", "sw", "nw", "ne", "se"]}
          resizeHandle={<RGLResizeHandle />}
          onLayoutChange={(_currentLayout, allLayouts) => {
            // While some pages are hidden by sidebar navigation, RGL compacts
            // the visible ones. That is a preview-only effect: never write it
            // back, or the saved design layout would be overwritten.
            if (isPreview && navFiltered) return
            onLayoutChange(allLayouts)
          }}
          margin={[5, 5]}
          compactType="vertical"
          preventCollision={false}
        >
          {gridItems}
        </ResponsiveGridLayout>
        </NavEmbedContext.Provider>
      )}
    </main>
  )
}