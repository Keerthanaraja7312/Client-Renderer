import React, { useState, useEffect } from "react";
import {
  LayoutList, Plus, ArrowLeft, Loader2, RefreshCw, Pencil, Trash2, X, RotateCcw,
} from "lucide-react";
import { type ViewBuilderPlugin } from "../sky-view-builder/core/plugin";
import {
  fetchDomainRows, fetchDomainSchema, fetchAllSchemas,
  updateDomainRow, deleteDomainRow, fetchArchivedRows, restoreDomainRow,
} from "../api/datastoreApi";
import { FormComponent, isDomainChoiceField } from "./formplugin";
import { withDbMultiLang, useFieldTranslations } from '../sky-view-builder/components/withDbMultiLang';
import { LanguageSwitcher } from '../sky-view-builder/components/LanguageSwitcher';
import domainListMultiLang from './domain-list.multilang.json';
import { withVisualStyle, StyledSurface } from '../sky-view-builder/styles/withVisualStyle';
import { useComponentState } from '../sky-view-builder/hooks/useComponentState';
import { DataTable } from './DataTable';
import type { VisualStyleConfig } from '../sky-view-builder/styles/visualStyles';
import { useDomainDataStore, useDomainRows, useDomainSchema } from '../sky-view-builder/store/domainDataStore';
import { useDomainData as useProviderDomainData } from '../data/DataProvider';
import { executeSavedQuery } from '../api/queryBuilderApi';
import {
  type SchemaField, type RelationInfo,
  rowId, rowLabel, fmt, SKIP, shouldSkip, isRelationField, isPlainMultiValue, isRowActive, useThemeColors,
  capitalize, Loading, Empty,
} from './domainListShared';
import { useRelations, RelatedTab, isJunctionLike } from './relatedRecordsPlugin';
import { can } from '../lib/permissions';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TabConfigItem {
  key:   string;   // "details" | "version-history" | `${mode}-${domain}`
  label: string;
}

type DomainListConfigs = {
  dataSourceId?: string | number | null;
  type?:        string | null;
  title:        string;
  showCreate:   boolean;
  createLabel:  string;
  visualStyle?: Partial<VisualStyleConfig>;
  tabConfig?:  TabConfigItem[];
  /** Domain tabs added ad-hoc from the "+" button in DetailView, on top
   *  of whatever relations were auto-detected. Just blank slots — no
   *  domain picker, nothing pre-filled. The id keeps each tab stable
   *  across renders/removals. */
  manualRelations?: { id: string }[];
  /** Snapshot of the currently-fetched list rows, kept in sync purely for
   *  JSON export (see write-back effect in ListView below). Not read at
   *  runtime — the live `rows` state is what's actually rendered. */
  _pageId?: string;
  _blockId?: string;
};

// (SchemaField / RelationInfo types now live in ./domainListShared)

// ─── Helpers ────────────────────────────────────────────────────────────────
// (rowId, rowLabel, fmt, shouldSkip, isRelationField, isRowActive,
// useThemeColors, SKIP, Loading, Empty now live in ./domainListShared and
// are imported above. stripServerOwnedFields, actualRowId, capitalize also
// live in ./domainListShared, but this file no longer needs them directly —
// they're only used inside ./relatedRecordsPlugin now.)

// ─── Tab Order / Label custom setting ─────────────────────────────────────────

function computeAvailableTabs(
  versioned: boolean,
  relations: RelationInfo[],
): TabConfigItem[] {
  const tabs: TabConfigItem[] = [{ key: "details", label: "Details" }];
  if (versioned) tabs.push({ key: "version-history", label: "Version History" });
  // Each related domain gets its own top-level tab (e.g. "Patient",
  // "Branch") — named after the domain model — instead of collapsing
  // into a single "Related" tab with an inner pill sub-nav.
  for (const rel of relations) {
    tabs.push({ key: `${rel.mode}-${rel.domain}`, label: capitalize(rel.domain) });
  }
  return tabs;
}

