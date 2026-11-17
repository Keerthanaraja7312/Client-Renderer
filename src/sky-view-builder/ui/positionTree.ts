// positionTree.ts
//
// Builds ONE JSON that captures everything about the current view:
//   - Position: Page (grid units) and every nested Block/Component (px,
//     correctly converted whether the parent Block uses freeform x/y or
//     auto-layout gridX/gridY — see gridUnitsToPx below).
//   - Structure: the full Page -> Block -> Component tree, via "children".
//   - Live config data: each item's "props" (sanitized configs — e.g. a
//     dropdown's Value Field setting, a table's title), "query",
//     "dataSourceId", "componentType".
//   - Live RUNTIME state: pulled directly from the StateHub singleton (NOT
//     from inst.state — see note below), e.g. a dropdown's currently
//     selected value, a search button's loading flag.
//
// STATE SOURCE — IMPORTANT:
// useComponentState()'s setState() (see hooks/useComponentState.ts) writes
// to StateHub's own internal Map via hub.set(...) — it never touches
// ComponentInstance.state at all. So `inst.state` is always empty for any
// component using this hook (which is effectively all interactive
// plugins). The actual live values live in the `stateHub` singleton,
// addressed by path convention:
//   component-scoped: global.components.{componentId}.{key}
//   block-scoped:      global.blocks.{blockKey}.{key}          (blockKey = configs.blockId || 'block', NOT the instance id — see useBlockState in BlockCanvas.tsx)
// This file reads those paths directly via stateHub.getSubtree(prefix),
// since stateHub is a plain singleton (not a hook) and is safe to import
// and call from a non-component function like this one.

import { type ComponentInstance } from "../index"
import { ensureLayoutsForInstances } from "./gridLayout"
import { stateHub } from "../../store/StateHub"
import { collectSidebarNavs, isTemplateLink, PAGE_PLUGIN_ID } from "../core/navigation"
import { getTemplate } from "../core/templateStore"

// ─── Constants: MUST mirror what the live renderers use ─────────────────────
// Page level   -> Canvas.tsx            (react-grid-layout Responsive)
// Block level  -> blockplugin.tsx       (react-grid-layout, auto-layout mode)
export const PAGE_GRID_CONFIG = {
  breakpoints: { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 },
  cols: { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 },
  rowHeight: 100,
  margin: [5, 5] as [number, number],
  compactType: "vertical" as const,
  preventCollision: false,
}
export const BLOCK_GRID_CONFIG = {
  cols: 12,
  rowHeight: 40,
  margin: [12, 12] as [number, number],
  compactType: null,
}
const GRID_COLS = BLOCK_GRID_CONFIG.cols
const GRID_ROW_HEIGHT = BLOCK_GRID_CONFIG.rowHeight
const GRID_MARGIN = BLOCK_GRID_CONFIG.margin
const DEFAULT_CONTAINER_WIDTH = 960

const DEFAULT_COMPONENT_WIDTH = 220
const DEFAULT_COMPONENT_HEIGHT = 120
const DEFAULT_BLOCK_WIDTH = 280
const DEFAULT_BLOCK_HEIGHT = 160

// Same table as blockplugin.tsx -> getDefaultGridSize (grid units, auto-layout).
function getDefaultBlockGridSize(pluginId: string): { w: number; h: number } {
  if (['data-table', 'cards-table', 'recent-candidates-plugin', 'table-plugin', 'domain-list'].includes(pluginId)) return { w: 6, h: 7 }
  if (pluginId === 'info-cards') return { w: 12, h: 4 }
  if (pluginId === 'sidebar') return { w: 6, h: 9 }
  if (pluginId === 'search-button') return { w: 3, h: 2 }
  if (pluginId === 'label' || pluginId === 'checkbox' || pluginId === 'toggle-button') return { w: 4, h: 2 }
  if (pluginId === 'generic-dropdown') return { w: 4, h: 2 }
  return { w: 6, h: 3 }
}

// Position/size keys are exported as x/y/w/h, so they are not repeated in props/style.
const POSITION_KEYS = new Set(['x', 'y', 'width', 'height'])
// Visual keys are NOT dropped any more: a client renderer needs them to look
// identical to the builder. They are exported under "style" (not "props").
const VISUAL_CONFIG_KEYS = new Set([
  'align', 'bgColor', 'border', 'borderColor', 'borderRadius', 'className',
  'color', 'fontSize', 'fontWeight', 'italic', 'margin', 'padding',
  'shadow', 'size', 'style', 'textAlign', 'uppercase', 'variant', '_pageBgColor',
])
// computedStyle is a DOM measurement the builder writes back into configs
// (px/rgb snapshots of the live element). It is not a setting, bloats the JSON
// a lot, and can fight the client's own styling, so it is not exported.
const STRUCTURAL_KEYS = new Set(['blocks', 'components', 'gridX', 'gridY', 'gridW', 'gridH', 'computedStyle'])

