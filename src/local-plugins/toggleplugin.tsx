import { useState, useEffect } from 'react';
import { ToggleLeft } from 'lucide-react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type ToggleConfigs = {
  label: string;
  helperText: string;
  onLabel: string;
  offLabel: string;
  defaultChecked: boolean;
  disabled: boolean;
  required: boolean;
  size: 'sm' | 'default';
  labelPosition: 'right' | 'left';
};

type ToggleSchema = {
  checked: boolean;
};

// ─── Canvas Component ─────────────────────────────────────────────────────────

function ToggleCanvas({
  configs,
  data,
}: {
  configs: ToggleConfigs;
  data: ToggleSchema[] | null;
}) {
  const {
    label,
    helperText,
    onLabel,
    offLabel,
    defaultChecked,
    disabled,
    required,
    size = 'default',
    labelPosition = 'right',
  } = configs;

  const liveChecked = data ? Boolean(data?.[0]?.checked) : Boolean(defaultChecked);
  const [checked, setChecked] = useState(liveChecked);

  // Keep local state in sync when switching between Design and Preview mode.
  useEffect(() => {
    setChecked(liveChecked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveChecked]);

  const stateLabel = onLabel || offLabel ? (checked ? onLabel : offLabel) : null;

  const isSmall = size === 'sm';
  const trackWidth = isSmall ? 24 : 32;
  const trackHeight = isSmall ? 14 : 18.4;
  const thumbSize = isSmall ? 12 : 16;
  const thumbTravel = trackWidth - thumbSize - 2; // 2px inset on each side

  const isDisabled = disabled || !!data;

  const switchEl = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={isDisabled}
        onClick={() => !isDisabled && setChecked((prev) => !prev)}
        className={`relative inline-flex shrink-0 items-center rounded-full border border-transparent outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? 'bg-primary' : 'bg-input dark:bg-input/80'
        }`}
        style={{ width: trackWidth, height: trackHeight }}
      >
        <span
          className="pointer-events-none block rounded-full bg-background shadow-sm transition-transform"
          style={{
            width: thumbSize,
            height: thumbSize,
            transform: `translateX(${checked ? thumbTravel : 1}px)`,
          }}
        />
      </button>
      {stateLabel && (
        <span className="text-xs font-medium text-muted-foreground min-w-[2ch]">
          {stateLabel}
        </span>
      )}
    </div>
  );

  const labelEl = label && (
    <label className="text-sm font-medium text-foreground select-none">
      {label}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );

  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center gap-3">
        {labelPosition === 'left' ? (
          <>
            {labelEl}
            {switchEl}
          </>
        ) : (
          <>
            {switchEl}
            {labelEl}
          </>
        )}
      </div>
      {helperText && (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      )}
    </div>
  );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const TogglePlugin: ViewBuilderPlugin<ToggleConfigs, ToggleSchema> = {
  id: 'toggle-button',
  pluginType: 'form',

  toolbar: {
    name: 'Toggle Button',
    element: <ToggleLeft className="w-5 h-5" />,
    toolTip: 'Add an on/off toggle switch',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<ToggleConfigs, ToggleSchema> {...props}>
        {({ data, configs }) => <ToggleCanvas configs={configs} data={data} />}
      </BasePluginView>
    ),
  },

  settings: [
    { field_id: 'label', label: 'Label', type: 'text', defaultValue: 'Toggle label' },
    { field_id: 'helperText', label: 'Helper Text', type: 'text', defaultValue: '' },
    { field_id: 'onLabel', label: 'On State Text', type: 'text', defaultValue: '' },
    { field_id: 'offLabel', label: 'Off State Text', type: 'text', defaultValue: '' },
    {
      field_id: 'labelPosition',
      label: 'Label Position',
      type: 'select',
      defaultValue: 'right',
      enum: ['right', 'left'],
    },
    {
      field_id: 'size',
      label: 'Size',
      type: 'select',
      defaultValue: 'default',
      enum: ['sm', 'default'],
    },
    {
      field_id: 'defaultChecked',
      label: 'On by Default',
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
    checked: { type: 'boolean', label: 'Toggle State' },
  },
};