import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ClipboardList, Loader2, CheckCircle2, AlertCircle,
  Send, Database, Type, Hash, Calendar,
  ToggleLeft, AlignLeft, Link2, Eye, X, ShieldCheck, RefreshCw,
  Users, FileText,
} from 'lucide-react';
import { type ViewBuilderPlugin } from '../sky-view-builder/core/plugin';
import {
  fetchDomainSchema,
  fetchDomainRows,
  submitFormRow,
  extractFieldErrors,
  updateDomainRow,
  setDatastoreBackend,
  createDomain,
  fetchAllSchemas,
  normalizeSchemaField,
  type BackendSchemaField,
} from '../api/datastoreApi';
import { fetchRolesForDomain } from '../api/rolesApi';
// At the top of formplugin.tsx, replace the imports:
import { withDbMultiLang, useFieldTranslations, useAppLanguage } from '../sky-view-builder/components/withDbMultiLang';
import { LanguageSwitcher } from '../sky-view-builder/components/LanguageSwitcher';
import { DomainLabel, useDomainLabel } from '../sky-view-builder/components/DomainLabel';
import formMultiLang from './form.multilang.json';
import { VisualStyleProvider, useVisualStyle } from '../sky-view-builder/styles/VisualStyleProvider';
import { VisualStyleSettings } from '../sky-view-builder/styles/VisualStyleSettings';
import type { VisualStyleConfig } from '../sky-view-builder/styles/visualStyles';
import { can } from '../lib/permissions';
// ─── Config type ──────────────────────────────────────────────────────────────

type FormConfigs = {
  formTitle: string;
  submitLabel: string;
  columnLayout: '1' | '2';
  successMessage: string;
  showFieldTypes: boolean;

  // ── Review step ────────────────────────────────────────────────────────────
  enableReview: boolean;
  reviewTitle: string;
  confirmLabel: string;

  // ── Post-submit ────────────────────────────────────────────────────────────
  redirectUrl: string;
  visualStyle?: Partial<VisualStyleConfig>;
};

// ─── Field classification helpers ─────────────────────────────────────────────

function isDatasourceField(f: BackendSchemaField) {
  return typeof f.datasource === 'string' && f.datasource.trim() !== '';
}

function isTextareaField(f: BackendSchemaField) {
  return (
    f.type === 'formattedText' ||
    f.component === 'textarea' ||
    f.ui_config?.component === 'textarea'
  );
}

function isBooleanField(f: BackendSchemaField) {
  return f.type === 'boolean';
}

/**
 * A "list" relation is a field whose values live in ANOTHER domain
 * (many-to-many, e.g. school.department). Its own fields belong to the
 * related domain and must never render as a plain input in THIS form —
 * they're collected in a dedicated step after this form is submitted.
 */
function isMultiCardinality(f: BackendSchemaField): boolean {
  const c = String((f as any).cardinality ?? '').toLowerCase();
  return c === 'list' || c === 'many';
}

/**
 * A plain value field (text / number / boolean / date …) whose cardinality is
 * "many" — e.g. several emails or contact persons. It has NO related domain,
 * so it is NOT a relation: it must render inline as a multi-value input
 * (comma-separated) and be submitted as an array.
 */
function isMultiValueField(f: BackendSchemaField): boolean {
  return isMultiCardinality(f) && f.type !== 'list' && f.type !== 'relation' && !getRelatedDomainName(f);
}

/**
 * An association field linked to SEVERAL domain models (e.g. Client.services →
 * MediaService | EventService | PrService). It is a real text column on THIS
 * table that stores WHICH domain the user picked, so it renders inline as a
 * dropdown of those domains; only the chosen domain's form becomes the next
 * step (see FormComponent). The picked record is linked via that domain's
 * `${parent}_${related}` junction table, as for any other association.
 */
function getChoiceDomains(f: BackendSchemaField): string[] {
  const list = (f as any).relatedDomains;
  if (!Array.isArray(list)) return [];
  return Array.from(new Set(list.filter((x: unknown): x is string => typeof x === 'string' && !!x.trim())));
}

export function isDomainChoiceField(f: BackendSchemaField): boolean {
  return getChoiceDomains(f).length > 1;
}

function isListRelationField(f: BackendSchemaField): boolean {
  if (isDomainChoiceField(f)) return false; // a picker column, never a hidden "list" relation
  if (isMultiValueField(f)) return false;
  return f.type === 'list' || isMultiCardinality(f);
}

function splitMulti(raw: string): string[] {
  return raw.split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
}

function getRelatedDomainName(f: BackendSchemaField): string | undefined {
  return (f as any).relatedDomain || (f as any).listDomain || undefined;
}

function htmlInputType(f: BackendSchemaField): React.HTMLInputTypeAttribute {
  if (f.type === 'number') return 'number';
  if (f.type === 'date')   return 'date';

  const DATE_ID_HINTS     = ["date", "day", "dob", "birthday", "from", "start", "end", "due"];
  const TIME_ID_HINTS     = ["time", "hour", "slot"];
  const DATETIME_ID_HINTS = ["datetime", "timestamp", "created", "scheduled"];

  const id = f.field_id.toLowerCase();
  if (DATETIME_ID_HINTS.some(h => id.includes(h))) return 'datetime-local';
  if (TIME_ID_HINTS.some(h => id.includes(h)) && !id.includes("date")) return 'time';
  if (DATE_ID_HINTS.some(h => id.includes(h))) return 'date';

  return 'text';
}
/** Pick a human-readable label from a related-domain row */
function rowLabel(row: Record<string, any>): string {
  // Prefer known "name-like" fields first — this is exactly what was
  // missing before. Without it, the fallback loop below would happily
  // return a foreign-key value (e.g. clinicId) since it's a non-empty
  // string that just happens to come first in the row's key order —
  // that's why every branch option showed the same clinicId number
  // instead of its own branch_name.
  //
  // email/phone moved to the END of this list, not the middle — they were
  // sitting BEFORE clinicName/clinic_name etc., so any row that had both
  // an email AND a proper name field (e.g. clinic.email + clinic.
  // clinic_name) always showed the email, since this loop stops at the
  // first match and email was checked first. A real name field should
  // always win; email/phone are only meant as a last-resort fallback when
  // nothing better exists.
  const NAME_KEYS = [
    'name', 'title', 'label',
    'clinicName', 'branchName', 'doctorName', 'patientName',
    'clinic_name', 'branch_name', 'doctor_name', 'patient_name',
    'fullName', 'displayName',
    'email', 'phone',
  ];
  for (const k of NAME_KEYS) {
    if (row[k] && typeof row[k] === 'string') return row[k];
  }
  const SKIP = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);
  for (const k of Object.keys(row)) {
    // Also skip any other FK field (ends in "Id") — a foreign key is never
    // a meaningful display label for the row it lives on.
    if (!SKIP.has(k) && !k.endsWith('Id') && typeof row[k] === 'string' && row[k]) return row[k];
  }
  // fall back to first non-skipped, non-FK field of any type
  for (const k of Object.keys(row)) {
    if (!SKIP.has(k) && !k.endsWith('Id') && row[k] != null) return String(row[k]);
  }
  return String(row.id ?? '—');
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateField(value: string, field: BackendSchemaField): string | null {
  const str   = value.trim();
  const name  = field.label || field.field_id;

  // ── Domain-choice column: one of the linked domains MUST be picked ────────
  // (it decides which form comes next), and only those domains are valid.
  if (isDomainChoiceField(field)) {
    if (!str) return `Choose one for ${name}`;
    if (!getChoiceDomains(field).some(d => d.toLowerCase() === str.toLowerCase())) {
      return `${name} must be one of: ${getChoiceDomains(field).join(', ')}`;
    }
  }

  // ── Part 1: built-in type checks — always run, no schema rules needed ─────

  if (field.type === 'number' && str !== '') {
    // Allow minus sign and decimal point while typing; reject anything else
    if (isNaN(Number(str)) || str === '-' || str === '.') {
      return `${name} must be a valid number`;
    }
  }

  if (field.type === 'date' && str !== '') {
    const d = new Date(str);
    if (isNaN(d.getTime())) {
      return `${name} must be a valid date`;
    }
  }

  // ── Part 2: schema-defined validation rules ───────────────────────────────

  const rules: any[] = Array.isArray(field.validations) ? field.validations : [];

  const multi = isMultiValueField(field);
  for (const rule of rules) {
    // Per-value rules (length/pattern/min/max) can't be checked against the
    // whole comma-separated string — only "required" applies to it.
    if (multi && rule.type !== 'required') continue;
    switch (rule.type) {
      case 'required':
        if (!str) return rule.message || `${name} is required`;
        break;
      case 'minLength':
        if (str.length > 0 && str.length < Number(rule.value))
          return rule.message || `${name} must be at least ${rule.value} characters`;
        break;
      case 'maxLength':
        if (str.length > Number(rule.value))
          return rule.message || `${name} must be at most ${rule.value} characters`;
        break;
      case 'min':
        if (str !== '' && Number(str) < Number(rule.value))
          return rule.message || `${name} must be at least ${rule.value}`;
        break;
      case 'max':
        if (str !== '' && Number(str) > Number(rule.value))
          return rule.message || `${name} must be at most ${rule.value}`;
        break;
      case 'pattern':
        if (str && !new RegExp(String(rule.value)).test(str))
          return rule.message || `${name} format is invalid`;
        break;
    }
  }
  return null;
}

