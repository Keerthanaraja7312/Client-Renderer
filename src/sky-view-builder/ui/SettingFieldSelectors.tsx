import React from 'react';
import type { SettingFieldComponentProps } from '@/sky-view-builder/core/plugin';

export const StateBindingSelect: React.FC<SettingFieldComponentProps> = ({
  value,
  onChange,
  stateOptions = [],
}) => {
  const options = stateOptions.length > 0 ? stateOptions : [{ label: 'No state available', value: '' }];

  return (
    <div className="relative">
      <select
        className="w-full bg-secondary border border-border rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none appearance-none cursor-pointer transition-all"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select a state binding...</option>
        {options.map((opt) => (
          <option key={opt.value || opt.label} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground/60">
        ↓
      </div>
    </div>
  );
};

export const DataFieldSelect: React.FC<SettingFieldComponentProps> = ({
  value,
  onChange,
  dataFieldOptions = [],
}) => {
  const options = dataFieldOptions.length > 0 ? dataFieldOptions : [{ label: 'Select a data source first', value: '' }];

  return (
    <div className="relative">
      <select
        className="w-full bg-secondary border border-border rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none appearance-none cursor-pointer transition-all"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select a field...</option>
        {options.map((opt) => (
          <option key={opt.value || opt.label} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground/60">
        ↓
      </div>
    </div>
  );
};

export const StateOrDataFieldSelect: React.FC<SettingFieldComponentProps> = ({
  value,
  onChange,
  stateOptions = [],
  dataFieldOptions = [],
}) => {
  const options = [
    ...stateOptions.map((opt) => ({ ...opt, label: `State: ${opt.label}` })),
    ...dataFieldOptions.map((opt) => ({ ...opt, label: `Field: ${opt.label}` })),
  ];

  return (
    <div className="relative">
      <select
        className="w-full bg-secondary border border-border rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none appearance-none cursor-pointer transition-all"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select a binding...</option>
        {options.map((opt) => (
          <option key={opt.value || opt.label} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground/60">
        ↓
      </div>
    </div>
  );
};

export default StateBindingSelect;
