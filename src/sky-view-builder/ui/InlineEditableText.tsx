import React, { useEffect, useRef, useState } from 'react';

interface InlineEditableTextProps {
  /** Current saved value (may be empty). */
  value: string;
  /** What to show when `value` is empty (e.g. "Page", "Block", the plugin name). */
  placeholder: string;
  /** Called with the trimmed new value when the edit is committed (Enter / blur). */
  onCommit: (next: string) => void;
  /** Classes for the label in its normal (display) state. */
  className?: string;
  /** Classes for the input while editing. */
  inputClassName?: string;
  /** Turn editing off (e.g. in preview mode) — renders the plain label. */
  disabled?: boolean;
  /** Tooltip on the label. */
  title?: string;
  /** Reports edit start / end so a parent can keep itself visible while editing. */
  onEditingChange?: (editing: boolean) => void;
}

/**
 * A label you rename in place: click it to edit, Enter or clicking anywhere
 * outside to save, Escape to cancel. Clearing the field and saving resets it to the
 * placeholder (stores an empty value).
 *
 * Every pointer / key event inside the input stops propagating, so editing never
 * selects, drags or collapses the Page / Block / component that contains it.
 */
export function InlineEditableText({
  value, placeholder, onCommit, className = '', inputClassName = '',
  disabled = false, title, onEditingChange,
}: InlineEditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { onEditingChange?.(editing); }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Close on any press outside the input. Blur alone isn't enough: the canvas'
  // drag / move handlers can swallow the mousedown's default action, so the
  // input would keep focus and stay open. Capture phase sees it first.
  const commitRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!editing) return;
    const onOutside = (e: Event) => {
      if (inputRef.current && e.target instanceof Node && inputRef.current.contains(e.target)) return;
      commitRef.current();
    };
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('touchstart', onOutside, true);
    return () => {
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('touchstart', onOutside, true);
    };
  }, [editing]);

  if (disabled) return <span className={className}>{value || placeholder}</span>;

  const start = () => { setDraft(value); setEditing(true); };
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== (value ?? '').trim()) onCommit(next);
  };
  const cancel = () => { setEditing(false); setDraft(value); };
  commitRef.current = () => { if (editing) commit(); };

  if (!editing) {
    return (
      <span
        className={`${className} cursor-text`}
        title={title ?? 'Click to rename'}
        // Single click renames (and doesn't also collapse / select the parent).
        onClick={(e) => { e.stopPropagation(); start(); }}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
      >
        {value || placeholder}
      </span>
    );
  }

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <input
      ref={inputRef}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation(); // Space / Enter must not toggle the header's collapse
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      }}
      onClick={stop}
      onDoubleClick={stop}
      onMouseDown={stop}
      onMouseUp={stop}
      onPointerDown={stop}
      onTouchStart={stop}
      onDragStart={(e) => e.preventDefault()}
      className={`min-w-0 flex-1 rounded border border-primary/50 bg-background px-1.5 py-0.5 text-foreground outline-none focus:ring-1 focus:ring-primary ${inputClassName}`}
    />
  );
}