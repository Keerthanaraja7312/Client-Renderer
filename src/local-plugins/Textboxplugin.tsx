import React from 'react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type TextBoxConfigs = {
  label: string;
  placeholder: string;
  helperText: string;
  defaultValue: string;
  disabled: boolean;
  required: boolean;
  maxLength: number;
  variant: 'outlined' | 'filled' | 'underline';
  size: 'sm' | 'md' | 'lg';
  labelPosition: 'top' | 'left' | 'hidden';
};

type TextBoxSchema = {
  value: string;
};

// ─── Canvas Component ─────────────────────────────────────────────────────────

function TextBoxCanvas({
  configs,
  data,
}: {
  configs: TextBoxConfigs;
  data: TextBoxSchema[] | null;
}) {
  const {
    label,
    placeholder,
    helperText,
    defaultValue,
    disabled,
    required,
    maxLength,
    variant = 'outlined',
    size = 'md',
    labelPosition = 'top',
  } = configs;

  const liveValue = data?.[0]?.value ?? defaultValue ?? '';

  // Size tokens
  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-2',
    lg: 'text-base px-4 py-3',
  }[size];

  // Variant tokens
  const variantClasses = {
    outlined:
      'border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring',
    filled:
      'border-0 border-b-2 border-input rounded-t-md bg-muted focus:outline-none focus:border-ring',
    underline:
      'border-0 border-b-2 border-input bg-transparent rounded-none focus:outline-none focus:border-ring',
  }[variant];

  const inputEl = (
    <div className="flex flex-col gap-1 w-full">
      {labelPosition !== 'hidden' && label && (
        <label
          className={`font-medium text-foreground ${size === 'sm' ? 'text-xs' : 'text-sm'}`}
        >
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </label>
      )}
      <input
        type="text"
        className={`w-full transition-colors ${sizeClasses} ${variantClasses} disabled:opacity-50 disabled:cursor-not-allowed`}
        placeholder={placeholder}
        defaultValue={liveValue}
        disabled={disabled}
        maxLength={maxLength || undefined}
        readOnly={!!data}
      />
      {helperText && (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      )}
    </div>
  );

  if (labelPosition === 'left') {
    return (
      <div className="flex items-center gap-3 w-full">
        {label && (
          <label className="font-medium text-sm text-foreground whitespace-nowrap shrink-0">
            {label}
            {required && <span className="text-destructive ml-0.5">*</span>}
          </label>
        )}
        <div className="flex-1 flex flex-col gap-1">
          <input
            type="text"
            className={`w-full transition-colors ${sizeClasses} ${variantClasses} disabled:opacity-50`}
            placeholder={placeholder}
            defaultValue={liveValue}
            disabled={disabled}
            maxLength={maxLength || undefined}
            readOnly={!!data}
          />
          {helperText && (
            <p className="text-xs text-muted-foreground">{helperText}</p>
          )}
        </div>
      </div>
    );
  }

  return inputEl;
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const TextBoxPlugin: ViewBuilderPlugin<TextBoxConfigs, TextBoxSchema> = {
  id: 'text-box',
  pluginType: 'form',

  toolbar: {
    name: 'Text Box',
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
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M8 12h8M12 9v6" />
      </svg>
    ),
    toolTip: 'Add a text input field',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<TextBoxConfigs, TextBoxSchema> {...props}>
        {({ data, configs }) => (
          <TextBoxCanvas configs={configs} data={data} />
        )}
      </BasePluginView>
    ),
  },

  settings: [
    { field_id: 'label', label: 'Label', type: 'text', defaultValue: 'Label' },
    {
      field_id: 'placeholder',
      label: 'Placeholder',
      type: 'text',
      defaultValue: 'Enter value...',
    },
    {
      field_id: 'helperText',
      label: 'Helper Text',
      type: 'text',
      defaultValue: '',
    },
    {
      field_id: 'defaultValue',
      label: 'Default Value',
      type: 'text',
      defaultValue: '',
    },
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
    {
      field_id: 'maxLength',
      label: 'Max Length',
      type: 'number',
      defaultValue: 0,
    },
    {
      field_id: 'required',
      label: 'Required',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      field_id: 'disabled',
      label: 'Disabled',
      type: 'checkbox',
      defaultValue: false,
    },
  ],

  componentDataSchema: {
    value: '',
  },

  componentDataMetadata: {
    value: { type: 'text', label: 'Field Value' },
  },
};