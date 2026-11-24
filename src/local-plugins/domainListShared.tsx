/**
 * Shared types + small helpers used by both domainlistplugin.tsx and
 * relatedRecordsPlugin.tsx. Pulled out into their own file specifically to
 * avoid a circular import: relatedRecordsPlugin needs these, and
 * domainlistplugin needs to import the *plugin itself* — if domainlistplugin
 * were the source of these helpers, that would be an import cycle between
 * the two files. Both now depend on this instead, and neither depends on
 * the other in that direction.
 */
import React from "react";
import { LayoutList, Loader2 } from "lucide-react";
import { useVisualStyle } from "../sky-view-builder/styles/withVisualStyle";
import { colorUtils } from "../sky-view-builder/styles/visualStyles";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SchemaField {
  field_id:       string;
  type:           string;
  label?:         string;
  listDomain?:    string;
  relatedDomain?: string;
  [key: string]:  any;
}

export interface RelationInfo {
  domain:   string;
  mode:     "fk_children" | "fk_ref" | "list";
  fkField:  string;
  label:    string;
  /**
   * "list" mode only — the field on THIS domain's schema that's associated
   * with the junction table, and the junction table's own field pointing
   * at the related domain (e.g. entity.grade → entity_grade.gradeId).
   * `fkField` above holds the junction table's OTHER field, the one
   * pointing back at this domain (e.g. entity_grade.entityId).
   */
  junctionTable?: string;
  viaField?: string;
  /**
   * How this relation was declared in the Domain Builder:
   * - "integral"    → composition/ownership (e.g. branch belongs to clinic).
   *                  The child record only ever exists under its parent —
   *                  no "Add Existing" / "Remove" actions are shown.
   * - "association" → a reassignable reference (e.g. doctor/patient → branch,
   *                  or entity ↔ grade many-to-many). Add Existing / Remove
   *                  actions make sense here.
   * Falls back to "association" when the schema doesn't carry this metadata
   * yet (older domains created before this flag existed), which preserves
   * today's Link/Unlink behavior for them.
   */
  relationKind: "integral" | "association";
  /** Target side of a many-to-many link: tab is read-only (Edit / Delete only). */
  reverse?: boolean;
  /**
   * Owns / Uses label set on the attribute in Schema Inspector (metadata only).
   * "owns" → "Add Existing" is hidden; "uses" (or missing) → it is shown.
   */
  linkMode?: "owns" | "uses";
}

// ─── Row helpers ────────────────────────────────────────────────────────────

export function rowId(row: Record<string, any>): string {
  return String(row._id ?? row.id ?? "");
}

export function rowLabel(row: Record<string, any>): string {
  const NAME_KEYS = [
    "name", "title", "label", "clinicName", "branchName", "doctorName",
    "patientName", "fullName", "displayName", "email", "phone",
  ];
  for (const k of NAME_KEYS) {
    if (row[k] && typeof row[k] === "string") return row[k];
  }
  const SKIP = new Set(["id", "created_at", "updated_at"]);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}/i;
  const BASE64_RE = /^data:image\//i;
  for (const k of Object.keys(row)) {
    if (
      !SKIP.has(k) &&
      !k.endsWith("Id") &&
      typeof row[k] === "string" &&
      !UUID_RE.test(row[k]) &&
      !BASE64_RE.test(row[k])
    )
      return row[k];
  }
  return String(row.id ?? "—");
}

export function fmt(val: any): string {
  if (val === null || val === undefined || val === "") return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  return String(val);
}

export function stripServerOwnedFields(row: Record<string, any>): Record<string, any> {
  const payload = { ...row };
  delete payload.id;
  delete payload._id;
  delete payload.created_at;
  delete payload.updated_at;
  delete payload._created_at;
  delete payload.versionOf;
  delete payload.isActive;
  delete payload.fromDate;
  delete payload.toDate;
  return payload;
}

export function actualRowId(row: Record<string, any>): string {
  return String(row._uuid ?? row._id ?? row.id ?? "");
}

export function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function statusColor(val: string): string {
  const v = val.toLowerCase();
  if (["active", "confirmed", "success", "yes", "true"].includes(v))
    return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  if (["inactive", "cancelled", "error", "no", "false"].includes(v))
    return "bg-rose-500/10 text-rose-600 border-rose-500/20";
  if (["pending", "waiting", "scheduled"].includes(v))
    return "bg-amber-500/10 text-amber-600 border-amber-500/20";
  return "bg-secondary text-muted-foreground border-border";
}

export const SKIP = new Set(["id", "created_at", "updated_at"]);
export function shouldSkip(key: string): boolean { return SKIP.has(key) || key.endsWith("Id"); }
export function excludeIdFields(f: { field_id: string }): boolean { return f.field_id.endsWith("Id"); }

export function isRelationField(f: { type?: string; cardinality?: string; relatedDomain?: string; listDomain?: string }): boolean {
  return f.type === "relation" || f.type === "list" || f.cardinality === "list" || !!f.relatedDomain || !!f.listDomain;
}

/** A plain value field with cardinality "many"/"list" and no related domain
 *  (e.g. several emails). Not a relation — the Create form must show it. */
export function isPlainMultiValue(f: { type?: string; cardinality?: string; relatedDomain?: string; listDomain?: string }): boolean {
  const c = String(f.cardinality ?? "").toLowerCase();
  return (c === "list" || c === "many") && f.type !== "list" && f.type !== "relation" && !f.relatedDomain && !f.listDomain;
}

export function isRowActive(row: Record<string, any>): boolean {
  const v = row?.isActive;
  if (typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "[v]", "1", "yes", "active"].includes(s)) return true;
    return false;
  }
  return false;
}

export function useThemeColors() {
  const { style } = useVisualStyle();
  const headerBg = style.colors.surface;
  const buttonBg = style.colors.accent.primary;
  const buttonFg = colorUtils.getContrastColor(buttonBg);
  return { headerBg, buttonBg, buttonFg };
}

// ─── Tiny shared UI states ──────────────────────────────────────────────────

export function Loading({ text = "Loading…" }: { text?: string }) {
  return (
    <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground/50">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-xs">{text}</span>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground/30">
      <LayoutList className="w-8 h-8" />
      <p className="text-xs">{text}</p>
    </div>
  );
}