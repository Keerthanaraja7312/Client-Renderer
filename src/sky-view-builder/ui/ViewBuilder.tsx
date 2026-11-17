import React, { useState } from "react"
import { registry, type ComponentInstance } from "../index"
import { Toolbar } from "./Toolbar"
import { JSONPreview } from './JSONPreview';
import { Canvas } from "./Canvas"
import { SettingsPanel } from "./SettingsPanel"
import { StateHubProvider } from "../../store/StateHubContext"
import { X, FileText, Menu, PanelRightOpen, PanelRightClose, BookmarkPlus, Check, Undo2, Redo2, Rocket } from "lucide-react"
import { SaveTemplateDialog } from "./SaveTemplateDialog"
import { PublishDialog } from "./PublishDialog"
import { useMediaQuery } from "../hooks/use-media-query"
import { useUndoRedo } from "../hooks/useUndoRedo"
import { stateHub } from "../../store/StateHub"
import { createDefaultLayoutItem, ensureLayoutsForInstances, getLayouts } from "./gridLayout"
import { getLayoutItem, updateLayoutItem, type GridLayoutItem } from "./layoutUtils"
import { saveGridLayout } from "../../api/gridLayoutApi"
import { getLayoutsWithPositions } from "./positionTree"
import { resolveDroppedTemplate, instantiateTemplate, getTemplate, TEMPLATE_DRAG_PREFIX } from "../core/templateStore"

/** Plugins allowed directly on the root canvas (everything else goes inside a Page). */
const ROOT_PLUGIN_IDS = ['page-plugin', 'sidebar']

export interface DataField {
  fieldId: string
  field_type: "text" | "number" | "date" | "boolean" | string
}

export interface DataSource {
  name: string
  id: string | number
  type: string
  availableFields: DataField[]
  /** Project the table belongs to (tables only; null / absent = no project). */
  project_id?: string | null
}

// ─── Recursive helpers ─────────────────────────────────────────────────────
// Instances can be nested: a Page's configs.blocks holds Block instances,
// and a Block's configs.components holds Component instances. Selection and
// updates need to walk that tree instead of assuming a flat top-level list.

function findInstanceRecursive(
  instances: ComponentInstance[],
  id: string
): ComponentInstance | null {
  if (!Array.isArray(instances)) return null

  for (const inst of instances) {
    if (!inst || typeof inst !== 'object') continue
    if (inst.id === id) return inst

    const nestedBlocks = (inst.configs as any)?.blocks
    if (Array.isArray(nestedBlocks)) {
      const found = findInstanceRecursive(nestedBlocks, id)
      if (found) return found
    }

    const nestedComponents = (inst.configs as any)?.components
    if (Array.isArray(nestedComponents)) {
      const found = findInstanceRecursive(nestedComponents, id)
      if (found) return found
    }
  }
  return null
}

function updateInstanceRecursive(
  instances: ComponentInstance[],
  id: string,
  updater: (inst: ComponentInstance) => ComponentInstance
): ComponentInstance[] {
  if (!Array.isArray(instances)) return []

  return instances.map((inst) => {
    if (!inst || typeof inst !== 'object') return inst
    if (inst.id === id) return updater(inst)

    let updatedConfigs = inst.configs && typeof inst.configs === 'object' ? inst.configs : {}
    let configsChanged = false

    const nestedBlocks = (inst.configs as any)?.blocks
    if (Array.isArray(nestedBlocks)) {
      const newBlocks = updateInstanceRecursive(nestedBlocks, id, updater)
      if (newBlocks !== nestedBlocks) {
        updatedConfigs = { ...updatedConfigs, blocks: newBlocks }
        configsChanged = true
      }
    }

    const nestedComponents = (inst.configs as any)?.components
    if (Array.isArray(nestedComponents)) {
      const newComponents = updateInstanceRecursive(nestedComponents, id, updater)
      if (newComponents !== nestedComponents) {
        updatedConfigs = { ...updatedConfigs, components: newComponents }
        configsChanged = true
      }
    }

    return configsChanged ? { ...inst, configs: updatedConfigs } : inst
  })
}

const VISUAL_CONFIG_KEYS = new Set([
  'align',
  'bgColor',
  'border',
  'borderColor',
  'borderRadius',
  'className',
  'color',
  'fontSize',
  'fontWeight',
  'height',
  'italic',
  'margin',
  'padding',
  'shadow',
  'size',
  'style',
  'textAlign',
  'uppercase',
  'variant',
  'width',
  'x',
  'y',
  '_pageBgColor',
])