function TabOrderSetting({
  value, onChange, configs,
}: {
  value?: TabConfigItem[];
  onChange: (v: TabConfigItem[]) => void;
  configs?: Record<string, any>;
}) {
  const domainName = (configs?.dataSourceId != null ? String(configs.dataSourceId) : "").trim();
  const [loading, setLoading]     = useState(true);
  const [available, setAvailable] = useState<TabConfigItem[]>([]);

  useEffect(() => {
    if (!domainName) { setAvailable([]); setLoading(false); return; }
    setLoading(true);

    Promise.all([
      fetchDomainSchema(domainName).catch(() => ({ schema: [], versioned: false } as any)),
      fetchAllSchemas().catch(() => ({ schemas: [] })),
    ]).then(([schemaRes, allRes]) => {
      const versioned = !!(schemaRes as any).versioned;
      const schemas = (allRes as any).schemas ?? [];
      const relations: RelationInfo[] = [];
      const domainNames = new Set(schemas.map((s: any) => s.table_name));

      const fkChildField = `${domainName}Id`;
      for (const entry of schemas) {
        if (entry.table_name === domainName) continue;
        const fields: SchemaField[] = Array.isArray(entry.schema)
          ? entry.schema
          : Object.values(entry.schema ?? {});

        if (isJunctionLike(fields)) {
          // Many-to-many — only shown on the side that declared it (the
          // first Id field in the junction, per Schema Inspector's
          // ${owningDomain}Id-first convention). See relatedRecordsPlugin
          // .tsx's useRelations for the full explanation.
          const idFields = fields.filter(f => f.field_id.endsWith("Id"));
          if (idFields.length < 2 || idFields[0].field_id !== fkChildField) continue;
          const myField = idFields[0];
          const otherField = idFields[1];
          const relatedDomain = otherField.field_id.slice(0, -2);
          if (!domainNames.has(relatedDomain)) continue;
          if (relations.some(r => r.domain === relatedDomain)) continue;

          relations.push({
            domain: relatedDomain,
            mode: "list",
            fkField: fkChildField,
            junctionTable: entry.table_name,
            viaField: otherField.field_id,
            label: relatedDomain,
            relationKind: myField.relationKind === "integral" ? "integral" : "association",
          });
          continue;
        }

        const fkField = fields.find(f => f.field_id === fkChildField);
        if (fkField) {
          relations.push({
            domain: entry.table_name,
            mode: "fk_children",
            fkField: fkChildField,
            label: entry.table_name,
            relationKind: fkField.relationKind === "integral" ? "integral" : "association",
          });
        }
      }

      const thisSchema = schemas.find((s: any) => s.table_name === domainName);
      const thisFields: SchemaField[] = thisSchema
        ? (Array.isArray(thisSchema.schema) ? thisSchema.schema : Object.values(thisSchema.schema ?? {}))
        : [];
      for (const field of thisFields) {
        if (!field.field_id.endsWith("Id")) continue;
        const refDomain = field.field_id.slice(0, -2);
        if (domainNames.has(refDomain) && !relations.some(r => r.domain === refDomain)) {
          relations.push({
            domain: refDomain,
            mode: "fk_ref",
            fkField: field.field_id,
            label: refDomain,
            relationKind: field.relationKind === "integral" ? "integral" : "association",
          });
        }
      }

      setAvailable(computeAvailableTabs(versioned, relations));
    }).finally(() => setLoading(false));
  }, [domainName]);

  const merged: TabConfigItem[] = React.useMemo(() => {
    const saved = value ?? [];
    const availableKeys = new Set(available.map(t => t.key));
    const kept = saved.filter(t => availableKeys.has(t.key));
    const keptKeys = new Set(kept.map(t => t.key));
    const added = available.filter(t => !keptKeys.has(t.key));
    return [...kept, ...added];
  }, [value, available]);

  const mergedSig = JSON.stringify(merged);
  useEffect(() => {
    if (!loading && domainName && mergedSig !== JSON.stringify(value ?? [])) {
      onChange(merged);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, domainName, mergedSig]);

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= merged.length) return;
    const next = [...merged];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function relabel(index: number, label: string) {
    const next = [...merged];
    next[index] = { ...next[index], label };
    onChange(next);
  }

  if (!domainName) {
    return <p className="text-xs text-muted-foreground/40 italic">Select a domain first to configure tabs.</p>;
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-card/50 text-muted-foreground/40 text-xs">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading tabs…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {merged.map((tab, i) => (
        <div key={tab.key} className="flex items-center gap-2 bg-secondary/30 border border-border rounded-lg p-2">
          <div className="flex flex-col shrink-0">
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
              className="text-muted-foreground/50 hover:text-foreground disabled:opacity-20 text-[10px] leading-none px-1">▲</button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === merged.length - 1}
              className="text-muted-foreground/50 hover:text-foreground disabled:opacity-20 text-[10px] leading-none px-1">▼</button>
          </div>
          <input
            type="text"
            value={tab.label}
            onChange={e => relabel(i, e.target.value)}
            placeholder={tab.key}
            className="flex-1 bg-background border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary/60"
          />
          <span className="text-[9px] font-mono text-muted-foreground/30 shrink-0">{tab.key}</span>
        </div>
      ))}
    </div>
  );
}


// ─── Version History Tab ─────────────────────────────────────────────────────

