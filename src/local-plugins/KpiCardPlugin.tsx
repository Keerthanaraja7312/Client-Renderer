import {
  Activity,
  ArrowDown,
  ArrowUp,
  DollarSign,
  Minus,
  ShoppingCart,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type KpiIcon = 'none' | 'users' | 'money' | 'cart' | 'activity' | 'trend';
type KpiAccent = 'blue' | 'green' | 'amber' | 'red' | 'purple';
type Aggregation = 'none' | 'count' | 'sum' | 'average' | 'min' | 'max';

type KpiConfigs = {
  label: string;
  value: string;
  prefix: string;
  suffix: string;
  decimals: string;
  compact: boolean;
  trendValue: string; // percent, e.g. 12.5 or -4
  trendLabel: string;
  higherIsBetter: boolean;
  description: string;
  icon: KpiIcon;
  accent: KpiAccent;
  aggregation: Aggregation;
  dataField: string;
};

type KpiSchema = {
  value: string;
};

// ─── Colours (inline so they never depend on the Tailwind build) ─────────────

const ACCENTS: Record<KpiAccent, { soft: string; solid: string }> = {
  blue: { soft: 'rgba(59,130,246,0.15)', solid: '#3b82f6' },
  green: { soft: 'rgba(34,197,94,0.15)', solid: '#22c55e' },
  amber: { soft: 'rgba(245,158,11,0.15)', solid: '#f59e0b' },
  red: { soft: 'rgba(239,68,68,0.15)', solid: '#ef4444' },
  purple: { soft: 'rgba(168,85,247,0.15)', solid: '#a855f7' },
};

const GOOD = '#22c55e';
const BAD = '#ef4444';

const ICONS: Record<Exclude<KpiIcon, 'none'>, LucideIcon> = {
  users: Users,
  money: DollarSign,
  cart: ShoppingCart,
  activity: Activity,
  trend: TrendingUp,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function aggregate(
  rows: Record<string, unknown>[],
  field: string,
  type: Exclude<Aggregation, 'none'>,
): number | null {
  if (type === 'count') return rows.length;
  if (!field) return null;

  const numbers = rows
    .map((row) => Number(row[field]))
    .filter((n) => Number.isFinite(n));
  if (numbers.length === 0) return 0;

  switch (type) {
    case 'sum':
      return numbers.reduce((a, b) => a + b, 0);
    case 'average':
      return numbers.reduce((a, b) => a + b, 0) / numbers.length;
    case 'min':
      return Math.min(...numbers);
    case 'max':
      return Math.max(...numbers);
    default:
      return null;
  }
}

function formatNumber(value: number, decimals: number, compact: boolean): string {
  return new Intl.NumberFormat(undefined, {
    notation: compact ? 'compact' : 'standard',
    minimumFractionDigits: compact ? 0 : decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

// ─── Canvas Component ─────────────────────────────────────────────────────────

function KpiCanvas({
  configs,
  data,
}: {
  configs: KpiConfigs;
  data: Record<string, unknown>[] | null;
}) {
  const {
    label = 'Total Revenue',
    value = '0',
    prefix = '',
    suffix = '',
    decimals = '0',
    compact = false,
    trendValue = '',
    trendLabel = 'vs last month',
    higherIsBetter = true,
    description = '',
    icon = 'none',
    accent = 'blue',
    aggregation = 'none',
    dataField = '',
  } = configs;

  const colors = ACCENTS[accent] ?? ACCENTS.blue;
  const digits = Math.min(Math.max(Math.floor(Number(decimals)) || 0, 0), 6);

  // Connected data wins; the "Value" setting is the fallback.
  let display: string;
  const fromData =
    data && data.length > 0 && aggregation !== 'none'
      ? aggregate(data, dataField, aggregation)
      : null;

  if (fromData !== null) {
    display = formatNumber(fromData, digits, compact);
  } else {
    const parsed = Number(String(value).replace(/,/g, ''));
    display =
      String(value).trim() !== '' && Number.isFinite(parsed)
        ? formatNumber(parsed, digits, compact)
        : String(value);
  }

  // Trend
  const trendNumber = Number(trendValue);
  const hasTrend = String(trendValue).trim() !== '' && Number.isFinite(trendNumber);
  const direction = trendNumber > 0 ? 'up' : trendNumber < 0 ? 'down' : 'flat';
  const isGood =
    direction === 'flat' ? null : (direction === 'up') === Boolean(higherIsBetter);
  const trendColor: CSSProperties['color'] =
    isGood === null ? undefined : isGood ? GOOD : BAD;
  const TrendIcon = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : Minus;

  const IconComponent = icon !== 'none' ? ICONS[icon] : null;

  return (
    <div className="w-full rounded-xl border border-border bg-background p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>

        {IconComponent && (
          <span
            aria-hidden="true"
            className="flex shrink-0 items-center justify-center rounded-lg"
            style={{ width: 40, height: 40, background: colors.soft, color: colors.solid }}
          >
            <IconComponent className="h-5 w-5" />
          </span>
        )}
      </div>

      <p className="mt-2 text-3xl font-bold text-foreground">
        {prefix}
        {display}
        {suffix}
      </p>

      {hasTrend && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm">
          <span
            className="inline-flex items-center gap-1 font-medium text-muted-foreground"
            style={{ color: trendColor }}
          >
            <TrendIcon className="h-4 w-4" aria-hidden="true" />
            {Math.abs(trendNumber)}%
          </span>
          {trendLabel && <span className="text-muted-foreground">{trendLabel}</span>}
        </p>
      )}

      {description && <p className="mt-2 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const KpiCardPlugin: ViewBuilderPlugin<KpiConfigs, KpiSchema> = {
  id: 'kpi-card',
  pluginType: 'form',

  toolbar: {
    name: 'KPI Card',
    element: <TrendingUp className="h-5 w-5" />,
    toolTip: 'Add a statistic / KPI card',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<KpiConfigs, KpiSchema> {...props}>
        {({ data, configs }) => <KpiCanvas configs={configs} data={data} />}
      </BasePluginView>
    ),
  },

  settings: [
    { field_id: 'label', label: 'Label', type: 'text', defaultValue: 'Total Revenue' },
    { field_id: 'value', label: 'Value', type: 'text', defaultValue: '12450' },
    { field_id: 'prefix', label: 'Prefix (e.g. $)', type: 'text', defaultValue: '$' },
    { field_id: 'suffix', label: 'Suffix (e.g. %)', type: 'text', defaultValue: '' },
    { field_id: 'decimals', label: 'Decimal Places', type: 'text', defaultValue: '0' },
    { field_id: 'compact', label: 'Compact Numbers (1.2K)', type: 'checkbox', defaultValue: false },
    {
      field_id: 'trendValue',
      label: 'Trend % (negative for a drop)',
      type: 'text',
      defaultValue: '12.5',
    },
    { field_id: 'trendLabel', label: 'Trend Label', type: 'text', defaultValue: 'vs last month' },
    {
      field_id: 'higherIsBetter',
      label: 'Higher Is Better (green when up)',
      type: 'checkbox',
      defaultValue: true,
    },
    { field_id: 'description', label: 'Description', type: 'text', defaultValue: '' },
    {
      field_id: 'icon',
      label: 'Icon',
      type: 'select',
      defaultValue: 'money',
      enum: ['none', 'users', 'money', 'cart', 'activity', 'trend'],
    },
    {
      field_id: 'accent',
      label: 'Icon Colour',
      type: 'select',
      defaultValue: 'blue',
      enum: ['blue', 'green', 'amber', 'red', 'purple'],
    },
    {
      field_id: 'aggregation',
      label: 'Calculate From Data',
      type: 'select',
      defaultValue: 'none',
      enum: ['none', 'count', 'sum', 'average', 'min', 'max'],
    },
    {
      field_id: 'dataField',
      label: 'Data Field (for sum / average / min / max)',
      type: 'text',
      defaultValue: '',
    },
  ],

  componentDataSchema: {
    value: '',
  },

  componentDataMetadata: {
    value: { type: 'string', label: 'KPI Value' },
  },
};