export interface GridBox { x: number; y: number; w: number; h: number }

export interface PositionNode {
  id: string
  pluginId: string
  unit: "px"
  x: number
  y: number
  w: number
  h: number
  /** Only for children of an auto-layout Block: the ORIGINAL grid-unit box.
   *  Prefer this over x/y/w/h when the client renders with react-grid-layout,
   *  because px values depend on the container width at export time. */
  grid?: GridBox & { cols: number; rowHeight: number; margin: [number, number] }
  layoutMode?: 'auto' | 'freeform'   // set on Blocks: how THEIR children are laid out
  props?: Record<string, any>
  style?: Record<string, any>
  dataSourceId?: string | number | null
  componentType?: string | null
  query?: Record<string, any>
  /** Live runtime state pulled from StateHub at export time (NOT inst.state — see file header). */
  state?: Record<string, any>
  children: PositionNode[]
}

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

function sanitizeProps(configs: Record<string, any> = {}): Record<string, any> {
  const cleaned = Object.fromEntries(
    Object.entries(configs).filter(
      ([key]) => !VISUAL_CONFIG_KEYS.has(key) && !STRUCTURAL_KEYS.has(key) && !POSITION_KEYS.has(key)
    )
  )
  return removeEmptyValues(cleaned)
}

function extractStyle(configs: Record<string, any> = {}): Record<string, any> {
  return removeEmptyValues(
    Object.fromEntries(Object.entries(configs).filter(([key]) => VISUAL_CONFIG_KEYS.has(key)))
  )
}

function getComponentHubState(componentId: string): Record<string, unknown> {
  return stateHub.getSubtree(`global.components.${componentId}`)
}

function getBlockHubState(blockKey: string): Record<string, unknown> {
  return stateHub.getSubtree(`global.blocks.${blockKey}`)
}

function withData(
  base: Omit<PositionNode, 'props' | 'style' | 'query' | 'dataSourceId' | 'componentType' | 'state'>,
  inst: ComponentInstance,
  configs: Record<string, any>,
  hubState: Record<string, unknown>
): PositionNode {
  const node: PositionNode = { ...base }
  const props = sanitizeProps(configs)
  if (Object.keys(props).length > 0) node.props = props
  const style = extractStyle(configs)
  if (Object.keys(style).length > 0) node.style = style
  if (inst.query && Object.keys(inst.query).length > 0) node.query = inst.query
  if (inst.dataSourceId != null) node.dataSourceId = inst.dataSourceId
  if (inst.type != null) node.componentType = inst.type
  if (hubState && Object.keys(hubState).length > 0) node.state = hubState
  return node
}

// Same maths react-grid-layout uses (containerPadding defaults to margin).
function gridUnitsToPx(gridItem: GridBox, containerWidth: number) {
  const colWidth = (containerWidth - GRID_MARGIN[0] * (GRID_COLS + 1)) / GRID_COLS
  return {
    x: Math.round(colWidth * gridItem.x + (gridItem.x + 1) * GRID_MARGIN[0]),
    y: Math.round(GRID_ROW_HEIGHT * gridItem.y + (gridItem.y + 1) * GRID_MARGIN[1]),
    w: Math.round(colWidth * gridItem.w + Math.max(0, gridItem.w - 1) * GRID_MARGIN[0]),
    h: Math.round(GRID_ROW_HEIGHT * gridItem.h + Math.max(0, gridItem.h - 1) * GRID_MARGIN[1]),
  }
}

// Resolves each auto-layout component's grid box exactly as blockplugin.tsx
// does: saved gridX/Y/W/H, else plugin default size; a missing gridY means
// "auto-place at the bottom" (the renderer uses Infinity there).
function resolveAutoGridBoxes(components: ComponentInstance[]): GridBox[] {
  const boxes: (Partial<GridBox> & { w: number; h: number })[] = components.map((comp, i) => {
    const c = (comp.configs ?? {}) as Record<string, any>
    const def = getDefaultBlockGridSize(comp.pluginId)
    return {
      x: typeof c.gridX === 'number' ? c.gridX : (i * def.w) % GRID_COLS,
      y: typeof c.gridY === 'number' ? c.gridY : undefined,
      w: typeof c.gridW === 'number' ? c.gridW : def.w,
      h: typeof c.gridH === 'number' ? c.gridH : def.h,
    }
  })
  let bottom = boxes.reduce((b, it) => (it.y != null ? Math.max(b, it.y + it.h) : b), 0)
  return boxes.map((b) => {
    if (b.y == null) {
      const y = bottom
      bottom += b.h
      return { x: b.x ?? 0, y, w: b.w, h: b.h }
    }
    return { x: b.x ?? 0, y: b.y, w: b.w, h: b.h }
  })
}

