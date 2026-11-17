// ui/layoutUtils.ts
//
// `layouts` (as used by <Canvas />) can be either:
//   - a flat array of react-grid-layout items: [{ i, x, y, w, h }, ...]
//   - a breakpoint map: { lg: [...], md: [...], sm: [...] }
//
// These helpers read/patch a single instance's grid item (by id) without
// caring which shape is currently in use, and always return the SAME shape
// that was passed in so callers can hand the result straight back to
// whatever `onLayoutChange` expects.

export interface GridLayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
  maxW?: number
  maxH?: number
  [key: string]: any
}

/** Finds the layout item for a given instance id. Checks "lg" first (the
 *  breakpoint the canvas is normally edited in), then falls back to
 *  whichever breakpoint has it. Returns null if the item hasn't been
 *  placed on the grid yet. */
export function getLayoutItem(layouts: any, id: string): GridLayoutItem | null {
  if (!layouts || !id) return null

  if (Array.isArray(layouts)) {
    return layouts.find((it: GridLayoutItem) => it?.i === id) || null
  }

  const breakpoints = Object.keys(layouts)
  const ordered = ["lg", ...breakpoints.filter((bp) => bp !== "lg")]
  for (const bp of ordered) {
    const item = (layouts[bp] || []).find((it: GridLayoutItem) => it?.i === id)
    if (item) return item
  }
  return null
}

/** Returns a NEW `layouts` value (same shape as the input) with the given
 *  instance's grid item patched wherever it appears. Use this to push
 *  edits made in the Settings panel back into the canvas's layout state. */
export function updateLayoutItem(
  layouts: any,
  id: string,
  partial: Partial<Pick<GridLayoutItem, "x" | "y" | "w" | "h">>
): any {
  if (!layouts || !id) return layouts

  const patch = (items: GridLayoutItem[]) =>
    (items || []).map((it) => (it?.i === id ? { ...it, ...partial } : it))

  if (Array.isArray(layouts)) {
    return patch(layouts)
  }

  const next: Record<string, GridLayoutItem[]> = {}
  for (const bp of Object.keys(layouts)) {
    next[bp] = patch(layouts[bp])
  }
  return next
}