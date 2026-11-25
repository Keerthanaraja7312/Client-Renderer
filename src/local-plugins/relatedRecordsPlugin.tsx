/**
 * relatedRecordsPlugin — the "grouped related tabs" feature, extracted out
 * of domainlistplugin.tsx into its own file so it can be reused/maintained
 * independently. domainlistplugin.tsx's DetailView renders a single
 * top-level "Related" tab and, inside it, uses <RelatedRecordsGroup> from
 * here (with a pill sub-nav to switch between branch/doctor/etc.) instead
 * of housing all of this logic inline.
 *
 * Exports:
 *  - useRelations(domainName, record) — detects which other domains relate
 *    to this record (both directions: children that FK to it, and fields
 *    on it that FK to something else).
 *  - RelatedRecordsGroup — the pill sub-nav + per-relation grid, given an
 *    already-detected relations list.
 *  - RelatedTab, LinkPickerPanel — the per-relation grid and its "Add
 *    Existing" picker, also exported individually in case something needs
 *    to render just one relation without the group wrapper.
 */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ArrowLeft, Loader2, Plus, Link2, Link2Off, Search, Pencil, Trash2 } from "lucide-react";
import { type ViewBuilderPlugin } from "../sky-view-builder/core/plugin";
import {
  fetchDomainRows, fetchDomainSchema, fetchAllSchemas, updateDomainRow,
  submitFormRow, deleteDomainRow, getActiveProject,
} from "../api/datastoreApi";
import { FormComponent } from "./formplugin";
import { DataTable } from "./DataTable";
import { withDbMultiLang } from '../sky-view-builder/components/withDbMultiLang';
import { withVisualStyle, StyledSurface } from '../sky-view-builder/styles/withVisualStyle';
import domainListMultiLang from './domain-list.multilang.json';
import { useDomainDataStore, useDomainRows, useDomainSchema } from "../sky-view-builder/store/domainDataStore";
import {
  type SchemaField, type RelationInfo,
  stripServerOwnedFields, actualRowId, capitalize, rowLabel, shouldSkip, isRelationField,
  useThemeColors, Loading, Empty,
} from "./domainListShared";

const CREATE_FORM_CONFIGS = {
  formTitle: "", submitLabel: "Save", columnLayout: "1" as const, successMessage: "",
  showFieldTypes: false, enableReview: false, reviewTitle: "", confirmLabel: "Confirm", redirectUrl: "",
};

// ─── Hook: detect relations for a domain/record ────────────────────────────
// Moved verbatim out of DetailView's useEffect — same detection logic, now
// reusable and independently testable.

/**
 * A junction table (auto-created for a many-to-many "list" relation) is
 * detected structurally rather than by name, since a domain's own name
 * could coincidentally contain an underscore too: every field besides the
 * standard system columns is itself a foreign key (ends in "Id"), with
 * nothing else — no real content of its own.
 */
const JUNCTION_SYSTEM_FIELDS = new Set([
  "id", "created_at", "updated_at", "deleted_at",
  "isActive", "fromDate", "toDate", "versionOf",
]);

/** The "Add Existing …" button is hidden for now. Set to true to show it again. */
const SHOW_ADD_EXISTING = true;
/** The per-row "Remove / unlink" button is hidden for now. Set to true to show it again. */
const SHOW_UNLINK = true;

/** Normalises the Owns / Uses label stored on a schema field. */
function toLinkMode(v: unknown): "owns" | "uses" | undefined {
  return v === "owns" ? "owns" : v === "uses" ? "uses" : undefined;
}

export function isJunctionLike(fields: SchemaField[]): boolean {
  const real = fields.filter(f => !JUNCTION_SYSTEM_FIELDS.has(f.field_id));
  if (real.length < 2) return false;
  return real.every(f => f.field_id.endsWith("Id"));
}