function VersionHistoryTab({
  domainName, record, schema,
}: {
  domainName: string;
  record: Record<string, any>;
  schema: SchemaField[];
}) {
  const [versions, setVersions] = useState<Record<string, any>[] | null>(null);
  const [loading, setLoading]   = useState(true);
  const { headerBg } = useThemeColors();

  useEffect(() => {
    setLoading(true);
    fetchDomainRows(domainName)
      .then(allRows => {
        const activeRecordId = String(record.id ?? "");

        const root = record.versionOf
          ? String(record.versionOf)
          : activeRecordId;

        const chain = allRows.filter(r => {
          const rId        = String(r.id ?? "");
          const rVersionOf = r.versionOf != null ? String(r.versionOf) : "";
          const inChain    = rId === root || rVersionOf === root;
          return inChain && rId !== activeRecordId;
        });

        chain.sort((a, b) => {
          const ta = a.fromDate ? new Date(a.fromDate).getTime() : 0;
          const tb = b.fromDate ? new Date(b.fromDate).getTime() : 0;
          return tb - ta;
        });

        console.log("[VersionHistoryTab] root:", root, "chain:", chain.length, "/ total rows:", allRows.length);
        setVersions(chain);
      })
      .catch(() => setVersions([]))
      .finally(() => setLoading(false));
  }, [domainName, record]);

  const cols = schema
    .map(f => f.field_id)
    .filter(k => !shouldSkip(k) && !["fromDate", "toDate", "isActive", "versionOf"].includes(k))
    .slice(0, 5);

if (loading) return <Loading text="Loading version history…" />;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] text-muted-foreground/50 uppercase tracking-widest font-bold px-0.5">
        Previous versions — {(versions ?? []).length} record{(versions ?? []).length !== 1 ? "s" : ""}
      </p>
      <DataTable
        columns={[
          ...cols.map(k => ({ key: k })),
          { key: "fromDate", label: "Valid From", render: (v: any) => <span className="text-[10px] font-mono text-muted-foreground/60">{v ? new Date(v).toLocaleString() : "—"}</span> },
          { key: "toDate", label: "Valid To", render: (v: any) => <span className="text-[10px] font-mono text-muted-foreground/60">{v ? new Date(v).toLocaleString() : "—"}</span> },
        ]}
        rows={versions}
        indexLabel="#"
        indexValue={(_row, i) => i + 1}
        emptyText="No previous versions found"
        muted
        headerBg={headerBg}
      />
    </div>
  );
}

// ─── Add Tab Button — the "+" next to the tab bar ──────────────────────────
// Just appends a blank tab — no picker, no domain list, nothing to choose.

function AddTabButton({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      title="Add a tab"
      className="flex items-center justify-center w-6 h-6 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors">
      <Plus className="w-3.5 h-3.5" />
    </button>
  );
}

// ─── Detail View ─────────────────────────────────────────────────────────────