function isRequired(f: BackendSchemaField) {
  // Picking a domain is what decides the next step, so it can't be skipped.
  if (isDomainChoiceField(f)) return true;
  return (Array.isArray(f.validations) ? f.validations : []).some((r: any) => r.type === 'required');
}

// ─── Field type icon ──────────────────────────────────────────────────────────

function FieldIcon({ type, datasource }: { type: string; datasource?: string }) {
  if (datasource)           return <Link2    className="w-3 h-3" />;
  if (type === 'number')    return <Hash     className="w-3 h-3" />;
  if (type === 'date')      return <Calendar className="w-3 h-3" />;
  if (type === 'boolean')   return <ToggleLeft className="w-3 h-3" />;
  if (type === 'formattedText') return <AlignLeft className="w-3 h-3" />;
  return <Type className="w-3 h-3" />;
}
const VERSIONING_SYSTEM_FIELDS = new Set(['versionOf']);

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useFormSchema(dataSourceId: string | number | null | undefined, refreshKey = 0) {
  const [schema,    setSchema]    = useState<BackendSchemaField[] | null>(null);
  const [dbBackend, setDbBackend] = useState<'dynamodb' | 'postgresql'>('dynamodb');
  const [versioned, setVersioned] = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!dataSourceId) { setSchema(null); setError(null); return; }
    let cancelled = false;
    setLoading(true); setError(null);
   fetchDomainSchema(String(dataSourceId))
  .then(result => {
    if (!cancelled) {
      // Normalize: handle array, nested {schema:[]}, or keyed object
      const raw = result.schema as any;
      let safeSchema: BackendSchemaField[];

      if (Array.isArray(raw)) {
        safeSchema = raw;
      } else if (raw && Array.isArray(raw.schema)) {
        safeSchema = raw.schema;
      } else if (raw && typeof raw === 'object') {
        safeSchema = Object.values(raw) as BackendSchemaField[];
      } else {
        safeSchema = [];
      }

      safeSchema = safeSchema.map(normalizeSchemaField);
      if (import.meta.env.DEV) console.debug('[form] schema for', String(dataSourceId), safeSchema);
      setSchema(safeSchema);
      setDbBackend(result.db_backend);
      setVersioned(!!result.versioned);
    }
  })
      .catch(e => { if (!cancelled) setError(e?.message ?? 'Schema load failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [String(dataSourceId), refreshKey]);

return { schema, dbBackend, versioned, loading, error };
}

function useLinkedOptions(tableName: string | null | undefined) {
  const [options,  setOptions]  = useState<{ value: string; label: string }[]>([]);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    if (!tableName) { setOptions([]); return; }
    let cancelled = false;
    setLoading(true);
    fetchDomainRows(String(tableName))
      .then(rows => {
        if (cancelled) return;
        setOptions(rows.map(r => ({ value: String(r.id ?? ''), label: rowLabel(r) })).filter(o => o.value));
      })
      .catch(() => setOptions([]))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName]);

  return { options, loading };
}

// ─── Related-step detection ──────────────────────────────────────────────────
// A related step is ANY relation whose own fields belong to another domain
// and therefore must never be rendered inline in this form:
//   - "child" : one-to-many — the related domain carries `${parent}Id` as FK.
//               (this domain's schema has no visible field for it at all)
//   - "list"  : many-to-many — THIS domain's schema has an actual field with
//               cardinality "list" pointing at the related domain; records
//               are linked through a `${parent}_${related}` junction table.

export type RelatedStepInfo =
  // `many` = the field was marked cardinality "list": only then does the
  // step offer "+ Add" for several records; otherwise it is one normal form.
  | { kind: 'child'; domain: string; fkField: string; many?: boolean }
  | { kind: 'list'; domain: string; fkField: string; junctionTable: string; many?: boolean };

// ─── Deep Nesting Types ──────────────────────────────────────────────────────

type NestedStepInfo = {
  domain: string;
  parentDomain: string;
  fkField: string;
  depth: number;
  children?: NestedStepInfo[];
  kind: 'child' | 'list';
  junctionTable?: string;
};

function useRelatedSteps(
  dataSourceId: string | number | null | undefined,
  schema: BackendSchemaField[] | null,
): RelatedStepInfo[] {
  const [steps, setSteps] = useState<RelatedStepInfo[]>([]);

  useEffect(() => {
    if (!dataSourceId || !schema) { setSteps([]); return; }
    let cancelled = false;
    const parentDomain  = String(dataSourceId);
    const parentIdField = `${parentDomain}Id`;

    // "list" steps come straight from this domain's own schema. Both
    // "integral" and "association" list fields become a next step.
    const listSteps: RelatedStepInfo[] = schema
      .filter(f => isListRelationField(f))
      .map(f => {
        const related = getRelatedDomainName(f) ?? '';
        return {
          kind: 'list' as const,
          many: true,
          domain: related,
          fkField: parentIdField,
          junctionTable: `${parentDomain}_${related}`,
        };
      })
      .filter(s => !!s.domain);

    // Every domain offered by a domain-choice field is a possible next step,
    // even if its junction table hasn't been created yet (it is created on
    // first use — see RepeatableRelatedStepForm).
    const choiceStepsFor = (existing: RelatedStepInfo[]): RelatedStepInfo[] =>
      schema.filter(isDomainChoiceField).flatMap(cf =>
        getChoiceDomains(cf)
          .filter(d => !existing.some(e => String(e.domain).toLowerCase() === d.toLowerCase()))
          .map(d => ({
            kind: 'list' as const,
            many: false,
            domain: d,
            fkField: parentIdField,
            junctionTable: `${parentDomain}_${d}`,
          })),
      );

    fetchAllSchemas()
      .then(allSchemas => {
        if (cancelled) return;
        // Every related domain becomes a next step, whether its link is
        // "integral" or "association":
        //  - child: another domain carries `${parent}Id` as a real FK.
        //  - junction (many-to-many): a junction table whose FIRST Id field
        //    is `${parent}Id` — only the declaring side gets the step.
        const SYSTEM = new Set(['id','created_at','updated_at','deleted_at','isActive','fromDate','toDate','versionOf']);
        const childSteps: RelatedStepInfo[] = [];
        const listFromJunction: RelatedStepInfo[] = [];
        const eq = (x: unknown, y: unknown) => String(x).toLowerCase() === String(y).toLowerCase();
        for (const s of (allSchemas.schemas ?? []) as any[]) {
          if (eq(s.table_name, parentDomain)) continue;
          // schema may come back as an array or as an object keyed by field
          const fields: any[] = Array.isArray(s.schema) ? s.schema : Object.values(s.schema ?? {});
          const real = fields.filter((f: any) => !SYSTEM.has(f.field_id));
          const isJunction = real.length >= 2 && real.every((f: any) => String(f.field_id).endsWith('Id'));
          if (isJunction) {
            // Only the declaring side gets the step: the junction's FIRST Id
            // column is the domain the link was created from (University in
            // University_College), so College's form shows no next step.
            if (!eq(real[0].field_id, parentIdField)) continue;
            const mine = 0;
            const other = real[1];
            const related = other ? String(other.field_id).slice(0, -2) : '';
            if (!related || listSteps.some(l => eq(l.domain, related))) continue;
            listFromJunction.push({ kind: 'list', many: (other as any)?.cardinality === 'list', domain: related, fkField: String(real[mine].field_id), junctionTable: s.table_name });
            continue;
          }
          if (String(s.table_name).toLowerCase().startsWith(`${parentDomain.toLowerCase()}_`)) continue;
          const fk = fields.find((f: any) => eq(f.field_id, parentIdField));
          if (fk) childSteps.push({ kind: 'child', many: (fk as any).cardinality === 'list', domain: s.table_name, fkField: String(fk.field_id) });
        }

        const base = [...childSteps, ...listSteps, ...listFromJunction];
        setSteps([...base, ...choiceStepsFor(base)]);
      })
      .catch(() => { if (!cancelled) setSteps([...listSteps, ...choiceStepsFor(listSteps)]); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [String(dataSourceId), JSON.stringify(schema?.map(f => f.field_id))]);

  return steps;
}

// One <option> of a domain-choice dropdown: shows the domain's business label,
// submits its table name.
function DomainChoiceOption({ name }: { name: string }) {
  const label = useDomainLabel(name);
  return <option value={name}>{label}</option>;
}

// ─── Individual field input (handles every type) ──────────────────────────────

function FieldInput({
  field, value, hasError, onChange, onBlur, disabled, ownTable,
}: {
  ownTable?: string | number | null;
  field: BackendSchemaField;
  value: string;
  hasError: boolean;
  onChange: (v: string) => void;
  onBlur: () => void;
  disabled?: boolean;
}) {
const { options, loading } = useLinkedOptions(isDatasourceField(field) ? field.datasource : null);

// A field like "libraryId" inside the "Library" domain is that domain's OWN
// identifier, not a reference to another table — render it as a normal input.
const isOwnId = !!ownTable && field.field_id.endsWith('Id') &&
  field.field_id.slice(0, -2).toLowerCase() === String(ownTable).toLowerCase();
const fkDomain = !isDatasourceField(field) && field.field_id.endsWith('Id') && !isOwnId
  ? field.field_id.slice(0, -2)
  : null;
const { options: fkOptions, loading: fkLoading } = useLinkedOptions(fkDomain);

// ── Auto-filled fields — hide from UI, submit silently ──────────────────
const AUTO_HIDDEN = ["fromdate", "validfrom", "todate", "isactive"];
if (AUTO_HIDDEN.some(h => field.field_id.toLowerCase().replace(/_/g, '') === h)) {
  return <input type="hidden" value={value} onChange={() => {}} />;
}
// ────────────────────────────────────────────────────────────────────────

  const ring = hasError
    ? 'border-destructive/60 focus:border-destructive/60 focus:ring-2 focus:ring-destructive/15'
    : 'border-border focus:border-primary/60 focus:ring-2 focus:ring-primary/15';

  const base = `w-full rounded-xl border bg-card text-foreground text-sm px-3 py-2.5 outline-none transition-all placeholder:text-muted-foreground/50 hover:border-border/80 ${ring}`;

  // Linked field — select from another table

  // Association linked to several domain models — choose ONE of them.
  const choiceDomains = getChoiceDomains(field);
  if (choiceDomains.length > 1) {
    return (
      <select className={base} value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur}>
        <option value="">— choose {field.label || field.field_id} —</option>
        {choiceDomains.map(d => <DomainChoiceOption key={d} name={d} />)}
      </select>
    );
  }

  // Linked field — select from another table
// Auto-detect FK fields by name ending in "Id" (e.g. clinicId → clinic)
  if (fkDomain) {
    if (fkLoading) {
      return (
        <div className="flex items-center gap-2 h-10 px-3 rounded-xl border border-border bg-card/50 text-muted-foreground/40 text-xs">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading <DomainLabel name={fkDomain} />…
        </div>
      );
    }
    return (
      <select className={base} value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur}>
        <option value="">— select <DomainLabel name={fkDomain} /> —</option>
        {fkOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        {fkOptions.length === 0 && (
          <option disabled value="">No records in "<DomainLabel name={fkDomain} />" — create one first</option>
        )}
      </select>
    );
  }

  // Linked field — select from another table

  if (isDatasourceField(field)) {
    if (loading) {
      return (
        <div className="flex items-center gap-2 h-10 px-3 rounded-xl border border-border bg-card/50 text-muted-foreground/40 text-xs">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading {field.datasource}…
        </div>
      );
    }
    return (
      <select className={base} value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur}>
        <option value="">— choose {field.label || field.field_id} —</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        {options.length === 0 && <option disabled value="">No records in "{field.datasource}"</option>}
      </select>
    );
  }

  // Multi-valued plain field (cardinality "many") — comma-separated entry
  if (isMultiValueField(field)) {
    return (
      <input
        type="text"
        className={base}
        placeholder={`Enter ${field.label || field.field_id} — separate multiple values with commas`}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
      />
    );
  }

  // Boolean
  if (isBooleanField(field)) {
    return (
      <select className={base} value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur}>
        <option value="">— select —</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  // Multi-line text
  if (isTextareaField(field)) {
    return (
      <textarea
        rows={3}
        className={`${base} resize-y min-h-[80px]`}
        placeholder={field.placeholder ?? field.ui_config?.placeholder ?? `Enter ${field.label || field.field_id}…`}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
      />
    );
  }

  // Default: text / number / date
// Image upload field — triggered by type=image OR field name suggests an image
  const IMAGE_NAME_HINTS = ["logo", "image", "photo", "avatar", "picture", "thumbnail", "banner", "icon"];
  const isImageField = field.type === "image" ||
    IMAGE_NAME_HINTS.some(hint => field.field_id.toLowerCase().includes(hint));

  if (isImageField) {
    return (
      <div className="flex flex-col gap-2">
        {value && (
          <div className="relative w-28 h-28 rounded-xl overflow-hidden border border-border bg-secondary/40">
            <img src={value} alt="preview" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => onChange("")}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center hover:bg-black/80 transition-colors">
              ×
            </button>
          </div>
        )}
        <label className={`flex items-center gap-2 cursor-pointer h-10 px-3 rounded-xl border border-dashed ${hasError ? "border-destructive/60" : "border-border"} bg-secondary/40 hover:bg-secondary/70 transition-colors text-xs text-muted-foreground`}>
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {value ? "Change image" : `Upload ${field.label || field.field_id}…`}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onBlur={onBlur}
              onClick={e => { (e.target as HTMLInputElement).value = ""; }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => onChange(reader.result as string);
                reader.readAsDataURL(file);
              }}
            />
        </label>
      </div>
    );
  }

  // Default: text / number / date
  return (
    <input
      type={htmlInputType(field)}
      className={base}
      placeholder={field.placeholder ?? field.ui_config?.placeholder ?? `Enter ${field.label || field.field_id}…`}
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
    />
  );
}

