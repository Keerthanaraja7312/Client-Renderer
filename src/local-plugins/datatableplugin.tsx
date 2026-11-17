import { useMemo, useState } from 'react';
import { Table2, Loader2, AlertTriangle } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useComponentState } from '@/sky-view-builder/hooks/useComponentState';
import { useQueriedDomainData } from '@/data/DataProvider';
import type { ViewBuilderPlugin } from '@/sky-view-builder/core/plugin';
import { useStateFilteredRows } from '@/store/useStateFilteredRows';
import type { StateFilter } from '@/store/stateFilters';
import { StateFilterEditor } from '@/sky-view-builder/ui/StateFilterEditor';

// ─── Rows come from DataProvider's shared domain-data cache once a Data ───
// Source is assigned in the Settings panel. DataProvider fetches
// /datastore/{table}/rows once per dataSourceId (shared across every plugin
// instance pointed at the same source) and applies the filter saved by the
// Logic Architect (Query Builder) — see useQueriedDomainData. Before a Data
// Source is assigned, the canvas shows an empty-state prompt.

type DataTableConfigs = {
  selectedRow?: string;
  showHeader?: boolean;
  stripedRows?: boolean;
  compact?: boolean;
  showRowNumber?: boolean;
  allowRowSelection?: boolean;
  /** Rows are narrowed by the live value of other components' state (e.g. a Dropdown). */
  stateFilters?: StateFilter[];
  _pageId?: string;
  _blockId?: string;
};

// ─── Canvas ───────────────────────────────────────────────────────────────────