function removeEmptyValues<T extends Record<string, any>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => {
      if (v == null) return false
      if (Array.isArray(v)) return v.length > 0
      if (typeof v === 'object') return Object.keys(v).length > 0
      return true
    })
  ) as Partial<T>
}

function sanitizeConfigs(configs: Record<string, any> = {}): Record<string, any> {
  const cleaned = Object.fromEntries(
    Object.entries(configs)
      .filter(([key]) => !VISUAL_CONFIG_KEYS.has(key) && key !== '__templateId')
      .map(([key, value]) => {
        if ((key === 'blocks' || key === 'components') && Array.isArray(value)) {
          return [key, sanitizeInstancesForSave(value)]
        }
        return [key, value]
      })
  )

  return removeEmptyValues(cleaned)
}
 
function sanitizeInstancesForSave(instances: ComponentInstance[]): Record<string, any>[] {
  return instances.map((inst) =>
    removeEmptyValues({
      id: inst.id,
      type: inst.pluginId,
      props: sanitizeConfigs(inst.configs),
      query: inst.query,
      componentDataSchema: inst.componentDataSchema,
      dataSourceId: inst.dataSourceId,
      componentType: inst.type,
      state: inst.state,
    })
  )
}

interface ViewBuilderProps {
  /** The list of component instances on the canvas */
  instances: ComponentInstance[]
  /** Callback triggered whenever the component list or their configurations change */
  onChange: (instances: ComponentInstance[] | ((prev: ComponentInstance[]) => ComponentInstance[])) => void
  /** Layout data for the grid */
  layouts: any
  /** Callback when the grid items change position or size */
  onLayoutChange: (newLayouts: any) => void
  /** Optional: List of available data sources for data mapping */
  availableFields?: DataSource[]
  /** Optional callback to expose preview mode state */
  onPreviewChange?: (isPreview: boolean) => void
}

/**
 * A controlled ViewBuilder component.
 * State is managed by the parent (e.g., App.tsx) to allow for easy saving/syncing.
 */
