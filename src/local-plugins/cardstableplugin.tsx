import { useEffect, useMemo, useRef, useState } from 'react';import { LayoutGrid, Loader2, AlertTriangle } from 'lucide-react';
import { useHub } from '@/store/StateHubContext';
import { useComponentState } from '@/sky-view-builder/hooks/useComponentState';
import { useQueriedDomainData } from '@/data/DataProvider';
import type { ViewBuilderPlugin } from '@/sky-view-builder/core/plugin';
import { StateBindingSelect, DataFieldSelect } from '@/sky-view-builder/ui/SettingFieldSelectors';
import { withVisualStyle, StyledSurface, useVisualStyle } from '@/sky-view-builder/styles/withVisualStyle';
import { colorUtils } from '@/sky-view-builder/styles/visualStyles';
import type { VisualStyleConfig } from '@/sky-view-builder/styles/visualStyles';

// ─── Cards Table ──────────────────────────────────────────────────────────────
// Same live-data path as Data Table (DataProvider's shared domain-data cache,
// filtered by the Logic Architect / Query Builder via useQueriedDomainData),
// but rendered as a responsive grid of cards instead of rows — one card per
// record. Columns are auto-derived from the real rows themselves, same as
// Data Table, since a generic data source can have any shape.
//
// Every field is shown uniformly as a label/value pair inside the card —
// no title/subtitle distinction.

type CardsTableConfigs = {
  columns?: number;
  selectedRow?: string;
  hubKey?: string;
  filterField?: string;
  visualStyle?: Partial<VisualStyleConfig>;
  /** Fine-grained styling beyond the shared Visual Style panel — the
   *  status bar text, card background/border (default + selected), and
   *  each field's label vs value color. */
  cardStyling?: CardStylingConfig;
  _pageId?: string;
  _blockId?: string;
};

interface CardStylingConfig {
  /** Color of the "{dataSource} — X of Y" status row above the grid. */
  statusBarText?: string;
  /** A card's own background/border in its normal (unselected) state. */
  cardBg?: string;
  cardBorder?: string;
  /** A card's background/border once clicked/selected — falls back to the
   *  theme accent color when unset, same as before this setting existed. */
  selectedBg?: string;
  selectedBorder?: string;
  /** Each field row inside a card: the field name vs its value. */
  labelColor?: string;
  valueColor?: string;
}

// ─── Color field — swatch + hex input, same pattern VisualStyleSettings
// uses, plus a reset (✕) so an override can fall back to the theme
// default instead of being stuck once set.