function DataTableCanvas({
  id,
  configs,
  updateConfigs,
  dataSourceId,
  dataSourceType,
  type,
  query,
}: {
  id: string;
  configs: DataTableConfigs;
  updateConfigs?: (c: Partial<DataTableConfigs>) => void;
  dataSourceId?: string | number | null;
  dataSourceType?: string | null;
  type?: string | null;
  query?: Record<string, any>;
}) {

  // ── Real data path — via DataProvider, queried/filtered by the Query Builder ──
  const { rows: queriedRows, allRows: remoteRows, loading, error } = useQueriedDomainData(
    dataSourceId,
    dataSourceType ?? type ?? 'table',
    query
  );

  // ── Live state filters — e.g. "clinic_id = <whatever the Clinic dropdown has selected>".
  // Runs after the saved query, and re-runs whenever a bound state variable changes.
  const { rows: filteredRemoteRows, pending: pendingState } = useStateFilteredRows(
    queriedRows,
    configs.stateFilters
  );

  // Columns are derived from the real rows themselves, since a generic data
  // source can have any shape — unlike the fixed CustomerRow demo columns.
  const remoteColumns = useMemo(() => {
    if (remoteRows.length === 0) return [];
    return Object.keys(remoteRows[0]).filter((k) => !k.startsWith('_'));
  }, [remoteRows]);

  const compact = configs.compact ?? false;
  const showHeader = configs.showHeader ?? true;
  const stripedRows = configs.stripedRows ?? false;
  const showRowNumber = configs.showRowNumber ?? false;
  const allowRowSelection = configs.allowRowSelection ?? true;

  const [selectedId, setSelectedId] = useState<string | undefined>(configs.selectedRow);

  const { setState } = useComponentState({
    componentId: id,
    stateKeys: { selectedRow: configs.selectedRow ?? null, loading: false },
    publishes: ['patientSelected'],
    pageId: configs._pageId,
    blockInstanceId: configs._blockId,
  });

  const selectRow = (rowId: string) => {
    if (!allowRowSelection) return;
    const next = selectedId === rowId ? undefined : rowId;
    setSelectedId(next);
    updateConfigs?.({ selectedRow: next });
    setState('selectedRow', next ?? null);
  };

  // ── Real data rendering ─────────────────────────────────────────────────
  if (dataSourceId) {
    return (
      <div className={`flex flex-col gap-2 w-full ${compact ? 'text-sm' : ''}`}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Table2 className="w-3 h-3" /> {String(dataSourceId)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {loading ? 'Loading…' : `${filteredRemoteRows.length} of ${remoteRows.length}`}
          </span>
        </div>

        <div className="w-full rounded-lg border border-border overflow-hidden">
          {error ? (
            <div className="flex items-center gap-2 p-4 text-xs text-destructive">
              <AlertTriangle className="w-3.5 h-3.5" /> {error}
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading rows…
            </div>
          ) : (
            <Table>
              {showHeader && (
                <TableHeader>
                  <TableRow>
                    {showRowNumber && <TableHead>#</TableHead>}
                    {remoteColumns.map((col) => (
                      <TableHead key={col}>{col}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
              )}
              <TableBody>
                {filteredRemoteRows.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-center text-muted-foreground italic" colSpan={(remoteColumns.length || 1) + (showRowNumber ? 1 : 0)}>
                      {pendingState.length > 0
                        ? `Select ${pendingState.join(', ')} to show rows.`
                        : 'No rows match this query.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRemoteRows.map((row, i) => {
                    const rowId = String(row.id ?? row.record_id ?? i);
                    return (
                      <TableRow
                        key={rowId}
                        onClick={() => selectRow(rowId)}
                        className={
                          `${allowRowSelection ? 'cursor-pointer' : 'cursor-default'} ${selectedId === rowId ? 'bg-primary/10' : ''} ${stripedRows && i % 2 === 1 ? 'bg-muted/5' : ''}`
                        }
                      >
                        {showRowNumber && (
                          <TableCell className="text-muted-foreground text-right">{i + 1}</TableCell>
                        )}
                        {remoteColumns.map((col) => (
                          <TableCell
                            key={col}
                            className={`${col === remoteColumns[0] ? 'font-medium' : 'text-muted-foreground'} ${compact ? 'px-2 py-1' : ''}`}
                          >
                            {String(row[col] ?? '')}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    );
  }

  // ── Empty state — no Data Source assigned yet ───────────────────────────
  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <Table2 className="w-3 h-3" /> Data Provider
        </span>
      </div>

      <div className="w-full rounded-lg border border-dashed border-border overflow-hidden">
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center px-4">
          <Table2 className="w-6 h-6 text-muted-foreground/40" />
          <p className="text-xs font-medium text-muted-foreground/60">
            No data source selected
          </p>
          <p className="text-[11px] text-muted-foreground/40">
            Select a Primary Data Source in the Configuration panel to preview rows here.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Plugin export ────────────────────────────────────────────────────────────

export const DataTablePlugin: ViewBuilderPlugin<DataTableConfigs> = {
  id: 'data-table',
  pluginType: 'data',
  toolbar: {
    name: 'Data Provider',
    element: () => <Table2 className="w-4 h-4" />,
    toolTip: 'Assign a Data Source in Settings to show real rows, filtered by the Logic Architect',
  },
  canvas: {
    element: ({ id, configs, updateConfigs, dataSourceId, type, query }) => (
      <DataTableCanvas
        id={id}
        configs={configs}
        updateConfigs={updateConfigs}
        dataSourceId={dataSourceId}
        dataSourceType={type ?? null}
        type={type ?? null}
        query={query}
      />
    ),
  },
  settings: [
    {
      field_id: 'stateFilters',
      label: 'Filter by State',
      type: 'stateFilters',
      defaultValue: [],
      optionsFrom: 'stateAndData',
      component: StateFilterEditor,
    },
    { field_id: 'showHeader', label: 'Show Header', type: 'checkbox', defaultValue: true },
    { field_id: 'stripedRows', label: 'Striped Rows', type: 'checkbox', defaultValue: false },
    { field_id: 'compact', label: 'Compact Mode', type: 'checkbox', defaultValue: false },
    { field_id: 'showRowNumber', label: 'Show Row Number', type: 'checkbox', defaultValue: false },
    { field_id: 'allowRowSelection', label: 'Allow Row Selection', type: 'checkbox', defaultValue: true },
  ],
  componentDataSchema: {},
};