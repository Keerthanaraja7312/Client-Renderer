import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Table as TableIcon, RefreshCw } from 'lucide-react';
import { type ViewBuilderPlugin } from '../sky-view-builder/core/plugin';
import { fetchDomainSchema } from '../api/datastoreApi';
import { useDataProvider, useQueriedDomainData } from '../data/DataProvider';
import { useStateFilteredRows } from '../store/useStateFilteredRows';
import type { StateFilter } from '../store/stateFilters';
import { StateFilterEditor } from '../sky-view-builder/ui/StateFilterEditor';
import { withVisualStyle, StyledSurface, useVisualStyle } from '../sky-view-builder/styles/withVisualStyle';
import { useComponentState } from '../sky-view-builder/hooks/useComponentState';
import { DataTable, type DataTableColumn } from './DataTable';

type TablePluginConfigs = {
  dataSourceId?: string | number | null;
  type?: string | null;
  title: string;
  maxColumns: number;
  /** Rows are narrowed by the live value of other components' state (e.g. a Dropdown). */
  stateFilters?: StateFilter[];
  _pageId?: string;
  _blockId?: string;
};

const SKIP = new Set(['id', 'created_at', 'updated_at']);

function isRelationField(f: { type?: string; cardinality?: string; relatedDomain?: string; listDomain?: string }): boolean {
  return f.type === 'relation' || f.type === 'list' || f.cardinality === 'list' || !!f.relatedDomain || !!f.listDomain;
}

function TableView({
  id,
  configs,
  query,
  updateConfigs: _updateConfigs,
}: {
  id: string;
  configs: TablePluginConfigs;
  query?: Record<string, any>;
  updateConfigs?: (c: Partial<TablePluginConfigs>) => void;
}) {
  const [schemaColumns, setSchemaColumns] = useState<DataTableColumn[]>([]);

  const domainName = (configs.dataSourceId != null ? String(configs.dataSourceId) : '').trim();
  const sourceType = configs.type ?? 'table';
  const { style } = useVisualStyle();
  const headerBg = style.colors.surface;

  // Rows come from the shared DataProvider cache (also honours a saved Query).
  const { refetchDomainRows } = useDataProvider();
  const { rows: queriedRows, loading, error } = useQueriedDomainData(domainName || null, sourceType, query);

  // Live state filters, e.g. Author.id = {book}.authorId. Re-runs automatically
  // whenever the dropdown it is bound to changes.
  const { rows: filteredRows, pending } = useStateFilteredRows(queriedRows, configs.stateFilters);
  const rows = domainName ? filteredRows : null;

  const { setState } = useComponentState({
    componentId: id,
    stateKeys: { 'input.rows': [] },
    pageId: configs._pageId,
    blockInstanceId: configs._blockId,
  });

  // Mirror the *filtered* rows into StateHub so other components can chain off this table.
  const lastRowsSignatureRef = useRef<string>('');
  useEffect(() => {
    const signature = JSON.stringify(filteredRows);
    if (signature !== lastRowsSignatureRef.current) {
      lastRowsSignatureRef.current = signature;
      setState('input.rows', filteredRows);
    }
  }, [filteredRows, setState]);

  // Column labels come from the schema for real tables; for a Query source (no
  // schema) fall back to the keys of the returned rows.
  useEffect(() => {
    if (!domainName || sourceType !== 'table') { setSchemaColumns([]); return; }
    let cancelled = false;
    fetchDomainSchema(domainName)
      .then((res) => {
        if (cancelled) return;
        setSchemaColumns(
          (res.schema ?? [])
            .filter((f: any) => !SKIP.has(f.field_id) && !f.field_id.endsWith('Id') && !isRelationField(f))
            .slice(0, configs.maxColumns || 6)
            .map((f: any) => ({ key: f.field_id, label: f.label ?? f.field_id }))
        );
      })
      .catch(() => { if (!cancelled) setSchemaColumns([]); });
    return () => { cancelled = true; };
  }, [domainName, sourceType, configs.maxColumns]);

  const columns: DataTableColumn[] = useMemo(() => {
    if (schemaColumns.length > 0) return schemaColumns;
    const first = queriedRows[0];
    if (!first) return [];
    return Object.keys(first)
      .filter((k) => !k.startsWith('_') && !SKIP.has(k))
      .slice(0, configs.maxColumns || 6)
      .map((k) => ({ key: k, label: k }));
  }, [schemaColumns, queriedRows, configs.maxColumns]);

  const load = () => { if (domainName) refetchDomainRows(domainName, sourceType); };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border" style={{ backgroundColor: headerBg }}>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-foreground">{configs.title || domainName || 'Table'}</h3>
          {rows !== null && (
            <p className="text-[10px] text-muted-foreground/50 mt-0.5">
              {rows.length} record{rows.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <button onClick={load} disabled={loading}
          className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-secondary transition-all">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          loadingText={`Loading ${domainName}…`}
          emptyText={
            !domainName
              ? 'Select a domain in the settings panel →'
              : pending.length > 0
                ? `Select ${pending.join(', ')} to show rows.`
                : (configs.stateFilters?.length ?? 0) > 0
                  ? 'No records match the current selection'
                  : `No records in "${domainName}" yet`
          }
          error={error}
          onRetry={load}
        />
      </div>
    </div>
  );
}

export const TablePlugin: ViewBuilderPlugin<TablePluginConfigs, Record<string, never>> = withVisualStyle({
  id: 'table-plugin',
  pluginType: 'data',

  toolbar: {
    name: 'Table',
    element: <TableIcon className="h-4 w-4" />,
    toolTip: 'A plain data table for any domain — no detail view, just rows.',
  },

        canvas: {
    element: ({ id, configs, dataSourceId, type, query, updateConfigs, isPreview }) => (
      <StyledSurface updateConfigs={updateConfigs} styleId={`${(configs as any)._pageId || 'page'}.${(configs as any)._blockId || 'block'}.${id}`} isPreview={isPreview}>
        <TableView id={id} configs={{ ...configs, dataSourceId, type }} query={query} updateConfigs={updateConfigs} />
      </StyledSurface>
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
    { field_id: 'title', label: 'Title', type: 'text', defaultValue: '' },
    { field_id: 'maxColumns', label: 'Max Columns', type: 'number', defaultValue: 6 },
  ],

  componentDataSchema: {} as Record<string, never>,
});