export function useRelations(domainName: string, record: Record<string, any>) {
  const [relations, setRelations] = useState<RelationInfo[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchAllSchemas()
      .then(res => {
        const found: RelationInfo[] = [];
        const schemas = res.schemas ?? [];
        const domainNames = new Set(schemas.map(s => s.table_name));

        // This domain's own fields — read up front so a relation can pick up
        // its Owns / Uses label from a marker field declared on this domain.
        const thisSchema = schemas.find(s => s.table_name === domainName);
        const thisFields: SchemaField[] = thisSchema
          ? (Array.isArray(thisSchema.schema)
              ? thisSchema.schema
              : Object.values(thisSchema.schema ?? {}))
          : [];

        // Tables are stored per project as "<Name>__<projectId>" (Client__31) while
        // link fields and junction columns only carry the plain name ("Output",
        // "User31"). Resolve plain names against THIS record's project so a
        // same-named table of another project (e.g. project 30's "Output") is
        // never used, and a table with no unsuffixed twin is still found.
        const projectId = thisSchema?.project_id != null ? String(thisSchema.project_id) : null;
        const inScope = (e: { project_id?: string | null }) =>
          projectId == null || e.project_id == null || String(e.project_id) === projectId;
        const baseOf = (e: any) => String(e.domain_name || e.table_name);
        const myTable = domainName.toLowerCase();
        const myBase  = (thisSchema ? baseOf(thisSchema) : domainName).toLowerCase();
        /** Is `fieldId` the FK column that points at THIS domain (as declared by `entry`)? */
        const pointsAtMe = (fieldId: string, entry: { project_id?: string | null }) => {
          const f = fieldId.toLowerCase();
          return f === `${myTable}id` || (inScope(entry) && f === `${myBase}id`);
        };
        /** A plain domain name → true when this project has a table for it. */
        const resolves = (name: string) => {
          const n = name.toLowerCase();
          return schemas.some(s2 => inScope(s2) && (
            s2.table_name.toLowerCase() === n ||
            s2.table_name.replace(/_/g, "").toLowerCase() === n ||
            baseOf(s2).toLowerCase() === n));
        };

        for (const entry of schemas) {
          if (entry.table_name === domainName) continue;
          const fields: SchemaField[] = Array.isArray(entry.schema)
            ? entry.schema
            : Object.values(entry.schema ?? {});

          if (isJunctionLike(fields)) {
            // Many-to-many — Schema Inspector never puts anything on the
            // parent domain's OWN schema for this (no marker field, no
            // "list"-type column at all — confirmed straight from its
            // CreateDomainTab.buildPayloadFor: "purely creates the
            // junction table, nothing added to THIS domain's field
            // list"). So the only place this relationship is recorded is
            // the junction table's own two FK columns — resolve directly
            // from those instead of looking for something on `domainName`
            // that will never exist.
            //
            // Only shown on the side that actually declared it, not both
            // directions symmetrically — Schema Inspector always writes
            // ${owningDomain}Id first and ${relatedDomain}Id second (e.g.
            // building entity→grade from inside "entity" produces
            // [entityId, gradeId] in exactly that order), so the first
            // Id field in the junction is the owning side. If it doesn't
            // match domainName, this domain is the TARGET of someone
            // else's relation, not the owner — skip it, same as an
            // fk_ref column only ever producing a tab on the domain that
            // actually holds it, never a symmetric one on the far side.
            const idFields = fields.filter(f => f.field_id.endsWith("Id"));
            if (idFields.length < 2) continue;
            if (!pointsAtMe(idFields[0].field_id, entry)) {
              // This domain is the TARGET side of the link (e.g. College in
              // University_College). It still gets a tab, but a read-only
              // one: only the records assigned to this record, with just
              // Edit / Delete — linking is managed from the owning side.
              if (pointsAtMe(idFields[1].field_id, entry)) {
                // The junction's owning side is marked "owns" (e.g. Client owns Output):
                // the owned record doesn't list its owner back, so no tab here.
                if (toLinkMode(idFields[0].linkMode) === "owns") continue;
                const ownerDomain = idFields[0].field_id.slice(0, -2);
                if (resolves(ownerDomain) && !found.some(r => r.domain === ownerDomain)) {
                  found.push({
                    domain:        ownerDomain,
                    mode:          "list",
                    fkField:       idFields[1].field_id,
                    junctionTable: entry.table_name,
                    viaField:      idFields[0].field_id,
                    label:         ownerDomain,
                    relationKind:  "association",
                    reverse:       true,
                  });
                }
              }
              continue;
            }
            const myField = idFields[0];
            const otherField = idFields[1];
            const relatedDomain = otherField.field_id.slice(0, -2);
            if (!resolves(relatedDomain)) continue;
            if (found.some(r => r.domain === relatedDomain)) continue;

            found.push({
              domain:        relatedDomain,
              mode:          "list",
              fkField:       myField.field_id,
              junctionTable: entry.table_name,
              viaField:      otherField.field_id,
              label:         relatedDomain,
              // Junction FK columns are plain { type: "string" } with no
              // relationKind at all in practice, so this reliably falls
              // back to "association" — exactly right for many-to-many.
              relationKind: myField.relationKind === "integral" ? "integral" : "association",
              // Owns / Uses: the junction's owning FK column first, else a
              // marker field on this domain that points at the related domain.
              linkMode: toLinkMode(myField.linkMode)
                ?? toLinkMode(thisFields.find(f =>
                     String(f.relatedDomain ?? "").toLowerCase() === relatedDomain.toLowerCase())?.linkMode),
            });
            continue;
          }

          const fkField = fields.find(f => pointsAtMe(f.field_id, entry));
          if (fkField) {
            found.push({
              domain:  entry.table_name,
              mode:    "fk_children",
              fkField: fkField.field_id,
              label:   entry.table_name,
              relationKind: fkField.relationKind === "integral" ? "integral" : "association",
              linkMode: toLinkMode(fkField.linkMode),
            });
          }
        }

        for (const field of thisFields) {
          if (field.field_id.endsWith("Id")) {
            const refDomain = field.field_id.slice(0, -2);
            if (resolves(refDomain) && record[field.field_id]) {
              if (!found.some(r => r.domain === refDomain)) {
                found.push({
                  domain:  refDomain,
                  mode:    "fk_ref",
                  fkField: field.field_id,
                  label:   refDomain,
                  relationKind: field.relationKind === "integral" ? "integral" : "association",
                });
              }
            }
            continue;
          }

          // Many-to-many — a field with cardinality "list" whose value
          // lives in a junction table (${domainName}_${relatedDomain}),
          // e.g. entity.grade ↔ entity_grade. relatedDomain/listDomain
          // cover the flattened shape; related_domain_model.linked_with
          // covers Schema Inspector's nested design-time shape, in case
          // that's what ends up in the published schema verbatim.
          // (In current practice this loop never actually matches, per
          // the junction-table-based detection above — kept as a
          // fallback in case some other creation path DOES leave such a
          // field on the parent's own schema.)
          const isList = field.type === "list" || (field as any).cardinality === "list";
          if (!isList) {
            // Single-valued relation field NOT named "xId" (e.g. an
            // association stored as "grade"): show the linked record as a tab.
            const target = field.relatedDomain
              ? Array.from(domainNames).find(d => String(d).toLowerCase() === String(field.relatedDomain).toLowerCase())
              : undefined;
            if (
              field.type === "relation" && target && !(field as any).isMarkerOnly &&
              record[field.field_id] && !found.some(r => r.domain === target)
            ) {
              found.push({
                domain:  String(target),
                mode:    "fk_ref",
                fkField: field.field_id,
                label:   String(target),
                relationKind: field.relationKind === "integral" ? "integral" : "association",
              });
            }
            continue;
          }
          const relatedDomain =
            field.relatedDomain || field.listDomain ||
            (field as any).related_domain_model?.linked_with;
          if (!relatedDomain || !resolves(relatedDomain)) continue;
          if (found.some(r => r.domain === relatedDomain)) continue;

          const relationKind =
            field.relationKind ||
            (field as any).related_domain_model?.kind;

          found.push({
            domain:        relatedDomain,
            mode:          "list",
            fkField:       `${domainName}Id`,
            junctionTable: `${domainName}_${relatedDomain}`,
            viaField:      `${relatedDomain}Id`,
            label:         relatedDomain,
            relationKind:  relationKind === "integral" ? "integral" : "association",
            linkMode:      toLinkMode(field.linkMode),
          });
        }

        // Both "integral" and "association" relations get a tab — you
        // still want to see/link Grades on an Entity even though Grade
        // isn't owned by Entity. What "integral" actually gates is the
        // forced multi-step creation flow (see useRelatedSteps in
        // formplugin.tsx) and the "Add Existing" link action just below
        // (showLinkActions) — not whether a tab shows up at all.
        // The project's IDAM user table (User31 / User__31) is not shown as a related tab —
        // a linked user (owner, lead…) is picked from the field's dropdown instead.
        // Needs the project suffix, so an ordinary "User" domain is still shown.
        const HIDDEN_RELATED = /^user_*\d+$/i;
        // The IDAM user table itself (User__14, User__11_1 …) shows only its Details —
        // the Task / Output links that point AT a user are not listed on the user's record.
        const isIdamUserTable = /^user__(?:\d+|np)(?:_\d+)?$/i.test(domainName);
        const shown = isIdamUserTable
          ? []
          : found.filter(r => !HIDDEN_RELATED.test(r.domain) && !HIDDEN_RELATED.test(r.label));
        // Debug aid: shows why related tabs are (not) built. Remove once published pages match the builder.
        console.info('[related-tabs]', {
          domainName,
          activeProject: getActiveProject(),
          schemasReturned: schemas.length,
          ownSchemaFound: !!thisSchema,
          ownSchemaTable: thisSchema?.table_name ?? null,
          projectOfThisTable: projectId,
          relationsFound: found.map(r => `${r.mode}:${r.domain}`),
          relationsShown: shown.map(r => `${r.mode}:${r.domain}`),
        });
        setRelations(shown);
      })
      .catch((e) => {
        console.error('[related-tabs] could not load schemas -> no related tabs:', e);
        setRelations([]);
      })
      .finally(() => setLoading(false));
  }, [domainName, record]);

  return { relations, loading };
}