// ─── Repeatable related-domain step — real sub-form for the related domain's
//     own fields, with entries added one-by-one into a table shown right
//     below it. Used for BOTH relation kinds:
//       - "child" (one-to-many, e.g. school → department via schoolId FK):
//         each entry is inserted straight into the child table with the FK
//         preset to the parent's id.
//       - "list"  (many-to-many via a junction table): each entry is
//         inserted into the related domain, then linked through the
//         junction table.
//     Either way, "a domain has many of these" means the step must let the
//     user add several before moving on — never a single one-shot form. ────

export function RepeatableRelatedStepForm({
  step, parentDomain, parentId, isLastStep, onContinue,
}: {
  step: RelatedStepInfo;
  parentDomain: string;
  parentId?: string;
  isLastStep: boolean;
  onContinue: () => void;
}) {
  const domain = step.domain;
  const { schema: rawSchema, dbBackend: relDbBackend, loading } = useFormSchema(domain);

  // The related domain's own fields, minus any FK/id/system columns and the
  // linking FK itself (preset to the parent id, never user-editable here).
  const editableSchema = useMemo(() => {
    if (!rawSchema) return [];
    return rawSchema.filter(f =>
      f.field_id !== 'id' &&
      f.field_id !== 'created_at' &&
      f.field_id !== 'updated_at' &&
      f.field_id !== step.fkField &&
      !f.field_id.endsWith('Id') &&
      !VERSIONING_SYSTEM_FIELDS.has(f.field_id) &&
      !isListRelationField(f)
    );
  }, [rawSchema, step.fkField]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [items,  setItems]  = useState<Record<string, string>[]>([]);
  const [saving, setSaving] = useState(false);

  function handleChange(fieldId: string, v: string) {
    setValues(p => ({ ...p, [fieldId]: v }));
    setErrors(p => { if (!p[fieldId]) return p; const n = { ...p }; delete n[fieldId]; return n; });
  }

  function addItem() {
    const errs: Record<string, string> = {};
    for (const f of editableSchema) {
      const e = validateField(values[f.field_id] ?? '', f);
      if (e) errs[f.field_id] = e;
    }
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setItems(prev => [...prev, values]);
    setValues({});
    setErrors({});
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleContinue() {
    // If the user filled in the entry sub-form but never clicked
    // "+ Add {domain}" to stage it, don't silently discard it — that's
    // exactly what looked like "it saved" while nothing was ever created.
    // Auto-stage the current field values (if any) before submitting.
    let pending = items;
    const hasUnstagedInput = editableSchema.some(f => (values[f.field_id] ?? '') !== '');
    if (hasUnstagedInput) {
      const errs: Record<string, string> = {};
      for (const f of editableSchema) {
        const e = validateField(values[f.field_id] ?? '', f);
        if (e) errs[f.field_id] = e;
      }
      if (Object.keys(errs).length) { setErrors(errs); return; }
      pending = [...items, values];
      setItems(pending);
      setValues({});
    }

    if (!parentId || pending.length === 0) { onContinue(); return; }
    setSaving(true);
    try {
      for (const item of pending) {
        const row: Record<string, any> = {};
        for (const f of editableSchema) {
          const raw = item[f.field_id] ?? '';
          if (raw === '') continue;
          if (f.type === 'number')       row[f.field_id] = Number(raw);
          else if (f.type === 'boolean') row[f.field_id] = raw === 'true';
          else                           row[f.field_id] = raw;
        }
        try {
          if (step.kind === 'child') {
            // One-to-many — the FK lives directly on the child row.
            row[step.fkField] = parentId;
            await submitFormRow(domain, row);
          } else {
            // Many-to-many — insert the related row, then link via junction.
            const res = await submitFormRow(domain, row);
            if (res.status === 'success' && res.record_id) {
              const link = {
                [`${parentDomain}Id`]: parentId,
                [`${domain}Id`]: res.record_id,
              };
              try {
                await submitFormRow(step.junctionTable, link);
              } catch (e1) {
                // Junction table missing (e.g. only one of several linked
                // domains got one) — create it, then retry once.
                try {
                  await createDomain({
                    table_name: step.junctionTable,
                    schema: [
                      { field_id: `${parentDomain}Id`, type: 'text', label: `${parentDomain}Id`, value: null },
                      { field_id: `${domain}Id`,       type: 'text', label: `${domain}Id`,       value: null },
                    ],
                    db_backend: relDbBackend,
                  });
                  await submitFormRow(step.junctionTable, link);
                } catch (e2) {
                  console.warn(`Junction insert failed for "${step.junctionTable}":`, e2);
                }
              }
            }
          }
        } catch (e) {
          console.warn(`Could not insert "${domain}" row:`, e);
        }
      }
    } finally {
      setSaving(false);
      onContinue();
    }
  }

  const cols = editableSchema.map(f => f.field_id);

  return (
    <div className="p-5 flex flex-col gap-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground capitalize">Add <DomainLabel name={domain} /></h3>
        {step.many && <button
          type="button"
          onClick={addItem}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-black hover:opacity-90 active:scale-95 transition-all"
        >
          + Add <DomainLabel name={domain} />
        </button>}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground/40 text-xs">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading <DomainLabel name={domain} /> fields…
        </div>
      ) : editableSchema.length === 0 ? (
        <div className="text-xs text-muted-foreground/40 italic">
          Domain "<DomainLabel name={domain} />" has no fields to fill in — you can continue.
        </div>
      ) : (
        <>
          {/* ── Entry sub-form ── */}
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-border p-4 bg-secondary/10">
            {editableSchema.map(f => (
              <div key={f.field_id} className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  {f.label || f.field_id}
                  {isRequired(f) && (
                    <span className="text-destructive font-black" style={{ fontSize: '0.55rem' }}>*</span>
                  )}
                </label>
                <FieldInput
                  field={f}
                  value={values[f.field_id] ?? ''}
                  hasError={!!errors[f.field_id]}
                  onChange={v => handleChange(f.field_id, v)}
                  onBlur={() => {}}
                  ownTable={domain}
                />
                {errors[f.field_id] && (
                  <p className="flex items-center gap-1 text-destructive text-[10px] font-semibold">
                    <AlertCircle className="w-3 h-3 flex-shrink-0" /> {errors[f.field_id]}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Table of added entries — only for "list" cardinality */}
          {step.many && (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-3 py-2 bg-secondary/20 border-b border-border text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">
              <DomainLabel name={domain} /> to add ({items.length})
            </div>
            {items.length === 0 ? (
              <div className="px-3 py-5 text-center text-[10px] text-muted-foreground/30 italic">
                No <DomainLabel name={domain} /> added yet
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40 bg-secondary/10">
                    <th className="px-3 py-2 text-left text-[9px] font-black text-muted-foreground/40 uppercase tracking-widest w-8">#</th>
                    {cols.map(c => (
                      <th key={c} className="px-3 py-2 text-left text-[9px] font-black text-muted-foreground/40 uppercase tracking-widest">{c}</th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx} className={`border-b border-border/20 group ${idx % 2 !== 0 ? 'bg-secondary/10' : ''}`}>
                      <td className="px-3 py-2 text-[9px] text-muted-foreground/30 font-bold">{idx + 1}</td>
                      {cols.map(c => (
                        <td key={c} className="px-3 py-2 text-foreground">{item[c] || <span className="text-muted-foreground/30 italic">—</span>}</td>
                      ))}
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="w-6 h-6 rounded-md text-muted-foreground/30 hover:text-destructive/70 hover:bg-destructive/10 text-xs font-bold transition-all flex items-center justify-center opacity-0 group-hover:opacity-100"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          )}
        </>
      )}

      <button
        type="button"
        onClick={handleContinue}
        disabled={saving}
        className="self-start flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-black uppercase tracking-widest transition-all hover:scale-[1.03] hover:shadow-lg hover:shadow-primary/25 active:scale-95 disabled:opacity-50"
      >
        {saving
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
          : <><Send className="w-3.5 h-3.5" /> {isLastStep ? 'Save & Finish' : 'Save & Continue →'}</>}
      </button>
    </div>
  );
}

// ─── The form (always interactive — both in builder and preview) ───────────────

export function FormComponent({
  configs,
  dataSourceId,
  isPreview,
  onSuccess,
  excludeFields,
  presetValues,
  lockedFields,
}: {
  configs: FormConfigs;
  dataSourceId?: string | number | null;
  isPreview?: boolean;
  onSuccess?: () => void;
  excludeFields?: (field: { field_id: string }) => boolean;
  presetValues?: Record<string, string>;
  lockedFields?: string[];
}) {
const [schemaRefreshKey, setSchemaRefreshKey] = useState(0);
  const { schema: rawSchema, dbBackend, versioned, loading, error: schemaError } = useFormSchema(dataSourceId, schemaRefreshKey);
  const allRelatedSteps = useRelatedSteps(dataSourceId, rawSchema);
  const { translateLabel, lang, setLang, languages } =
  useFieldTranslations(dataSourceId ? String(dataSourceId) : null);
const schema = useMemo(() => {
    if (!rawSchema) return rawSchema;
    let s = rawSchema.filter(f => !VERSIONING_SYSTEM_FIELDS.has(f.field_id));
    // Relation fields with list cardinality never render inline in THIS form —
    // their own fields belong to the related domain and are collected in a
    // dedicated step (see RepeatableRelatedStepForm) after this form is submitted.
    s = s.filter(f => !isListRelationField(f));
    if (excludeFields) s = s.filter(f => !excludeFields(f));
    return s;
  }, [rawSchema, excludeFields]);

  const [values,      setValues]      = useState<Record<string, string>>({});

  // ── Domain-choice fields (one association → several domain models) ──────────
  // Every domain in the group has its own junction table, so `allRelatedSteps`
  // lists them ALL. Keep only the one the user picked in the dropdown; the
  // others are alternatives, not extra steps. Domains outside any choice group
  // (ordinary child / list relations) are always kept.
  const choiceFields = useMemo(() => (rawSchema ?? []).filter(isDomainChoiceField), [rawSchema]);
  const stepsForValues = useCallback((vals: Record<string, string>): RelatedStepInfo[] => {
    if (choiceFields.length === 0) return allRelatedSteps;
    const eq = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
    return allRelatedSteps.filter(step => choiceFields.every(cf => {
      if (!getChoiceDomains(cf).some(d => eq(d, step.domain))) return true;
      return eq(vals[cf.field_id] ?? '', step.domain);
    }));
  }, [allRelatedSteps, choiceFields]);
  const relatedSteps = useMemo(() => stepsForValues(values), [stepsForValues, values]);
  const hasChildren  = relatedSteps.length > 0;

  const [errors,      setErrors]      = useState<Record<string, string>>({});
  const [touched,     setTouched]     = useState<Record<string, boolean>>({});
  const [submitState, setSubmitState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [submitMsg,   setSubmitMsg]   = useState('');
  const [showReview,  setShowReview]  = useState(false);
  const [validationBlocked, setValidationBlocked] = useState(false);
  
  // ── Post-submit details view ───────────────────────────────────────────────
  const [showDetails,      setShowDetails]      = useState(false);
  const [detailRecord,     setDetailRecord]     = useState<string | undefined>();
  const [submittedValues,  setSubmittedValues]  = useState<Record<string, string>>({});
  const [submittedAt,      setSubmittedAt]      = useState('');
  const [domainRoles,      setDomainRoles]      = useState<any[]>([]);
  const [rolesLoading,     setRolesLoading]     = useState(false);
  // ── Multi-step child form ──────────────────────────────────────────────────
  const [childSteps,     setChildSteps]     = useState<Array<RelatedStepInfo & { presetValues: Record<string, string> }>>([]);
  const [currentStep,    setCurrentStep]    = useState(0);
  const [parentRecordId, setParentRecordId] = useState<string | undefined>();
  // Stable refs
  const schemaRef  = useRef<BackendSchemaField[] | null>(null);
  const touchedRef = useRef<Record<string, boolean>>({});
  const valuesRef  = useRef<Record<string, string>>({});
  const formRef    = useRef<HTMLFormElement>(null);
  useEffect(() => { schemaRef.current  = schema;  }, [schema]);
  useEffect(() => { touchedRef.current = touched; }, [touched]);
  useEffect(() => { valuesRef.current  = values;  }, [values]);

  // Seed defaults when schema arrives; reset on domain change
// Seed defaults when schema arrives; reset on domain change
useEffect(() => {
  if (!schema) return;

  // ── Helpers for current date/time ─────────────────────────────────────
  const now = new Date();
  const localDate = now.toISOString().slice(0, 10); // "YYYY-MM-DD"
  const localTime = now.toTimeString().slice(0, 5);  // "HH:MM"
  const localDatetime = `${localDate}T${localTime}`; // "YYYY-MM-DDTHH:MM"

const DATE_HINTS = ["date", "day", "dob", "birthday", "fromdate", "startdate", "duedate"];
  const TIME_HINTS     = ["time", "hour", "slot"];
  // Removed the bare "at" substring hint — it was matching ANY field whose
  // name happens to contain the letters "a" followed by "t" anywhere
  // (e.g. "qualification" -> ...c-AT-ion), silently overwriting unrelated
  // text fields with the current datetime. "createdAt" / "scheduledAt"
  // style fields are now matched as an actual suffix instead, on the
  // original (non-lowercased) field_id so the camelCase boundary survives.
  const DATETIME_HINTS = ["datetime", "timestamp", "created", "scheduled"];

  function shouldAutoFillDate(f: BackendSchemaField): boolean {
    if (f.type === "date") return true;
    const id = f.field_id.toLowerCase();
    return DATE_HINTS.some(h => id.includes(h));
  }

  function shouldAutoFillTime(f: BackendSchemaField): boolean {
    if (f.type === "time") return true;
    const id = f.field_id.toLowerCase();
    return TIME_HINTS.some(h => id.includes(h)) && !id.includes("date");
  }

  function shouldAutoFillDatetime(f: BackendSchemaField): boolean {
    if (f.type === "datetime" || f.type === "datetime-local") return true;
    const id = f.field_id.toLowerCase();
    if (DATETIME_HINTS.some(h => id.includes(h))) return true;
    // Suffix match for the camelCase "...At" convention, e.g. createdAt,
    // updatedAt, scheduledAt — checked on the raw field_id so case is
    // preserved (a lowercase id would lose the word boundary entirely).
    return /At$/.test(f.field_id);
  }
  // ──────────────────────────────────────────────────────────────────────

  setValues(() => {
    const defaults: Record<string, string> = {};

  for (const f of schema) {
      // Skip versioning-managed fields — set only by doSubmit on old row
      const NEVER_AUTOFILL = ["todate", "isactive"];
      if (NEVER_AUTOFILL.some(h => f.field_id.toLowerCase().replace(/_/g, '') === h)) continue;

      // 1. Schema-defined default value takes priority
      if (f.value != null) {
        defaults[f.field_id] = String(f.value);
        continue;
      }

      // 2. Auto-fill date/time fields with current value
      if (shouldAutoFillDatetime(f)) {
        defaults[f.field_id] = localDatetime;
      } else if (shouldAutoFillDate(f)) {
        defaults[f.field_id] = localDate;
      } else if (shouldAutoFillTime(f)) {
        defaults[f.field_id] = localTime;
      }
    }

    // 3. Preset values (locked FK fields etc.) always win
    if (presetValues) {
      for (const k of Object.keys(presetValues)) defaults[k] = presetValues[k];
    }

    return defaults;
  });

  setErrors({});
  setTouched({});
  setSubmitState('idle');
  setValidationBlocked(false);
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [schema, presetValues]);

  /**
   * On every keystroke:
   *  - always update the value
   *  - if the field has already been touched (blurred once) or has an
   *    existing error, re-run validation immediately so the user sees the
   *    error update live while typing — no need to blur again.
   */
  const handleChange = useCallback((fieldId: string, val: string) => {
    setValidationBlocked(false);
    setValues(p => {
      const next = { ...p, [fieldId]: val };
      valuesRef.current = next;
      return next;
    });
    setErrors(prev => {
      const wasTouched = !!touchedRef.current[fieldId];
      const hadError   = !!prev[fieldId];
      if (!wasTouched && !hadError) return prev;          // not interacted yet — leave alone

      const currentSchema = schemaRef.current;
      if (!currentSchema) return prev;
      const field = currentSchema.find(f => f.field_id === fieldId);
      if (!field) return prev;

      const err = validateField(val, field);
      if (!err) { const n = { ...prev }; delete n[fieldId]; return n; }
      return { ...prev, [fieldId]: err };
    });
  }, []);  // stable — uses refs internally

  /**
   * On blur: mark field as touched and run validation once.
   * This is the trigger for the very first validation of a field.
   */
  const handleBlur = useCallback((field: BackendSchemaField) => {
    setTouched(p => {
      const next = { ...p, [field.field_id]: true };
      touchedRef.current = next;
      return next;
    });
    // Read latest value directly from state setter to avoid stale closure
    setValues(currentValues => {
      const err = validateField(currentValues[field.field_id] ?? '', field);
      setErrors(prev =>
        err ? { ...prev, [field.field_id]: err }
            : (() => { const n = { ...prev }; delete n[field.field_id]; return n; })()
      );
      return currentValues; // no change to values
    });
  }, []);  // stable — reads values via setter trick

  function validateAll(): boolean {
    if (!schema) return false;
    const currentValues = valuesRef.current;
    const errs: Record<string, string> = {};
    const touched2: Record<string, boolean> = {};
    for (const f of schema) {
      touched2[f.field_id] = true;
      const e = validateField(currentValues[f.field_id] ?? '', f);
      if (e) errs[f.field_id] = e;
    }
    setTouched(touched2);
    setErrors(errs);

    // Scroll to first error field after React re-renders
    const firstErrorId = Object.keys(errs)[0];
    if (firstErrorId) {
      requestAnimationFrame(() => {
        const el = formRef.current?.querySelector(`[data-field-id="${firstErrorId}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }

    return Object.keys(errs).length === 0;
  }

  /** Called after review confirmation (or directly if review is disabled). */
async function doSubmit() {
    if (!schema) return;
    setShowReview(false);
    setSubmitState('loading');

    try {
      const row: Record<string, any> = {};
      for (const f of schema) {
        const raw = values[f.field_id] ?? '';
        if (raw === '') continue;
        if (isMultiValueField(f)) {
          const parts = splitMulti(raw);
          if (parts.length === 0) continue;
          row[f.field_id] = f.type === 'number'  ? parts.map(Number)
                          : f.type === 'boolean' ? parts.map(x => x === 'true')
                          : parts;
          continue;
        }
        if (f.type === 'number')       row[f.field_id] = Number(raw);
        else if (f.type === 'boolean') row[f.field_id] = raw === 'true';
        else                           row[f.field_id] = raw;
      }

      let successMsg = configs.successMessage?.trim();
      if (!dataSourceId) throw new Error('No domain model selected.');

      await setDatastoreBackend(dbBackend);



let res = await submitFormRow(String(dataSourceId), row);

      // Auto-create table if missing then retry
      if (
        res.status === 'error' &&
        (res.message?.includes('ResourceNotFoundException') || res.message?.includes('not found'))
      ) {
        await createDomain({
          table_name: String(dataSourceId),
          schema: schema.map(f => ({ field_id: f.field_id, type: f.type, label: f.label, value: f.value })),
          db_backend: dbBackend,
        });
        res = await submitFormRow(String(dataSourceId), row);
      }

      // Server validation errors (any status that carries per-field reasons)
      const resFieldErrors = res.errors ? extractFieldErrors({ errors: res.errors }) : {};
      if (Object.keys(resFieldErrors).length > 0) {
        const serverErrors = resFieldErrors;
        const touched2: Record<string, boolean> = {};
        Object.keys(serverErrors).forEach(fid => { touched2[fid] = true; });
        setTouched(prev => ({ ...prev, ...touched2 }));
        setErrors(prev => ({ ...prev, ...serverErrors }));
        setValidationBlocked(true);
        setSubmitState('idle');
        return;
      }

      if (res.status !== 'success') throw new Error(res.message ?? 'Submission failed');

      const dbLabel = dbBackend === 'postgresql' ? 'PostgreSQL' : 'DynamoDB';
      successMsg = successMsg || `Saved to ${dbLabel}! Record ID: ${res.record_id ?? '—'}`;

      // ── Launch child/list step wizard (steps already known from the hook) ──
      const stepsNow = stepsForValues(valuesRef.current);
      if (res.record_id && stepsNow.length > 0) {
        setChildSteps(stepsNow.map((step) => ({
          ...step,
          presetValues: { [`${String(dataSourceId)}Id`]: res.record_id! },
        })));
        setParentRecordId(res.record_id);
        setCurrentStep(1);

        const snapshot = { ...valuesRef.current };
        setSubmittedValues(snapshot);
        setSubmittedAt(new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
        setDetailRecord(res.record_id);
        setSubmitState('success');
        setSubmitMsg('');
        setValues(() => {
          const defaults: Record<string, string> = {};
          for (const f of schema) { if (f.value != null) defaults[f.field_id] = String(f.value); }
          return defaults;
        });
        setErrors({});
        setTouched({});
        return; // wizard takes over — skip showDetails
      }

      const snapshot = { ...valuesRef.current };
      setSubmittedValues(snapshot);
      setSubmittedAt(new Date().toLocaleString(undefined, {
        dateStyle: 'medium', timeStyle: 'short',
      }));
      setDetailRecord(res.record_id);
      setSubmitState('success');
      setSubmitMsg(successMsg || 'Done!');

      onSuccess?.();

      setValues(() => {
        const defaults: Record<string, string> = {};
        for (const f of schema) { if (f.value != null) defaults[f.field_id] = String(f.value); }
        return defaults;
      });
      setErrors({});
      setTouched({});

      setRolesLoading(true);
      fetchRolesForDomain(String(dataSourceId))
        .then(roles => setDomainRoles(roles))
        .catch(() => setDomainRoles([]))
        .finally(() => setRolesLoading(false));

      setShowDetails(true);

      const redirect = configs.redirectUrl?.trim();
      if (redirect) {
        setTimeout(() => { window.location.href = redirect; }, 1500);
      }
    } catch (err: any) {
      // HTTP 4xx with per-field reasons → show them under the fields.
      const fe: Record<string, string> = err?.fieldErrors ?? {};
      if (Object.keys(fe).length > 0) {
        const t: Record<string, boolean> = {};
        Object.keys(fe).forEach(fid => { t[fid] = true; });
        setTouched(prev => ({ ...prev, ...t }));
        setErrors(prev => ({ ...prev, ...fe }));
        setValidationBlocked(true);
      }
      setSubmitState('error');
      setSubmitMsg(err?.message ?? 'Submission failed. Please try again.');
      setTimeout(() => setSubmitState('idle'), 6000);
    }
  }
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!schema) return;
    if (!validateAll()) {
      setValidationBlocked(true);
      return;
    }
    setValidationBlocked(false);

    if (configs.enableReview) {
      // Show the review dialog — actual fetch happens only after user confirms
      setShowReview(true);
    } else {
      doSubmit();
    }
  }

  const colClass      = configs.columnLayout === '2' ? 'grid-cols-2' : 'grid-cols-1';
  const reviewEnabled = !!configs.enableReview;

  const DB_LABEL = dbBackend === 'postgresql' ? 'PostgreSQL' : 'DynamoDB';
  const DB_COLOR = dbBackend === 'postgresql'
    ? 'bg-blue-500/10 border-blue-500/20 text-blue-600/80'
    : 'bg-orange-500/10 border-orange-500/20 text-orange-600/80';

// ── Child / list-relation step wizard ────────────────────────────────────────
  if (currentStep > 0 && childSteps.length > 0 && !showDetails) {
    const step = childSteps[currentStep - 1];
    const isLastStep = currentStep === childSteps.length;
    const totalSteps = childSteps.length + 1; // parent + all related steps

    function finishOrAdvance() {
      if (isLastStep) {
        setCurrentStep(0);
        setChildSteps([]);
        setShowDetails(true);
      } else {
        setCurrentStep(s => s + 1);
      }
    }

    return (
      <div className="h-full w-full flex flex-col bg-card rounded-2xl overflow-hidden">

        {/* Step progress bar */}
        <div className="px-5 py-3 border-b border-border bg-secondary/20 shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-black text-muted-foreground/50 uppercase tracking-widest">
              Step {currentStep + 1} of {totalSteps}
            </span>
            <span className="ml-auto text-[9px] text-muted-foreground/30 font-mono">
              parentId: {parentRecordId?.slice(0, 8)}…
            </span>
            <button
              type="button"
              onClick={finishOrAdvance}
              className="text-[10px] text-muted-foreground/50 hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Skip →
            </button>
          </div>

          {/* Step indicators */}
          <div className="flex items-center gap-1.5">
            {/* Parent step — always completed */}
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-[10px] font-bold text-emerald-600 truncate max-w-[80px]">
                {String(dataSourceId)}
              </span>
            </div>

            {/* Related steps */}
            {childSteps.map((s, idx) => {
              const stepNum  = idx + 1;
              const isDone   = stepNum < currentStep;
              const isActive = stepNum === currentStep;
              return (
                <React.Fragment key={`${s.kind}-${s.domain}`}>
                  <span className="text-muted-foreground/20 text-xs shrink-0">→</span>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                      isDone   ? 'bg-emerald-500' :
                      isActive ? 'bg-primary' :
                                 'bg-border/40'
                    }`}>
                      {isDone
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                        : <span className={`text-[10px] font-black ${isActive ? 'text-white' : 'text-muted-foreground/40'}`}>
                            {stepNum}
                          </span>
                      }
                    </div>
                    <span className={`text-[10px] font-bold truncate max-w-[80px] ${
                      isDone   ? 'text-emerald-600' :
                      isActive ? 'text-primary' :
                                 'text-muted-foreground/30'
                    }`}>
                      <DomainLabel name={s.domain} />{s.many ? ' [ ]' : ''}
                    </span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Step body — always repeatable: a related domain means "many of
            these can belong to the parent", whether linked via a direct FK
            (one-to-many) or a junction table (many-to-many). */}
        <div className="flex-1 overflow-hidden">
          <RepeatableRelatedStepForm
            step={step}
            parentDomain={String(dataSourceId)}
            parentId={parentRecordId}
            isLastStep={isLastStep}
            onContinue={finishOrAdvance}
          />
        </div>
      </div>
    );
  }

  // ── Post-submit details view ────────────────────────────────────────────────
  if (showDetails && schema) {
    return (
      <div className="h-full w-full flex flex-col bg-card rounded-2xl overflow-hidden">
        <FormDetailsView
          formTitle={configs.formTitle}
          dataSourceId={String(dataSourceId ?? '')}
          dbBackend={dbBackend}
          recordId={detailRecord}
          submittedValues={submittedValues}
          submittedAt={submittedAt}
          schema={schema}
          roles={domainRoles}
          rolesLoading={rolesLoading}
          onReset={() => {
            setShowDetails(false);
            setSubmitState('idle');
            setSubmitMsg('');
          }}
        />
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-card rounded-2xl overflow-hidden relative">

      {/* ── Review / Confirm overlay ─────────────────────────────────────────── */}
      {showReview && schema && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-2xl p-4">
          <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-full overflow-hidden animate-in zoom-in-95 duration-200">

            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
              <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-foreground">
                  {configs.reviewTitle?.trim() || 'Review your submission'}
                </p>
                <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                  Please confirm all details before submitting.
                </p>
              </div>
              <button
                onClick={() => setShowReview(false)}
                className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground/50 hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Field summary */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {schema.map(field => {
                const raw = values[field.field_id] ?? '';
                const displayVal = raw === ''
                  ? <span className="italic text-muted-foreground/30">—</span>
                  : raw === 'true' ? 'Yes'
                  : raw === 'false' ? 'No'
                  : raw;
                return (
                  <div key={field.field_id} className="flex items-start gap-3 py-2 border-b border-border/30 last:border-0">
                    <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest truncate">
  {translateLabel(field.field_id, field.label || field.field_id)}
</p>
                      <p className="text-sm font-semibold text-foreground mt-0.5 break-words">{displayVal}</p>
                    </div>
                    {configs.showFieldTypes && (
                      <span className="shrink-0 mt-1 text-[8px] font-mono text-muted-foreground/20 uppercase">
                        {field.type}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* DB target badge + actions */}
            <div className="px-5 py-4 border-t border-border shrink-0 space-y-3">
              {/* Destination indicator */}
              <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[10px] font-bold border ${DB_COLOR}`}>
                <Database className="w-3 h-3 shrink-0" />
                Submitting to <strong>{DB_LABEL}</strong>
                {dataSourceId ? <span className="opacity-60">→ {String(dataSourceId)}</span> : null}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowReview(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-border text-xs font-bold text-muted-foreground hover:bg-secondary transition-all"
                >
                  Back to Edit
                </button>
                <button
                  onClick={doSubmit}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-black uppercase tracking-widest transition-all hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/25 active:scale-95"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {configs.confirmLabel?.trim() || 'Confirm & Submit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Form body ── */}
      <div className="flex-1 overflow-y-auto">

        {/* No domain selected */}
        {!dataSourceId ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center opacity-40">
            <Database className="w-8 h-8 text-muted-foreground" />
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {isPreview ? 'No domain connected' : 'Select a Domain Model in the Settings panel →'}
            </p>
          </div>

        ) : loading ? (
          <div className="h-full flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-primary/60" />
            <span className="text-xs text-muted-foreground/50">Loading fields…</span>
          </div>

        ) : schemaError ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
            {schemaError.startsWith('PERMISSION_DENIED::') ? (
              <>
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <X className="w-5 h-5 text-amber-500" />
                </div>
                <p className="text-sm font-bold text-amber-600">
                  {schemaError.replace('PERMISSION_DENIED::', '')}
                </p>
                <p className="text-[10px] text-muted-foreground/40">
                  Ask an administrator to grant the required permission.
                </p>
              </>
            ) : (
              <>
                <AlertCircle className="w-6 h-6 text-destructive/50 flex-shrink-0" />
                <p className="text-xs text-destructive/70">Failed to load schema: {schemaError}</p>
              </>
            )}
          </div>

        ) : !schema?.length ? (
          <div className="h-full flex items-center justify-center text-muted-foreground/40 text-xs p-6 text-center">
            {dataSourceId
              ? `Domain "${String(dataSourceId)}" has no fields. Add fields in the Domain Builder.`
              : 'No schema loaded. Link a domain or set an endpoint in Settings.'}
          </div>

        ) : (
          <div className="p-5">

            


            {/* Success / error banners */}
            {submitState === 'success' && (
              <div className="mb-4 flex items-start gap-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-xl p-3 text-xs font-semibold animate-in fade-in duration-300">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> {submitMsg}
              </div>
            )}
            {submitState === 'error' && (
              submitMsg.startsWith('PERMISSION_DENIED::') ? (
                <div className="mb-4 flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 text-amber-700 rounded-xl p-3 text-xs font-semibold animate-in fade-in duration-300">
                  <X className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
                  <div>
                    <p className="font-bold">{submitMsg.replace('PERMISSION_DENIED::', '')}</p>
                    <p className="text-[10px] font-normal text-amber-600/60 mt-0.5">
                      Ask an administrator to grant the required permission.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mb-4 flex items-start gap-2.5 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl p-3 text-xs font-semibold animate-in fade-in duration-300">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {submitMsg}
                </div>
              )
            )}

            <form ref={formRef} onSubmit={handleSubmit} noValidate>

{/* Form title + language switcher */}
<div className="flex items-center justify-between mb-5 pb-3 border-b border-border/40">
  <h3 className="text-sm font-bold text-foreground tracking-tight">
    {configs.formTitle || ""}
  </h3>
  <LanguageSwitcher lang={lang} setLang={setLang} languages={languages} />
</div>

{/* Step breadcrumb — shown when related (child or list) steps exist */}
{hasChildren && (
  <div className="mb-4 flex items-center flex-wrap gap-1.5 rounded-xl px-3 py-2 text-[10px] font-semibold border bg-primary/5 border-primary/15 text-primary/70">
    <span className="font-black">Step 1 of {relatedSteps.length + 1}</span>
    <span className="opacity-30 mx-0.5">·</span>
    <span className="opacity-60">After this:</span>
    {relatedSteps.map((s) => (
      <span key={`${s.kind}-${s.domain}`} className="flex items-center gap-1">
        <span className="opacity-30">→</span>
        <span className="font-mono bg-primary/10 px-1.5 py-0.5 rounded-md text-primary/80">
          <DomainLabel name={s.domain} />{s.many ? ' [ ]' : ''}
        </span>
      </span>
    ))}
  </div>
)}

              {/* Error summary — shown after submit attempt */}
              {validationBlocked && Object.keys(errors).length > 0 && (
                <div className="mb-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 animate-in fade-in duration-200">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-destructive mb-2">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {Object.keys(errors).length} field{Object.keys(errors).length !== 1 ? 's need' : ' needs'} attention
                  </p>
                  <ul className="space-y-0.5 pl-5 list-disc">
                    {Object.entries(errors).map(([fid, msg]) => {
                      const label = schema?.find(f => f.field_id === fid)?.label || fid;
                      // The server can reject a field this form doesn't render.
                      // Say so (and why) instead of pointing at a field that
                      // isn't on screen.
                      const onForm = !!schema?.some(f => f.field_id === fid);
                      const hiddenDef = !onForm ? rawSchema?.find(f => f.field_id === fid) as any : undefined;
                      const hiddenReason = onForm ? '' : !hiddenDef
                        ? 'not part of this form\u2019s schema'
                        : (hiddenDef.type === 'list' || hiddenDef.cardinality === 'list')
                          ? `a related list${getRelatedDomainName(hiddenDef) ? ` (${getRelatedDomainName(hiddenDef)})` : ''} \u2014 hidden here, filled in a later step`
                          : hiddenDef.relatedDomain || hiddenDef.type === 'relation'
                            ? `a relation${hiddenDef.relatedDomain ? ` to ${hiddenDef.relatedDomain}` : ''} \u2014 hidden in this form`
                            : 'hidden in this form';
                      return (
                        <li key={fid} className="text-[10px] text-destructive/80">
                          {!onForm && (
                            <span className="font-semibold">{label}</span>
                          )}
                          {!onForm && ` — ${msg} (field not shown: ${hiddenReason})`}
                          {onForm && <button
                            type="button"
                            className="underline underline-offset-2 hover:no-underline text-left"
                            onClick={() => {
                              formRef.current
                                ?.querySelector<HTMLElement>(`[data-field-id="${fid}"]`)
                                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }}
                          >
                            {label}
                          </button>}
                          {onForm && <>{' — '}{msg}</>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Fields grid */}
              <div className={`grid ${colClass} gap-x-5 gap-y-5 mb-6`}>
               {schema.map(field => {
  const AUTO_HIDDEN = ["fromdate", "validfrom", "todate",  "isactive"];
  if (AUTO_HIDDEN.some(h => field.field_id.toLowerCase().replace(/_/g, '') === h)) {
    return null;
  }
  const err = errors[field.field_id];
                  const req = isRequired(field);
                  return (
                    <div
                      key={field.field_id}
                      data-field-id={field.field_id}
                      className={`flex flex-col gap-1.5 rounded-xl transition-colors ${err ? 'p-2 -m-2 bg-destructive/[0.03]' : ''}`}
                    >
                      <div className="flex items-center gap-1.5">
                        {configs.showFieldTypes && (
                          <span className="text-muted-foreground/40">
                            <FieldIcon type={field.type} datasource={field.datasource} />
                          </span>
                        )}
                       <label className={`text-[11px] font-semibold uppercase tracking-wide ${err ? 'text-destructive/70' : 'text-muted-foreground'}`}>
  {translateLabel(field.field_id, field.label || field.field_id)}
</label>
                        {req && (
                          <span className="text-destructive font-black" style={{ fontSize: '0.55rem' }}>*</span>
                        )}
                        {configs.showFieldTypes && (
                          <span className="ml-auto text-[8px] font-mono text-muted-foreground/25">
                            {field.datasource ? `→ ${field.datasource}` : field.type}
                          </span>
                        )}
                      </div>

                      <FieldInput
                        field={field}
                        value={values[field.field_id] ?? ''}
                        hasError={!!err}
                        onChange={v => handleChange(field.field_id, v)}
                        onBlur={() => handleBlur(field)}
                        ownTable={dataSourceId}
                        disabled={lockedFields?.includes(field.field_id)}
                      />

                      {/* Inline error message */}
                      {err && (
                        <p className="flex items-center gap-1 text-destructive text-[10px] font-semibold animate-in fade-in slide-in-from-top-1 duration-150">
                          <AlertCircle className="w-3 h-3 flex-shrink-0" /> {err}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {dataSourceId && !can(String(dataSourceId), 'create') ? (
                <p className="text-xs text-muted-foreground">You don't have permission to create {String(dataSourceId)} records.</p>
              ) : (
              <button
                type="submit"
                disabled={submitState === 'loading'}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-black uppercase tracking-widest transition-all hover:scale-[1.03] hover:shadow-lg hover:shadow-primary/25 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {submitState === 'loading' ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                ) : hasChildren ? (
                  <>
                    <span>Next</span>
                    <span className="opacity-60 text-[10px] normal-case tracking-normal font-normal">
                      ({relatedSteps.length} more step{relatedSteps.length !== 1 ? 's' : ''})
                    </span>
                    <span>→</span>
                  </>
                ) : reviewEnabled ? (
                  <><Eye className="w-3.5 h-3.5" /> {configs.submitLabel || 'Review & Submit'}</>
                ) : (
                  <><Send className="w-3.5 h-3.5" /> {configs.submitLabel || 'Submit'}</>
                )}
              </button>
              )}

            </form>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Form Details View — shown after a successful submission ─────────────────

const PERM_COLS_DEF = [
  { key: 'can_create', label: 'Create', color: 'text-emerald-600 dark:text-emerald-400', ring: 'ring-emerald-500/30', bg: 'bg-emerald-500/10' },
  { key: 'can_read',   label: 'Read',   color: 'text-blue-600 dark:text-blue-400',       ring: 'ring-blue-500/30',   bg: 'bg-blue-500/10'    },
  { key: 'can_update', label: 'Update', color: 'text-amber-600 dark:text-amber-400',     ring: 'ring-amber-500/30',  bg: 'bg-amber-500/10'   },
  { key: 'can_delete', label: 'Delete', color: 'text-rose-600 dark:text-rose-400',       ring: 'ring-rose-500/30',   bg: 'bg-rose-500/10'    },
] as const;

const FIELD_TYPE_PILL: Record<string, string> = {
  text:          'bg-slate-500/10 text-slate-600 dark:text-slate-400',
  number:        'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  date:          'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  boolean:       'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  formattedText: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
};

function FormDetailsView({
  formTitle,
  dataSourceId,
  dbBackend,
  recordId,
  submittedValues,
  submittedAt,
  schema,
  roles,
  rolesLoading,
  onReset,
}: {
  formTitle:       string;
  dataSourceId:    string;
  dbBackend:       'dynamodb' | 'postgresql';
  recordId?:       string;
  submittedValues: Record<string, string>;
  submittedAt:     string;
  schema:          BackendSchemaField[];
  roles:           any[];
  rolesLoading:    boolean;
  onReset:         () => void;
}) {
  const dbLabel = dbBackend === 'postgresql' ? 'PostgreSQL' : 'DynamoDB';
  const dbColor = dbBackend === 'postgresql'
    ? 'bg-blue-500/10 border-blue-500/20 text-blue-600'
    : 'bg-orange-500/10 border-orange-500/20 text-orange-600';

  /** Human-readable display of a raw submitted string value */
function displayValue(raw: string | undefined, field: BackendSchemaField): React.ReactNode {
    if (raw === undefined || raw === '') {
      return <span className="italic text-muted-foreground/25 text-[11px]">—</span>;
    }
    if (field.type === 'boolean') {
      return (
        <span className={`font-semibold ${raw === 'true' ? 'text-emerald-600' : 'text-rose-500'}`}>
          {raw === 'true' ? 'Yes' : 'No'}
        </span>
      );
    }
    // Image field — show thumbnail instead of base64 string
    const IMAGE_NAME_HINTS = ["logo", "image", "photo", "avatar", "picture", "thumbnail", "banner", "icon"];
    const isImage = field.type === "image" ||
      IMAGE_NAME_HINTS.some(hint => field.field_id.toLowerCase().includes(hint)) ||
      raw.startsWith("data:image");
    if (isImage) {
      return (
        <div className="flex items-center gap-3">
          <img
            src={raw}
            alt={field.label || field.field_id}
            className="w-12 h-12 rounded-lg object-cover border border-border bg-secondary/40"
          />
          <span className="text-[9px] font-mono text-muted-foreground/30 truncate max-w-[120px]">
            base64 image
          </span>
        </div>
      );
    }
    return <span className="font-semibold text-foreground">{raw}</span>;
  }

  return (
    <div className="flex-1 overflow-y-auto animate-in fade-in duration-300">

      {/* ══════════════════════════════════════════════════════════════════════
          HEADER — success strip + meta info
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="px-5 pt-5 pb-0 space-y-3">

        {/* Success banner */}
        <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl px-4 py-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-emerald-700 dark:text-emerald-400 leading-none">
              Form Submitted
            </p>
            <p className="text-[10px] text-emerald-600/60 mt-0.5">{submittedAt}</p>
          </div>
          <button
            onClick={onReset}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 active:scale-95 transition-all"
          >
            <RefreshCw className="w-3 h-3" /> New Response
          </button>
        </div>

        {/* Domain + form meta row */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Form title */}
          <div className="flex items-center gap-1.5 bg-secondary/60 border border-border rounded-xl px-3 py-1.5">
            <FileText className="w-3 h-3 text-muted-foreground/50" />
            <span className="text-[11px] font-bold text-foreground">{formTitle || 'Untitled Form'}</span>
          </div>
          <span className="text-muted-foreground/20 text-xs">→</span>
          {/* Domain name */}
          <div className="flex items-center gap-1.5 bg-secondary/60 border border-border rounded-xl px-3 py-1.5">
            <Database className="w-3 h-3 text-muted-foreground/50" />
            <span className="text-[11px] font-bold text-foreground font-mono"><DomainLabel name={String(dataSourceId)} /></span>
          </div>
          {/* DB badge */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-bold ${dbColor}`}>
            {dbLabel}
          </div>
          {/* Record ID */}
          {recordId && (
            <div className="ml-auto flex items-center gap-1.5 bg-secondary/30 border border-border/50 rounded-xl px-3 py-1.5">
              <span className="text-[9px] font-bold text-muted-foreground/40 uppercase tracking-widest">ID</span>
              <span className="text-[11px] font-mono text-muted-foreground/70">{recordId}</span>
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TABLE 1 — Submitted Form Data
          Columns: Field Name | Type | Validation Rules | Value
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="px-5 pt-4">
        <div className="rounded-2xl border border-border bg-card overflow-hidden">

          {/* Section header */}
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-secondary/30">
            <ClipboardList className="w-3.5 h-3.5 text-primary/50" />
            <span className="text-[10px] font-black text-muted-foreground/70 uppercase tracking-widest">
              Submitted Data
            </span>
            <span className="ml-auto text-[9px] text-muted-foreground/30 font-mono">
              {schema.length} field{schema.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border/60 bg-secondary/10">
                  <th className="text-left px-4 py-2.5 text-[9px] font-black text-muted-foreground/50 uppercase tracking-widest w-[30%]">
                    Field
                  </th>
                  <th className="text-left px-3 py-2.5 text-[9px] font-black text-muted-foreground/50 uppercase tracking-widest w-[15%]">
                    Type
                  </th>
                  <th className="text-left px-3 py-2.5 text-[9px] font-black text-muted-foreground/50 uppercase tracking-widest w-[25%]">
                    Validations
                  </th>
                  <th className="text-left px-4 py-2.5 text-[9px] font-black text-muted-foreground/50 uppercase tracking-widest">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {schema.map((field, i) => {
                  const rawVal    = submittedValues[field.field_id];
                  const validations: any[] = Array.isArray(field.validations) ? field.validations : [];
                  const typePill  = FIELD_TYPE_PILL[field.type] ?? FIELD_TYPE_PILL.text;
                  const hasVal    = rawVal !== undefined && rawVal !== '';

                  return (
                    <tr
                      key={field.field_id}
                      className={`border-b border-border/30 transition-colors ${
                        i % 2 !== 0 ? 'bg-secondary/10' : ''
                      } ${hasVal ? '' : 'opacity-50'}`}
                    >
                      {/* Field label + id */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground/40">
                            <FieldIcon type={field.type} datasource={field.datasource} />
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground leading-tight truncate">
                              {field.label || field.field_id}
                            </p>
                            <p className="text-[9px] font-mono text-muted-foreground/30 truncate">
                              {field.field_id}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Type */}
                      <td className="px-3 py-3">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-lg ${typePill}`}>
                          {field.type === 'formattedText' ? 'text*' : field.type}
                        </span>
                      </td>

                      {/* Validation rules */}
                      <td className="px-3 py-3">
                        {validations.length === 0 ? (
                          <span className="text-[9px] text-muted-foreground/25 italic">none</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {validations.map((v: any, vi: number) => (
                              <span
                                key={vi}
                                title={v.message || v.type}
                                className="text-[8px] font-bold uppercase tracking-wide bg-primary/10 text-primary/70 px-1.5 py-0.5 rounded-full whitespace-nowrap"
                              >
                                {v.type}{v.value != null ? `:${v.value}` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* Submitted value */}
                      <td className="px-4 py-3 text-sm">
                        {displayValue(rawVal, field)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TABLE 2 — Roles & Access
          Columns: Role | Create | Read | Update | Delete
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="px-5 pt-4 pb-5">
        <div className="rounded-2xl border border-border bg-card overflow-hidden">

          {/* Section header */}
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-secondary/30">
            <Users className="w-3.5 h-3.5 text-primary/50" />
            <span className="text-[10px] font-black text-muted-foreground/70 uppercase tracking-widest">
              Roles &amp; Access
            </span>
            {rolesLoading && (
              <Loader2 className="w-3 h-3 animate-spin text-primary/40 ml-1" />
            )}
            {!rolesLoading && (
              <span className="ml-auto text-[9px] text-muted-foreground/30 font-mono">
                {roles.length} role{roles.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {rolesLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground/40">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[11px]">Loading role permissions…</span>
            </div>
          ) : roles.length === 0 ? (
            <div className="py-8 text-center">
              <Users className="w-7 h-7 text-muted-foreground/15 mx-auto mb-2" />
              <p className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-widest">
                No roles assigned to this domain
              </p>
              <p className="text-[9px] text-muted-foreground/25 mt-1">
                Configure access in the Roles panel → then re-submit
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border/60 bg-secondary/10">
                    <th className="text-left px-4 py-3 text-[9px] font-black text-muted-foreground/50 uppercase tracking-widest">
                      Role
                    </th>
                    {PERM_COLS_DEF.map(col => (
                      <th
                        key={col.key}
                        className={`px-4 py-3 text-[9px] font-black uppercase tracking-widest text-center ${col.color}`}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role: any, i: number) => {
                    const grantedCols = PERM_COLS_DEF.filter(c => !!role[c.key]);
                    const hasAny      = grantedCols.length > 0;

                    return (
                      <tr
                        key={role.id ?? i}
                        className={`border-b border-border/30 ${i % 2 !== 0 ? 'bg-secondary/10' : ''}`}
                      >
                        {/* Role name */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-[10px] font-black flex items-center justify-center flex-shrink-0 ring-1 ring-primary/20">
                              {String(role.name || 'R')[0].toUpperCase()}
                            </div>
                            <div>
                              <p className="font-bold text-foreground leading-none">{role.name}</p>
                              {role.description && (
                                <p className="text-[9px] text-muted-foreground/40 mt-0.5 truncate max-w-[130px]">
                                  {role.description}
                                </p>
                              )}
                            </div>
                            {/* Access summary pill */}
                            {hasAny ? (
                              <span className="ml-1 text-[8px] font-black px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20">
                                {grantedCols.length} access
                              </span>
                            ) : (
                              <span className="ml-1 text-[8px] font-black px-2 py-0.5 rounded-full bg-border/30 text-muted-foreground/30">
                                no access
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Permission cells */}
                        {PERM_COLS_DEF.map(col => {
                          const granted = !!role[col.key];
                          return (
                            <td key={col.key} className="px-4 py-3 text-center">
                              {granted ? (
                                <div className="inline-flex flex-col items-center gap-0.5">
                                  <span
                                    className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${col.bg} ${col.color} font-black text-[11px] ring-1 ${col.ring}`}
                                    title={`${role.name} can ${col.key.replace('can_', '')}`}
                                  >
                                    ✓
                                  </span>
                                  <span className={`text-[8px] font-bold ${col.color} opacity-60`}>
                                    {col.label}
                                  </span>
                                </div>
                              ) : (
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-border/20 text-muted-foreground/20 text-[11px]">
                                  —
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

// ─── Styled canvas wrapper — applies the configured visual style ─────────────

function StyledFormWrapper({
  configs, dataSourceId, isPreview,
}: {
  configs: FormConfigs;
  dataSourceId?: string | number | null;
  isPreview?: boolean;
}) {
  const { className, inlineStyles } = useVisualStyle();
  return (
    <div className={`h-full w-full ${className}`} style={inlineStyles}>
      <FormComponent configs={configs} dataSourceId={dataSourceId} isPreview={isPreview} />
    </div>
  );
}

// ─── Plugin definition ────────────────────────────────────────────────────────

export const FormPlugin: ViewBuilderPlugin<FormConfigs, Record<string, never>> = {
  id: 'form',
  pluginType: 'form',
  multiLang: formMultiLang,

  toolbar: {
    name: 'Form',
    element: <ClipboardList className="w-4 h-4" />,
    toolTip: 'Add a data-entry form linked to a domain model',
  },

canvas: {
  element: withDbMultiLang(
    ({ configs, dataSourceId, isPreview }) => (
      <VisualStyleProvider styleConfig={configs.visualStyle}>
        <StyledFormWrapper configs={configs} dataSourceId={dataSourceId} isPreview={isPreview} />
      </VisualStyleProvider>
    ),
    formMultiLang,
  ),
},

  settings: [
  // ── Display ───────────────────────────────────────────────────────────────
  { field_id: 'formTitle',      label: 'Form Title',          type: 'text',     defaultValue: 'New Form' },
  { field_id: 'submitLabel',    label: 'Submit Button Label',  type: 'text',     defaultValue: 'Submit' },
  { field_id: 'columnLayout',   label: 'Column Layout',        type: 'select',   enum: ['1', '2'], defaultValue: '1' },
  { field_id: 'showFieldTypes', label: 'Show Field Types',     type: 'checkbox', defaultValue: false },

  // ── Review / Approve step ──────────────────────────────────────────────────
  {
    field_id: 'enableReview',
    label: 'Enable Review & Approve Step',
    type: 'checkbox',
    defaultValue: false,
  },
  {
    field_id: 'reviewTitle',
    label: 'Review Dialog Title',
    type: 'text',
    defaultValue: 'Review your submission',
    showWhen: (c) => !!c.enableReview,
  },
  {
    field_id: 'confirmLabel',
    label: 'Confirm Button Label',
    type: 'text',
    defaultValue: 'Confirm & Submit',
    showWhen: (c) => !!c.enableReview,
  },

  // ── Post-submit ────────────────────────────────────────────────────────────
  { field_id: 'successMessage', label: 'Success Message',          type: 'text', defaultValue: '' },
  { field_id: 'redirectUrl',    label: 'Redirect URL after Submit', type: 'text', defaultValue: '' },
  
  // ── Visual Style ──────────────────────────────────────────────────────────
{
    field_id: 'visualStyle',
    label: 'Visual Style',
    type: 'custom',
    defaultValue: {},
    component: VisualStyleSettings,
  },
],

  componentDataSchema: {} as Record<string, never>,
};