import React from 'react';
import { Loader2, LayoutList } from 'lucide-react';

export interface DataTableColumn {
  key: string;
  label?: string;
  /** Custom cell renderer. Receives the raw field value and the full row. */
  render?: (value: any, row: Record<string, any>) => React.ReactNode;
}

export interface DataTableAction {
  icon: React.ReactNode;
  title: string;
  onClick: (row: Record<string, any>) => void;
  /** Only show this action when this returns true (default: always shown). */
  show?: (row: Record<string, any>) => boolean;
  busy?: (row: Record<string, any>) => boolean;
  className?: string;
}

export interface DataTableProps {
  columns: DataTableColumn[];
  rows: Record<string, any>[] | null;
  rowKey?: (row: Record<string, any>, index: number) => string | number;
  onRowClick?: (row: Record<string, any>) => void;
  showIndexColumn?: boolean;
  indexLabel?: string;
  indexValue?: (row: Record<string, any>, index: number) => React.ReactNode;
  actions?: DataTableAction[];
  loading?: boolean;
  loadingText?: string;
  emptyText?: string;
  error?: string | null;
  onRetry?: () => void;
  /** Dims rows — used for version history / archived data. */
  muted?: boolean;
  variant?: 'default' | 'amber';
  headerBg?: string;
}

function defaultFmt(val: any): string {
  if (val === null || val === undefined || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  return String(val);
}

function defaultStatusColor(val: string): string {
  const v = val.toLowerCase();
  if (['active', 'confirmed', 'success', 'yes', 'true'].includes(v))
    return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
  if (['inactive', 'cancelled', 'error', 'no', 'false'].includes(v))
    return 'bg-rose-500/10 text-rose-600 border-rose-500/20';
  if (['pending', 'waiting', 'scheduled'].includes(v))
    return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
  return 'bg-secondary text-muted-foreground border-border';
}

function defaultCell(key: string, value: any): React.ReactNode {
  if (key.toLowerCase().includes('status')) {
    const text = defaultFmt(value);
    return (
      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${defaultStatusColor(text)}`}>
        {text}
      </span>
    );
  }
  if (typeof value === 'string' && value.startsWith('data:image')) {
    return <img src={value} alt={key} className="w-8 h-8 rounded object-cover border border-border" />;
  }
  return <span className="truncate max-w-[140px] block">{defaultFmt(value)}</span>;
}

function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground/50">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-xs">{text}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground/30">
      <LayoutList className="w-8 h-8" />
      <p className="text-xs">{text}</p>
    </div>
  );
}

/**
 * Generic, presentation-only table. Owns no fetching logic — callers
 * supply `rows` + `columns`; this just renders them consistently
 * (status badges, image cells, hover actions, loading/empty/error states).
 * Used by the standalone TablePlugin and internally by DomainListPlugin
 * (main list, Related tab, Version History tab).
 */
export function DataTable({
  columns,
  rows,
  rowKey,
  onRowClick,
  showIndexColumn = true,
  indexLabel = 'ID',
  indexValue,
  actions = [],
  loading = false,
  loadingText = 'Loading…',
  emptyText = 'No records',
  error = null,
  onRetry,
  muted = false,
  variant = 'default',
  headerBg,
}: DataTableProps) {
  if (loading) return <Loading text={loadingText} />;

  if (error) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-xs text-destructive/70">{error}</p>
        {onRetry && <button onClick={onRetry} className="text-xs text-primary underline">Retry</button>}
      </div>
    );
  }

  if (!rows || rows.length === 0) return <Empty text={emptyText} />;

  const isAmber = variant === 'amber';
  const headerCls = isAmber ? 'border-b border-amber-500/20 bg-amber-500/5' : 'border-b border-border bg-secondary/20';
  const thCls = isAmber
    ? 'px-4 py-2.5 text-left text-[9px] font-black uppercase tracking-widest text-amber-600/50'
    : 'px-4 py-2.5 text-left text-[9px] font-black uppercase tracking-widest text-muted-foreground/50';
  const rowHoverCls = isAmber ? 'hover:bg-amber-500/5' : 'hover:bg-secondary/10';
  const dividerCls = isAmber ? 'divide-amber-500/10' : 'divide-border/30';
  const borderCls = isAmber ? 'border-amber-500/20' : 'border-border';

  return (
    <div className={`overflow-x-auto rounded-xl border ${borderCls}`}>
      <table className="w-full text-xs">
        <thead>
          <tr className={headerCls} style={headerBg ? { backgroundColor: headerBg } : undefined}>
            {showIndexColumn && <th className={thCls}>{indexLabel}</th>}
            {columns.map(col => (
              <th key={col.key} className={thCls}>{col.label ?? col.key}</th>
            ))}
            {actions.length > 0 && <th className="w-8" />}
          </tr>
        </thead>
        <tbody className={`divide-y ${dividerCls}`}>
          {rows.map((row, i) => {
            const key = rowKey ? rowKey(row, i) : (row.id ?? i);
            return (
              <tr
                key={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`${rowHoverCls} transition-colors group ${onRowClick ? 'cursor-pointer' : ''} ${muted ? 'opacity-75' : ''}`}
              >
                {showIndexColumn && (
                  <td className="px-4 py-3 font-mono text-muted-foreground/40 text-[10px]">
                    {indexValue ? indexValue(row, i) : (row.id ?? i + 1)}
                  </td>
                )}
                {columns.map(col => (
                  <td key={col.key} className="px-4 py-3 text-foreground/80 font-medium">
                    {col.render ? col.render(row[col.key], row) : defaultCell(col.key, row[col.key])}
                  </td>
                ))}
                {actions.length > 0 && (
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {actions.filter(a => !a.show || a.show(row)).map((a, ai) => (
                        <button
                          key={ai}
                          title={a.title}
                          disabled={a.busy?.(row)}
                          onClick={() => a.onClick(row)}
                          className={a.className ?? 'p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors'}
                        >
                          {a.busy?.(row) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : a.icon}
                        </button>
                      ))}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}