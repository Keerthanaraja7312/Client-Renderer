// responsiveGrid.ts
// Layouts for a Block's grid at narrower widths.
//
// The saved layout (gridX / gridY / gridW / gridH on each component) is the
// WIDE layout and is never changed by this file. For narrower blocks we build
// a fresh layout from it by stacking the components in reading order, so they
// reflow instead of being squeezed side by side.

export interface GridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  [extra: string]: unknown;
}

/** Widths are the BLOCK's own width, not the screen's. */
export const BLOCK_BREAKPOINTS = { lg: 600, sm: 360, xxs: 0 };
export const BLOCK_COLS = { lg: 12, sm: 6, xxs: 1 };

/**
 * Stack items left-to-right, top-to-bottom, in the order they appear in the
 * wide layout, into `cols` columns. An item wider than `cols` becomes full width.
 */
export function stackLayout<T extends GridItem>(items: T[], cols: number): T[] {
  const sorted = [...items].sort((a, b) => (a.y - b.y) || (a.x - b.x) || 0);
  const out: T[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const it of sorted) {
    const w = Math.max(1, Math.min(it.w, cols));
    if (x > 0 && x + w > cols) {
      y += rowH;
      x = 0;
      rowH = 0;
    }
    out.push({ ...it, x, y, w, minW: 1 });
    x += w;
    rowH = Math.max(rowH, it.h);
    if (x >= cols) {
      y += rowH;
      x = 0;
      rowH = 0;
    }
  }
  return out;
}

/** The `layouts` prop for a Responsive grid: the saved layout for wide, stacked for the rest. */
export function buildBlockLayouts<T extends GridItem>(wide: T[]) {
  return {
    lg: wide,
    sm: stackLayout(wide, BLOCK_COLS.sm),
    xxs: stackLayout(wide, BLOCK_COLS.xxs),
  };
}