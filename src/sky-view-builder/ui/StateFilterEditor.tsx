import React from 'react';
import { Plus, Trash2, Link2 } from 'lucide-react';
import type { SettingFieldComponentProps } from '@/sky-view-builder/core/plugin';
import {
  STATE_FILTER_OPERATORS,
  type StateFilter,
  type StateFilterOperator,
  type StateFilterWhenEmpty,
} from '@/store/stateFilters';

/**
 * Settings-panel editor for "Filter by State".
 *
 * Register it on any data-consuming plugin with:
 *
 *   { field_id: 'stateFilters', label: 'Filter by State', type: 'stateFilters',
 *     defaultValue: [], optionsFrom: 'stateAndData', component: StateFilterEditor }
 *
 * `optionsFrom: 'stateAndData'` makes SettingsPanel pass BOTH lists in:
 *   stateOptions     → state variables other components publish (e.g. a Dropdown's hubKey)
 *   dataFieldOptions → columns of this component's own data source
 */

const selectClass =
  'w-full bg-secondary border border-border rounded-lg p-2 text-xs focus:ring-2 focus:ring-primary outline-none appearance-none cursor-pointer transition-all';

const newId = () => Math.random().toString(36).substring(2, 9);

const withCurrent = (options: Array<{ label: string; value: string }>, current?: string) =>
  current && !options.some((o) => o.value === current) ? [{ label: current, value: current }, ...options] : options;

export const StateFilterEditor: React.FC<SettingFieldComponentProps> = ({
  value,
  onChange,
  stateOptions = [],
  dataFieldOptions = [],
}) => {
  const filters: StateFilter[] = Array.isArray(value) ? value : [];

  const update = (id: string, patch: Partial<StateFilter>) =>
    onChange(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const remove = (id: string) => onChange(filters.filter((f) => f.id !== id));

  const add = () =>
    onChange([
      ...filters,
      { id: newId(), column: '', operator: '=', stateKey: '', whenEmpty: 'ignore' } satisfies StateFilter,
    ]);

  return (
    <div className="space-y-3">
      {filters.length === 0 && (
        <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
          Narrow this component's rows using a value another component publishes — e.g. a Dropdown's selection.
        </p>
      )}

      {filters.map((f) => (
        <div key={f.id} className="rounded-xl border border-border bg-secondary/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              <Link2 className="w-3 h-3" /> Row field is…
            </span>
            <button
              type="button"
              onClick={() => remove(f.id)}
              className="text-muted-foreground/50 hover:text-destructive transition-colors"
              aria-label="Remove filter"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <select className={selectClass} value={f.column} onChange={(e) => update(f.id, { column: e.target.value })}>
            <option value="">{dataFieldOptions.length ? 'Select a field…' : 'Select a data source first'}</option>
            {withCurrent(dataFieldOptions, f.column).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2">
            <select
              className={`${selectClass} font-mono font-bold`}
              value={f.operator}
              onChange={(e) => update(f.id, { operator: e.target.value as StateFilterOperator })}
            >
              {STATE_FILTER_OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>

            <select className={selectClass} value={f.stateKey} onChange={(e) => update(f.id, { stateKey: e.target.value })}>
              <option value="">{stateOptions.length ? 'Select a state…' : 'No state available'}</option>
              {withCurrent(stateOptions, f.stateKey).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          

          
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:border-primary/50 hover:text-primary transition-all"
      >
        <Plus className="w-3.5 h-3.5" /> Add state filter
      </button>
    </div>
  );
};