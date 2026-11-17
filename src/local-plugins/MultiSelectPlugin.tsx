import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, ChevronDown, ListChecks, X } from 'lucide-react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type SelectSize = 'sm' | 'md' | 'lg';

type MultiSelectConfigs = {
  label: string;
  placeholder: string;
  options: string; // "Red|red, Green|green, Blue" (Label|value, value optional)
  defaultSelected: string; // comma separated values
  searchable: boolean;
  showSelectAll: boolean;
  maxSelections: string; // 0 = no limit
  maxVisibleChips: string; // 0 = show all
  required: boolean;
  disabled: boolean;
  helpText: string;
  size: SelectSize;
  inlineList: boolean; // show the list in the page flow instead of floating over it
  closeOnSelect: boolean; // close the list after every pick
  optionLabelField: string; // optional: build options from connected data
  optionValueField: string;
};

type MultiSelectSchema = {
  selected: string;
};

type Option = { label: string; value: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const SIZES: Record<SelectSize, { minHeight: number; fontSize: number }> = {
  sm: { minHeight: 34, fontSize: 13 },
  md: { minHeight: 42, fontSize: 14 },
  lg: { minHeight: 50, fontSize: 16 },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// "Red|red, Green|green, Blue" → [{label, value}, ...]
function parseOptions(raw: string): Option[] {
  const seen = new Set<string>();
  const options: Option[] = [];
  (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const pipe = part.indexOf('|');
      const label = (pipe === -1 ? part : part.slice(0, pipe)).trim();
      const value = (pipe === -1 ? label : part.slice(pipe + 1).trim()) || label;
      if (label && !seen.has(value)) {
        seen.add(value);
        options.push({ label, value });
      }
    });
  return options;
}

// Unique options built from connected rows.
function optionsFromRows(
  rows: Record<string, unknown>[],
  labelField: string,
  valueField: string,
): Option[] {
  const seen = new Set<string>();
  const options: Option[] = [];
  for (const row of rows) {
    const label = String(row[labelField] ?? '').trim();
    const value = valueField ? String(row[valueField] ?? '').trim() : label;
    if (label && value && !seen.has(value)) {
      seen.add(value);
      options.push({ label, value });
    }
  }
  return options;
}

function toLimit(raw: string): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ─── Canvas Component ─────────────────────────────────────────────────────────

function MultiSelectCanvas({
  configs,
  data,
}: {
  configs: MultiSelectConfigs;
  data: Record<string, unknown>[] | null;
}) {
  const {
    label = '',
    placeholder = 'Select options',
    options: rawOptions = '',
    defaultSelected = '',
    searchable = true,
    showSelectAll = true,
    maxSelections = '0',
    maxVisibleChips = '0',
    required = false,
    disabled = false,
    helpText = '',
    size = 'md',
    inlineList = false,
    closeOnSelect = true,
    optionLabelField = '',
    optionValueField = '',
  } = configs;

  const baseId = useId();
  const listId = `${baseId}-list`;
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Connected data wins; the "Options" setting is the fallback.
  const options =
    data && data.length > 0 && optionLabelField !== ''
      ? optionsFromRows(data, optionLabelField, optionValueField)
      : parseOptions(rawOptions);

  const limit = toLimit(maxSelections);
  const visibleChips = toLimit(maxVisibleChips);

  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);

  // Start from the "Default Selected" setting, and follow it when it changes.
  useEffect(() => {
    const wanted = defaultSelected
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    const valid = options
      .filter((o) => wanted.includes(o.value) || wanted.includes(o.label))
      .map((o) => o.value);
    setSelected(limit > 0 ? valid.slice(0, limit) : valid);
  }, [defaultSelected, rawOptions, limit]);

  // Close when clicking or tapping anywhere outside. Listening in the capture
  // phase means the builder canvas cannot swallow the event first.
  useEffect(() => {
    if (!open) return;
    const onOutside = (event: Event) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
        setTouched(true);
      }
    };
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('touchstart', onOutside, true);
    return () => {
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('touchstart', onOutside, true);
    };
  }, [open]);

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle))
    : options;
  const activeIndex = Math.min(active, Math.max(filtered.length - 1, 0));

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${baseId}-opt-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex, baseId]);

  const atLimit = limit > 0 && selected.length >= limit;
  const labelOf = (value: string) => options.find((o) => o.value === value)?.label ?? value;
  const sizing = SIZES[size] ?? SIZES.md;
  const showError = required && touched && selected.length === 0;

  const toggle = (value: string) => {
    if (disabled) return;
    setSelected((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      if (limit > 0 && prev.length >= limit) return prev;
      return [...prev, value];
    });
  };

  const closeList = () => {
    setOpen(false);
    setQuery('');
    setTouched(true);
  };

  // A pick from the list (mouse or keyboard): toggle it, then close if asked to.
  const pick = (value: string) => {
    toggle(value);
    if (closeOnSelect) closeList();
  };

  const selectAllShown = () => {
    setSelected((prev) => {
      const next = [...prev];
      for (const option of filtered) {
        if (limit > 0 && next.length >= limit) break;
        if (!next.includes(option.value)) next.push(option.value);
      }
      return next;
    });
  };

  const allShownSelected =
    filtered.length > 0 && filtered.every((o) => selected.includes(o.value));

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) setOpen(true);
        else setActive((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) setOpen(true);
        else setActive((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        if (open) {
          event.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (open) {
          event.preventDefault();
          setActive(Math.max(filtered.length - 1, 0));
        }
        break;
      case 'Enter':
        event.preventDefault();
        if (open && filtered[activeIndex]) pick(filtered[activeIndex].value);
        else setOpen(true);
        break;
      case ' ':
        if (!searchable || query === '') {
          event.preventDefault();
          if (open && filtered[activeIndex]) pick(filtered[activeIndex].value);
          else setOpen(true);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          closeList();
        }
        break;
      case 'Backspace':
        if (query === '' && selected.length > 0) setSelected((prev) => prev.slice(0, -1));
        break;
      case 'Tab':
        closeList();
        break;
      default:
        break;
    }
  };

  // Chips (with "+N more" when a limit is set)
  const chipValues = visibleChips > 0 ? selected.slice(0, visibleChips) : selected;
  const hiddenCount = selected.length - chipValues.length;

  const list = open && (
    <div
      className="rounded-md border border-border bg-background shadow-lg"
      style={
        inlineList
          ? { marginTop: 6 }
          : { position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 6, zIndex: 30 }
      }
    >
      {(showSelectAll || selected.length > 0) && options.length > 0 && (
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs">
          {showSelectAll ? (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={allShownSelected ? () => setSelected((p) => p.filter((v) => !filtered.some((o) => o.value === v))) : selectAllShown}
              className="text-primary hover:underline"
            >
              {allShownSelected ? 'Deselect all' : 'Select all'}
              {needle ? ' shown' : ''}
            </button>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            {selected.length}
            {limit > 0 ? ` / ${limit}` : ''} selected
          </span>
        </div>
      )}

      <ul
        id={listId}
        role="listbox"
        aria-multiselectable="true"
        aria-label={label || 'Options'}
        className="m-0 list-none p-1"
        style={{ maxHeight: 240, overflowY: 'auto' }}
      >
        {filtered.length === 0 && (
          <li className="px-3 py-2 text-sm italic text-muted-foreground">
            {options.length === 0 ? 'Add options in Settings' : 'No matches'}
          </li>
        )}

        {filtered.map((option, index) => {
          const isSelected = selected.includes(option.value);
          const blocked = atLimit && !isSelected;
          return (
            <li
              key={option.value}
              id={`${baseId}-opt-${index}`}
              role="option"
              aria-selected={isSelected}
              aria-disabled={blocked}
              onMouseDown={(e) => e.preventDefault()} // keep focus in the input
              onMouseEnter={() => setActive(index)}
              onClick={() => !blocked && pick(option.value)}
              className={`flex items-center gap-2 rounded px-2 py-2 text-sm ${
                index === activeIndex ? 'bg-muted' : ''
              } ${blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            >
              <span
                aria-hidden="true"
                className={`flex shrink-0 items-center justify-center rounded border ${
                  isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                }`}
                style={{ width: 16, height: 16 }}
              >
                {isSelected && <Check size={12} strokeWidth={3} />}
              </span>
              <span className="min-w-0 truncate text-foreground">{option.label}</span>
            </li>
          );
        })}
      </ul>

      {atLimit && (
        <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          Maximum of {limit} selected
        </p>
      )}
    </div>
  );

  return (
    <div ref={containerRef} className="w-full" style={{ position: 'relative', minWidth: 200 }}>
      {label && (
        <label
          htmlFor={`${baseId}-input`}
          className="mb-1.5 block text-sm font-medium text-foreground"
        >
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}

      <div
        onClick={openList}
        className={`flex w-full flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 ${
          showError ? 'border-red-500' : 'border-border'
        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-text'}`}
        style={{ minHeight: sizing.minHeight, fontSize: sizing.fontSize }}
      >
        {chipValues.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-foreground"
            style={{ fontSize: sizing.fontSize - 1 }}
          >
            {labelOf(value)}
            <button
              type="button"
              aria-label={`Remove ${labelOf(value)}`}
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                toggle(value);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X size={12} />
            </button>
          </span>
        ))}

        {hiddenCount > 0 && (
          <span
            className="rounded-full border border-border px-2 py-0.5 text-muted-foreground"
            style={{ fontSize: sizing.fontSize - 1 }}
          >
            +{hiddenCount} more
          </span>
        )}

        <input
          id={`${baseId}-input`}
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete={searchable ? 'list' : 'none'}
          aria-activedescendant={open && filtered.length > 0 ? `${baseId}-opt-${activeIndex}` : undefined}
          value={query}
          readOnly={!searchable}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            if (!open) setOpen(true);
          }}
          onFocus={() => !disabled && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={selected.length === 0 ? placeholder : ''}
          className="min-w-0 flex-1 bg-transparent px-1 text-foreground outline-none placeholder:text-muted-foreground"
          style={{ minWidth: 80, cursor: searchable ? 'text' : 'pointer' }}
        />

        {selected.length > 0 && !disabled && (
          <button
            type="button"
            aria-label="Clear all"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              setSelected([]);
            }}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="text-muted-foreground"
          style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }}
        />
      </div>

      {list}

      {showError && (
        <p role="alert" className="mt-1 text-xs text-red-500">
          Select at least one option.
        </p>
      )}
      {helpText && !showError && <p className="mt-1.5 text-xs text-muted-foreground">{helpText}</p>}
    </div>
  );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const MultiSelectPlugin: ViewBuilderPlugin<MultiSelectConfigs, MultiSelectSchema> = {
  id: 'multi-select',
  pluginType: 'form',

  toolbar: {
    name: 'Multi Select',
    element: <ListChecks className="h-5 w-5" />,
    toolTip: 'Add a multi select dropdown',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<MultiSelectConfigs, MultiSelectSchema> {...props}>
        {({ data, configs }) => <MultiSelectCanvas configs={configs} data={data} />}
      </BasePluginView>
    ),
  },

  settings: [
    { field_id: 'label', label: 'Label', type: 'text', defaultValue: 'Skills' },
    { field_id: 'placeholder', label: 'Placeholder', type: 'text', defaultValue: 'Select options' },
    {
      field_id: 'options',
      label: 'Options (comma separated, Label|value)',
      type: 'text',
      defaultValue: 'React, TypeScript, Node.js, Python, SQL, Docker, AWS',
    },
    {
      field_id: 'defaultSelected',
      label: 'Default Selected (comma separated)',
      type: 'text',
      defaultValue: '',
    },
    { field_id: 'searchable', label: 'Searchable', type: 'checkbox', defaultValue: true },
    { field_id: 'showSelectAll', label: 'Show Select All', type: 'checkbox', defaultValue: true },
    { field_id: 'maxSelections', label: 'Max Selections (0 = no limit)', type: 'text', defaultValue: '0' },
    {
      field_id: 'maxVisibleChips',
      label: 'Max Chips Shown (0 = all)',
      type: 'text',
      defaultValue: '0',
    },
    { field_id: 'required', label: 'Required', type: 'checkbox', defaultValue: false },
    { field_id: 'disabled', label: 'Disabled', type: 'checkbox', defaultValue: false },
    { field_id: 'helpText', label: 'Help Text', type: 'text', defaultValue: '' },
    {
      field_id: 'size',
      label: 'Size',
      type: 'select',
      defaultValue: 'md',
      enum: ['sm', 'md', 'lg'],
    },
    {
      field_id: 'inlineList',
      label: 'Show List Inline (use if the dropdown gets cut off)',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      field_id: 'closeOnSelect',
      label: 'Close List After Each Selection',
      type: 'checkbox',
      defaultValue: true,
    },
    {
      field_id: 'optionLabelField',
      label: 'Options From Data: Label Field',
      type: 'text',
      defaultValue: '',
    },
    {
      field_id: 'optionValueField',
      label: 'Options From Data: Value Field (optional)',
      type: 'text',
      defaultValue: '',
    },
  ],

  componentDataSchema: {
    selected: '',
  },

  componentDataMetadata: {
    selected: { type: 'string', label: 'Selected Values' },
  },
};