export const ViewBuilder: React.FC<ViewBuilderProps> = ({
  instances,
  onChange,
  layouts,
  onLayoutChange,
  availableFields = [],
  onPreviewChange,
}) => {

  console.log("ViewBuilder data sources: ---- ", availableFields);

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isPreview, setIsPreview] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const flashSaveMsg = (ok: boolean, text: string) => {
    setSaveMsg({ ok, text })
    window.setTimeout(() => setSaveMsg(null), 3000)
  }
  const [layoutJsonOpen, setLayoutJsonOpen] = useState(false)
  // Save draft / Publish to the client app (see PublishDialog + core/pageDocument).
  const [publishOpen, setPublishOpen] = useState(false)
  const [pageSlug, setPageSlug] = useState('')

  // ── Responsive chrome ────────────────────────────────────────────────────
  // ≥768px: the component palette is a docked column. Below that (small
  // windows, or DevTools docked beside/under the page) it becomes a slide-over
  // drawer opened from the header, so the canvas keeps all the room.
  const isDesktop = useMediaQuery('(min-width: 768px)', true)
  const [toolbarOpen, setToolbarOpen] = useState(false)
  const [drawerDragging, setDrawerDragging] = useState(false)
  // The settings panel floats over the canvas; it can be collapsed to a small
  // tab without deselecting, so the canvas underneath is reachable again.
  const [settingsCollapsed, setSettingsCollapsed] = useState(false)

  // ── Undo / redo ──────────────────────────────────────────────────────────
  // Snapshots the page tree + grid layouts. Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and
  // Ctrl+Y also work (not while typing in a field — the browser handles that).
  const { undo, redo, canUndo, canRedo } = useUndoRedo(
    { instances, layouts },
    (snap) => {
      onChange(snap.instances)
      onLayoutChange(snap.layouts)
      // If undo removed the selected item, close its config panel.
      setSelectedId((id) => (id && !findInstanceRecursive(snap.instances, id) ? null : id))
    },
    { enabled: !isPreview },
  )

  // Adapts JSONPreview's generic save signature to gridLayoutApi's shape
  // (layout_data instead of page_data) so the same modal component can
  // save either JSON without knowing about the field-name difference.
  const saveLayoutJson = async (payload: {
    page_name: string
    page_data: any
    label: string
    created_by: string | null
  }) => {
    const res = await saveGridLayout({
      page_name: payload.page_name,
      layout_data: payload.page_data,
      label: payload.label,
      created_by: payload.created_by,
    })
    return { data: res.data ? { id: res.data.id } : undefined }
  }

  const applyInstanceUpdate = (updater: (prev: ComponentInstance[]) => ComponentInstance[]) => {
    // Pass the updater function straight through to onChange (setInstances)
    // instead of eagerly resolving it against a possibly-stale `instances`
    // closure. React's setState natively supports functional updates and
    // correctly queues/composes multiple rapid calls within the same
    // render commit (e.g. two sibling effects both writing configs on the
    // same instance) — resolving eagerly here was silently dropping
    // whichever update landed second.
    onChange(updater)
  }

  const addComponent = (pluginId: string) => {
    // A saved Page template dropped at the root: clone it (fresh ids) and
    // add it straight to the top-level instance list, same as a normal
    // page-plugin add below — just pre-populated instead of blank.
    const template = resolveDroppedTemplate(pluginId)
    if (template) {
      if (!ROOT_PLUGIN_IDS.includes(template.pluginId)) {
        console.warn('Only saved Pages (and standalone components like the Sidebar) can be dropped at the root canvas — saved Blocks/Components go inside a Page.')
        return
      }
      const newInstances = [...instances, template]
      onChange(newInstances)
      const currentLayouts = getLayouts(layouts)
      const largeLayout = currentLayouts.lg ?? []
      onLayoutChange(ensureLayoutsForInstances({
        ...currentLayouts,
        lg: [...largeLayout, createDefaultLayoutItem(template.id, template.pluginId, largeLayout)],
      }, newInstances))
      setSelectedId(template.id)
      return
    }

    // Pages, plus standalone root-level components (e.g. the Sidebar), may live at the root canvas.
    if (!ROOT_PLUGIN_IDS.includes(pluginId)) {
      console.warn('Please drag blocks/components into an existing Page instead of adding them at the root canvas.')
      return
    }

    const plugin = registry.getPlugin(pluginId)
    if (!plugin) return

    const defaultConfigs: any = {}
    plugin.settings.forEach((s) => {
      defaultConfigs[s.field_id] = s.defaultValue
    })

    if (pluginId === 'page-plugin') {
      // If no external metadata is provided, default to empty maps so the
      // builder remains usable. Consumers can inject real `blockDefs` and
      // `componentDefs` into the page configs later when saving/loading.
      defaultConfigs.blockDefs = {};
      defaultConfigs.componentDefs = {};
      defaultConfigs.pageMeta = { id: defaultConfigs.pageId, blocks: [] }
      defaultConfigs.blocks = []
    }

    const newInstance: ComponentInstance = {
      id: Math.random().toString(36).substring(2, 9),
      pluginId,
      configs: defaultConfigs,
      query: {},
      componentDataSchema: {},
      dataSourceId: null,
      type: null,
    }

    const newInstances = [...instances, newInstance]
    onChange(newInstances)
    const currentLayouts = getLayouts(layouts)
    const largeLayout = currentLayouts.lg ?? []
    onLayoutChange(ensureLayoutsForInstances({
      ...currentLayouts,
      lg: [...largeLayout, createDefaultLayoutItem(newInstance.id, pluginId, largeLayout)],
    }, newInstances))
    setSelectedId(newInstance.id)
  }
 
  // "Edit" on a saved block: put a linked copy on the canvas, select it, and
  // open the config panel. Whatever the user changes there (settings, inline
  // edits, drag/resize, adding children) is saved back over the SAME saved
  // block via the Save button — see SaveTemplateDialog.
  const editTemplate = (templateId: string) => {
    const tpl = getTemplate(templateId)
    if (!tpl) return

    // Pages / Sidebar live at the root canvas — same path as dragging them in.
    if (ROOT_PLUGIN_IDS.includes(tpl.pluginId)) {
      addComponent(TEMPLATE_DRAG_PREFIX + templateId)
      setSettingsCollapsed(false)
      return
    }

    // Blocks / components live inside a Page: use the page of the current
    // selection, otherwise the first page on the canvas.
    const selectedTop = selectedId
      ? instances.find((i) => i.id === selectedId || findInstanceRecursive([i], selectedId))
      : null
    const page =
      selectedTop?.pluginId === 'page-plugin'
        ? selectedTop
        : instances.find((i) => i.pluginId === 'page-plugin')
    if (!page) {
      flashSaveMsg(false, 'Add a Page to the canvas first, then edit this block.')
      return
    }

    const copy = instantiateTemplate(templateId)
    if (!copy) return

    const pageConfigs = (page.configs ?? {}) as Record<string, any>
    const blocks: ComponentInstance[] = Array.isArray(pageConfigs.blocks) ? pageConfigs.blocks : []
    // Drop it just below whatever is already on the page so it never lands on top of another block.
    const nextY = blocks.reduce(
      (m, b) => Math.max(m, ((b.configs as any)?.y ?? 0) + ((b.configs as any)?.height ?? 160)),
      0
    ) + 20

    let placed: ComponentInstance
    let selectId: string
    if (copy.pluginId === 'block-plugin') {
      placed = { ...copy, configs: { ...(copy.configs as any), x: 20, y: nextY } }
      selectId = placed.id
    } else {
      // A loose component needs a wrapper Block, same as dropping it on a page.
      const wrapperId = `block-${Math.random().toString(36).substring(2, 9)}`
      placed = {
        id: wrapperId,
        pluginId: 'block-plugin',
        configs: {
          blockId: wrapperId,
          layout: 'vertical',
          x: 20,
          y: nextY,
          width: (copy.configs as any)?.width || 280,
          height: (copy.configs as any)?.height || 160,
          stateKeys: [],
          publishes: [],
          subscribes: [],
          components: [copy],
        },
        query: {},
        componentDataSchema: {},
        dataSourceId: null,
        type: 'table',
      }
      selectId = copy.id
    }

    onChange((prev) =>
      updateInstanceRecursive(prev, page.id, (p) => {
        const cfg = (p.configs ?? {}) as Record<string, any>
        const existing: ComponentInstance[] = Array.isArray(cfg.blocks) ? cfg.blocks : []
        return {
          ...p,
          configs: {
            ...cfg,
            blocks: [...existing, placed],
            pageMeta: {
              id: cfg.pageMeta?.id ?? cfg.pageId,
              ...cfg.pageMeta,
              blocks: [...(cfg.pageMeta?.blocks ?? []), { id: placed.id, ref: 'block-plugin' }],
            },
          },
        }
      })
    )
    setSelectedId(selectId)
    setSettingsCollapsed(false)
  }

  const deleteComponent = (id: string) => {
    const newInstances = instances.filter((i) => i.id !== id)
    onChange(newInstances)
    if (selectedId === id) setSelectedId(null)
  }

  const updateConfig = (fieldId: string | Record<string, any>, value?: any) => {
    if (!selectedId) return

    const newInstances = updateInstanceRecursive(instances, selectedId, (inst) => {
      const safeInst = inst && typeof inst === 'object' ? inst : { id: '', pluginId: 'unknown', configs: {}, query: {}, componentDataSchema: {}, dataSourceId: null, type: null }
      const safeConfigs = safeInst.configs && typeof safeInst.configs === 'object' ? safeInst.configs : {}
      if (typeof fieldId === "object") {
        let updated = { ...safeInst }
        Object.entries(fieldId).forEach(([k, v]) => {
          if (
            [
              "query",
              "componentDataSchema",
              "dataSourceId",
              "type",
              "processId",
              "state",
            ].includes(k)
          ) {
            ;(updated as any)[k] = v
          } else {
            updated.configs = { ...safeConfigs, [k]: v }
          }
        })
        return updated
      }

      // Handle top-level instance properties
      if (
        [
          "query",
          "componentDataSchema",
          "dataSourceId",
          "type",
          "processId",
          "state",
        ].includes(fieldId)
      ) {
        return { ...safeInst, [fieldId]: value }
      }

      // Handle nested config settings
      return { ...safeInst, configs: { ...safeConfigs, [fieldId]: value } }
    })

    onChange(newInstances)
  }

