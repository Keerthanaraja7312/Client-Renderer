import { createElement } from 'react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type LabelConfigs = {
  text: string;
  tag: 'p' | 'span' | 'h1' | 'h2' | 'h3' | 'h4';
  align: 'left' | 'center' | 'right';
  weight: 'normal' | 'medium' | 'semibold' | 'bold';
  size: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  color: string;
  italic: boolean;
  uppercase: boolean;
};

type LabelSchema = {
  text: string;
};

// ─── Canvas Component ─────────────────────────────────────────────────────────

function LabelCanvas({
  configs,
  data,
}: {
  configs: LabelConfigs;
  data: LabelSchema[] | null;
}) {
  const {
    text,
    tag = 'p',
    align = 'left',
    weight = 'normal',
    size = 'md',
    color,
    italic,
    uppercase,
  } = configs;

  const liveText = data?.[0]?.text ?? text ?? '';

  const sizeClasses = {
    xs: 'text-xs',
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
    xl: 'text-xl',
  }[size];

  const weightClasses = {
    normal: 'font-normal',
    medium: 'font-medium',
    semibold: 'font-semibold',
    bold: 'font-bold',
  }[weight];

  const alignClasses = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  }[align];

  return createElement(
    tag || 'p',
    {
      className: `w-full ${sizeClasses} ${weightClasses} ${alignClasses} ${italic ? 'italic' : ''} ${uppercase ? 'uppercase' : ''}`,
      style: color ? { color } : undefined,
    },
    liveText
  );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const LabelPlugin: ViewBuilderPlugin<LabelConfigs, LabelSchema> = {
  id: 'label',
  pluginType: 'content',

  toolbar: {
    name: 'Label',
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
        <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
        <path d="M9 20h6" />
        <path d="M12 4v16" />
      </svg>
    ),
    toolTip: 'Add a static text label',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<LabelConfigs, LabelSchema> {...props}>
        {({ data, configs }) => <LabelCanvas configs={configs} data={data} />}
      </BasePluginView>
    ),
  },

  settings: [
    { field_id: 'text', label: 'Text', type: 'text', defaultValue: 'Label text' },
    {
      field_id: 'tag',
      label: 'HTML Tag',
      type: 'select',
      defaultValue: 'p',
      enum: ['p', 'span', 'h1', 'h2', 'h3', 'h4'],
    },
    {
      field_id: 'size',
      label: 'Size',
      type: 'select',
      defaultValue: 'md',
      enum: ['xs', 'sm', 'md', 'lg', 'xl'],
    },
    {
      field_id: 'weight',
      label: 'Weight',
      type: 'select',
      defaultValue: 'normal',
      enum: ['normal', 'medium', 'semibold', 'bold'],
    },
    {
      field_id: 'align',
      label: 'Alignment',
      type: 'select',
      defaultValue: 'left',
      enum: ['left', 'center', 'right'],
    },
    { field_id: 'color', label: 'Text Color', type: 'text', defaultValue: '' },
    { field_id: 'italic', label: 'Italic', type: 'checkbox', defaultValue: false },
    { field_id: 'uppercase', label: 'Uppercase', type: 'checkbox', defaultValue: false },
  ],

  componentDataSchema: {
    text: '',
  },

  componentDataMetadata: {
    text: { type: 'text', label: 'Label Text' },
  },
};