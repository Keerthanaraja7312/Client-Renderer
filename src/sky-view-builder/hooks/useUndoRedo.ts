import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Undo / redo for the View Builder.
 *
 * The builder is a controlled component (the parent owns `instances` and
 * `layouts`), so history is tracked by watching those two values: whenever
 * they change, the previous state is pushed onto the undo stack. Undo / redo
 * hand a stored snapshot back through `restore`, which writes it into the
 * parent's state.
 *
 * Changes that arrive in a quick burst (dragging, resizing, typing, a slider)
 * are merged into ONE history step, so a single Ctrl+Z reverts the whole
 * gesture instead of one pixel of it.
 */
export interface BuilderSnapshot {
  instances: any;
  layouts: any;
}

interface Options {
  /** Max undo steps kept in memory. */
  limit?: number;
  /** Changes closer together than this (ms) count as one step. */
  burstMs?: number;
  /** Turn history capture + shortcuts off (e.g. in preview mode). */
  enabled?: boolean;
}

/** After undo/redo, ignore the echo of our own restore for at most this long. */
const RESTORE_GRACE_MS = 500;

/** Compares by CONTENT, not identity. The grid re-emits normalised copies of an
 *  unchanged layout (extra flags like `moved`/`static`, new object identity);
 *  those must not count as edits or they wipe the redo stack. */
const layoutKey = (layouts: any) =>
  JSON.stringify(layouts, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) && 'i' in v && 'x' in v
      ? { i: v.i, x: v.x, y: v.y, w: v.w, h: v.h }
      : v,
  );

const sameContent = (a: BuilderSnapshot, b: BuilderSnapshot) => {
  if (a.instances !== b.instances && JSON.stringify(a.instances) !== JSON.stringify(b.instances)) return false;
  if (a.layouts !== b.layouts && layoutKey(a.layouts) !== layoutKey(b.layouts)) return false;
  return true;
};

const isTypingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
};

export function useUndoRedo(
  current: BuilderSnapshot,
  restore: (snapshot: BuilderSnapshot) => void,
  { limit = 100, burstMs = 500, enabled = true }: Options = {},
) {
  const past = useRef<BuilderSnapshot[]>([]);
  const future = useRef<BuilderSnapshot[]>([]);
  const present = useRef<BuilderSnapshot>(current);
  const lastChangeAt = useRef(0);
  const restoreUntil = useRef(0);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  // Only used to re-render when canUndo / canRedo change.
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  useEffect(() => {
    // Right after an undo/redo the grid and any self-updating components
    // re-emit their own (normalised) copies of the restored state. Absorb
    // those silently: they are not user edits, so they must not push onto the
    // undo stack or clear the redo stack.
    if (Date.now() < restoreUntil.current) {
      present.current = current;
      lastChangeAt.current = 0; // the next real edit starts a fresh step
      return;
    }

    const prev = present.current;
    if (prev.instances === current.instances && prev.layouts === current.layouts) return;
    // Same content, different object identity: not an edit either.
    if (sameContent(prev, current)) {
      present.current = current;
      return;
    }

    if (enabled) {
      const now = Date.now();
      const startsNewStep = past.current.length === 0 || now - lastChangeAt.current > burstMs;
      if (startsNewStep) {
        past.current.push(prev);
        if (past.current.length > limit) past.current.shift();
      }
      lastChangeAt.current = now;
      if (future.current.length) future.current = [];
      bump();
    }
    present.current = current;
  }, [current.instances, current.layouts]); // eslint-disable-line react-hooks/exhaustive-deps

  const undo = useCallback(() => {
    const target = past.current.pop();
    if (!target) return;
    future.current.push(present.current);
    restoreUntil.current = Date.now() + RESTORE_GRACE_MS;
    present.current = target;
    restoreRef.current(target);
    bump();
  }, []);

  const redo = useCallback(() => {
    const target = future.current.pop();
    if (!target) return;
    past.current.push(present.current);
    restoreUntil.current = Date.now() + RESTORE_GRACE_MS;
    present.current = target;
    restoreRef.current(target);
    bump();
  }, []);

  // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl+Y = redo. Left alone while
  // the user is typing in a field so the browser's own text undo still works.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, undo, redo]);

  return {
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}