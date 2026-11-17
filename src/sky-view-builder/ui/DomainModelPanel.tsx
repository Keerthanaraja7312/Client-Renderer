/**
 * DomainModelPanel — full domain model manager embedded in the page builder.
 *
 * Lets users create domains, add/edit/remove fields (with type, label, placeholder,
 * default value and per-field validation rules) and save them to the backend
 * without ever leaving the page builder.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Database, Plus, Trash2, Save, ChevronRight, ChevronDown,
  Loader2, CheckCircle2, AlertCircle, RefreshCw, Edit3,
  Hash, Type, Calendar, ToggleLeft, AlignLeft, X, GripVertical,
  ShieldCheck, ServerCog, Link2,
} from 'lucide-react';
import {
  fetchAllSchemas,
  createDomain,
  getDatastoreConfig,
  setDatastoreBackend,
  type BackendSchemaField,
  type BackendSchemaEntry,
} from '../../api/datastoreApi';
import {
  loadDomainViewConfig,
  saveDomainViewConfig,
  type DomainViewConfig,
} from '../core/domainViewConfig';
import { DomainViewConfigSection } from './DomainViewConfigSection';

// ─── Local types ──────────────────────────────────────────────────────────────

type FieldType = 'text' | 'number' | 'date' | 'boolean' | 'formattedText' | 'relation';

type ValidationDraft = {
  _id: string;      // local key only
  type: 'required' | 'minLength' | 'maxLength' | 'min' | 'max' | 'pattern';
  value: string;    // empty for 'required'
  message: string;
};

type FieldDraft = {
  _id: string;           // local key only
  field_id: string;
  label: string;
  type: FieldType;
  placeholder: string;
  defaultValue: string;
  validations: ValidationDraft[];
  datasource?: string;   // target domain table name — only for 'relation' type
};

type DomainDraft = {
  name: string;
  fields: FieldDraft[];
  viewConfig: DomainViewConfig;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;
const uid = () => String(++_seq);

const FIELD_TYPES: { value: FieldType; label: string; icon: React.ReactNode }[] = [
  { value: 'text',          label: 'Text',           icon: <Type        className="w-3.5 h-3.5" /> },
  { value: 'number',        label: 'Number',         icon: <Hash        className="w-3.5 h-3.5" /> },
  { value: 'date',          label: 'Date',           icon: <Calendar    className="w-3.5 h-3.5" /> },
  { value: 'boolean',       label: 'Boolean',        icon: <ToggleLeft  className="w-3.5 h-3.5" /> },
  { value: 'formattedText', label: 'Formatted Text', icon: <AlignLeft   className="w-3.5 h-3.5" /> },
  { value: 'relation',      label: 'Domain Link',    icon: <Link2       className="w-3.5 h-3.5" /> },
];

const VALIDATION_TYPES: { value: ValidationDraft['type']; label: string; hasValue: boolean }[] = [
  { value: 'required',  label: 'Required',     hasValue: false },
  { value: 'minLength', label: 'Min Length',   hasValue: true  },
  { value: 'maxLength', label: 'Max Length',   hasValue: true  },
  { value: 'min',       label: 'Min Value',    hasValue: true  },
  { value: 'max',       label: 'Max Value',    hasValue: true  },
  { value: 'pattern',   label: 'Regex Pattern',hasValue: true  },
];

function fieldTypeIcon(type: FieldType) {
  return FIELD_TYPES.find(f => f.value === type)?.icon ?? <Type className="w-3.5 h-3.5" />;
}

function backendFieldToDraft(f: BackendSchemaField): FieldDraft {
  // A field with a datasource property is a relation (domain link) field
  const datasource = (f as any).datasource as string | undefined;
  const isRelation = !!datasource;
  return {
    _id:          uid(),
    field_id:     f.field_id,
    label:        f.label ?? f.field_id,
    type:         isRelation ? 'relation' : ((f.type as FieldType) ?? 'text'),
    placeholder:  f.placeholder ?? (f as any).ui_config?.placeholder ?? '',
    defaultValue: f.value != null ? String(f.value) : '',
    validations:  Array.isArray(f.validations)
      ? f.validations.map((v: any) => ({
          _id:     uid(),
          type:    v.type,
          value:   v.value != null ? String(v.value) : '',
          message: v.message ?? '',
        }))
      : [],
    datasource,
  };
}

function draftToBackendField(d: FieldDraft): BackendSchemaField {
  // Relation fields are stored as type='text' + datasource=targetDomain on the backend
  const field: BackendSchemaField = {
    field_id:    d.field_id.trim(),
    type:        d.type === 'relation' ? 'text' : d.type,
    label:       d.label.trim() || d.field_id.trim(),
    value:       d.defaultValue !== '' ? d.defaultValue : undefined,
    placeholder: d.placeholder || undefined,
  };

  if (d.type === 'relation' && d.datasource) {
    (field as any).datasource = d.datasource;
  }

  const validations = d.validations
    .filter(v => v.type)
    .map(v => ({
      type:    v.type,
      ...(v.value !== '' ? { value: isNaN(Number(v.value)) ? v.value : Number(v.value) } : {}),
      message: v.message.trim() || defaultMessage(v.type, d.label || d.field_id, v.value),
    }));

  if (validations.length) field.validations = validations;
  return field;
}

function defaultMessage(type: string, fieldName: string, val: string): string {
  switch (type) {
    case 'required':  return `${fieldName} is required`;
    case 'minLength': return `${fieldName} must be at least ${val} characters`;
    case 'maxLength': return `${fieldName} must be at most ${val} characters`;
    case 'min':       return `${fieldName} must be at least ${val}`;
    case 'max':       return `${fieldName} must be at most ${val}`;
    case 'pattern':   return `${fieldName} format is invalid`;
    default:          return 'Invalid value';
  }
}

// ─── Validation badge strip ───────────────────────────────────────────────────

function ValidationBadges({ validations }: { validations: ValidationDraft[] }) {
  if (!validations.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {validations.map(v => (
        <span
          key={v._id}
          className="text-[9px] font-bold uppercase tracking-wider bg-primary/10 text-primary/70 px-1.5 py-0.5 rounded-full"
        >
          {v.type}{v.value ? `:${v.value}` : ''}
        </span>
      ))}
    </div>
  );
}

// ─── Validation rule hint text ────────────────────────────────────────────────

const VALIDATION_HINTS: Record<string, { placeholder: string; valuePlaceholder?: string }> = {
  required:  { placeholder: 'e.g. This field is required' },
  minLength: { placeholder: 'e.g. Must be at least 3 characters', valuePlaceholder: 'e.g. 3' },
  maxLength: { placeholder: 'e.g. Cannot exceed 100 characters',  valuePlaceholder: 'e.g. 100' },
  min:       { placeholder: 'e.g. Must be at least 0',            valuePlaceholder: 'e.g. 0' },
  max:       { placeholder: 'e.g. Cannot exceed 999',             valuePlaceholder: 'e.g. 999' },
  pattern:   { placeholder: 'e.g. Invalid email format',          valuePlaceholder: 'e.g. ^\\S+@\\S+$' },
};

// Which validation types make sense per field type
const VALID_RULES_FOR_TYPE: Record<FieldType, ValidationDraft['type'][]> = {
  text:          ['required', 'minLength', 'maxLength', 'pattern'],
  number:        ['required', 'min', 'max'],
  date:          ['required'],
  boolean:       ['required'],
  formattedText: ['required', 'minLength', 'maxLength'],
  relation:      ['required'],
};

// ─── Relation (Domain Link) picker ───────────────────────────────────────────

/**
 * Lets the user pick an existing domain as the relation target, or create a
 * brand-new empty domain inline without leaving the current editor.
 */