const selectedInstance = selectedId ? findInstanceRecursive(instances, selectedId) : null

  // Only top-level instances (Pages) live in react-grid-layout's `layouts`.
  // Anything found only via recursion into configs.blocks/components (Blocks,
  // Components) is positioned in px on its own configs, per BlockSlot's and
  // ComponentSlot's drag/resize handlers.
  const isTopLevelSelected = selectedId ? instances.some((inst) => inst.id === selectedId) : false
  const layoutUnit: 'grid' | 'px' = isTopLevelSelected ? 'grid' : 'px'

  // The layout box (x/y/w/h) for whatever is currently selected. For a Page
  // this comes live from react-grid-layout's `layouts` (grid cols/rows). For
  // a nested Block/Component it's read straight from configs.x/y/width/height
  // (pixels), which is how BlockSlot/ComponentSlot actually persist position.
  const selectedLayoutItem: GridLayoutItem | null = !selectedId
    ? null
    : isTopLevelSelected
      ? getLayoutItem(layouts, selectedId)
      : selectedInstance
        ? {
            i: selectedId,
            x: (selectedInstance.configs as any)?.x ?? 0,
            y: (selectedInstance.configs as any)?.y ?? 0,
            w: (selectedInstance.configs as any)?.width ?? 0,
            h: (selectedInstance.configs as any)?.height ?? 0,
          }
        : null

  const updateSelectedLayout = (partial: Partial<Pick<GridLayoutItem, "x" | "y" | "w" | "h">>) => {
    if (!selectedId) return

    if (isTopLevelSelected) {
      const next = updateLayoutItem(layouts, selectedId, partial)
      onLayoutChange(next)
      return
    }

    // Nested Block/Component: write straight into the instance's own
    // configs.x/y/width/height via updateConfig's object-patch form, which
    // walks the tree through updateInstanceRecursive.
    const configPatch: Record<string, number> = {}
    if (partial.x !== undefined) configPatch.x = partial.x
    if (partial.y !== undefined) configPatch.y = partial.y
    if (partial.w !== undefined) configPatch.width = partial.w
    if (partial.h !== undefined) configPatch.height = partial.h
    updateConfig(configPatch)
  }
  const handleGenerate = () => setJsonOpen(true)

  const handleCloseJson = () => setJsonOpen(false)

  React.useEffect(() => {
    onPreviewChange?.(isPreview)
  }, [isPreview, onPreviewChange])

  const pageInstance = instances.find((inst) => inst.pluginId === 'page-plugin')
  // The react-grid-layout JSON, now enriched with each Page's nested
  // Block/Component positions (in px) under a "children" field per item —
  // one JSON with both grid position and full nested structure, instead of
  // a separate Positions JSON.
  const generatedLayoutJson = getLayoutsWithPositions(layouts, instances)
  console.log('[EXPORT DEBUG]', JSON.stringify(generatedLayoutJson).includes('"options"') ? 'OPTIONS PRESENT in generatedLayoutJson' : 'options MISSING from generatedLayoutJson')
  const generatedJson = {
    components: sanitizeInstancesForSave(instances),
    layout: generatedLayoutJson,
  }
  const generatedPageName =
    (pageInstance?.configs as any)?.pageId ||
    (pageInstance?.configs as any)?.pageMeta?.id ||
    'test_page_2'

  return (
    <StateHubProvider hub={stateHub}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background font-sans text-foreground">
        <div className={`min-h-14 sm:h-16 border-b border-border bg-card/30 backdrop-blur-md flex items-center justify-between gap-2 px-3 sm:px-8 shrink-0 z-40 ${isPreview ? 'bg-background/80' : ''}`}>
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            {!isPreview && !isDesktop && (
              <button
                type="button"
                onClick={() => setToolbarOpen(true)}
                aria-label="Open component palette"
                title="Components"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground/80 hover:bg-secondary/70 transition-all"
              >
                <Menu className="w-4 h-4" />
              </button>
            )}
            <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${isPreview ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
              {isPreview ? 'Live Preview' : 'Design Mode'}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {isPreview && (
              <button
                onClick={() => setLayoutJsonOpen(true)}
                title="View the react-grid-layout JSON, including nested block/component positions"
                className="h-9 sm:h-10 px-3 sm:px-5 rounded-xl text-xs font-black uppercase tracking-widest bg-secondary text-foreground/80 hover:bg-secondary/70 transition-all flex items-center gap-2"
              >
                <FileText className="w-4 h-4" /> <span className="hidden sm:inline">Layout JSON</span>
              </button>
            )}
            {!isPreview && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={undo}
                  disabled={!canUndo}
                  title="Undo (Ctrl+Z)"
                  aria-label="Undo"
                  className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-secondary text-foreground/80 hover:bg-secondary/70 disabled:opacity-40 disabled:pointer-events-none transition-all flex items-center justify-center"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={redo}
                  disabled={!canRedo}
                  title="Redo (Ctrl+Shift+Z)"
                  aria-label="Redo"
                  className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-secondary text-foreground/80 hover:bg-secondary/70 disabled:opacity-40 disabled:pointer-events-none transition-all flex items-center justify-center"
                >
                  <Redo2 className="w-4 h-4" />
                </button>
              </div>
            )}
            {!isPreview && (
              <button
                onClick={() => setSaveOpen(true)}
                disabled={!selectedInstance}
                title={selectedInstance ? "Save the selected item as a reusable block" : "Select a page, block or component on the canvas to save it"}
                className="h-9 sm:h-10 px-3 sm:px-5 rounded-xl text-xs font-black uppercase tracking-widest border border-primary/40 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-40 disabled:pointer-events-none transition-all flex items-center gap-2"
              >
                <BookmarkPlus className="w-4 h-4" /> <span className="hidden sm:inline">Save</span>
              </button>
            )}
            {!isPreview && (
              <button
                onClick={() => setPublishOpen(true)}
                title="Save this canvas to the server and publish it to the client app"
                className="h-9 sm:h-10 px-3 sm:px-5 rounded-xl text-xs font-black uppercase tracking-widest border border-primary/40 bg-primary text-primary-foreground hover:opacity-90 transition-all flex items-center gap-2"
              >
                <Rocket className="w-4 h-4" /> <span className="hidden sm:inline">Publish</span>
              </button>
            )}
            {saveMsg && (
              <span role="status" className={`hidden md:inline-flex items-center gap-1 text-[11px] font-semibold ${saveMsg.ok ? 'text-green-600' : 'text-red-600'}`}>
                {saveMsg.ok && <Check className="w-3.5 h-3.5" />}{saveMsg.text}
              </span>
            )}
            <button
              onClick={() => setIsPreview(!isPreview)}
              className={`h-9 sm:h-10 px-3 sm:px-6 rounded-xl text-[11px] sm:text-xs font-black uppercase tracking-widest whitespace-nowrap transition-all ${isPreview ? 'bg-destructive text-destructive-foreground shadow-lg shadow-destructive/20 hover:scale-105' : 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:scale-105'}`}
            >
              {isPreview ? 'Back to Editor' : 'Enter Preview'}
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Docked palette (desktop) */}
          {!isPreview && isDesktop && <Toolbar onAdd={addComponent} onEditTemplate={editTemplate} onGenerate={handleGenerate} />}

          {/* Palette drawer (phones / very narrow windows). The drag SOURCE is
              never touched during a drag (changing a dragged element's DOM or
              pointer-events cancels the native drag in Chrome). Only the dim
              backdrop — which is not the source — stops catching pointer events
              while dragging, so the canvas to the right of the drawer is a
              valid drop target. The drawer closes when the drag ends. */}
          {!isPreview && !isDesktop && toolbarOpen && (
            <>
              <div
                className={`fixed inset-0 z-[54] bg-black/50 ${drawerDragging ? 'pointer-events-none opacity-0' : ''}`}
                onClick={() => setToolbarOpen(false)}
              />
              <div
                className={`fixed inset-y-0 left-0 z-[55] max-w-full animate-in slide-in-from-left duration-200 ${drawerDragging ? 'pointer-events-none opacity-40' : ''}`}
                onDragStart={() => { window.setTimeout(() => setDrawerDragging(true), 50) }}
                onDragEnd={() => { setDrawerDragging(false); setToolbarOpen(false) }}
              >
                <Toolbar
                  variant="drawer"
                  onDraggingChange={(d) => { setDrawerDragging(d); if (!d) setToolbarOpen(false) }}
                  onClose={() => setToolbarOpen(false)}
                  onAdd={(id) => { addComponent(id); setToolbarOpen(false) }}
                  onEditTemplate={(id) => { editTemplate(id); setToolbarOpen(false) }}
                  onGenerate={() => { handleGenerate(); setToolbarOpen(false) }}
                />
              </div>
            </>
          )}

          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            <Canvas
              instances={instances}
              selectedId={isPreview ? null : selectedId}
              onSelect={isPreview ? () => {} : (id) => { setSelectedId(id); setSettingsCollapsed(false) }}
              onDelete={deleteComponent}
              onChange={applyInstanceUpdate}
              layouts={layouts}
              onLayoutChange={onLayoutChange}
              isPreview={isPreview}
              onDropPlugin={addComponent}
            />

            {/* Configuration panel. Floats over the canvas (so opening it never
                changes the grid's width/breakpoint and never reflows the design),
                but is now sized to the viewport:
                  • < 640px  : full-width sheet
                  • ≥ 640px  : right-hand column, 300–420px wide
                It stops short of the bottom nav pill, scrolls internally, and can
                be collapsed to a small tab. */}
            {!isPreview && selectedInstance && !settingsCollapsed && (
              <div className="pointer-events-none absolute inset-x-2 top-2 bottom-16 z-50 sm:inset-x-auto sm:right-3 sm:bottom-20 sm:w-[clamp(300px,34vw,420px)]">
                <div className="animate-in fade-in slide-in-from-right-10 pointer-events-auto h-full min-h-0 flex flex-col overflow-hidden rounded-xl border border-border bg-card/95 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl duration-300">
                  <div className="flex items-center justify-between border-b border-border/40 px-3 py-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSettingsCollapsed(true)}
                      className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition hover:bg-secondary/60 hover:text-foreground focus:outline-none"
                      aria-label="Collapse configuration panel"
                      title="Collapse (keeps the selection)"
                    >
                      <PanelRightClose className="h-4 w-4" />
                      <span className="hidden sm:inline">Collapse</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/80 text-red-500 transition hover:bg-red-500/10 focus:outline-none"
                      aria-label="Close configuration panel"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <SettingsPanel
                      onRequestSave={() => setSaveOpen(true)}
                      selectedInstance={selectedInstance}
                      onUpdateConfig={updateConfig}
                      availableFields={availableFields}
                      instances={instances}
                      layoutItem={selectedLayoutItem}
                      onUpdateLayout={updateSelectedLayout}
                      layoutUnit={layoutUnit}
                    />
                  </div>
                </div>
              </div>
            )}

            {!isPreview && selectedInstance && settingsCollapsed && (
              <button
                type="button"
                onClick={() => setSettingsCollapsed(false)}
                className="absolute right-3 top-3 z-50 inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card/95 px-4 text-[10px] font-bold uppercase tracking-widest text-foreground shadow-xl backdrop-blur-md hover:bg-secondary/60"
                aria-label="Open configuration panel"
              >
                <PanelRightOpen className="h-4 w-4 text-primary" />
                Configuration
              </button>
            )}
            <SaveTemplateDialog
              instance={selectedInstance}
              open={saveOpen}
              onOpenChange={setSaveOpen}
              onSaved={(n, mode) => flashSaveMsg(true, mode === 'update' ? `Updated "${n}" in Saved Blocks` : `Saved "${n}" to Saved Blocks`)}
              onError={() => flashSaveMsg(false, 'Could not save. Try again.')}
            />
            <PublishDialog
              open={publishOpen}
              onOpenChange={setPublishOpen}
              instances={instances}
              layouts={layouts}
              slug={pageSlug}
              onSlugChange={setPageSlug}
              suggestedTitle={(pageInstance?.configs as any)?.title || (pageInstance?.configs as any)?.pageId}
              onLoad={(loadedInstances, loadedLayouts) => {
                onChange(loadedInstances)
                onLayoutChange(loadedLayouts)
                setSelectedId(null)
              }}
            />
            <JSONPreview
              open={jsonOpen}
              json={generatedJson}
              pageName={generatedPageName}
              defaultLabel={`${generatedPageName} - Interaction JSON`}
              onClose={handleCloseJson}
            />
            <JSONPreview
              open={layoutJsonOpen}
              json={generatedLayoutJson}
              pageName={generatedPageName}
              title="React Grid Layout JSON"
              defaultLabel={`${generatedPageName} - Grid Layout`}
              saveFn={saveLayoutJson}
              onClose={() => setLayoutJsonOpen(false)}
            />
          </div>
        </div>
      </div>
    </StateHubProvider>
  )
}