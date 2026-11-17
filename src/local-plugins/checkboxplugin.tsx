import { useState, useEffect, type ReactNode } from 'react';
import { AlignLeft, AlignCenter, AlignRight, AlignJustify } from 'lucide-react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type CheckboxConfigs = {
  label: string;
  helperText: string;
  defaultChecked: boolean;
  disabled: boolean;
  required: boolean;
  labelPosition: 'right' | 'left';
  /** Where the checkbox + label sit inside the component's box. */
  checkboxAlign: 'left' | 'center' | 'right' | 'spread';
};

type CheckboxSchema = {
  checked: boolean;
};

// ─── Settings controls ────────────────────────────────────────────────────────
// One-click button groups instead of a dropdown, so moving the checkbox
// left / center / right is a single click.

type SegmentOption = { value: string; label: string; icon?: ReactNode };

function SegmentedControl({
  value,
  onChange,
  options,
  fallback,
}: {
  value?: string;
  onChange: (v: string) => void;
  options: SegmentOption[];
  fallback: string;
}) {
  const current = value || fallback;
  return (
    <div role="radiogroup" className="grid gap-1 rounded-xl border border-border bg-secondary p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = current === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={`flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
              active ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
            }`}
          >
            {o.icon}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const ALIGN_OPTIONS: SegmentOption[] = [
  { value: 'left', label: 'Left', icon: <AlignLeft className="h-4 w-4" /> },
  { value: 'center', label: 'Center', icon: <AlignCenter className="h-4 w-4" /> },
  { value: 'right', label: 'Right', icon: <AlignRight className="h-4 w-4" /> },
  { value: 'spread', label: 'Spread', icon: <AlignJustify className="h-4 w-4" /> },
];

const LABEL_SIDE_OPTIONS: SegmentOption[] = [
  { value: 'right', label: 'Label right' },
  { value: 'left', label: 'Label left' },
];

const AlignmentField = ({ value, onChange }: { value?: string; onChange: (v: string) => void }) => (
  <SegmentedControl value={value} onChange={onChange} options={ALIGN_OPTIONS} fallback="left" />
);
const LabelSideField = ({ value, onChange }: { value?: string; onChange: (v: string) => void }) => (
  <SegmentedControl value={value} onChange={onChange} options={LABEL_SIDE_OPTIONS} fallback="right" />
);

// ─── Canvas Component ─────────────────────────────────────────────────────────

function CheckboxCanvas({
  configs,
  data,
}: {
  configs: CheckboxConfigs;
  data: CheckboxSchema[] | null;
}) {
  const {
    label,
    helperText,
    defaultChecked,
    disabled,
    required,
    labelPosition = 'right',
    checkboxAlign = 'left',
  } = configs;

  // 'spread' pushes the checkbox and its label to opposite edges.
  const rowJustify = {
    left: 'justify-start',
    center: 'justify-center',
    right: 'justify-end',
    spread: 'justify-between',
  }[checkboxAlign] ?? 'justify-start';
  const helperAlign = { left: 'text-left', center: 'text-center', right: 'text-right', spread: 'text-left' }[checkboxAlign] ?? 'text-left';

  const liveChecked = data ? Boolean(data?.[0]?.checked) : Boolean(defaultChecked);
  const [checked, setChecked] = useState(liveChecked);

  // Keep local state in sync when the underlying config/data changes
  // (e.g. switching between Design and Preview mode).
  useEffect(() => {
    setChecked(liveChecked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveChecked]);

  const checkboxEl = (
    <input
      type="checkbox"
      className="h-4 w-4 rounded border border-input accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
      checked={checked}
      disabled={disabled || !!data}
      onChange={(e) => setChecked(e.target.checked)}
    />
  );

  const labelEl = label && (
    <label className="text-sm font-medium text-foreground select-none">
      {label}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );

  return (
    <div className="flex flex-col gap-1 w-full">
      <div className={`flex items-center gap-2 w-full ${rowJustify}`}>
        {labelPosition === 'left' ? (
          <>
            {labelEl}
            {checkboxEl}
          </>
        ) : (
          <>
            {checkboxEl}
            {labelEl}
          </>
        )}
      </div>
      {helperText && (
        <p className={`text-xs text-muted-foreground ${helperAlign}`}>{helperText}</p>
      )}
    </div>
  );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const CheckboxPlugin: ViewBuilderPlugin<CheckboxConfigs, CheckboxSchema> = {
  id: 'checkbox',
  pluginType: 'form',

  toolbar: {
    name: 'Checkbox',
    element: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="m8 12 3 3 5-6" />
      </svg>
    ),
    toolTip: 'Add a checkbox field',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<CheckboxConfigs, CheckboxSchema> {...props}>
        {({ data, configs }) => <CheckboxCanvas configs={configs} data={data} />}
      </BasePluginView>
    ),
  },

  settings: [
    { field_id: 'label', label: 'Label', type: 'text', defaultValue: 'Checkbox label' },
    { field_id: 'helperText', label: 'Helper Text', type: 'text', defaultValue: '' },
    {
      field_id: 'checkboxAlign',
      label: 'Checkbox Alignment',
      type: 'select',
      defaultValue: 'left',
      enum: ['left', 'center', 'right', 'spread'],
      component: AlignmentField,
    },
    {
      field_id: 'labelPosition',
      label: 'Label Side',
      type: 'select',
      defaultValue: 'right',
      enum: ['right', 'left'],
      component: LabelSideField,
    },
    {
      field_id: 'defaultChecked',
      label: 'Checked by Default',
      type: 'checkbox',
      defaultValue: false,
    },
    { field_id: 'required', label: 'Required', type: 'checkbox', defaultValue: false },
    { field_id: 'disabled', label: 'Disabled', type: 'checkbox', defaultValue: false },
  ],

  componentDataSchema: {
    checked: false,
  },

  componentDataMetadata: {
    checked: { type: 'boolean', label: 'Checked State' },
  },
};