function ColorField({
  label, value, placeholder, onChange,
}: {
  label: string;
  value?: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground/60 block mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || placeholder}
          onChange={e => onChange(e.target.value)}
          className="w-8 h-8 rounded-lg border border-border cursor-pointer bg-transparent p-0.5 shrink-0"
        />
        <input
          type="text"
          value={value || ''}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className="flex-1 h-8 rounded-lg border border-border bg-secondary px-2 text-xs outline-none focus:border-primary/60 font-mono"
        />
        {value && (
          <button
            type="button"
            title="Reset to theme default"
            onClick={() => onChange('')}
            className="shrink-0 text-[10px] text-muted-foreground/40 hover:text-destructive px-1">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function CardStylingSetting({
  value, onChange,
}: {
  value?: CardStylingConfig;
  onChange: (v: CardStylingConfig) => void;
}) {
  const cur = value ?? {};

  function set(patch: Partial<CardStylingConfig>) {
    onChange({ ...cur, ...patch });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 bg-secondary/20 rounded-lg p-3 border border-border">
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">Status Bar</p>
        <ColorField label="Text Color" placeholder="#a8b0bf" value={cur.statusBarText} onChange={v => set({ statusBarText: v })} />
      </div>

      <div className="flex flex-col gap-3 bg-secondary/20 rounded-lg p-3 border border-border">
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">Card</p>
        <ColorField label="Background" placeholder="#1c212b" value={cur.cardBg} onChange={v => set({ cardBg: v })} />
        <ColorField label="Border" placeholder="#262c38" value={cur.cardBorder} onChange={v => set({ cardBorder: v })} />
      </div>

      <div className="flex flex-col gap-3 bg-secondary/20 rounded-lg p-3 border border-border">
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">Selected Card</p>
        <ColorField label="Background" placeholder="#1a3a30" value={cur.selectedBg} onChange={v => set({ selectedBg: v })} />
        <ColorField label="Border" placeholder="#34d399" value={cur.selectedBorder} onChange={v => set({ selectedBorder: v })} />
      </div>

      <div className="flex flex-col gap-3 bg-secondary/20 rounded-lg p-3 border border-border">
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">Field Text</p>
        <ColorField label="Label Color" placeholder="#a8b0bf" value={cur.labelColor} onChange={v => set({ labelColor: v })} />
        <ColorField label="Value Color" placeholder="#f5f7fa" value={cur.valueColor} onChange={v => set({ valueColor: v })} />
      </div>
    </div>
  );
}

// ─── Theme colors ────────────────────────────────────────────────────────────
// Resolves the current Visual Style config into the colors this plugin's
// own markup needs. Same approach as DomainListPlugin's useThemeColors:
// applied as inline styles rather than bg-primary/border-primary Tailwind
// classes, since those resolve through the app's own CSS-variable theme
// and won't necessarily reflect a raw hex override the way a direct
// inline style does. Selected cards use `colors.accent.primary`; the
// top status bar picks up `colors.surface`, matching the header treatment
// other plugins give their own top bar.
function useThemeColors() {
  const { style } = useVisualStyle();
  const surfaceBg = style.colors.surface;
  const accent = style.colors.accent.primary;
  const accentFg = colorUtils.getContrastColor(accent);
  return { surfaceBg, accent, accentFg };
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

function CardsTableCanvas({
  id,
  configs,
  updateConfigs,
  dataSourceId,
  dataSourceType,
  type,
  query,
}: {
  id: string;
  configs: CardsTableConfigs;
  updateConfigs?: (c: Partial<CardsTableConfigs>) => void;
  dataSourceId?: string | number | null;
  dataSourceType?: string | number | null;
  type?: string | null;
  query?: Record<string, any>;
}) {
  const columns = configs.columns && configs.columns > 0 ? configs.columns : 3;
  const { accent } = useThemeColors();
  const cardStyling = configs.cardStyling ?? {};

  // ── Real data path — via DataProvider, queried/filtered by the Query Builder ──
  const { rows: filteredRemoteRows, allRows: remoteRows, loading, error } = useQueriedDomainData(
    dataSourceId,
    dataSourceType ?? type ?? 'table',
    query
  );

  const safeRemoteRows = useMemo(() => {
    if (!Array.isArray(remoteRows)) return [];
    return remoteRows.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
  }, [remoteRows]);

  const safeFilteredRows = useMemo(() => {
    if (!Array.isArray(filteredRemoteRows)) return [];
    return filteredRemoteRows.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
  }, [filteredRemoteRows]);

  const remoteColumns = useMemo(() => {
    if (safeRemoteRows.length === 0) return [];
    const firstRow = safeRemoteRows[0] as Record<string, any>;
    return Object.keys(firstRow).filter((k) => !k.startsWith('_'));
  }, [safeRemoteRows]);

  const bodyFields = remoteColumns;
  const hub = useHub();
  const [hubFilterValue, setHubFilterValue] = useState<string | null>(() => {
    if (!configs.hubKey) return null;
    try {
      const initialValue = hub.getResolved(configs.hubKey, {
        componentId: id,
        blockInstanceId: configs._blockId,
        pageId: configs._pageId,
      });
      return initialValue == null ? null : String(initialValue);
    } catch {
      return null;
    }
  });
  const [selectedId, setSelectedId] = useState<string | undefined>(configs.selectedRow);

  useEffect(() => {
    if (!configs.hubKey) {
      setHubFilterValue(null);
      return;
    }

    try {
      const currentValue = hub.getResolved(configs.hubKey, {
        componentId: id,
        blockInstanceId: configs._blockId,
        pageId: configs._pageId,
      });
      setHubFilterValue(currentValue == null ? null : String(currentValue));
      console.log('[cards-table] resolved-state', { hubKey: configs.hubKey, currentValue, configs });
    } catch (err) {
      console.error('[cards-table] resolved-state-error', err);
      setHubFilterValue(null);
    }
  }, [hub, configs.hubKey, id, configs._blockId, configs._pageId]);

  useEffect(() => {
    if (!configs.hubKey) return;

    try {
      const unsubscribe = hub.on(`${configs.hubKey}Changed`, (payload) => {
        const nextValue = payload == null ? null : String(payload);
        setHubFilterValue(nextValue);
        console.log('[cards-table] event-state', { hubKey: configs.hubKey, nextValue, configs });
      });
      return unsubscribe;
    } catch {
      return undefined;
    }
  }, [hub, configs.hubKey]);

  const displayedRows = useMemo(() => {
    const filterField = configs.filterField;
    const selectedText = hubFilterValue?.trim().toLowerCase();

    if (!configs.hubKey || !filterField || !selectedText) {
      return safeFilteredRows;
    }

    return safeFilteredRows.filter((row) => {
      const record = row as Record<string, any>;
      const directValue = record[filterField];
      if (directValue != null) {
        const normalized = String(directValue).trim().toLowerCase();
        if (normalized === selectedText || normalized.includes(selectedText)) {
          return true;
        }
      }

      return Object.entries(record).some(([key, value]) => {
        if (key === filterField) return false;
        const normalized = String(value ?? '').trim().toLowerCase();
        return normalized === selectedText || normalized.includes(selectedText);
      });
    });
  }, [safeFilteredRows, configs.hubKey, configs.filterField, hubFilterValue]);

    const { setState } = useComponentState({
    componentId: id,
    // 'input.rows' registers global.components.{id}.input.rows — same
    // live-runtime-state pattern used by the dropdown plugin's input.options
    // and TablePlugin/domainlistplugin's input.rows.
    stateKeys: { selectedRow: configs.selectedRow ?? null, 'input.rows': [] },
    publishes: ['cardSelected'],
    pageId: configs._pageId,
    blockInstanceId: configs._blockId,
  });

  // Mirror the currently-displayed (filtered) rows into StateHub,
  // content-compared so this only fires when the actual row data changes.
  const lastCardsRowsSignatureRef = useRef<string>('');
  useEffect(() => {
    const signature = JSON.stringify(displayedRows);
    if (signature !== lastCardsRowsSignatureRef.current) {
      lastCardsRowsSignatureRef.current = signature;
      setState('input.rows', displayedRows);
    }
  }, [displayedRows, setState]);

  const selectRow = (rowId: string) => {
    const next = selectedId === rowId ? undefined : rowId;
    setSelectedId(next);
    // Only state — removed the old updateConfigs?.({ selectedRow: next })
    // duplicate write (was writing the same value to both props and state).
    setState('selectedRow', next ?? null);
  };

  const clampedColumns = Math.min(Math.max(columns, 1), 4);

  // ── Real data rendering ─────────────────────────────────────────────────
  if (dataSourceId) {
    return (
      <div className="flex flex-col gap-2 w-full">
        <div className="flex items-center justify-between">
          <span
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
            style={cardStyling.statusBarText ? { color: cardStyling.statusBarText } : undefined}>
            <LayoutGrid className="w-3 h-3" /> {String(dataSourceId)}
          </span>
          <span
            className="text-[10px] text-muted-foreground"
            style={cardStyling.statusBarText ? { color: cardStyling.statusBarText } : undefined}>
            {loading ? 'Loading…' : `${displayedRows.length} of ${safeRemoteRows.length}`}
          </span>
        </div>

        {error ? (
          <div className="flex items-center gap-2 p-4 text-xs text-destructive rounded-lg border border-border">
            <AlertTriangle className="w-3.5 h-3.5" /> {error}
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground rounded-lg border border-border">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading rows…
          </div>
        ) : displayedRows.length === 0 ? (
          <div className="p-6 text-center text-xs italic text-muted-foreground rounded-lg border border-dashed border-border">
            No rows match this query.
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${clampedColumns}, minmax(0, 1fr))` }}
          >
            {displayedRows.map((row, i) => {
              const rowId = String(row.id ?? row.record_id ?? i);
              const isSelected = selectedId === rowId;
              return (
                <div
                  key={rowId}
                  onClick={() => selectRow(rowId)}
                  className={`cursor-pointer rounded-xl border p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md ${
                    isSelected
                      ? (cardStyling.selectedBg || cardStyling.selectedBorder ? '' : 'bg-primary/5')
                      : (cardStyling.cardBg || cardStyling.cardBorder ? '' : 'border-border bg-card')
                  }`}
                  style={{
                    ...(isSelected
                      ? {
                          backgroundColor: cardStyling.selectedBg,
                          borderColor: cardStyling.selectedBorder || accent,
                        }
                      : {
                          backgroundColor: cardStyling.cardBg,
                          borderColor: cardStyling.cardBorder,
                        }),
                  }}
                >
                  {bodyFields.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      {bodyFields.map((field) => (
                        <div key={field} className="flex items-center justify-between gap-2 text-[11px]">
                          <span
                            className="text-muted-foreground/70 uppercase tracking-wide truncate"
                            style={cardStyling.labelColor ? { color: cardStyling.labelColor } : undefined}>
                            {field}
                          </span>
                          <span
                            className="font-medium truncate"
                            style={cardStyling.valueColor ? { color: cardStyling.valueColor } : undefined}>
                            {String((row as Record<string, any>)[field] ?? '')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Empty state — no Data Source assigned yet ───────────────────────────
  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <LayoutGrid className="w-3 h-3" /> Cards Table
        </span>
      </div>

      <div className="w-full rounded-lg border border-dashed border-border overflow-hidden">
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center px-4">
          <LayoutGrid className="w-6 h-6 text-muted-foreground/40" />
          <p className="text-xs font-medium text-muted-foreground/60">
            No data source selected
          </p>
          <p className="text-[11px] text-muted-foreground/40">
            Select a Primary Data Source in the Configuration panel to preview cards here.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Plugin export ────────────────────────────────────────────────────────────
//
// Wrapped in withVisualStyle, same as DomainListPlugin: no manual
// "visualStyle" settings field, no manual VisualStyleProvider — the HOC
// appends the Visual Style field to `settings` and supplies the config to
// useVisualStyle() automatically. Canvas content is wrapped in
// <StyledSurface> so the plugin's card grid sits on the styled background
// like every other withVisualStyle plugin.

export const CardsTablePlugin: ViewBuilderPlugin<CardsTableConfigs> = withVisualStyle({
  id: 'cards-table',
  pluginType: 'data',
  status: 'completed',
  toolbar: {
    name: 'Cards Grid',
    element: () => <LayoutGrid className="w-4 h-4" />,
    toolTip: 'Assign a Data Source in Settings to show real rows as a card grid',
  },
    canvas: {
    element: ({ id, configs, updateConfigs, dataSourceId, dataSourceType, query, isPreview }) => (
      <StyledSurface updateConfigs={updateConfigs} styleId={`${configs._pageId || 'page'}.${configs._blockId || 'block'}.${id}`} isPreview={isPreview}>
        <CardsTableCanvas
          id={id}
          configs={configs}
          updateConfigs={updateConfigs}
          dataSourceId={dataSourceId}
          dataSourceType={dataSourceType}
          query={query}
        />
      </StyledSurface>
    ),
  },
  settings: [
    {
      field_id: 'columns',
      label: 'Columns',
      type: 'select',
      defaultValue: 3,
      enum: ['1', '2', '3', '4'],
    },
    {
      field_id: 'hubKey',
      label: 'Linked State',
      type: 'text',
      defaultValue: '',
      optionsFrom: 'state',
      component: StateBindingSelect,
    },
    {
      field_id: 'filterField',
      label: 'Filter Field',
      type: 'text',
      defaultValue: '',
      optionsFrom: 'dataField',
      component: DataFieldSelect,
    },
    {
      field_id: 'cardStyling',
      label: 'Card Styling',
      type: 'custom',
      defaultValue: {},
      component: CardStylingSetting,
    },
    // "visualStyle" is appended automatically by withVisualStyle — don't add it here.
  ],
  componentDataSchema: {},
});