function DetailView({
  record, domainName, versioned, onBack, tabConfig = [],
  manualRelations = [], onManualRelationsChange,
}: {
  record: Record<string, any>;
  domainName: string;
  versioned: boolean;
  onBack: () => void;
  tabConfig?: TabConfigItem[];
  /** Domain names added ad-hoc via the "+" tab menu (persisted on the
   *  block's configs, not just local state, so they survive re-opening). */
  manualRelations?: { id: string }[];
  onManualRelationsChange?: (next: { id: string }[]) => void;
}) {
  // Relation detection moved into its own hook (relatedRecordsPlugin.tsx) —
  // same logic, now shared/reusable instead of living inline here.
  const { relations, loading: loadingRel } = useRelations(domainName, record);
  const [activeTab, setActiveTab]   = useState<string>("details");
  const [allRows] = useState<Record<string, Record<string, any>[]>>({});
  // A row clicked inside a related tab (e.g. an Output under a Client) opens
  // that record's own detail view — with its own tabs — in place of this one.
  const [drill, setDrill] = useState<{ domain: string; row: Record<string, any> } | null>(null);
  const [domainSchema, setDomainSchema] = useState<SchemaField[]>([]);

const recordId     = String(record.id ?? "");
  const label        = rowLabel(record);
  const relationFieldIds = new Set(domainSchema.filter(isRelationField).map(f => f.field_id));
  const detailFields = Object.entries(record).filter(([k]) => !shouldSkip(k) && !relationFieldIds.has(k));
  const { translateLabel } = useFieldTranslations(domainName);

  useEffect(() => {
    fetchDomainSchema(domainName)
      .then(res => setDomainSchema(res.schema ?? []))
      .catch(() => setDomainSchema([]));
  }, [domainName]);

  type TabDef = { key: string; defaultLabel: string };
  const tabDefs: TabDef[] = [
    { key: "details", defaultLabel: "Details" },
    ...(versioned ? [{ key: "version-history", defaultLabel: "Version History" }] : []),
    // Each related domain (branch, doctor, patient, ...) gets its own
    // top-level tab named after that domain model, instead of all of
    // them collapsing into a single "Related" tab with a pill sub-nav.
    ...relations.map(rel => ({
      key: `${rel.mode}-${rel.domain}`,
      defaultLabel: capitalize(rel.domain),
    })),
  ];

  const orderIndex = new Map(tabConfig.map((t, i) => [t.key, i]));
  const orderedTabs = [...tabDefs].sort((a, b) => {
    const ai = orderIndex.has(a.key) ? orderIndex.get(a.key)! : Number.MAX_SAFE_INTEGER;
    const bi = orderIndex.has(b.key) ? orderIndex.get(b.key)! : Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
  const labelFor = (t: TabDef) =>
    tabConfig.find(c => c.key === t.key)?.label?.trim() || t.defaultLabel;

  const { headerBg } = useThemeColors();

  if (drill) {
    return (
      <DetailView
        key={`${drill.domain}:${String(drill.row.id ?? "")}`}
        record={drill.row}
        domainName={drill.domain}
        versioned={false}
        onBack={() => setDrill(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border" style={{ backgroundColor: headerBg }}>
        <button onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <span className="text-muted-foreground/30">·</span>
        <span className="text-sm font-semibold text-foreground truncate">{label}</span>
        <span className="ml-auto text-[10px] font-mono text-muted-foreground/40">ID: {recordId}</span>
      </div>

{/* Tabs */}
      <div className="flex items-center border-b border-border px-5 gap-1 overflow-x-auto">
        {orderedTabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            {labelFor(tab)}
          </button>
        ))}

        {/* Manually-added blank tabs — each removable on hover. */}
        {manualRelations.map((mr, idx) => {
          const key = `manual-${mr.id}`;
          const label = `Tab ${idx + 1}`;
          return (
            <div key={key} className="flex items-center group shrink-0">
              <button onClick={() => setActiveTab(key)}
                className={`pl-3 pr-1 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px ${
                  activeTab === key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}>
                {label}
              </button>
              <button
                type="button"
                title={`Remove ${label}`}
                onClick={() => {
                  onManualRelationsChange?.(manualRelations.filter(r => r.id !== mr.id));
                  if (activeTab === key) setActiveTab("details");
                }}
                className="opacity-0 group-hover:opacity-100 mr-1.5 p-0.5 rounded text-muted-foreground/40 hover:text-destructive transition-opacity">
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        {loadingRel && (
          <span className="px-3 py-2.5 text-xs text-muted-foreground/30 flex items-center gap-1 shrink-0">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading tabs…
          </span>
        )}

        <AddTabButton
          onAdd={() => {
            const id = Math.random().toString(36).slice(2, 8);
            const next = [...manualRelations, { id }];
            onManualRelationsChange?.(next);
            setActiveTab(`manual-${id}`);
          }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {activeTab === "details" && (
          <div className="grid grid-cols-2 gap-4">
            {detailFields.map(([key, val]) => (
              <div key={key} className="flex flex-col gap-1">
<span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">{translateLabel(key, key)}</span>               <span className="text-sm font-medium text-foreground break-words">
                  {fmt(val) === "—"
                    ? <span className="text-muted-foreground/30 italic text-xs">—</span>
                    : typeof val === "string" && val.startsWith("data:image")
                      ? <img src={val} alt={key} className="w-16 h-16 rounded-lg object-cover border border-border" />
                      : fmt(val)}
                </span>
              </div>
            ))}
          </div>
        )}

        {versioned && activeTab === "version-history" && (
          <VersionHistoryTab domainName={domainName} record={record} schema={domainSchema} />
        )}

        {relations.map(rel => {
          const relKey = `${rel.mode}-${rel.domain}`;
          return activeTab === relKey ? (
            <RelatedTab
              key={relKey}
              relation={rel}
              record={record}
              allRows={allRows}
              parentDomain={domainName}
              onOpenRecord={(domain, row) => setDrill({ domain, row })}
            />
          ) : null;
        })}

        {manualRelations.map(mr => (
          activeTab === `manual-${mr.id}` ? (
            <Empty key={mr.id} text="Empty tab — nothing configured here yet." />
          ) : null
        ))}
      </div>
    </div>
  );
}

// ─── Default form configs ─────────────────────────────────────────────────────

const DEFAULT_FORM_CONFIGS = {
  formTitle:      "",
  submitLabel:    "Save",
  columnLayout:   "1" as const,
  successMessage: "",
  showFieldTypes: false,
  enableReview:   false,
  reviewTitle:    "",
  confirmLabel:   "Confirm",
  redirectUrl:    "",
};

// ─── Edit Row View ────────────────────────────────────────────────────────────

function EditRowView({
  domainName, row, schema, versioned, onBack, onSaved,
}: {
  domainName: string;
  row: Record<string, any>;
  schema: SchemaField[];
  versioned: boolean;
  onBack: () => void;
  onSaved: () => void;
}) {
 const EDIT_HIDDEN = ["fromdate", "validfrom", "todate",  "isactive", "versionof"];
const editableFields = schema.filter(f =>
  !SKIP.has(f.field_id) &&
  !f.field_id.endsWith("Id") &&
  !isRelationField(f) &&
  !EDIT_HIDDEN.some(h => f.field_id.toLowerCase().replace(/_/g, '') === h)
);
  const [values, setValues] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    for (const f of editableFields) init[f.field_id] = row[f.field_id] ?? "";
    return init;
  });
const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const { translateLabel } = useFieldTranslations(domainName);

  async function handleSave() {
    setSaving(true); setError(null);
    try {
      const actualId = String(row._uuid ?? row._id ?? row.id ?? "");

      const fullPayload = { ...row, ...values };
      delete fullPayload.id;
      delete fullPayload._id;
      delete fullPayload.created_at;
      delete fullPayload.updated_at;
      delete fullPayload._created_at;
      delete fullPayload.versionOf;
      delete fullPayload.isActive;
      delete fullPayload.fromDate;
      delete fullPayload.toDate;

      await updateDomainRow(domainName, actualId, fullPayload);

      onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }
  const { headerBg, buttonBg, buttonFg } = useThemeColors();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0" style={{ backgroundColor: headerBg }}>
        <button onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <span className="text-muted-foreground/30">·</span>
        <span className="text-sm font-semibold text-foreground capitalize">Edit {domainName}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        <div className="flex flex-col gap-4 max-w-lg">
          {editableFields.map(f => (
            <div key={f.field_id} className="flex flex-col gap-1.5">
           <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
  {translateLabel(f.field_id, f.label ?? f.field_id)}
</label>
              {f.type === "boolean" ? (
                <select
                  value={String(values[f.field_id])}
                  onChange={e => setValues(v => ({ ...v, [f.field_id]: e.target.value === "true" }))}
                  className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground outline-none focus:border-primary/60">
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : f.type === "number" ? (
                <input
                  type="number"
                  value={values[f.field_id]}
                  onChange={e => setValues(v => ({ ...v, [f.field_id]: e.target.value }))}
                  className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground outline-none focus:border-primary/60" />
              ) : f.type === "date" ? (
                <input
                  type="date"
                  value={values[f.field_id]}
                  onChange={e => setValues(v => ({ ...v, [f.field_id]: e.target.value }))}
                  className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground outline-none focus:border-primary/60" />
                           ) : (f.type === "image" || ["logo","image","photo","avatar","picture","thumbnail","banner","icon"].some(h => f.field_id.toLowerCase().includes(h))) ? (

                <div className="flex flex-col gap-2">
                  {values[f.field_id] && (
                    <div className="relative w-28 h-28 rounded-xl overflow-hidden border border-border bg-secondary/40">
                      <img
                        src={values[f.field_id]}
                        alt="preview"
                        className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setValues(v => ({ ...v, [f.field_id]: "" }))}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center hover:bg-black/80 transition-colors">
                        ×
                      </button>
                    </div>
                  )}
                  <label className="flex items-center gap-2 cursor-pointer h-9 px-3 rounded-lg border border-dashed border-border bg-secondary/40 hover:bg-secondary/70 transition-colors text-xs text-muted-foreground">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {values[f.field_id] ? "Change image" : "Upload image"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onClick={e => { (e.target as HTMLInputElement).value = ""; }}
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => setValues(v => ({ ...v, [f.field_id]: reader.result as string }));
                        reader.readAsDataURL(file);
                      }} />
                  </label>
                </div>
              ) : (
                <input
                  type="text"
                  value={values[f.field_id]}
                  onChange={e => setValues(v => ({ ...v, [f.field_id]: e.target.value }))}
                  className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground outline-none focus:border-primary/60" />
              )}
            </div>
          ))}
          {error && <p className="text-xs text-destructive/70">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button onClick={onBack}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-secondary text-foreground hover:bg-secondary/70 transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity"
              style={{ backgroundColor: buttonBg, color: buttonFg }}>
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {versioned ? "Save as New Version" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── List View ───────────────────────────────────────────────────────────────

function ListView({
  id,
  configs,
  updateConfigs,
}: {
  id: string;
  configs: DomainListConfigs;
  updateConfigs?: (c: Partial<DomainListConfigs>) => void;
}) {
  // Data now lives in the dedicated domainDataStore (Zustand) instead of
  // local useState — cached by key so switching away and back to this
  // grid (or another grid pointed at the same domain, if it chose to
  // share the key) doesn't force a refetch. "grid:" prefix + block id
  // keeps this instance's cache entry distinct from any RelatedTab's.
  const domainNameForKey = (configs.dataSourceId != null ? String(configs.dataSourceId) : "").trim();
  const cacheKey = domainNameForKey ? `grid:${id}:${domainNameForKey}` : "";

  const rows   = useDomainRows(cacheKey);
  const schema = useDomainSchema(cacheKey) as SchemaField[];
  const loading = useDomainDataStore((s) => (cacheKey ? s.loading[cacheKey] ?? false : false));
  const error   = useDomainDataStore((s) => (cacheKey ? s.error[cacheKey] ?? null : null));
  const setStoreRows    = useDomainDataStore((s) => s.setRows);
  const setStoreSchema  = useDomainDataStore((s) => s.setSchema);
  const setStoreLoading = useDomainDataStore((s) => s.setLoading);
  const setStoreError   = useDomainDataStore((s) => s.setError);

  // "State" source (Data Provider panel → State radio): dataSourceId holds
  // a StatePath instead of a domain name, and the data comes from another
  // block's live output via useDomainData('state') — reactive, no backend
  // fetch, and none of the Zustand domainDataStore caching above applies to
  // it at all (this hook does its own reactive subscription internally).
  const sourceType = ((configs as any).type as string) || "table";
  const isStateSource = sourceType === "state";
  // "Query" source: dataSourceId is a saved query_definitions id (e.g. 31),
  // NOT a table name. It must go through executeSavedQuery(), never through
  // the /datastore/{table}/rows endpoint (that is what caused
  // `relation "31" does not exist`). Query results are read-only: no
  // schema, create, edit, archive or related-record detail view.
  const isQuerySource = sourceType === "query";
  const isReadOnlySource = isStateSource || isQuerySource;
  const stateResult = useProviderDomainData(
    isStateSource ? configs.dataSourceId : undefined,
    "state"
  );

  const [isVersioned, setIsVersioned] = useState(false);

  const { setState } = useComponentState({
    componentId: id,
    // 'input.rows' registers global.components.{id}.input.rows — live
    // runtime state, same pattern as the dropdown plugin's input.options.
    stateKeys: { 'input.rows': [] },
    pageId: configs._pageId,
    blockInstanceId: configs._blockId,
  });

  // Mirror the fetched (visible, active) rows into StateHub, content-compared
  // so this only fires when the actual row data changes. Deliberately
  // captures only the main `rows` list (not archivedRows) — archive is a
  // secondary view, not what the tile normally shows.
  const lastRowsSignatureRef = React.useRef<string>('');
  useEffect(() => {
    if (rows == null) return;
    const signature = JSON.stringify(rows);
    if (signature !== lastRowsSignatureRef.current) {
      lastRowsSignatureRef.current = signature;
      setState('input.rows', rows);
    }
  }, [rows, setState]);

  const [selected, setSelected]   = useState<Record<string, any> | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editRow, setEditRow]       = useState<Record<string, any> | null>(null);
  const [deleteRow, setDeleteRow]   = useState<Record<string, any> | null>(null);
  const [deleting, setDeleting]     = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [archivedRows, setArchivedRows] = useState<Record<string, any>[] | null>(null);
  const [loadingArchive, setLoadingArchive] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const domainName = (configs.dataSourceId != null ? String(configs.dataSourceId) : "").trim();
  const { translateLabel, lang, setLang, languages } = useFieldTranslations(domainName);
  const { headerBg, buttonBg, buttonFg } = useThemeColors();

  async function load() {
    if (!domainName || !cacheKey) return;
    setStoreLoading(cacheKey, true); setStoreError(cacheKey, null);
    try {
      if (isQuerySource) {
        const queryRows = await executeSavedQuery(domainName);
        const list: Record<string, any>[] = Array.isArray(queryRows)
          ? queryRows.filter((r: any) => r && typeof r === "object" && !Array.isArray(r))
          : [];
        setStoreRows(cacheKey, list);
        setStoreSchema(cacheKey, []);
        setIsVersioned(false);
        return;
      }

      const [rowsRes, schemaRes] = await Promise.all([
        fetchDomainRows(domainName),
        fetchDomainSchema(domainName).catch(() => ({ schema: [], db_backend: "postgresql" as const, versioned: false })),
      ]);

      const schemaVersioned = !!(schemaRes as any).versioned;
      const dataVersioned = rowsRes.some(r =>
        "isActive" in r || ("versionOf" in r && r.versionOf != null)
      );
      const versioned = schemaVersioned || dataVersioned;

      const visibleRows = versioned
        ? rowsRes.filter(r => isRowActive(r))
        : rowsRes;

      setStoreRows(cacheKey, visibleRows);
      setStoreSchema(cacheKey, schemaRes.schema ?? []);
      setIsVersioned(versioned);
    } catch (e: any) {
      setStoreError(cacheKey, e?.message ?? "Failed to load");
      setStoreRows(cacheKey, []);
    } finally {
      setStoreLoading(cacheKey, false);
    }
  }

  async function loadArchive() {
    if (!domainName || isReadOnlySource) return;
    setLoadingArchive(true);
    try {
      const rows = await fetchArchivedRows(domainName);
      setArchivedRows(rows);
    } catch {
      setArchivedRows([]);
    } finally {
      setLoadingArchive(false);
    }
  }

  // Bring an archived record back: clears deleted_at on the backend, then
  // refreshes both the archive list and the active list.
  async function handleRestore(row: Record<string, any>) {
    const id = rowId(row);
    setRestoringId(id);
    setArchiveError(null);
    try {
      await restoreDomainRow(domainName, id);
      await Promise.all([loadArchive(), load()]);
    } catch (e: any) {
      setArchiveError(e?.message ?? "Failed to restore");
    } finally {
      setRestoringId(null);
    }
  }

  useEffect(() => {
    if (!isStateSource) load();
    setSelected(null);
    setShowCreate(false);
    setEditRow(null);
    setDeleteRow(null);
  }, [domainName, isStateSource, isQuerySource]);

  if (editRow) {
    return (
      <EditRowView
        domainName={domainName}
        row={editRow}
        schema={schema}
        versioned={isVersioned}
        onBack={() => setEditRow(null)}
        onSaved={() => { setEditRow(null); setSelected(null); load(); }}
      />
    );
  }

  if (showCreate) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0" style={{ backgroundColor: headerBg }}>
  <button onClick={() => setShowCreate(false)}
    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
    <ArrowLeft className="w-3.5 h-3.5" /> Back
  </button>
  <span className="text-muted-foreground/30">·</span>
  <span className="text-sm font-semibold text-foreground capitalize">
    {configs.createLabel || "Create"} {domainName}
  </span>
</div>
        <div className="flex-1 overflow-y-auto">
          <FormComponent
            configs={{ ...DEFAULT_FORM_CONFIGS, formTitle: `New ${domainName}` }}
            dataSourceId={domainName}
            isPreview={false}
            onSuccess={() => { setShowCreate(false); load(); }}
            excludeFields={(f: any) => isRelationField(f) && !isPlainMultiValue(f) && !isDomainChoiceField(f)}
          />
        </div>
      </div>
    );
  }

if (selected) {
    return (
      <DetailView
        record={selected}
        domainName={domainName}
        versioned={isVersioned}
        tabConfig={configs.tabConfig}
        manualRelations={configs.manualRelations}
        onManualRelationsChange={(next) => updateConfigs?.({ manualRelations: next })}
        onBack={() => setSelected(null)}
      />
    );
  }

  const effectiveRows: Record<string, any>[] | null = isStateSource ? stateResult.rows : rows;
  const effectiveLoading = isStateSource ? stateResult.loading : loading;
  const effectiveError = isStateSource ? stateResult.error : error;

  // A state-bound source has no domain schema to read column names from —
  // derive them from whatever keys the first row actually has instead.
  const listCols = isReadOnlySource
    ? Object.keys(effectiveRows?.[0] ?? {}).filter(k => !SKIP.has(k) && !k.endsWith("Id")).slice(0, 5)
    : schema.filter(f => !SKIP.has(f.field_id) && !isRelationField(f)).map(f => f.field_id).slice(0, 5);

  const archiveCols = schema
    .filter(f => !SKIP.has(f.field_id) && !isRelationField(f))
    .map(f => f.field_id)
    .slice(0, 4);

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border" style={{ backgroundColor: headerBg }}>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-foreground">
            {configs.title || domainName || "Domain List"}
          </h3>
          {effectiveRows !== null && (
            <p className="text-[10px] text-muted-foreground/50 mt-0.5">
              {effectiveRows.length} record{effectiveRows.length !== 1 ? "s" : ""}
              {isVersioned && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-500 border border-violet-500/20 text-[8px] font-bold uppercase tracking-widest">
                  Versioned
                </span>
              )}
            </p>
          )}
        </div>
       {!isStateSource && (
         <button onClick={load} disabled={effectiveLoading}
    className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-secondary transition-all">
    <RefreshCw className={`w-3.5 h-3.5 ${effectiveLoading ? "animate-spin" : ""}`} />
  </button>
       )}
<LanguageSwitcher lang={lang} setLang={setLang} languages={languages} />
        {!isReadOnlySource && (
          <button
            onClick={() => { setShowArchive(v => !v); if (!archivedRows) loadArchive(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-opacity border ${
              showArchive
                ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                : "bg-secondary text-muted-foreground border-border hover:text-foreground"
            }`}>
            Archive
          </button>
        )}
        {configs.showCreate && !showArchive && !isReadOnlySource && can(domainName, "create") && (
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
            style={{ backgroundColor: buttonBg, color: buttonFg }}>
            <Plus className="w-3.5 h-3.5" />
            {configs.createLabel || "Create"}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {showArchive ? (
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <button onClick={() => { setShowArchive(false); setArchiveError(null); }}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>
                <span className="text-muted-foreground/30">·</span>
                <span className="text-xs font-bold text-amber-600/80 uppercase tracking-widest">
                  Archived Records
                </span>
              </div>
              <button onClick={loadArchive} disabled={loadingArchive}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                <RefreshCw className={`w-3 h-3 ${loadingArchive ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>
            {archiveError && <p className="text-xs text-destructive/70 mb-2">{archiveError}</p>}
            {loadingArchive ? (
              <Loading text="Loading archive…" />
            ) : !archivedRows || archivedRows.length === 0 ? (
              <Empty text="No archived records" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-amber-500/20">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-amber-500/20 bg-amber-500/5">
                      <th className="px-4 py-2.5 text-left text-[9px] font-black uppercase tracking-widest text-amber-600/50">ID</th>
                      {archiveCols.map(k => (
                        <th key={k} className="px-4 py-2.5 text-left text-[9px] font-black uppercase tracking-widest text-amber-600/50">{k}</th>
                      ))}
                      <th className="px-4 py-2.5 text-left text-[9px] font-black uppercase tracking-widest text-amber-600/50">Archived At</th>
                      <th className="px-4 py-2.5 text-right text-[9px] font-black uppercase tracking-widest text-amber-600/50">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-500/10">
                    {archivedRows.map((row, i) => (
                      <tr key={row.id ?? i} className="hover:bg-amber-500/5 transition-colors opacity-70">
                        <td className="px-4 py-3 font-mono text-muted-foreground/40 text-[10px]">{row.id}</td>
                        {archiveCols.map(k => (
                          <td key={k} className="px-4 py-3 text-foreground/60">
                            {typeof row[k] === "string" && row[k].startsWith("data:image")
                              ? <img src={row[k]} alt="" className="w-8 h-8 rounded object-cover border border-border opacity-60" />
                              : <span className="truncate max-w-[120px] block">{fmt(row[k])}</span>}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-[10px] text-amber-600/60 font-mono">
                          {row.deleted_at ? new Date(row.deleted_at).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {can(domainName, "edit") && <button
                            onClick={() => handleRestore(row)}
                            disabled={restoringId === rowId(row)}
                            title="Restore this record"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold border border-amber-500/30 text-amber-600 hover:bg-amber-500/10 transition-colors disabled:opacity-50">
                            {restoringId === rowId(row)
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <RotateCcw className="w-3 h-3" />}
                            Restore
                          </button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : !domainName ? (
          <Empty text={isStateSource ? "Pick a state source in the Data Provider panel →" : "Select a domain in the settings panel →"} />
        ) : effectiveLoading ? (
          <Loading text={isStateSource ? "Loading state…" : isQuerySource ? "Running query…" : `Loading ${domainName}…`} />
        ) : effectiveError ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 p-4 text-center">
            <p className="text-xs text-destructive/70">{effectiveError}</p>
            {!isStateSource && <button onClick={load} className="text-xs text-primary underline">Retry</button>}
          </div>
        ) : effectiveRows?.length === 0 ? (
          <Empty text={isStateSource ? "No records in the bound state yet" : isQuerySource ? "This query returned no records" : `No records in "${domainName}" yet`} />
        ) : (
         <DataTable
            columns={listCols.map(k => ({ key: k, label: translateLabel(k, schema.find(f => f.field_id === k)?.label || k) }))}
            rows={effectiveRows}
            onRowClick={(row) => { if (!isQuerySource) setSelected(row); }}
            headerBg={headerBg}
            actions={isReadOnlySource ? [] : [
              ...(can(domainName, "edit") ? [{ icon: <Pencil className="w-3.5 h-3.5" />, title: "Edit", onClick: (row: Record<string, any>) => setEditRow(row) }] : []),
              ...(can(domainName, "delete") ? [{ icon: <Trash2 className="w-3.5 h-3.5" />, title: "Delete", onClick: (row: Record<string, any>) => setDeleteRow(row), className: "p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" }] : []),
            ]}
          />
        )}
      </div>

      {deleteRow && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-2xl">
          <div className="bg-card border border-border rounded-xl shadow-xl p-5 w-72 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-bold text-foreground">Archive record?</span>
              <span className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{rowLabel(deleteRow)}</span> will be moved to the archive. You can view it anytime from the Archive tab.
              </span>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteRow(null)}
                disabled={deleting}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-secondary text-foreground hover:bg-secondary/70 transition-colors">
                Cancel
              </button>
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await deleteDomainRow(domainName, rowId(deleteRow));
                    setDeleteRow(null);
                    load();
                  } catch (e) {
                    console.error(e);
                  } finally {
                    setDeleting(false);
                  }
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-destructive text-white hover:opacity-90 transition-opacity flex items-center gap-1.5">
                  {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                Archive
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Plugin Definition ───────────────────────────────────────────────────────

export const DomainListPlugin: ViewBuilderPlugin<DomainListConfigs, Record<string, never>> = withVisualStyle({
  id: "domain-list",
  pluginType: "data",
  status: 'completed',
  multiLang: domainListMultiLang,

  toolbar: {
    name: "Data grid",
    element: <LayoutList className="h-4 w-4" />,
    toolTip: "List records from any domain — click to view details and auto-linked related domains",
  },

        canvas: {
    element: withDbMultiLang(
      ({ id, configs, dataSourceId, type, updateConfigs, isPreview }) => (
        <StyledSurface updateConfigs={updateConfigs} styleId={`${(configs as any)._pageId || 'page'}.${(configs as any)._blockId || 'block'}.${id}`} isPreview={isPreview}>
          <ListView id={id} configs={{ ...configs, dataSourceId, type }} updateConfigs={updateConfigs} />
        </StyledSurface>
      ),
      domainListMultiLang,
    ),
  },

  settings: [
    {
      field_id: "title",
      label: "Title",
      type: "text",
      defaultValue: "",
    },
    {
      field_id: "showCreate",
      label: "Show Create Button",
      type: "checkbox",
      defaultValue: true,
    },
    {
      field_id: "createLabel",
      label: "Create Button Label",
      type: "text",
      defaultValue: "Create",
      showWhen: (c) => !!c.showCreate,
    },
    {
      field_id: "tabConfig",
      label: "Tabs",
      type: "custom",
      defaultValue: [],
      component: TabOrderSetting,
    },
  ],

  componentDataSchema: {} as Record<string, never>,
}, { colorFields: ['background', 'surface', 'buttonAccent', 'fontColor'] });