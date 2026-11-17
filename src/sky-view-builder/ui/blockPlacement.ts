// blockPlacement.ts
// Pure helpers for placing components inside a Block's grid and for working
// out how big the Block must be to hold them. No React, no DOM.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Find a spot for `want` that does not overlap anything in `taken`.
 *  1. the wanted spot, if it is free;
 *  2. the nearest free column on the same rows;
 *  3. the same, but narrower (down to `minW`) so it fits the gap beside a neighbour;
 *  4. otherwise directly below everything.
 * Nothing is ever pushed or overlapped.
 */
export function findFreeSpot(taken: Rect[], want: Rect, cols: number, minW = 1): Rect {
  const free = (r: Rect) => !taken.some((t) => overlaps(r, t));
  if (free(want)) return want;

  const lowest = Math.max(1, Math.min(minW, want.w));
  for (let w = want.w; w >= lowest; w--) {
    for (let d = 0; d <= cols; d++) {
      for (const x of d === 0 ? [want.x] : [want.x + d, want.x - d]) {
        if (x < 0 || x + w > cols) continue;
        const r = { ...want, x, w };
        if (free(r)) return r;
      }
    }
  }

  const bottom = taken.reduce((m, t) => Math.max(m, t.y + t.h), 0);
  return { ...want, x: Math.max(0, Math.min(want.x, cols - want.w)), y: bottom };
}

/**
 * Size of the grid area needed to show every rect, and a component's own
 * minimum width: height = rows used, width = widest minimum + the grid's side margins.
 */
export function requiredGridAreaSize(
  rects: Rect[],
  minPxWidths: number[],
  rowHeight: number,
  margin: [number, number]
): { width: number; height: number } {
  const bottom = rects.reduce((m, r) => Math.max(m, r.y + r.h), 0);
  const height = bottom > 0 ? bottom * (rowHeight + margin[1]) + margin[1] : 0;
  const widest = minPxWidths.reduce((m, w) => Math.max(m, w), 0);
  const width = widest > 0 ? widest + margin[0] * 2 : 0;
  return { width, height };
}

/**
 * Close vertical gaps: every rect moves straight up until it touches the one
 * above it (or the top). Columns and sizes never change, nothing overlaps.
 * Returns new y values keyed by index.
 */
export function compactUp(rects: Rect[]): number[] {
  const order = rects.map((_, i) => i).sort((a, b) => rects[a].y - rects[b].y || rects[a].x - rects[b].x);
  const placed: Rect[] = [];
  const ys: number[] = rects.map((r) => r.y);
  for (const i of order) {
    const r = { ...rects[i] };
    while (r.y > 0 && !placed.some((p) => overlaps({ ...r, y: r.y - 1 }, p))) r.y -= 1;
    ys[i] = r.y;
    placed.push(r);
  }
  return ys;
}