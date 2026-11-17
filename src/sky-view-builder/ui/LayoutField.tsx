// ui/LayoutField.tsx
//
// A single editable Width/Height/X/Y number field, shared by the Layout
// section wherever it's rendered (currently inside Visual Style > Layout).
// Keeps its own text while typing so "12" doesn't collapse to "1" mid-edit,
// but always shows the live canvas value once the field is blurred/idle.

import React from 'react';

export const LayoutField: React.FC<{
  label: string;
  value: number | undefined;
  min?: number;
  onCommit: (val: number) => void;
}> = ({ label, value, min = 1, onCommit }) => {
  const [draft, setDraft] = React.useState(value != null ? String(value) : '');

  React.useEffect(() => {
    setDraft(value != null ? String(value) : '');
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isNaN(parsed)) {
      onCommit(Math.max(min, Math.round(parsed)));
    } else {
      setDraft(value != null ? String(value) : '');
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-tight">{label}</label>
      <input
        type="number"
        min={min}
        className="w-full bg-secondary border border-border rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none transition-all"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
};