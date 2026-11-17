/**
 * DomainViewConfigSection — "how should this domain be displayed" controls
 * (Table View / Form View / Card-Gallery View), moved into the page builder
 * from the Schema Inspector's Domain Model tab.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Table, FileText, LayoutGrid } from 'lucide-react';
import type { DomainViewConfig } from '../core/domainViewConfig';

export interface DomainViewConfigSectionProps {
  domainName: string;
  fieldNames: string[];
  value: DomainViewConfig;
  onChange: (cfg: DomainViewConfig) => void;
}

export function DomainViewConfigSection({
  domainName,
  fieldNames,
  value,
  onChange,
}: DomainViewConfigSectionProps) {
  const [open, setOpen] = useState(false);

  const tv = value.tableView ?? { enabled: false };
  const fv = value.formView ?? { enabled: false };
  const cv = value.cardView ?? { enabled: false };

  function setTable(patch: Partial<typeof tv>) {
    onChange({ ...value, tableView: { ...tv, ...patch } });
  }
  function setForm(patch: Partial<typeof fv>) {
    onChange({ ...value, formView: { ...fv, ...patch } });
  }
  function setCard(patch: Partial<typeof cv>) {
    onChange({ ...value, cardView: { ...cv, ...patch } });
  }

  const enabledCount = [tv.enabled, fv.enabled, cv.enabled].filter(Boolean).length;

  const inp = `w-full rounded-lg border border-border bg-secondary/30 text-foreground text-xs px-2.5 py-1.5 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/30`;
  const sel = `${inp} appearance-none cursor-pointer`;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* ── Section header ── */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-secondary/20 transition-colors select-none"
      >
        <Table className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
        <span className="text-xs font-bold text-foreground flex-1 text-left">
          Domain View Configuration
        </span>
        {enabledCount > 0 && (
          <span className="text-[9px] font-black bg-primary/10 text-primary/80 px-1.5 py-0.5 rounded-full flex-shrink-0">
            {enabledCount} ON
          </span>
        )}
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
        }
      </button>

      {open && (
        <div className="border-t border-border/40 p-3 space-y-3 bg-card">

          {/* ── Table View ── */}
          <div className="rounded-lg border border-border/60 p-2.5 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!tv.enabled}
                onChange={e => setTable({ enabled: e.target.checked })}
              />
              <Table className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
              <span className="text-[11px] font-bold text-foreground">Table View</span>
              <span className="text-[10px] text-muted-foreground/40">
                Show {domainName || 'this domain'}'s rows in a data grid
              </span>
            </label>

            {tv.enabled && (
              <div className="pl-6 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest">
                      Page size
                    </span>
                    <input
                      className={inp}
                      type="number"
                      min={5}
                      max={200}
                      step={5}
                      value={tv.pageSize ?? 25}
                      onChange={e => setTable({ pageSize: Number(e.target.value) })}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest">
                      Visible fields
                    </span>
                    <input
                      className={inp}
                      value={(tv.visibleFields ?? []).join(', ')}
                      onChange={e =>
                        setTable({
                          visibleFields: e.target.value
                            .split(',')
                            .map(s => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder={fieldNames.slice(0, 3).join(', ') || 'leave blank = all'}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                    <input type="checkbox" checked={!!tv.sortable} onChange={e => setTable({ sortable: e.target.checked })} />
                    Sortable columns
                  </label>
                  <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                    <input type="checkbox" checked={!!tv.filterable} onChange={e => setTable({ filterable: e.target.checked })} />
                    Column filters
                  </label>
                  <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                    <input type="checkbox" checked={!!tv.searchable} onChange={e => setTable({ searchable: e.target.checked })} />
                    Global search
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* ── Form View ── */}
          <div className="rounded-lg border border-border/60 p-2.5 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!fv.enabled}
                onChange={e => setForm({ enabled: e.target.checked })}
              />
              <FileText className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
              <span className="text-[11px] font-bold text-foreground">Form View</span>
              <span className="text-[10px] text-muted-foreground/40">Create / edit instances in a form</span>
            </label>

            {fv.enabled && (
              <div className="pl-6">
                <label className="space-y-1 block max-w-xs">
                  <span className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest">
                    Layout
                  </span>
                  <select
                    className={sel}
                    value={fv.layout ?? 'single'}
                    onChange={e => setForm({ layout: e.target.value as any })}
                  >
                    <option value="single">Single column</option>
                    <option value="two-column">Two columns</option>
                    <option value="multi-column">Multi-column</option>
                  </select>
                </label>
              </div>
            )}
          </div>

          {/* ── Card / Gallery View ── */}
          <div className="rounded-lg border border-border/60 p-2.5 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!cv.enabled}
                onChange={e => setCard({ enabled: e.target.checked })}
              />
              <LayoutGrid className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
              <span className="text-[11px] font-bold text-foreground">Card / Gallery View</span>
              <span className="text-[10px] text-muted-foreground/40">Show instances as visual cards</span>
            </label>

            {cv.enabled && (
              <div className="pl-6 grid grid-cols-3 gap-2">
                <label className="space-y-1">
                  <span className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest">
                    Title field
                  </span>
                  <select
                    className={sel}
                    value={cv.titleField ?? ''}
                    onChange={e => setCard({ titleField: e.target.value || undefined })}
                  >
                    <option value="">— none —</option>
                    {fieldNames.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest">
                    Subtitle field
                  </span>
                  <select
                    className={sel}
                    value={cv.subtitleField ?? ''}
                    onChange={e => setCard({ subtitleField: e.target.value || undefined })}
                  >
                    <option value="">— none —</option>
                    {fieldNames.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest">
                    Image field
                  </span>
                  <select
                    className={sel}
                    value={cv.imageField ?? ''}
                    onChange={e => setCard({ imageField: e.target.value || undefined })}
                  >
                    <option value="">— none —</option>
                    {fieldNames.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}