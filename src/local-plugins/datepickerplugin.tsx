import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type DatePickerConfigs = {
  label: string;
  helperText: string;
  defaultValue: string; // ISO date string, e.g. "2026-07-09"
  minDate: string;
  maxDate: string;
  disabled: boolean;
  required: boolean;
  variant: 'outlined' | 'filled' | 'underline';
  size: 'sm' | 'md' | 'lg';
  labelPosition: 'top' | 'left' | 'hidden';
};

type DatePickerSchema = {
  date: string;
};

// ─── Canvas Component ─────────────────────────────────────────────────────────

function DatePickerCanvas({
  configs,
  data,
}: {
  configs: DatePickerConfigs;
  data: DatePickerSchema[] | null;
}) {
  const {
    label,
    helperText,
    defaultValue,
    minDate,
    maxDate,
    disabled,
    required,
    variant = 'outlined',
    size = 'md',
    labelPosition = 'top',
  } = configs;

  const liveValue = data?.[0]?.date ?? defaultValue ?? '';

  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-2',
    lg: 'text-base px-4 py-3',
  }[size];

  const variantClasses = {
    outlined:
      'border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring',
    filled:
      'border-0 border-b-2 border-input rounded-t-md bg-muted focus:outline-none focus:border-ring',
    underline:
      'border-0 border-b-2 border-input bg-transparent rounded-none focus:outline-none focus:border-ring',
  }[variant];

  const inputEl = (
    <input
      type="date"
      className={`w-full transition-colors ${sizeClasses} ${variantClasses} disabled:opacity-50 disabled:cursor-not-allowed`}
      defaultValue={liveValue}
      min={minDate || undefined}
      max={maxDate || undefined}
      disabled={disabled}
      readOnly={!!data}
    />
  );

  const labelEl = labelPosition !== 'hidden' && label && (
    <label
      className={`font-medium text-foreground ${size === 'sm' ? 'text-xs' : 'text-sm'} ${
        labelPosition === 'left' ? 'whitespace-nowrap shrink-0' : ''
      }`}
    >
      {label}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );

  if (labelPosition === 'left') {
    return (
      <div className="flex items-center gap-3 w-full">
        {labelEl}
        <div className="flex-1 flex flex-col gap-1">
          {inputEl}
          {helperText && (
            <p className="text-xs text-muted-foreground">{helperText}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 w-full">
      {labelEl}
      {inputEl}
      {helperText && (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      )}
    </div>
  );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const DatePickerPlugin: ViewBuilderPlugin<DatePickerConfigs, DatePickerSchema> = {
  id: 'date-picker',
  pluginType: 'form',

  toolbar: {
    name: 'Date Picker',
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
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
      </svg>
    ),
    toolTip: 'Add a date picker field',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<DatePickerConfigs, DatePickerSchema> {...props}>
        {({ data, configs }) => <DatePickerCanvas configs={configs} data={data} />}
      </BasePluginView>
    ),
  },

  settings: [
    { field_id: 'label', label: 'Label', type: 'text', defaultValue: 'Date' },
    { field_id: 'helperText', label: 'Helper Text', type: 'text', defaultValue: '' },
    { field_id: 'defaultValue', label: 'Default Date', type: 'text', defaultValue: '' },
    { field_id: 'minDate', label: 'Min Date', type: 'text', defaultValue: '' },
    { field_id: 'maxDate', label: 'Max Date', type: 'text', defaultValue: '' },
    {
      field_id: 'variant',
      label: 'Variant',
      type: 'select',
      defaultValue: 'outlined',
      enum: ['outlined', 'filled', 'underline'],
    },
    {
      field_id: 'size',
      label: 'Size',
      type: 'select',
      defaultValue: 'md',
      enum: ['sm', 'md', 'lg'],
    },
    {
      field_id: 'labelPosition',
      label: 'Label Position',
      type: 'select',
      defaultValue: 'top',
      enum: ['top', 'left', 'hidden'],
    },
    { field_id: 'required', label: 'Required', type: 'checkbox', defaultValue: false },
    { field_id: 'disabled', label: 'Disabled', type: 'checkbox', defaultValue: false },
  ],

  componentDataSchema: {
    date: '',
  },

  componentDataMetadata: {
    date: { type: 'date', label: 'Date Value' },
  },
};