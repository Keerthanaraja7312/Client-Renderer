import { ArrowDown, ArrowLeftRight, ArrowUp, Minus } from 'lucide-react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type Aggregation = 'none' | 'count' | 'sum' | 'average' | 'min' | 'max';
type DifferenceStyle = 'percent' | 'absolute' | 'both';

type MetricComparisonConfigs = {
  title: string;
  currentLabel: string;
  currentValue: string;
  previousLabel: string;
  previousValue: string;
  prefix: string;
  suffix: string;
  decimals: string;
  compact: boolean;
  higherIsBetter: boolean;
  differenceStyle: DifferenceStyle;
  showBars: boolean;
  aggregation: Aggregation; // optional: calculate the current value from data
  dataField: string;
};

type MetricComparisonSchema = {
  currentValue: string;
  previousValue: string;
};

// ─── Colours (inline so they never depend on the Tailwind build) ─────────────

const CURRENT_COLOR = '#3b82f6';
const PREVIOUS_COLOR = '#9ca3af';
const GOOD = '#22c55e';
const BAD = '#ef4444';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNumber(raw: string): number | null {
  const text = String(raw ?? '').replace(/,/g, '').trim();
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function aggregate(
  rows: Record<string, unknown>[],
  field: string,
  type: Exclude<Aggregation, 'none'>,
): number | null {
  if (type === 'count') return rows.length;
  if (!field) return null;

  const numbers = rows.map((row) => Number(row[field])).filter((n) => Number.isFinite(n));
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

function MetricComparisonCanvas({
  configs,
  data,
}: {
  configs: MetricComparisonConfigs;
  data: Record<string, unknown>[] | null;
}) {
  const {
    title = 'Revenue',
    currentLabel = 'This month',
    currentValue = '0',
    previousLabel = 'Last month',
    previousValue = '0',
    prefix = '',
    suffix = '',
    decimals = '0',
    compact = false,
    higherIsBetter = true,
    differenceStyle = 'both',
    showBars = true,
    aggregation = 'none',
    dataField = '',
  } = configs;

  const digits = Math.min(Math.max(Math.floor(Number(decimals)) || 0, 0), 6);
  const fmt = (n: number) => `${prefix}${formatNumber(n, digits, compact)}${suffix}`;

  // Connected data wins for the current value; settings are the fallback.
  const fromData =
    data && data.length > 0 && aggregation !== 'none'
      ? aggregate(data, dataField, aggregation)
      : null;
  const current = fromData ?? toNumber(currentValue) ?? 0;
  const previous = toNumber(previousValue) ?? 0;

  const diff = current - previous;
  const percent = previous !== 0 ? (diff / Math.abs(previous)) * 100 : null;
  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const isGood = direction === 'flat' ? null : (direction === 'up') === Boolean(higherIsBetter);
  const diffColor = isGood === null ? undefined : isGood ? GOOD : BAD;
  const DiffIcon = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : Minus;

  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  const absoluteText = `${sign}${fmt(Math.abs(diff))}`;
  const percentText =
    percent === null ? 'n/a' : `${sign}${Math.abs(percent).toFixed(1)}%`;

  const diffText =
    differenceStyle === 'absolute'
      ? absoluteText
      : differenceStyle === 'percent'
        ? percentText
        : `${absoluteText} (${percentText})`;

  // Bars are scaled against the larger of the two values.
  const maxValue = Math.max(Math.abs(current), Math.abs(previous), 1e-9);
  const currentWidth = (Math.abs(current) / maxValue) * 100;
  const previousWidth = (Math.abs(previous) / maxValue) * 100;

  return (
    <div className="w-full rounded-xl border border-border bg-background p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>

        <span
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground"
          style={{ color: diffColor }}
          aria-label={`Change: ${diffText}`}
        >
          <DiffIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {diffText}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="text-xs text-muted-foreground">{currentLabel}</p>
          <p className="mt-1 text-3xl font-bold text-foreground">{fmt(current)}</p>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">{previousLabel}</p>
          <p className="mt-1 text-xl font-semibold text-muted-foreground">{fmt(previous)}</p>
        </div>
      </div>

      {showBars && (
        <div className="mt-5 space-y-2" role="img" aria-label={`${currentLabel} ${fmt(current)} compared with ${previousLabel} ${fmt(previous)}`}>
          {[
            { label: currentLabel, width: currentWidth, color: CURRENT_COLOR },
            { label: previousLabel, width: previousWidth, color: PREVIOUS_COLOR },
          ].map((bar) => (
            <div key={bar.label} className="flex items-center gap-3">
              <span className="truncate text-xs text-muted-foreground" style={{ width: 84 }}>
                {bar.label}
              </span>
              <div className="flex-1 overflow-hidden rounded-full bg-muted" style={{ height: 8 }}>
                <div
                  style={{
                    width: `${bar.width}%`,
                    height: '100%',
                    background: bar.color,
                    borderRadius: 9999,
                    transition: 'width 300ms ease',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const MetricComparisonPlugin: ViewBuilderPlugin<
  MetricComparisonConfigs,
  MetricComparisonSchema
> = {
  id: 'metric-comparison',
  pluginType: 'form',

  toolbar: {
    name: 'Metric Comparison',
    element: <ArrowLeftRight className="h-5 w-5" />,
    toolTip: 'Compare a metric with a previous period',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<MetricComparisonConfigs, MetricComparisonSchema> {...props}>
        {({ data, configs }) => <MetricComparisonCanvas configs={configs} data={data} />}
      </BasePluginView>
    ),
  },

  settings: [
    { field_id: 'title', label: 'Title', type: 'text', defaultValue: 'Revenue' },
    { field_id: 'currentLabel', label: 'Current Label', type: 'text', defaultValue: 'This month' },
    { field_id: 'currentValue', label: 'Current Value', type: 'text', defaultValue: '14200' },
    { field_id: 'previousLabel', label: 'Previous Label', type: 'text', defaultValue: 'Last month' },
    { field_id: 'previousValue', label: 'Previous Value', type: 'text', defaultValue: '12600' },
    { field_id: 'prefix', label: 'Prefix (e.g. $)', type: 'text', defaultValue: '$' },
    { field_id: 'suffix', label: 'Suffix (e.g. %)', type: 'text', defaultValue: '' },
    { field_id: 'decimals', label: 'Decimal Places', type: 'text', defaultValue: '0' },
    { field_id: 'compact', label: 'Compact Numbers (1.2K)', type: 'checkbox', defaultValue: false },
    {
      field_id: 'higherIsBetter',
      label: 'Higher Is Better (green when up)',
      type: 'checkbox',
      defaultValue: true,
    },
    {
      field_id: 'differenceStyle',
      label: 'Show Difference As',
      type: 'select',
      defaultValue: 'both',
      enum: ['percent', 'absolute', 'both'],
    },
    { field_id: 'showBars', label: 'Show Comparison Bars', type: 'checkbox', defaultValue: true },
    {
      field_id: 'aggregation',
      label: 'Calculate Current Value From Data',
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
    currentValue: '',
    previousValue: '',
  },

  componentDataMetadata: {
    currentValue: { type: 'string', label: 'Current Value' },
    previousValue: { type: 'string', label: 'Previous Value' },
  },
};