function RelationPicker({
  value,
  allDomainNames,
  domainLabels = {},
  onSelect,
  onCreateDomain,
}: {
  value: string;
  allDomainNames: string[];
  /** table_name → business label; the option shows the label, the value stays the table name. */
  domainLabels?: Record<string, string>;
  onSelect: (name: string) => void;
  onCreateDomain: (name: string) => Promise<void>;
}) {
  const [creating,        setCreating]        = useState(false);
  const [newName,         setNewName]         = useState('');
  const [createLoading,   setCreateLoading]   = useState(false);
  const [createErr,       setCreateErr]       = useState('');

  const inp = `w-full rounded-lg border border-border bg-secondary/30 text-foreground text-xs px-2.5 py-1.5 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/30`;
  const sel = `${inp} appearance-none cursor-pointer`;

  async function doCreate() {
    const name = newName.trim().replace(/\s+/g, '_').toLowerCase();
    if (!name) return;
    setCreateLoading(true);
    setCreateErr('');
    try {
      await onCreateDomain(name);
      onSelect(name);
      setCreating(false);
      setNewName('');
    } catch (e: any) {
      setCreateErr(e?.message ?? 'Failed to create domain');
    } finally {
      setCreateLoading(false);
    }
  }

  if (creating) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
        <p className="text-[9px] font-black text-primary/70 uppercase tracking-widest flex items-center gap-1">
          <Plus className="w-2.5 h-2.5" /> Create New Domain
        </p>
        <div className="flex gap-2">
          <input
            autoFocus
            className={inp}
            placeholder="domain_name (e.g. clinic)"
            value={newName}
            onChange={e => setNewName(e.target.value.replace(/\s+/g, '_').toLowerCase())}
            onKeyDown={e => {
              if (e.key === 'Enter') doCreate();
              if (e.key === 'Escape') { setCreating(false); setCreateErr(''); }
            }}
          />
          <button
            type="button"
            onClick={doCreate}
            disabled={createLoading || !newName.trim()}
            title="Create domain"
            className="flex-shrink-0 p-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            {createLoading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <CheckCircle2 className="w-3.5 h-3.5" />
            }
          </button>
          <button
            type="button"
            onClick={() => { setCreating(false); setCreateErr(''); }}
            title="Cancel"
            className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {createErr && (
          <p className="text-[9px] text-destructive font-semibold">{createErr}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select
          className={sel}
          value={value}
          onChange={e => onSelect(e.target.value)}
        >
          <option value="">— select a domain —</option>
          {allDomainNames.map(name => (
            <option key={name} value={name}>{domainLabels[name] || name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setCreating(true)}
          title="Create new domain to link to"
          className="flex-shrink-0 p-1.5 rounded-lg bg-secondary/60 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors border border-border"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {value && (
        <div className="flex items-center gap-1.5 text-[10px] text-blue-500/80 bg-blue-500/5 border border-blue-500/20 rounded-lg px-2.5 py-1.5">
          <Link2 className="w-3 h-3 flex-shrink-0" />
          <span>Each record links to one <strong>{value}</strong> record</span>
        </div>
      )}

      {allDomainNames.length === 0 && !value && (
        <p className="text-[9px] text-muted-foreground/40 italic">
          No domains exist yet — click <strong>+</strong> to create one first.
        </p>
      )}
    </div>
  );
}

// ─── Single field editor row ──────────────────────────────────────────────────

function FieldEditor({
  field,
  onChange,
  onDelete,
  allDomainNames,
  domainLabels,
  onCreateDomain,
}: {
  field: FieldDraft;
  onChange: (updated: FieldDraft) => void;
  onDelete: () => void;
  allDomainNames: string[];
  domainLabels?: Record<string, string>;
  onCreateDomain: (name: string) => Promise<void>;
}) {
  const [open,       setOpen]       = useState(false);
  const [activeTab,  setActiveTab]  = useState<'field' | 'validations'>('field');

  function set<K extends keyof FieldDraft>(key: K, value: FieldDraft[K]) {
    onChange({ ...field, [key]: value });
  }

  function addValidation() {
    const allowed = VALID_RULES_FOR_TYPE[field.type] ?? ['required'];
    // Pick first allowed type not already added
    const existing = new Set(field.validations.map(v => v.type));
    const next = allowed.find(t => !existing.has(t)) ?? allowed[0];
    const draft: ValidationDraft = { _id: uid(), type: next, value: '', message: '' };
    set('validations', [...field.validations, draft]);
  }

  function updateValidation(id: string, patch: Partial<ValidationDraft>) {
    set('validations', field.validations.map(v => v._id === id ? { ...v, ...patch } : v));
  }

  function removeValidation(id: string) {
    set('validations', field.validations.filter(v => v._id !== id));
  }

  const inp = `w-full rounded-lg border border-border bg-secondary/30 text-foreground text-xs px-2.5 py-1.5 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/30`;
  const sel = `${inp} appearance-none cursor-pointer`;

  const allowedTypes = VALID_RULES_FOR_TYPE[field.type] ?? VALIDATION_TYPES.map(t => t.value);
  const validationCount = field.validations.length;

  return (
    <div className={`rounded-xl border bg-card overflow-hidden transition-all ${open ? 'border-primary/30 shadow-sm shadow-primary/5' : 'border-border'}`}>

      {/* ── Collapsed header ── */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-secondary/20 transition-colors select-none"
        onClick={() => setOpen(o => !o)}
      >
        <GripVertical className="w-3 h-3 text-muted-foreground/20 flex-shrink-0" />
        <span className="text-muted-foreground/50 flex-shrink-0">{fieldTypeIcon(field.type)}</span>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">
            {field.label || field.field_id || <span className="italic text-muted-foreground/30">Unnamed field</span>}
          </p>
          <p className="text-[9px] font-mono text-muted-foreground/30 truncate">
            {field.field_id || '—'}
            {field.type === 'relation' && field.datasource && (
              <span className="ml-1 text-blue-400/70 not-font-mono">→ {field.datasource}</span>
            )}
          </p>
        </div>

        {/* Validation count pill */}
        {validationCount > 0 && (
          <span className="flex items-center gap-0.5 text-[9px] font-bold bg-primary/10 text-primary/80 px-1.5 py-0.5 rounded-full flex-shrink-0">
            <ShieldCheck className="w-2.5 h-2.5" /> {validationCount}
          </span>
        )}

        <div className="flex items-center gap-1 flex-shrink-0">
          {open
            ? <ChevronDown  className="w-3.5 h-3.5 text-muted-foreground/40" />
            : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />
          }
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="p-1 rounded-lg text-muted-foreground/20 hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* ── Expanded editor ── */}
      {open && (
        <div className="border-t border-border/40">

          {/* Tab bar */}
          <div className="flex border-b border-border/40 bg-secondary/10">
            <button
              type="button"
              onClick={() => setActiveTab('field')}
              className={`flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors border-b-2 ${
                activeTab === 'field'
                  ? 'border-primary text-primary bg-card'
                  : 'border-transparent text-muted-foreground/50 hover:text-foreground'
              }`}
            >
              <Edit3 className="w-2.5 h-2.5" /> Field
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('validations')}
              className={`flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors border-b-2 ${
                activeTab === 'validations'
                  ? 'border-primary text-primary bg-card'
                  : 'border-transparent text-muted-foreground/50 hover:text-foreground'
              }`}
            >
              <ShieldCheck className="w-2.5 h-2.5" /> Validations
              {validationCount > 0 && (
                <span className={`text-[8px] font-black px-1 py-0.5 rounded-full ${
                  activeTab === 'validations' ? 'bg-primary text-primary-foreground' : 'bg-primary/15 text-primary/70'
                }`}>
                  {validationCount}
                </span>
              )}
            </button>
          </div>

          {/* ── TAB: Field Config ── */}
          {activeTab === 'field' && (
            <div className="p-3 space-y-3 bg-card">

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest">Field ID</label>
                  <input
                    className={inp}
                    placeholder="field_id"
                    value={field.field_id}
                    onChange={e => set('field_id', e.target.value.replace(/\s+/g, '_').toLowerCase())}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest">Label</label>
                  <input
                    className={inp}
                    placeholder="Display label"
                    value={field.label}
                    onChange={e => set('label', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest">Type</label>
                  <select
                    className={sel}
                    value={field.type}
                    onChange={e => {
                      const newType = e.target.value as FieldType;
                      // Clear datasource when switching away from relation
                      onChange({ ...field, type: newType, datasource: newType !== 'relation' ? undefined : field.datasource });
                    }}
                  >
                    {FIELD_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                {/* Default value — hidden for relation fields */}
                {field.type !== 'relation' && (
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest">Default Value</label>
                    {field.type === 'boolean' ? (
                      <select className={sel} value={field.defaultValue} onChange={e => set('defaultValue', e.target.value)}>
                        <option value="">None</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    ) : (
                      <input
                        className={inp}
                        placeholder="Optional"
                        value={field.defaultValue}
                        onChange={e => set('defaultValue', e.target.value)}
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Relation: domain link picker */}
              {field.type === 'relation' && (
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest flex items-center gap-1">
                    <Link2 className="w-2.5 h-2.5" /> Target Domain
                  </label>
                  <RelationPicker
                    value={field.datasource ?? ''}
                    allDomainNames={allDomainNames}
                    domainLabels={domainLabels}
                    onSelect={name => set('datasource', name)}
                    onCreateDomain={onCreateDomain}
                  />
                </div>
              )}

              {/* Placeholder — not meaningful for relation fields */}
              {field.type !== 'relation' && (
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest">Placeholder</label>
                  <input
                    className={inp}
                    placeholder="Hint text shown inside the input"
                    value={field.placeholder}
                    onChange={e => set('placeholder', e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── TAB: Validations ── */}
          {activeTab === 'validations' && (
            <div className="p-3 space-y-2 bg-card">

              {/* Empty state */}
              {validationCount === 0 && (
                <div className="py-6 rounded-xl border border-dashed border-border/50 flex flex-col items-center gap-2 text-center">
                  <ShieldCheck className="w-5 h-5 text-muted-foreground/20" />
                  <p className="text-[9px] font-bold text-muted-foreground/40 uppercase tracking-widest">No rules yet</p>
                  <p className="text-[9px] text-muted-foreground/30">
                    Click <strong>+ Add Rule</strong> to add a validation
                  </p>
                </div>
              )}

              {/* Rules */}
              {field.validations.map((v, i) => {
                const meta  = VALIDATION_TYPES.find(t => t.value === v.type);
                const hints = VALIDATION_HINTS[v.type] ?? { placeholder: 'Error message (optional)' };
                return (
                  <div key={v._id} className="rounded-xl border border-border bg-secondary/20 overflow-hidden">

                    {/* Rule header */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-secondary/30 border-b border-border/40">
                      <ShieldCheck className="w-3 h-3 text-primary/50 flex-shrink-0" />
                      <span className="text-[9px] font-black text-muted-foreground/50 uppercase tracking-widest">
                        Rule {i + 1}
                      </span>
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={() => removeValidation(v._id)}
                        className="p-1 rounded text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="p-2.5 space-y-2">
                      {/* Type + Value */}
                      <div className="flex gap-2">
                        <div className="space-y-1 flex-1">
                          <label className="text-[8px] font-bold text-muted-foreground/40 uppercase tracking-widest">Rule Type</label>
                          <select
                            className={`${sel} text-[10px]`}
                            value={v.type}
                            onChange={e => updateValidation(v._id, { type: e.target.value as any, value: '', message: '' })}
                          >
                            {VALIDATION_TYPES
                              .filter(t => allowedTypes.includes(t.value))
                              .map(t => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))
                            }
                          </select>
                        </div>
                        {meta?.hasValue && (
                          <div className="space-y-1 w-20 flex-shrink-0">
                            <label className="text-[8px] font-bold text-muted-foreground/40 uppercase tracking-widest">Value</label>
                            <input
                              className={`${inp} text-[10px]`}
                              placeholder={hints.valuePlaceholder ?? 'Value'}
                              value={v.value}
                              onChange={e => updateValidation(v._id, { value: e.target.value })}
                            />
                          </div>
                        )}
                      </div>

                      {/* Custom message */}
                      <div className="space-y-1">
                        <label className="text-[8px] font-bold text-muted-foreground/40 uppercase tracking-widest">
                          Error Message <span className="normal-case font-normal opacity-60">(leave blank for default)</span>
                        </label>
                        <input
                          className={`${inp} text-[10px]`}
                          placeholder={hints.placeholder}
                          value={v.message}
                          onChange={e => updateValidation(v._id, { message: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Add Rule button */}
              <button
                type="button"
                onClick={addValidation}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-primary/30 hover:border-primary/60 hover:bg-primary/5 text-primary/60 hover:text-primary text-[10px] font-bold uppercase tracking-widest transition-all"
              >
                <Plus className="w-3 h-3" /> Add Rule
              </button>

              {/* Allowed rules hint */}
              <p className="text-[8px] text-muted-foreground/30 text-center">
                Available for <strong>{field.type}</strong>: {allowedTypes.join(', ')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export const DomainModelPanel: React.FC = () => {
  const [domains,    setDomains]    = useState<BackendSchemaEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [draft,      setDraft]      = useState<DomainDraft | null>(null);
  const [isNew,      setIsNew]      = useState(false);

  const [saving,     setSaving]     = useState(false);
  const [saveMsg,    setSaveMsg]    = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [dbBackend,     setDbBackend]     = useState<'dynamodb' | 'postgresql'>('dynamodb');
  const [dbSwitching,   setDbSwitching]   = useState(false);
  const [dbSwitchMsg,   setDbSwitchMsg]   = useState<string | null>(null);

  // ── Load all domains ──────────────────────────────────────────────────────

  const loadDomains = useCallback(async () => {
    setLoading(true); setFetchError(null);
    try {
      const res = await fetchAllSchemas();
      if (res.status !== 'success') throw new Error(res.status);
      setDomains(res.schemas ?? []);
    } catch (e: any) {
      setFetchError(e?.message ?? 'Failed to load domains');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDomains(); }, [loadDomains]);

  // ── Load current DB backend ───────────────────────────────────────────────

  useEffect(() => {
    getDatastoreConfig()
      .then(res => setDbBackend(res.db_backend))
      .catch(() => {/* silently ignore — default stays dynamodb */});
  }, []);

  // ── Switch DB backend ─────────────────────────────────────────────────────

  async function switchBackend(target: 'dynamodb' | 'postgresql') {
    if (target === dbBackend || dbSwitching) return;
    setDbSwitching(true);
    setDbSwitchMsg(null);
    try {
      const res = await setDatastoreBackend(target);
      if (res.status === 'success') {
        setDbBackend(target);
        setDbSwitchMsg(`Switched to ${target === 'dynamodb' ? 'DynamoDB' : 'PostgreSQL'}`);
        setTimeout(() => setDbSwitchMsg(null), 3000);
        loadDomains();
      } else {
        setDbSwitchMsg(res.message ?? 'Switch failed');
      }
    } catch (e: any) {
      setDbSwitchMsg(e?.message ?? 'Switch failed');
    } finally {
      setDbSwitching(false);
    }
  }

  // ── Open existing domain ──────────────────────────────────────────────────

  function openDomain(entry: BackendSchemaEntry) {
    setIsNew(false);
    setDraft({
      name: entry.table_name,
      fields: entry.schema.map(backendFieldToDraft),
      viewConfig: loadDomainViewConfig(entry.table_name),
    });
    setSaveMsg(null);
  }

  // ── Start new domain (no intermediate "confirm" step) ─────────────────────

  function startNewDomain() {
    setIsNew(true);
    setDraft({ name: '', fields: [], viewConfig: {} });
    setSaveMsg(null);
  }

  // ── Domain View Configuration (Table/Form/Card views) ─────────────────────

  function setViewConfig(cfg: DomainViewConfig) {
    if (!draft) return;
    setDraft({ ...draft, viewConfig: cfg });
  }

  function cancelNew() {
    setDraft(null);
    setIsNew(false);
    setSaveMsg(null);
  }

  // ── Field CRUD ────────────────────────────────────────────────────────────

  function addField() {
    if (!draft) return;
    const f: FieldDraft = {
      _id: uid(), field_id: '', label: '', type: 'text',
      placeholder: '', defaultValue: '', validations: [],
    };
    setDraft({ ...draft, fields: [...draft.fields, f] });
  }

  function updateField(id: string, updated: FieldDraft) {
    if (!draft) return;
    setDraft({ ...draft, fields: draft.fields.map(f => f._id === id ? updated : f) });
  }

  function deleteField(id: string) {
    if (!draft) return;
    setDraft({ ...draft, fields: draft.fields.filter(f => f._id !== id) });
  }

  // ── Save / Create ─────────────────────────────────────────────────────────

  async function handleSave() {
    if (!draft) return;

    const name = draft.name.trim();
    if (!name) { setSaveMsg({ type: 'err', text: 'Domain name is required.' }); return; }

    const emptyIds = draft.fields.filter(f => !f.field_id.trim());
    if (emptyIds.length) {
      setSaveMsg({ type: 'err', text: 'All fields must have a Field ID.' }); return;
    }

    const ids   = draft.fields.map(f => f.field_id.trim());
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) {
      setSaveMsg({ type: 'err', text: `Duplicate field IDs: ${[...new Set(dupes)].join(', ')}` }); return;
    }

    // Relation fields must have a target domain selected
    const unlinked = draft.fields.filter(f => f.type === 'relation' && !f.datasource?.trim());
    if (unlinked.length) {
      const labels = unlinked.map(f => f.label || f.field_id || 'Unnamed').join(', ');
      setSaveMsg({ type: 'err', text: `Select a target domain for: ${labels}` }); return;
    }

    setSaving(true); setSaveMsg(null);
    try {
      const res = await createDomain({ table_name: name, schema: draft.fields.map(draftToBackendField) });
      if (res.status === 'success') {
        const wasNew = isNew;
        saveDomainViewConfig(name, draft.viewConfig);
        setIsNew(false);
        setSaveMsg({ type: 'ok', text: `"${name}" ${wasNew ? 'created' : 'saved'} successfully.` });
        await loadDomains();
      } else {
        throw new Error(res.message ?? 'Save failed');
      }
    } catch (e: any) {
      setSaveMsg({ type: 'err', text: e?.message ?? 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  const allDomainNames = domains.map(d => d.table_name);
  const domainLabels: Record<string, string> = Object.fromEntries(
    domains.map(d => [d.table_name, d.label?.trim() || d.table_name]),
  );

  // ── Create a brand-new empty domain (used by RelationPicker inline flow) ──

  async function handleCreateDomain(name: string): Promise<void> {
    const res = await createDomain({ table_name: name, schema: [] });
    if (res.status !== 'success') throw new Error(res.message ?? 'Failed to create domain');
    await loadDomains();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">

      {/* ── Left: domain list ── */}
      <div className="w-52 border-r border-border flex flex-col flex-shrink-0 bg-secondary/10">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Domains</span>
          <div className="flex items-center gap-1">
            <button onClick={loadDomains} title="Refresh"
              className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-secondary transition-colors">
              <RefreshCw className="w-3 h-3" />
            </button>
            <button onClick={startNewDomain} title="New Domain"
              className="p-1.5 rounded-lg text-primary bg-primary/10 hover:bg-primary/20 transition-colors">
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin text-primary/40" />
            </div>
          ) : fetchError ? (
            <p className="p-3 text-[10px] text-destructive/70">{fetchError}</p>
          ) : domains.length === 0 ? (
            <p className="p-4 text-[10px] text-muted-foreground/40 text-center leading-relaxed font-medium">
              No domains yet.<br />Click + to create one.
            </p>
          ) : domains.map(entry => (
            <button
              key={entry.table_name}
              onClick={() => openDomain(entry)}
              className={`w-full text-left px-4 py-2.5 text-xs font-semibold transition-colors hover:bg-secondary/60 ${
                draft?.name === entry.table_name && !isNew
                  ? 'bg-primary/10 text-primary border-r-2 border-primary'
                  : 'text-foreground'
              }`}
            >
              <div className="flex items-center gap-2">
                <Database className="w-3 h-3 flex-shrink-0 text-muted-foreground/40" />
                <span className="truncate" title={entry.table_name}>{entry.label?.trim() || entry.table_name}</span>
              </div>
              <span className="text-[9px] font-mono text-muted-foreground/30 pl-5">
                {entry.schema.length} field{entry.schema.length !== 1 ? 's' : ''}
              </span>
            </button>
          ))}
        </div>

        {/* ── DB backend toggle ── */}
        <div className="border-t border-border p-3 flex-shrink-0">
          <div className="flex items-center gap-1.5 mb-2">
            <ServerCog className="w-3 h-3 text-muted-foreground/40" />
            <span className="text-[9px] font-black text-muted-foreground/50 uppercase tracking-widest">Database</span>
            {dbSwitching && <Loader2 className="w-2.5 h-2.5 animate-spin text-primary/50 ml-auto" />}
          </div>
          <div className="flex rounded-lg overflow-hidden border border-border">
            <button
              type="button"
              disabled={dbSwitching}
              onClick={() => switchBackend('dynamodb')}
              className={`flex-1 py-1.5 text-[9px] font-black uppercase tracking-widest transition-colors ${
                dbBackend === 'dynamodb'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground/50 hover:text-foreground hover:bg-secondary/60'
              }`}
            >
              DynamoDB
            </button>
            <button
              type="button"
              disabled={dbSwitching}
              onClick={() => switchBackend('postgresql')}
              className={`flex-1 py-1.5 text-[9px] font-black uppercase tracking-widest transition-colors border-l border-border ${
                dbBackend === 'postgresql'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground/50 hover:text-foreground hover:bg-secondary/60'
              }`}
            >
              PostgreSQL
            </button>
          </div>
          {dbSwitchMsg && (
            <p className={`text-[9px] mt-1.5 text-center font-semibold ${
              dbSwitchMsg.includes('Switched') ? 'text-emerald-500' : 'text-destructive/70'
            }`}>
              {dbSwitchMsg}
            </p>
          )}
        </div>
      </div>

      {/* ── Right: editor ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Empty state */}
        {!draft && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8 opacity-40">
            <Database className="w-10 h-10 text-muted-foreground" />
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Select a domain to edit<br />
              <span className="text-[10px] font-normal normal-case opacity-60">or click + to create a new one</span>
            </p>
          </div>
        )}

        {draft && (
          <>
            {/* ── Header ── */}
            <div className="px-5 py-3 border-b border-border flex items-center gap-3 flex-shrink-0">
              <Database className="w-4 h-4 text-primary/60 flex-shrink-0" />

              {/* Editable name for new domains, static for existing */}
              {isNew ? (
                <input
                  autoFocus
                  className="flex-1 rounded-xl border border-primary/40 bg-primary/5 text-foreground text-sm font-bold px-3 py-1.5 outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/30"
                  placeholder="domain_name  (e.g. employees)"
                  value={draft.name}
                  onChange={e => setDraft({ ...draft, name: e.target.value.replace(/\s+/g, '_').toLowerCase() })}
                />
              ) : (
                <h3 className="font-black text-sm text-foreground flex-1 truncate">{draft.name}</h3>
              )}

              {/* Cancel (new only) */}
              {isNew && (
                <button onClick={cancelNew}
                  className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-secondary transition-colors">
                  <X className="w-4 h-4" />
                </button>
              )}

              {/* Save / Create Domain button */}
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-black uppercase tracking-widest transition-all hover:scale-105 hover:shadow-lg hover:shadow-primary/20 disabled:opacity-50 disabled:scale-100 flex-shrink-0"
              >
                {saving
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                  : isNew
                    ? <><Plus className="w-3.5 h-3.5" /> Create Domain</>
                    : <><Save className="w-3.5 h-3.5" /> Save</>
                }
              </button>
            </div>

            {/* ── New domain hint strip ── */}
            {isNew && (
              <div className="mx-5 mt-3 flex items-start gap-2 rounded-xl bg-primary/5 border border-primary/15 p-3 text-[10px] text-primary/70 leading-relaxed flex-shrink-0">
                <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  Give your domain a name, add fields below, and set validation rules on each field.
                  When you're ready, click <strong>Create Domain</strong>.
                </span>
              </div>
            )}

            {/* Status banner */}
            {saveMsg && (
              <div className={`mx-5 mt-3 flex items-center gap-2 rounded-xl p-3 text-xs font-semibold animate-in fade-in duration-200 flex-shrink-0 ${
                saveMsg.type === 'ok'
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600'
                  : 'bg-destructive/10 border border-destructive/20 text-destructive'
              }`}>
                {saveMsg.type === 'ok'
                  ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  : <AlertCircle  className="w-4 h-4 flex-shrink-0" />
                }
                {saveMsg.text}
              </div>
            )}

            {/* ── Fields ── */}
            <div className="flex-1 overflow-y-auto p-5 space-y-2">

              {draft.fields.length === 0 && (
                <div className="py-10 rounded-2xl border-2 border-dashed border-border/40 text-center flex flex-col items-center gap-2">
                  <Plus className="w-5 h-5 text-muted-foreground/20" />
                  <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">No fields yet</p>
                  <p className="text-[10px] text-muted-foreground/30">Click <strong>+ Add Field</strong> below</p>
                </div>
              )}

              {draft.fields.map(field => (
                <FieldEditor
                  key={field._id}
                  field={field}
                  onChange={updated => updateField(field._id, updated)}
                  onDelete={() => deleteField(field._id)}
                  allDomainNames={allDomainNames}
                  domainLabels={domainLabels}
                  onCreateDomain={handleCreateDomain}
                />
              ))}

              {/* Add field */}
              <button
                onClick={addField}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary/5 text-muted-foreground/50 hover:text-primary/70 text-xs font-semibold transition-all"
              >
                <Plus className="w-4 h-4" /> Add Field
              </button>

              {/* Domain View Configuration — moved here from the Schema
                  Inspector's "Domain Model" tab, so table/form/card view
                  settings live next to the fields that drive them. */}
              <DomainViewConfigSection
                domainName={draft.name}
                fieldNames={draft.fields.map(f => f.field_id).filter(Boolean)}
                value={draft.viewConfig}
                onChange={setViewConfig}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};