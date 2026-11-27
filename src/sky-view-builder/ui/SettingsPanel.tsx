import React from 'react';
import { useProjectScope } from '../hooks/useProjectScope';
import { registry, type ComponentInstance } from "../index";
import type { DataSource } from "./ViewBuilder";

import { Settings2, BookmarkPlus } from "lucide-react";

const flatten = (obj: any, parent = '', res: any = {}) => {
  for (let key in obj) {
    const newKey = parent ? `${parent}.${key}` : key;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      flatten(obj[key], newKey, res);
    } else {
      res[newKey] = obj[key];
    }
  }
  return res;
};

const unflatten = (data: any) => {
  const result: any = {};
  for (let key in data) {
    const keys = key.split(".");
    let cur = result;
    keys.forEach((k, i) => {
      if (i === keys.length - 1) {
        cur[k] = data[key];
      } else {
        if (!cur[k]) cur[k] = {};
        cur = cur[k];
      }
    });
  }
  return result;
};

const isRecord = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);


function collectBindableValues(instances: any[], selectedInstanceId?: string | null): string[] {
  const values = new Set<string>();

  const visit = (list: any[]) => {
    if (!Array.isArray(list)) return;

    for (const inst of list) {
      if (!isRecord(inst)) continue;

      const configs = isRecord(inst.configs) ? inst.configs : {};
      for (const [key, value] of Object.entries(configs)) {
        // selectedValue / selectedRow hold a runtime DATA value (e.g. "5"), not a
        // state-variable name — listing them pollutes the binding pickers.
        if (/^selected(Value|Row|Id)?$/i.test(key)) continue;
        if (typeof value === 'string' && value.trim()) {
          const isBindingLike = /key|binding|event|state/i.test(key) || /selected|filter|hub/i.test(key);
          if (isBindingLike) {
            values.add(value);
          }
        }
      }

      const nestedCollections = [configs.blocks, configs.components];
      nestedCollections.forEach((childList) => {
        if (Array.isArray(childList)) visit(childList);
      });
    }
  };

  visit(instances);

  if (selectedInstanceId) {
    const selected = instances.find((inst) => inst?.id === selectedInstanceId);
    if (selected && isRecord(selected.configs)) {
      const hubKey = selected.configs.hubKey;
      if (typeof hubKey === 'string' && hubKey.trim()) values.add(hubKey);
    }
  }

  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function resolveEffectiveDataSource(instances: any[], targetId?: string | null, inheritedDataSourceId?: string | number | null): string | number | null {
  if (!targetId) return inheritedDataSourceId ?? null;

  const visit = (list: any[], inherited: string | number | null): string | number | null => {
    if (!Array.isArray(list)) return null;

    for (const inst of list) {
      if (!isRecord(inst)) continue;

      const nextInherited = inst.dataSourceId ?? inherited ?? null;

      if (inst.id === targetId) {
        return inst.dataSourceId ?? inherited ?? null;
      }

      const nestedCollections = [inst?.configs?.blocks, inst?.configs?.components];
      for (const childList of nestedCollections) {
        if (Array.isArray(childList)) {
          const found = visit(childList, nextInherited);
          if (found != null) return found;
        }
      }
    }

    return null;
  };

  return visit(instances, inheritedDataSourceId ?? null);
}

function resolveEffectiveType(instances: any[], targetId?: string | null, inheritedType?: string | null): string | null {
  if (!targetId) return inheritedType ?? null;

  const visit = (list: any[], inherited: string | null): string | null => {
    if (!Array.isArray(list)) return null;

    for (const inst of list) {
      if (!isRecord(inst)) continue;

      const nextInherited = inst.type ?? inherited ?? null;

      if (inst.id === targetId) {
        return inst.type ?? inherited ?? null;
      }

      const nestedCollections = [inst?.configs?.blocks, inst?.configs?.components];
      for (const childList of nestedCollections) {
        if (Array.isArray(childList)) {
          const found = visit(childList, nextInherited);
          if (found != null) return found;
        }
      }
    }

    return null;
  };

  return visit(instances, inheritedType ?? null);
}

interface SettingsPanelProps {
  /** Opens the "Save as reusable" dialog for the selected item. */
  onRequestSave?: () => void;
  selectedInstance: ComponentInstance | null;
  onUpdateConfig: (fieldId: string | Record<string, any>, value?: any) => void;
  availableFields?: DataSource[];
  instances?: ComponentInstance[];
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ selectedInstance, onUpdateConfig, availableFields = [], instances = [], onRequestSave }) => {

  const effectiveDataSourceId = React.useMemo(
    () => resolveEffectiveDataSource(instances, selectedInstance?.id ?? null),
    [instances, selectedInstance?.id]
  );

  const effectiveType = React.useMemo(
    () => resolveEffectiveType(instances, selectedInstance?.id ?? null),
    [instances, selectedInstance?.id]
  );

  const selectedSource = effectiveDataSourceId != null && effectiveDataSourceId !== ''
    ? availableFields.find(s => String(s.id) === String(effectiveDataSourceId))
    : null;

  const sourceType = selectedInstance?.type === 'query'
    ? 'query'
    : selectedInstance?.type === 'table'
      ? 'table'
      : effectiveType === 'query'
        ? 'query'
        : effectiveType === 'table'
          ? 'table'
          : selectedSource?.type === 'query'
            ? 'query'
            : 'table';

  // Project → Domain model: pick a project first, then only its tables are listed.
  const tableSources = React.useMemo(() => availableFields.filter(s => s.type === 'table'), [availableFields]);
  const projectScope = useProjectScope(tableSources, sourceType === 'table' ? effectiveDataSourceId : null, selectedInstance?.id);

  const showDataContext = !!selectedInstance;

  const selectedPlugin = selectedInstance ? registry.getPlugin(selectedInstance.pluginId) : null;

  const pluginSchema = selectedPlugin?.componentDataSchema || {};
  const dataFormatKeys = Object.keys(flatten(pluginSchema));
  const instanceSchemaFlat = flatten(selectedInstance?.componentDataSchema || {});

  const stateOptions = React.useMemo(() => {
    const values = collectBindableValues(instances, selectedInstance?.id);
    return values.map((value) => ({ label: value, value })).sort((a, b) => a.label.localeCompare(b.label));
  }, [instances, selectedInstance?.id]);

  const dataFieldOptions = React.useMemo(() => {
    if (!effectiveDataSourceId && effectiveDataSourceId !== 0) return [];
    const source = availableFields.find((s) => String(s.id) === String(effectiveDataSourceId));
    return (source?.availableFields ?? []).map((field: any) => ({
      label: `${field.label?.trim() || field.fieldId} (${field.field_type})`,
      value: field.fieldId,
    }));
  }, [availableFields, effectiveDataSourceId]);

  return (
    <aside className="w-full h-full min-h-0 flex flex-col overflow-hidden shrink-0">
      <div className="px-6 py-5 border-b border-border flex items-center gap-3">
        <Settings2 className="w-5 h-5 text-muted-foreground" />
        <h2 className="font-bold text-sm uppercase tracking-tight">Configuration</h2>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
        {!selectedInstance ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-4 opacity-50">
              <Settings2 className="w-5 h-5" />
            </div>
            <p className="text-muted-foreground text-xs font-medium px-8">Select an element on the canvas to adjust its properties.</p>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="pb-6 border-b border-border">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0"></span>
                  <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-widest truncate">{selectedPlugin?.toolbar.name}</p>
                </div>
                <button
                  type="button"
                  onClick={onRequestSave}
                  title="Save as reusable — drag it into other pages/blocks from the Toolbar's Saved section"
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-primary-foreground shadow-sm transition hover:bg-primary/90 shrink-0">
                  <BookmarkPlus className="w-3.5 h-3.5" /> Save
                </button>
              </div>
            </div>

            {showDataContext ? (
              <div className="pb-8 border-b border-border space-y-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-4 bg-primary/40 rounded-full"></div>
                  <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Data Provider</h3>
                </div>

                <div className="space-y-3 pb-6 border-b border-border/30">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Select
                    </label>

                    <div className="flex gap-6">
                      <label className="flex items-center gap-2 text-xs">
                        <input type="radio" checked={sourceType === 'table'} onChange={() => { onUpdateConfig({ dataSourceId: null, type: 'table' }); }} />
                        Table
                      </label>

                      <label className="flex items-center gap-2 text-xs">
                        <input type="radio" checked={sourceType === 'query'} onChange={() => { onUpdateConfig({ dataSourceId: null, type: 'query' }); }} />
                        Query
                      </label>
                    </div>

                    <span className="text-[9px] text-primary font-bold">
                      *Required
                    </span>
                  </div>

                  <div className="relative">
                    <select
                      className="w-full bg-primary/5 border border-primary/20 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none appearance-none cursor-pointer transition-all font-bold text-primary disabled:opacity-50"
                      value={effectiveDataSourceId ?? ''}
                      onChange={(e) => {
                        const sourceId = e.target.value;
                        const source = availableFields.find(s => String(s.id) === String(sourceId));
                        onUpdateConfig({
                          dataSourceId: sourceId,
                          type: source?.type || sourceType || 'table',
                        });
                      }}
                    >
                      <option value="">
                        Select Table/Query...
                      </option>
                      {(sourceType === 'table' ? projectScope.scopedSources : availableFields.filter(source => source.type === sourceType))
                        .map(source => (
                          <option key={source.id} value={source.id}>
                            {source.label?.trim() || source.name}
                          </option>
                        ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-primary/40">
                      ↓
                    </div>
                  </div>
                </div>

                {selectedInstance.dataSourceId ? (
                  <div className="space-y-8 animate-in fade-in duration-500">
                    {dataFormatKeys.length > 0 && (
                      <div className="space-y-6 pt-4 border-t border-border/30">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Property Mapping</label>
                          <span className="text-[9px] text-muted-foreground/40 font-mono italic">Data Binding</span>
                        </div>
                        <div className="space-y-6">
                          {dataFormatKeys.map(key => (
                            <div key={key} className="space-y-3">
                              <label className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-tight">{key}</label>
                              <div className="relative">
                                <select
                                  className="w-full bg-secondary/30 border border-border/50 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none appearance-none cursor-pointer transition-all font-mono"
                                  value={instanceSchemaFlat[key] || ''}
                                  onChange={(e) => {
                                    const newFlat = { ...instanceSchemaFlat, [key]: e.target.value };
                                    onUpdateConfig('componentDataSchema', unflatten(newFlat));
                                  }}
                                >
                                  <option value="">Select Field...</option>
                                  {availableFields
                                    .find(s => String(s.id) === String(effectiveDataSourceId))
                                    ?.availableFields
                                    .filter(field => {
                                      const metadata = (selectedPlugin as any)?.componentDataMetadata?.[key];
                                      return !metadata || !metadata.type || field.field_type === metadata.type;
                                    })
                                    .map(field => (
                                      <option key={field.fieldId} value={field.fieldId}>
                                        {field.label?.trim() || field.fieldId} ({field.field_type})
                                      </option>
                                    ))}
                                </select>
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground/40">
                                  ↓
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {selectedPlugin?.settings
              .filter(field => !field.visibleWhen || field.visibleWhen(selectedInstance.configs ?? {}))
              .map(field => (
              <div key={field.field_id} className="space-y-3">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{field.label}</label>

                {field.component ? (
                  <field.component
                    value={selectedInstance.configs[field.field_id]}
                    onChange={(val: any) => onUpdateConfig(field.field_id, val)}
                    stateOptions={field.optionsFrom === 'state' || field.optionsFrom === 'stateAndData' ? stateOptions : []}
                    dataFieldOptions={field.optionsFrom === 'dataField' || field.optionsFrom === 'stateAndData' ? dataFieldOptions : []}
                    availableFields={availableFields}
                    selectedInstance={selectedInstance}
                    selectedPlugin={selectedPlugin}
                    sourceType={sourceType}
                  />
                ) : null}

                {!field.component && field.type === 'text' && (
                  <input
                    type="text"
                    className="w-full bg-secondary border border-border rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none transition-all placeholder:text-muted-foreground/30"
                    value={selectedInstance.configs[field.field_id] || ''}
                    onChange={(e) => onUpdateConfig(field.field_id, e.target.value)}
                  />
                )}

                {!field.component && field.type === 'textarea' && (
                  <textarea
                    rows={4}
                    className="w-full bg-secondary border border-border rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none transition-all"
                    value={selectedInstance.configs[field.field_id] || ''}
                    onChange={(e) => onUpdateConfig(field.field_id, e.target.value)}
                  />
                )}

                {!field.component && field.type === 'select' && (
                  <div className="relative">
                    <select
                      className="w-full bg-secondary border border-border rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none appearance-none cursor-pointer transition-all"
                      value={selectedInstance.configs[field.field_id] || ''}
                      onChange={(e) => onUpdateConfig(field.field_id, e.target.value)}
                    >
                      {field.enum?.map(val => (
                        <option key={val} value={val}>{val.toUpperCase()}</option>
                      ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground/60">
                      ↓
                    </div>
                  </div>
                )}

                {!field.component && field.type === 'checkbox' && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-tight">Active State</span>
                    <button
                      onClick={() => onUpdateConfig(field.field_id, !selectedInstance.configs[field.field_id])}
                      className={`group relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${selectedInstance.configs[field.field_id] ? 'bg-primary' : 'bg-secondary'}`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${selectedInstance.configs[field.field_id] ? 'translate-x-4' : 'translate-x-0'}`}
                      />
                    </button>
                  </div>
                )}

                {!field.component && field.type === 'color' && (
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      className="h-10 w-14 rounded-lg border border-border cursor-pointer bg-transparent p-1"
                      value={selectedInstance.configs[field.field_id] || '#ffffff'}
                      onChange={(e) => onUpdateConfig(field.field_id, e.target.value)}
                    />
                    <input
                      type="text"
                      className="flex-1 bg-secondary border border-border rounded-xl p-3 text-sm font-mono focus:ring-2 focus:ring-primary outline-none transition-all placeholder:text-muted-foreground/30"
                      value={selectedInstance.configs[field.field_id] || ''}
                      onChange={(e) => onUpdateConfig(field.field_id, e.target.value)}
                      placeholder="#ffffff"
                    />
                  </div>
                )}

                {!field.component && field.type === 'number' && (
                  <input
                    type="number"
                    className="w-full bg-secondary border border-border rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none transition-all"
                    value={selectedInstance.configs[field.field_id] ?? 0}
                    onChange={(e) => onUpdateConfig(field.field_id, Number(e.target.value))}
                  />
                )}


              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};