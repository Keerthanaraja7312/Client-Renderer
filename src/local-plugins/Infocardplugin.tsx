import { LayoutGrid, Users, Activity, DollarSign, Loader2, AlertTriangle, type LucideIcon } from 'lucide-react';
import { useDomainData } from '@/data/DataProvider';
import { DataSourceSelect } from './DataSourceSelect';
import type { ViewBuilderPlugin } from '@/sky-view-builder/core/plugin';

// ─── Three Info Cards Plugin ────────────────────────────────────────────────
// Renders three side-by-side cards, each bound to its OWN Data Source and
// showing that source's real row count. Unlike a normal plugin instance
// (which has a single "Primary Data Source" in Settings), each card here
// picks its own table via its own dropdown (DataSourceSelect — same table
// list as the built-in Primary Data Source picker), then reads real rows
// independently through DataProvider's shared cache
// (useDomainData -> /datastore/{table}/rows) — the same cache Data Table /
// Dropdown use, so if another block on the page already points at the same
// table, this shares that fetch instead of re-requesting it.

const ICONS: Record<string, LucideIcon> = {
  users: Users,
  activity: Activity,
  dollar: DollarSign,
  grid: LayoutGrid,
};

type InfoCardsConfigs = {
  label1: string; icon1: string; dataSource1: string;
  label2: string; icon2: string; dataSource2: string;
  label3: string; icon3: string; dataSource3: string;
};

function InfoCard({
  label,
  iconKey,
  dataSource,
}: {
  label: string;
  iconKey: string;
  dataSource: string;
}) {
  const Icon = ICONS[iconKey] || LayoutGrid;
  const { rows, loading, error } = useDomainData(dataSource || null);

  return (
    <div className="flex-1 min-w-[160px] rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/30 hover:shadow-md">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {label}
          </p>
          <p className="text-[9px] font-mono text-muted-foreground/50">
            {dataSource || 'no source set'}
          </p>
        </div>
        <div className="rounded-lg bg-secondary p-1.5 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>

      {!dataSource ? (
        <p className="text-[11px] italic text-muted-foreground/60">Set a table name in Settings</p>
      ) : error ? (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="inline-block h-6 w-10 animate-pulse rounded bg-muted" />
        </div>
      ) : (
        <h2 className="text-2xl font-black tracking-tight animate-in fade-in duration-500">
          {rows.length.toLocaleString()}
        </h2>
      )}
    </div>
  );
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

function InfoCardsCanvas({ configs }: { configs: InfoCardsConfigs }) {
  return (
    <div className="flex w-full flex-wrap gap-4">
      <InfoCard label={configs.label1} iconKey={configs.icon1} dataSource={configs.dataSource1} />
      <InfoCard label={configs.label2} iconKey={configs.icon2} dataSource={configs.dataSource2} />
      <InfoCard label={configs.label3} iconKey={configs.icon3} dataSource={configs.dataSource3} />
    </div>
  );
}

// ─── Plugin export ────────────────────────────────────────────────────────────

export const InfoCardsPlugin: ViewBuilderPlugin<InfoCardsConfigs> = {
  id: 'info-cards',
  pluginType: 'data',
  toolbar: {
    name: 'Info Cards',
    element: () => (
      <div className="flex h-full w-full items-center justify-center text-primary">
        <LayoutGrid className="h-5 w-5" />
      </div>
    ),
    toolTip: 'Three cards, each showing the real row count of its own Data Source',
  },
  canvas: {
    element: ({ configs }) => <InfoCardsCanvas configs={configs} />,
  },
  settings: [
    { field_id: 'label1', label: 'Card 1 Label', type: 'text', defaultValue: 'Card 1' },
    { field_id: 'icon1', label: 'Card 1 Icon', type: 'select', enum: ['users', 'activity', 'dollar', 'grid'], defaultValue: 'grid' },
    { field_id: 'dataSource1', label: 'Card 1 Data Source', type: 'text', component: DataSourceSelect, defaultValue: '' },

    { field_id: 'label2', label: 'Card 2 Label', type: 'text', defaultValue: 'Card 2' },
    { field_id: 'icon2', label: 'Card 2 Icon', type: 'select', enum: ['users', 'activity', 'dollar', 'grid'], defaultValue: 'users' },
    { field_id: 'dataSource2', label: 'Card 2 Data Source', type: 'text', component: DataSourceSelect, defaultValue: '' },

    { field_id: 'label3', label: 'Card 3 Label', type: 'text', defaultValue: 'Card 3' },
    { field_id: 'icon3', label: 'Card 3 Icon', type: 'select', enum: ['users', 'activity', 'dollar', 'grid'], defaultValue: 'activity' },
    { field_id: 'dataSource3', label: 'Card 3 Data Source', type: 'text', component: DataSourceSelect, defaultValue: '' },
  ],
  // This plugin doesn't use the single-instance Primary Data Source / Property
  // Mapping section (each card supplies its own source directly instead), so
  // componentDataSchema stays empty — same as Data Table / Dropdown.
  componentDataSchema: {},
};