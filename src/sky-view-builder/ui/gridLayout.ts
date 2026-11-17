export interface GridLayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
}

type GridSize = Pick<GridLayoutItem, "w" | "h" | "minW" | "minH">

// The canvas uses 12 columns and 100px rows. These sizes give each component
// enough room for its normal content as soon as it is dropped, rather than
// starting every item as the grid library's 1x1 fallback.
const DEFAULT_SIZES: Record<string, GridSize> = {
  "page-plugin": { w: 12, h: 6, minW: 6, minH: 3 },
  "block-plugin": { w: 6, h: 3, minW: 3, minH: 2 },
  sidebar: { w: 3, h: 6, minW: 1, minH: 3 },
  "data-table": { w: 12, h: 4, minW: 6, minH: 3 },
  "cards-table": { w: 12, h: 4, minW: 6, minH: 3 },
  "recent-candidates-plugin": { w: 12, h: 4, minW: 6, minH: 3 },
  "info-cards": { w: 12, h: 2, minW: 6, minH: 2 },
  "auto-test-plugin": { w: 6, h: 2, minW: 3, minH: 1 },
  label: { w: 3, h: 1, minW: 2, minH: 1 },
  "search-button": { w: 2, h: 1, minW: 2, minH: 1 },
}

const FORM_CONTROL_SIZE: GridSize = { w: 4, h: 1, minW: 2, minH: 1 }

export function getDefaultGridSize(pluginId: string): GridSize {
  return DEFAULT_SIZES[pluginId] ?? FORM_CONTROL_SIZE
}

export function getLayouts(layouts: unknown): Record<string, GridLayoutItem[]> {
  if (Array.isArray(layouts)) return { lg: layouts as GridLayoutItem[] }
  if (layouts && typeof layouts === "object") {
    return layouts as Record<string, GridLayoutItem[]>
  }
  return { lg: [] }
}

export function createDefaultLayoutItem(
  id: string,
  pluginId: string,
  existingItems: GridLayoutItem[]
): GridLayoutItem {
  const size = getDefaultGridSize(pluginId)
  return {
    i: id,
    x: 0,
    // React Grid Layout's vertical compaction will place this in the first
    // available aligned position, including partially filled rows.
    y: existingItems.reduce((bottom, item) => Math.max(bottom, item.y + item.h), 0),
    ...size,
  }
}


const BREAKPOINT_COLS: Record<string, number> = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }

/**
 * Makes sure EVERY breakpoint has a layout item for EVERY instance.
 *
 * react-grid-layout only auto-generates a layout for a breakpoint when that
 * breakpoint has no entry at all. If e.g. `md` already exists (from an earlier
 * drag/resize) but a newly dropped Page was only added to `lg`, RGL falls back
 * to its 1x1 default for that item — which is why a freshly dropped Page
 * appeared tiny. Here missing items are copied from `lg` (or the plugin's
 * default size) and clamped to the breakpoint's column count.
 */
export function ensureLayoutsForInstances(
  layouts: unknown,
  instances: { id: string; pluginId: string }[]
): Record<string, GridLayoutItem[]> {
  const base = getLayouts(layouts)
  const lg = base.lg ?? []
  const result: Record<string, GridLayoutItem[]> = { ...base }

  for (const [bp, cols] of Object.entries(BREAKPOINT_COLS)) {
    const current = base[bp] ?? (bp === "lg" ? lg : undefined)
    // No entry for this breakpoint: let RGL derive it from the larger one.
    if (!current) continue
    const have = new Set(current.map((item) => item.i))
    const additions: GridLayoutItem[] = []
    for (const inst of instances) {
      if (have.has(inst.id)) continue
      const fromLg = lg.find((item) => item.i === inst.id)
      const size = getDefaultGridSize(inst.pluginId)
      const w = Math.min(fromLg?.w ?? size.w, cols)
      additions.push({
        ...size,
        i: inst.id,
        x: 0,
        y: [...current, ...additions].reduce((b, it) => Math.max(b, it.y + it.h), 0),
        w,
        h: fromLg?.h ?? size.h,
        minW: Math.min(size.minW ?? 1, w),
      })
    }
    if (additions.length) result[bp] = [...current, ...additions]
  }
  return result
}