function walkBlockChildren(blockInstance: ComponentInstance): PositionNode[] {
  const blockConfigs = (blockInstance.configs ?? {}) as Record<string, any>
  const isAutoLayout = blockConfigs.layoutMode !== 'freeform'
  const containerWidth = Number(blockConfigs.width) || DEFAULT_CONTAINER_WIDTH

  const components: ComponentInstance[] = Array.isArray(blockConfigs.components) ? blockConfigs.components : []
  const nestedBlocks: ComponentInstance[] = Array.isArray(blockConfigs.blocks) ? blockConfigs.blocks : []

  const autoBoxes = isAutoLayout ? resolveAutoGridBoxes(components) : []

  const componentNodes: PositionNode[] = components.map((comp, idx) => {
    const c = (comp.configs ?? {}) as Record<string, any>
    const hubState = getComponentHubState(comp.id)

    if (isAutoLayout) {
      const gridBox = autoBoxes[idx]
      const px = gridUnitsToPx(gridBox, containerWidth)
      return withData(
        {
          id: comp.id, pluginId: comp.pluginId, unit: "px",
          x: px.x, y: px.y, w: px.w, h: px.h,
          grid: { ...gridBox, cols: GRID_COLS, rowHeight: GRID_ROW_HEIGHT, margin: GRID_MARGIN },
          children: [],
        },
        comp, c, hubState
      )
    }

    return withData(
      {
        id: comp.id,
        pluginId: comp.pluginId,
        unit: "px",
        x: Number(c.x) || 0,
        y: Number(c.y) || 0,
        w: Number(c.width) || DEFAULT_COMPONENT_WIDTH,
        h: Number(c.height) || DEFAULT_COMPONENT_HEIGHT,
        children: [],
      },
      comp, c, hubState
    )
  })

  // Nested blocks are ALWAYS freeform-positioned (x/y/width/height), even
  // when the parent Block's components use the auto grid — see
  // blockplugin.tsx addComponent(). They must never be "stacked" here.
  const nestedBlockNodes: PositionNode[] = nestedBlocks.map((nb) => {
    const nbConfigs = (nb.configs ?? {}) as Record<string, any>
    const blockKey = nbConfigs.blockId || 'block'
    return withData(
      {
        id: nb.id,
        pluginId: nb.pluginId,
        unit: "px",
        x: Number(nbConfigs.x) || 0,
        y: Number(nbConfigs.y) || 0,
        w: Number(nbConfigs.width) || DEFAULT_BLOCK_WIDTH,
        h: Number(nbConfigs.height) || DEFAULT_BLOCK_HEIGHT,
        layoutMode: nbConfigs.layoutMode === 'freeform' ? 'freeform' : 'auto',
        children: walkBlockChildren(nb),
      },
      nb, nbConfigs, getBlockHubState(blockKey)
    )
  })

  return [...nestedBlockNodes, ...componentNodes]
}

const ROOT_HOST = '__root__'

/** Everything the client needs to render one Page-like instance: its own
 *  props/style/query/state plus the px-positioned Block/Component tree. */
function buildPageData(inst: ComponentInstance): Record<string, any> {
  const configs = (inst.configs ?? {}) as Record<string, any>
  const pageBlocks: ComponentInstance[] = Array.isArray(configs.blocks) ? configs.blocks : []
  const children: PositionNode[] = pageBlocks.map((block) => {
    const bConfigs = (block.configs ?? {}) as Record<string, any>
    return withData(
      {
        id: block.id,
        pluginId: block.pluginId,
        unit: "px",
        x: Number(bConfigs.x) || 0,
        y: Number(bConfigs.y) || 0,
        w: Number(bConfigs.width) || DEFAULT_BLOCK_WIDTH,
        h: Number(bConfigs.height) || DEFAULT_BLOCK_HEIGHT,
        layoutMode: bConfigs.layoutMode === 'freeform' ? 'freeform' : 'auto',
        children: walkBlockChildren(block),
      },
      block, bConfigs, getBlockHubState(bConfigs.blockId || 'block')
    )
  })

  const pageHubState = getComponentHubState(inst.id)
  const itemData = removeEmptyValues({
    pluginId: inst.pluginId,
    props: sanitizeProps(configs),
    style: extractStyle(configs),
    query: inst.query && Object.keys(inst.query).length > 0 ? inst.query : undefined,
    dataSourceId: inst.dataSourceId ?? undefined,
    componentType: inst.type ?? undefined,
    state: Object.keys(pageHubState).length > 0 ? pageHubState : undefined,
  })
  return { ...itemData, children }
}