// ─── Link Existing Picker ───────────────────────────────────────────────────

export function LinkPickerPanel({
  relation, parentId, onLinked, onClose,
}: {
  relation: RelationInfo;
  parentId: string;
  onLinked: () => void;
  onClose: () => void;
}) {
  const [rows, setRows]         = useState<Record<string, any>[] | null>(null);
  const [loading, setLoading]   = useState(true);
  const [query, setQuery]       = useState("");
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  // "list" mode only — ids already linked to this parent via the junction
  // table, so they can be excluded from the "add" list entirely (a
  // many-to-many link either exists or doesn't — there's no fk_children
  // "linked elsewhere, move it here" concept to show instead).
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    if (relation.mode === "list") {
      Promise.all([
        fetchDomainRows(relation.domain).catch(() => []),
        fetchDomainRows(relation.junctionTable!).catch(() => []),
      ])
        .then(([all, junctionRows]) => {
          const mine = junctionRows.filter(r => String(r[relation.fkField]) === String(parentId));
          setLinkedIds(new Set(mine.map(r => String(r[relation.viaField!] ?? ""))));
          setRows(all);
        })
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
      return;
    }
    fetchDomainRows(relation.domain)
      .then(all => {
        const notLinkedToThisBranch = all.filter(
          r => String(r[relation.fkField]) !== String(parentId)
        );
        setRows(notLinkedToThisBranch);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [relation.domain, relation.fkField, relation.mode, relation.junctionTable, relation.viaField, parentId]);

  const filtered = (rows ?? [])
    .filter(r => relation.mode !== "list" || !linkedIds.has(String(r.id)))
    .filter(r => rowLabel(r).toLowerCase().includes(query.trim().toLowerCase()));

  const { buttonBg, buttonFg } = useThemeColors();

  async function handleLink(row: Record<string, any>) {
    const id = actualRowId(row);
    setLinkingId(id);
    setError(null);
    try {
      if (relation.mode === "list") {
        // The related row itself isn't touched — just insert a new row
        // into the junction table connecting the two ids.
        await submitFormRow(relation.junctionTable!, {
          [relation.fkField]: parentId,
          [relation.viaField!]: id,
        });
      } else {
        const payload = stripServerOwnedFields({ ...row, [relation.fkField]: parentId });
        await updateDomainRow(relation.domain, id, payload);
      }
      onLinked();
    } catch (e: any) {
      setError(e?.message ?? "Failed to link");
    } finally {
      setLinkingId(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-1 pb-3 mb-1 border-b border-border">
        <button onClick={onClose}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Cancel
        </button>
        
       <span className="text-muted-foreground/30">·</span>
        <span className="text-sm font-semibold text-foreground capitalize">
          Add existing {relation.domain}
        </span>
      </div>

      <div className="relative mb-3">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Search ${relation.domain}…`}
          className="w-full h-9 rounded-lg border border-border bg-secondary pl-8 pr-3 text-sm text-foreground outline-none focus:border-primary/60" />
      </div>

      {error && <p className="text-xs text-destructive/70 mb-2">{error}</p>}

      {loading ? (
        <Loading text={`Loading ${relation.domain}…`} />
      ) : filtered.length === 0 ? (
        <Empty text={
          (rows?.length ?? 0) === 0
            ? `No ${relation.domain} records available`
            : "No matches"
        } />
      ) : (
        <div className="flex flex-col divide-y divide-border/30 rounded-xl border border-border overflow-hidden">
          {filtered.map((row, i) => {
            const id = actualRowId(row);
            const busy = linkingId === id;
            const currentLink = row[relation.fkField];
            const linkedElsewhere = currentLink && String(currentLink) !== String(parentId);
            return (
              <div key={id || i} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-secondary/10 transition-colors">
                <div className="flex flex-col min-w-0">
                  <span className="text-sm text-foreground/80 truncate">{rowLabel(row)}</span>
                  {linkedElsewhere && (
                    <span className="text-[10px] text-amber-600/80 truncate">
                      Currently added to another {relation.domain === "doctor" ? "branch" : "record"} — adding will move it here
                    </span>
                  )}
                </div>
                <button
                  disabled={busy}
                  onClick={() => handleLink(row)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-opacity shrink-0 ${
                    linkedElsewhere
                      ? "bg-amber-500/10 text-amber-600 border border-amber-500/30 hover:bg-amber-500/20"
                      : "hover:opacity-90"
                  }`}
                  style={linkedElsewhere ? undefined : { backgroundColor: buttonBg, color: buttonFg }}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                  {linkedElsewhere ? `Move ${capitalize(relation.domain)} Here` : `Add ${capitalize(relation.domain)}`}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Edit one related record (inline, replaces the grid while open) ─────────

const RELATED_EDIT_HIDDEN = ["fromdate", "validfrom", "todate", "isactive", "versionof"];

function RelatedRowEditor({
  domain, row, schema, onBack, onSaved,
}: {
  domain: string;
  row: Record<string, any>;
  schema: SchemaField[];
  onBack: () => void;
  onSaved: () => void;
}) {
  const editableFields = schema.filter(f =>
    !shouldSkip(f.field_id) &&
    !isRelationField(f) &&
    !RELATED_EDIT_HIDDEN.includes(f.field_id.toLowerCase().replace(/_/g, ""))
  );
  const [values, setValues] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    for (const f of editableFields) init[f.field_id] = row[f.field_id] ?? "";
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const { buttonBg, buttonFg } = useThemeColors();

  const inputCls =
    "h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground outline-none focus:border-primary/60";

  async function handleSave() {
    setSaving(true); setError(null);
    try {
      // Keep the row's FK (e.g. clientId) so it stays linked to its parent;
      // only the visible, editable fields are overwritten.
      const payload = stripServerOwnedFields({ ...row, ...values });
      await updateDomainRow(domain, actualRowId(row), payload);
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-1 pb-3 mb-3 border-b border-border">
        <button onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Cancel
        </button>
        <span className="text-muted-foreground/30">·</span>
        <span className="text-sm font-semibold text-foreground capitalize">Edit {domain}</span>
      </div>
      <div className="flex flex-col gap-4 max-w-lg">
        {editableFields.map(f => (
          <div key={f.field_id} className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
              {f.label ?? f.field_id}
            </label>
            {f.type === "boolean" ? (
              <select
                value={String(values[f.field_id])}
                onChange={e => setValues(v => ({ ...v, [f.field_id]: e.target.value === "true" }))}
                className={inputCls}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : (
              <input
                type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                value={values[f.field_id]}
                onChange={e => setValues(v => ({ ...v, [f.field_id]: e.target.value }))}
                className={inputCls} />
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
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Related Grid Tab — one relation's own data ─────────────────────────────

export function RelatedTab({
  relation, record, allRows, parentDomain, onOpenRecord,
}: {
  relation: RelationInfo;
  record: Record<string, any>;
  allRows: Record<string, Record<string, any>[]>;
  parentDomain: string;
  /** When given, clicking a row opens that related record's own detail view. */
  onOpenRecord?: (domain: string, row: Record<string, any>) => void;
}) {
  const parentId = String(record.id ?? "");

  // Own cache entry, distinct from ListView's ("grid:...") and from any
  // other RelatedTab instance — scoped to this exact parent record +
  // relation, since the rows here are filtered/found relative to THIS
  // parentId, not shareable with a different record's same-domain tab.
  const cacheKey = `related:${parentDomain}:${parentId}:${relation.mode}-${relation.domain}`;

  const rows   = useDomainRows(cacheKey);
  const schema = useDomainSchema(cacheKey) as SchemaField[];
  const loading = useDomainDataStore((s) => s.loading[cacheKey] ?? false);
  const setStoreRows    = useDomainDataStore((s) => s.setRows);
  const setStoreSchema  = useDomainDataStore((s) => s.setSchema);
  const setStoreLoading = useDomainDataStore((s) => s.setLoading);

  const [refRow, setRefRow]   = useState<Record<string, any> | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [editRow, setEditRow]     = useState<Record<string, any> | null>(null);
  const [deleteRow, setDeleteRow] = useState<Record<string, any> | null>(null);
  const [deleting, setDeleting]   = useState(false);
  // "list" mode only — maps a related row's id to the junction row that
  // links it to this parent, so unlink knows exactly which junction row
  // to delete (the related row itself carries no FK back to the parent).
  const [junctionRowByRelatedId, setJunctionRowByRelatedId] = useState<Record<string, string>>({});

  function reload() {
    setStoreLoading(cacheKey, true);
    if (relation.mode === "list") {
      loadListRelation();
      return;
    }
    fetchDomainRows(relation.domain)
      .then(domainRows => {
        setStoreRows(cacheKey, domainRows.filter(r => String(r[relation.fkField]) === parentId));
      })
      .catch(() => setStoreRows(cacheKey, []))
      .finally(() => setStoreLoading(cacheKey, false));
  }

  // Many-to-many read path: fetch this parent's junction rows, pull out the
  // related ids, then fetch+filter the related domain's own rows to just
  // those ids. Also builds junctionRowByRelatedId for unlink to use.
  function loadListRelation() {
    const junctionTable = relation.junctionTable!;
    const viaField = relation.viaField!;
    setStoreLoading(cacheKey, true);
    Promise.all([
      fetchDomainRows(junctionTable).catch(() => []),
      fetchDomainRows(relation.domain).catch(() => []),
      fetchDomainSchema(relation.domain).catch(() => ({ schema: [], db_backend: "postgresql" as const })),
    ])
      .then(([junctionRows, domainRows, schemaRes]) => {
        const mine = junctionRows.filter(r => String(r[relation.fkField]) === parentId);
        const relatedIdToJunctionId: Record<string, string> = {};
        for (const jr of mine) {
          const relatedId = String(jr[viaField] ?? "");
          if (relatedId) relatedIdToJunctionId[relatedId] = actualRowId(jr);
        }
        setJunctionRowByRelatedId(relatedIdToJunctionId);
        const linkedIds = new Set(Object.keys(relatedIdToJunctionId));
        setStoreRows(cacheKey, domainRows.filter(r => linkedIds.has(String(r.id))));
        setStoreSchema(cacheKey, schemaRes.schema ?? []);
      })
      .catch(() => setStoreRows(cacheKey, []))
      .finally(() => setStoreLoading(cacheKey, false));
  }

  useEffect(() => {
    setStoreLoading(cacheKey, true);
 
    if (relation.mode === "fk_children") {
      Promise.all([
        fetchDomainRows(relation.domain),
        fetchDomainSchema(relation.domain).catch(() => ({ schema: [], db_backend: "postgresql" as const })),
      ])
        .then(([domainRows, schemaRes]) => {
          setStoreRows(cacheKey, domainRows.filter(r => String(r[relation.fkField]) === parentId));
          setStoreSchema(cacheKey, schemaRes.schema ?? []);
        })
        .catch(() => setStoreRows(cacheKey, []))
        .finally(() => setStoreLoading(cacheKey, false));
    } else if (relation.mode === "list") {
      loadListRelation();
    } else {
      const refId = String(record[relation.fkField] ?? "");
      fetchDomainRows(relation.domain)
        .then(domainRows => {
          const found = domainRows.find(r => String(r.id) === refId) ?? null;
          setRefRow(found);
          setStoreRows(cacheKey, found ? [found] : []);
          return fetchDomainSchema(relation.domain).catch(() => ({ schema: [], db_backend: "postgresql" as const }));
        })
        .then(schemaRes => {
          setStoreSchema(cacheKey, (schemaRes as any).schema ?? []);
        })
        .catch(() => setStoreRows(cacheKey, []))
        .finally(() => setStoreLoading(cacheKey, false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relation.domain, relation.fkField, relation.mode, parentId, cacheKey]);
 
  async function handleUnlink(row: Record<string, any>) {
    const id = actualRowId(row);
    setUnlinkingId(id);
    setUnlinkError(null);
    try {
      if (relation.mode === "list") {
        // The related row (e.g. Grade) carries no FK back to the parent —
        // the link lives entirely in the junction table, so unlink means
        // deleting THAT row, not editing the related row at all.
        const junctionRowId = junctionRowByRelatedId[id];
        if (junctionRowId) {
          await deleteDomainRow(relation.junctionTable!, junctionRowId);
        }
      } else {
        const payload = stripServerOwnedFields({ ...row, [relation.fkField]: "" });
        await updateDomainRow(relation.domain, id, payload);
      }
      reload();
    } catch (e: any) {
      console.error(e);
      setUnlinkError(e?.message ?? `Failed to remove ${relation.domain}`);
    } finally {
      setUnlinkingId(null);
    }
  }
 
  // Delete (archive) the related record itself — different from "Remove",
  // which only unlinks it from this parent and keeps the record.
  async function handleDelete() {
    if (!deleteRow) return;
    const id = actualRowId(deleteRow);
    setDeleting(true);
    setUnlinkError(null);
    try {
      if (relation.mode === "list") {
        // Many-to-many: drop the junction link first so no dangling link remains.
        const junctionRowId = junctionRowByRelatedId[id];
        if (junctionRowId) await deleteDomainRow(relation.junctionTable!, junctionRowId);
      }
      await deleteDomainRow(relation.domain, id);
      setDeleteRow(null);
      reload();
    } catch (e: any) {
      console.error(e);
      setUnlinkError(e?.message ?? `Failed to delete ${relation.domain}`);
      setDeleteRow(null);
    } finally {
      setDeleting(false);
    }
  }

  const cols = schema.filter(f => !shouldSkip(f.field_id) && !isRelationField(f)).map(f => f.field_id).slice(0, 6);
  const { headerBg, buttonBg, buttonFg } = useThemeColors();
 
  // ── Inline "Create" uses the domain's normal form (same as the main list) ──
  const createPreset = useMemo<Record<string, string>>(
    () => (relation.mode === "fk_children" && relation.fkField && parentId
      ? { [relation.fkField]: String(parentId) } : {}),
    [relation.mode, relation.fkField, parentId],
  );
  const createLocked = useMemo<string[]>(
    () => (relation.mode === "fk_children" && relation.fkField ? [relation.fkField] : []),
    [relation.mode, relation.fkField],
  );
  const createExclude = useCallback(
    (f: { field_id: string }) => f.field_id === relation.fkField && relation.mode === "list",
    [relation.fkField, relation.mode],
  );
  async function linkCreated(recordId: string) {
    // many-to-many: link the new row to the parent through the junction table.
    // Use the junction's real columns (fkField = parent side, viaField = related
    // side), not `${parentDomain}Id` — tables are stored per project ("Client__31")
    // while junction columns carry the plain name ("ClientId").
    if (relation.mode !== "list") return;
    if (!relation.junctionTable || !parentId) {
      console.warn("[related create] cannot link — missing junction/parent", { relation, parentId });
      return;
    }
    const link = {
      [relation.fkField]: parentId,
      [relation.viaField ?? `${relation.domain}Id`]: recordId,
    };
    try {
      const res = await submitFormRow(relation.junctionTable, link);
      if (res.status !== "success") console.warn("[related create] junction insert failed", relation.junctionTable, link, res);
    } catch (e) {
      console.warn("[related create] junction insert threw", relation.junctionTable, link, e);
    }
  }

  if (loading) return <Loading text={`Loading ${relation.domain}…`} />;
 
  // Both one-to-many (fk_children) and many-to-many (list) support an
  // inline "Create new X" — RepeatableRelatedStepForm already knows how
  // to insert into the junction table too when step.kind is "list".
  const showCreateBtn = !relation.reverse && (relation.mode === "fk_children" || relation.mode === "list");
  // Composition relations (e.g. branch belongs to clinic) don't get
  // Add Existing / Remove — a child of this kind only ever exists under
  // its parent, so linking/unlinking it elsewhere isn't a valid action.
  // "list" relations always get Add Existing / Remove regardless of
  // relationKind — a many-to-many reference is never "owned" the way a
  // single fk_children composition can be.
  // Owns / Uses label: when the attribute is marked "owns", Add Existing is
  // hidden (create only); "uses" — or no label — keeps Add Existing.
  const showLinkActions = !relation.reverse && relation.linkMode !== "owns" && (
    relation.mode === "list" ||
    (relation.mode === "fk_children" && relation.relationKind !== "integral"));
 
  if (showCreate) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-1 pb-3 mb-1 border-b border-border">
          <button onClick={() => { setShowCreate(false); reload(); }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Cancel
          </button>
          <span className="text-muted-foreground/30">·</span>
          <span className="text-sm font-semibold text-foreground capitalize">
            Create {relation.domain}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <FormComponent
            configs={CREATE_FORM_CONFIGS}
            dataSourceId={relation.domain}
            isPreview={false}
            presetValues={createPreset}
            lockedFields={createLocked}
            excludeFields={createExclude}
            onCreated={linkCreated}
            onSuccess={() => { setShowCreate(false); reload(); }}
          />
        </div>
      </div>
    );
  }
 
  if (editRow) {
    return (
      <RelatedRowEditor
        domain={relation.domain}
        row={editRow}
        schema={schema}
        onBack={() => setEditRow(null)}
        onSaved={() => { setEditRow(null); reload(); }}
      />
    );
  }

  if (showLinkPicker) {
    return (
      <LinkPickerPanel
        relation={relation}
        parentId={parentId}
        onClose={() => setShowLinkPicker(false)}
        onLinked={() => { setShowLinkPicker(false); reload(); }}
      />
    );
  }
 
return (
    <div className="flex flex-col gap-3 relative">
      {unlinkError && <p className="text-xs text-destructive/70">{unlinkError}</p>}
      {deleteRow && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-xl">
          <div className="bg-card border border-border rounded-xl p-5 shadow-2xl max-w-xs w-full mx-4 flex flex-col gap-3">
            <span className="text-sm font-bold text-foreground">Delete {relation.domain}?</span>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">{rowLabel(deleteRow)}</span> will be moved to the archive
              {relation.mode === "list" ? " and unlinked from this record." : "."}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteRow(null)} disabled={deleting}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-secondary text-foreground hover:bg-secondary/70 transition-colors">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-destructive text-white hover:opacity-90 transition-opacity flex items-center gap-1.5">
                {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {(showCreateBtn || showLinkActions) && (
        <div className="flex items-center justify-between gap-2">
          {showCreateBtn && !showLinkActions ? (
            <span className="text-[11px] text-muted-foreground/70">
              {capitalize(relation.domain)} belongs to this {parentDomain} — create one directly.
            </span>
          ) : <span />}
          <div className="flex gap-2">
            {SHOW_ADD_EXISTING && showLinkActions && (
              <button onClick={() => setShowLinkPicker(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-bold border border-border hover:bg-secondary/70 transition-colors">
                <Link2 className="w-3.5 h-3.5" /> Add Existing {capitalize(relation.domain)}
              </button>
            )}
            {showCreateBtn && (
              <button onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
                style={{ backgroundColor: buttonBg, color: buttonFg }}>
                <Plus className="w-3.5 h-3.5" /> Create {relation.domain}
              </button>
            )}
          </div>
        </div>
      )}
      <DataTable
        columns={cols.map(k => ({ key: k, label: schema.find(f => f.field_id === k)?.label || k }))}
        preserveHeaderCase
        rows={rows}
        onRowClick={onOpenRecord ? (row) => onOpenRecord(relation.domain, row) : undefined}
        indexLabel="#"
        indexValue={(_row, i) => i + 1}
        emptyText={`No ${relation.domain} records ${showLinkActions ? "added" : "yet"}`}
        headerBg={headerBg}
        actions={[
          {
            icon: <Pencil className="w-3.5 h-3.5" />,
            title: `Edit ${capitalize(relation.domain)}`,
            onClick: (row) => setEditRow(row),
          },
          // Remove = unlink only (keeps the record). Not offered for
          // composition relations, where a child can't live outside its parent.
          ...(SHOW_UNLINK && showLinkActions ? [{
            icon: <Link2Off className="w-3.5 h-3.5" />,
            title: `Remove ${capitalize(relation.domain)} from this ${parentDomain}`,
            onClick: (row: Record<string, any>) => handleUnlink(row),
            busy: (row: Record<string, any>) => unlinkingId === actualRowId(row),
            className: "p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors",
          }] : []),
          {
            icon: <Trash2 className="w-3.5 h-3.5" />,
            title: `Delete ${capitalize(relation.domain)}`,
            onClick: (row) => setDeleteRow(row),
            className: "p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors",
          },
        ]}
      />
    </div>
  );
}

// ─── RelatedRecordsGroup — pill sub-nav + the active relation's grid ───────
// This is the piece DetailView actually renders for its single "Related"
// tab. Caller owns which relation is active (so it can persist/restore
// selection alongside its own tab state) — this component just renders
// the pills and the matching RelatedTab underneath.

export function RelatedRecordsGroup({
  relations, record, parentDomain, allRows,
  activeRelation, onActiveRelationChange, onOpenRecord,
}: {
  relations: RelationInfo[];
  record: Record<string, any>;
  parentDomain: string;
  allRows: Record<string, Record<string, any>[]>;
  activeRelation: string;
  onActiveRelationChange: (key: string) => void;
  onOpenRecord?: (domain: string, row: Record<string, any>) => void;
}) {
  if (relations.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-nav — pill row to switch between branch/doctor/etc. */}
      <div className="flex flex-wrap gap-1.5">
        {relations.map(rel => {
          const relKey = `${rel.mode}-${rel.domain}`;
          const isActive = activeRelation === relKey;
          return (
            <button
              key={relKey}
              onClick={() => onActiveRelationChange(relKey)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition-colors border ${
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary text-muted-foreground border-border hover:text-foreground hover:bg-secondary/70"
              }`}>
              {rel.label}
            </button>
          );
        })}
      </div>

      {relations.map(rel => {
        const relKey = `${rel.mode}-${rel.domain}`;
        return activeRelation === relKey ? (
          <RelatedTab
            key={relKey}
            relation={rel}
            record={record}
            allRows={allRows}
            parentDomain={parentDomain}
            onOpenRecord={onOpenRecord}
          />
        ) : null;
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Standalone plugin — "Related Records" as its own draggable block
// ════════════════════════════════════════════════════════════════════════════
//
// Gets its data the same way Data Grid does: `dataSourceId` comes from the
// Data Provider panel (injected as a canvas prop, same as DomainListPlugin).
// The one extra thing it needs — WHICH record's relations to show — is a
// plain settings-panel field (RecordPickerSetting below), fetched the same
// way TabOrderSetting fetches its own data. No cross-block binding, no
// StateHub subscription — fully self-contained, just like every other block
// in this palette.

interface RelatedRecordsConfigs {
  dataSourceId?: string | number | null;
  type?: string | null;
  /** Which record (by id) to show relations for — picked in settings. */
  recordId?: string;
  title?: string;
  _pageId?: string;
  _blockId?: string;
}

function RecordPickerSetting({
  value, onChange, configs,
}: {
  value?: string;
  onChange: (v: string) => void;
  configs?: Record<string, any>;
}) {
  const domainName = (configs?.dataSourceId != null ? String(configs.dataSourceId) : "").trim();
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!domainName) { setRows([]); setLoading(false); return; }
    setLoading(true);
    fetchDomainRows(domainName)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [domainName]);

  if (!domainName) {
    return <p className="text-xs text-muted-foreground/40 italic">Select a domain first to pick a record.</p>;
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-card/50 text-muted-foreground/40 text-xs">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading {domainName} records…
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground/40 italic">No records in "{domainName}" yet.</p>;
  }

  return (
    <select
      value={value ?? ""}
      onChange={e => onChange(e.target.value)}
      className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary/60">
      <option value="">— select a {domainName} record —</option>
      {rows.map(r => (
        <option key={String(r.id)} value={String(r.id)}>{rowLabel(r)}</option>
      ))}
    </select>
  );
}

function RelatedRecordsCanvas({
  configs,
}: {
  configs: RelatedRecordsConfigs;
}) {
  const domainName = configs.dataSourceId != null ? String(configs.dataSourceId) : "";
  const recordId   = configs.recordId ? String(configs.recordId) : "";

  const [record, setRecord]   = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeRelation, setActiveRelation] = useState("");

  useEffect(() => {
    if (!domainName || !recordId) { setRecord(null); return; }
    setLoading(true);
    fetchDomainRows(domainName)
      .then(rows => setRecord(rows.find(r => String(r.id) === recordId) ?? null))
      .catch(() => setRecord(null))
      .finally(() => setLoading(false));
  }, [domainName, recordId]);

  const { relations } = useRelations(domainName, record ?? {});

  useEffect(() => {
    if (relations.length > 0) {
      setActiveRelation(prev => prev || `${relations[0].mode}-${relations[0].domain}`);
    }
  }, [relations]);

  if (!domainName) return <Empty text="Select a domain in the Data Provider panel →" />;
  if (!recordId)   return <Empty text="Pick a record in the settings panel →" />;
  if (loading)     return <Loading text="Loading record…" />;
  if (!record)     return <Empty text="That record couldn't be found — it may have been deleted." />;

  return (
    <div className="p-4">
      <RelatedRecordsGroup
        relations={relations}
        record={record}
        parentDomain={domainName}
        allRows={{}}
        activeRelation={activeRelation}
        onActiveRelationChange={setActiveRelation}
      />
    </div>
  );
}

export const RelatedRecordsPlugin: ViewBuilderPlugin<RelatedRecordsConfigs, Record<string, never>> = withVisualStyle({
  id: "related-records",
  pluginType: "data",
  status: "completed",

  toolbar: {
    name: "Related Records",
    element: <Link2 className="h-4 w-4" />,
    toolTip: "Show a record's related-domain data (branch/doctor/etc.) grouped in one block",
  },

  canvas: {
    element: withDbMultiLang(
      ({ id, configs, dataSourceId, type, updateConfigs, isPreview }) => (
        <StyledSurface
          updateConfigs={updateConfigs}
          styleId={`${(configs as any)._pageId || 'page'}.${(configs as any)._blockId || 'block'}.${id}`}
          isPreview={isPreview}>
          <RelatedRecordsCanvas configs={{ ...configs, dataSourceId, type }} />
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
      field_id: "recordId",
      label: "Record",
      type: "custom",
      defaultValue: "",
      component: RecordPickerSetting,
    },
  ],

  componentDataSchema: {} as Record<string, never>,
}, { colorFields: ['background', 'surface', 'buttonAccent', 'fontColor'] });