/** hostId -> { "tpl:10": <page node>, ... } for every saved page a sidebar links to. */
function collectLinkedTemplatePages(instances: ComponentInstance[]): Map<string, Record<string, any>> {
  const out = new Map<string, Record<string, any>>()
  for (const nav of collectSidebarNavs(instances)) {
    const hostKey = nav.hostId === nav.sidebarId ? ROOT_HOST : nav.hostId
    for (const link of nav.pageIds) {
      if (!isTemplateLink(link)) continue
      const tpl = getTemplate(link.slice('tpl:'.length))
      if (!tpl) {
        console.warn(`[export] saved page "${link}" is not loaded - it will be missing from the JSON`)
        continue
      }
      const bucket = out.get(hostKey) ?? {}
      bucket[link] = {
        id: link,
        templateId: tpl.id,
        name: tpl.name,
        ...buildPageData(tpl.instance),
      }
      out.set(hostKey, bucket)
    }
  }
  return out
}

export function getLayoutsWithPositions(
  layouts: unknown,
  instances: ComponentInstance[]
): Record<string, any[]> {
  // Same normalisation the Canvas applies, so EVERY breakpoint has an item
  // for EVERY instance. Without it, md/sm/xs/xxs could be missing items and
  // the client would render them 1x1 (the "tiny Page" bug).
  const layoutsByBreakpoint = ensureLayoutsForInstances(
    layouts,
    instances.map((i) => ({ id: i.id, pluginId: i.pluginId }))
  )
  const instanceById = new Map(instances.map((inst) => [inst.id, inst]))

  // Build the nested tree ONCE per instance (not once per breakpoint).
  const dataById = new Map<string, Record<string, any>>()
  for (const inst of instances) dataById.set(inst.id, buildPageData(inst))

  // Sidebar menu items can link to SAVED page templates ("tpl:<id>"). Those
  // pages live in the backend, not in `instances`, so without embedding them
  // the client reports: Page "tpl:10" is not in the JSON. Embed each linked
  // template under props.pages of the Page that hosts the sidebar.
  const pagesByHost = collectLinkedTemplatePages(instances)
  for (const [hostId, pages] of pagesByHost) {
    const data = dataById.get(hostId)
    if (!data) continue
    data.props = { ...(data.props ?? {}), pages: { ...(data.props?.pages ?? {}), ...pages } }
  }
  // A sidebar sitting directly on the root canvas has no host Page: give the
  // pages to every top-level Page so the client can always find them.
  const rootPages = pagesByHost.get(ROOT_HOST)
  if (rootPages) {
    for (const inst of instances) {
      if (inst.pluginId !== PAGE_PLUGIN_ID) continue
      const data = dataById.get(inst.id)!
      data.props = { ...(data.props ?? {}), pages: { ...(data.props?.pages ?? {}), ...rootPages } }
    }
  }

  const result: Record<string, any[]> = {}
  for (const bp of Object.keys(layoutsByBreakpoint)) {
    // Drop layout items whose instance no longer exists (stale ids).
    result[bp] = layoutsByBreakpoint[bp]
      .filter((item) => instanceById.has(item.i))
      .map((item) => ({
        ...item,
        // Page-level grid is in GRID UNITS; this tells the client how to render it.
        gridConfig: {
          cols: (PAGE_GRID_CONFIG.cols as Record<string, number>)[bp] ?? PAGE_GRID_CONFIG.cols.lg,
          rowHeight: PAGE_GRID_CONFIG.rowHeight,
          margin: PAGE_GRID_CONFIG.margin,
          compactType: PAGE_GRID_CONFIG.compactType,
          preventCollision: PAGE_GRID_CONFIG.preventCollision,
          breakpoint: bp,
          minWidth: (PAGE_GRID_CONFIG.breakpoints as Record<string, number>)[bp],
        },
        ...dataById.get(item.i),
      }))
  }
  return result
}