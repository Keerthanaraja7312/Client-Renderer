import { Gauge as GaugeIcon } from 'lucide-react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type GaugeShape = 'semi' | 'arc';
type GaugeStyle = 'fill' | 'needle';
type ColorMode = 'zones' | 'single';
type GaugeColor = 'blue' | 'green' | 'amber' | 'red' | 'purple';
type GaugeSize = 'sm' | 'md' | 'lg';
type Aggregation = 'none' | 'count' | 'sum' | 'average' | 'min' | 'max';

type GaugeConfigs = {
  title: string;
  value: string;
  min: string;
  max: string;
  prefix: string;
  suffix: string;
  decimals: string;
  caption: string;
  shape: GaugeShape;
  gaugeStyle: GaugeStyle;
  colorMode: ColorMode;
  color: GaugeColor;
  lowThreshold: string;
  highThreshold: string;
  higherIsBetter: boolean;
  showMinMax: boolean;
  size: GaugeSize;
  aggregation: Aggregation; // optional: calculate the value from connected data
  dataField: string;
};

type GaugeSchema = {
  value: string;
};

// ─── Colours (inline so they never depend on the Tailwind build) ─────────────

const HEX: Record<GaugeColor, string> = {
  blue: '#3b82f6',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  purple: '#a855f7',
};

const MAX_WIDTH: Record<GaugeSize, number> = { sm: 180, md: 260, lg: 340 };

// ─── Geometry ─────────────────────────────────────────────────────────────────

const CX = 100;
const CY = 100;
const RADIUS = 78;
const STROKE = 16;

// Angles run clockwise in degrees, 0° = pointing right (SVG y axis points down).
const SHAPES: Record<GaugeShape, { start: number; sweep: number; viewBox: string }> = {
  semi: { start: 180, sweep: 180, viewBox: '0 0 200 124' },
  arc: { start: 135, sweep: 270, viewBox: '0 0 200 178' },
};

function pointAt(angleDeg: number, radius: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
}

function arcPath(start: number, sweep: number): string {
  const [sx, sy] = pointAt(start, RADIUS);
  const [ex, ey] = pointAt(start + sweep, RADIUS);
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${sx} ${sy} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${ex} ${ey}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNumber(raw: string, fallback: number): number {
  const text = String(raw ?? '').replace(/,/g, '').trim();
  if (text === '') return fallback;
  const n = Number(text);
  return Number.isFinite(n) ? n : fallback;
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

function formatNumber(value: number, decimals: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

// ─── Canvas Component ─────────────────────────────────────────────────────────

function GaugeCanvas({
  configs,
  data,
}: {
  configs: GaugeConfigs;
  data: Record<string, unknown>[] | null;
}) {
  const {
    title = '',
    value = '0',
    min = '0',
    max = '100',
    prefix = '',
    suffix = '',
    decimals = '0',
    caption = '',
    shape = 'semi',
    gaugeStyle = 'fill',
    colorMode = 'zones',
    color = 'blue',
    lowThreshold = '40',
    highThreshold = '70',
    higherIsBetter = true,
    showMinMax = true,
    size = 'md',
    aggregation = 'none',
    dataField = '',
  } = configs;

  const geometry = SHAPES[shape] ?? SHAPES.semi;
  const digits = Math.min(Math.max(Math.floor(Number(decimals)) || 0, 0), 4);

  // Range
  const minValue = toNumber(min, 0);
  let maxValue = toNumber(max, 100);
  if (maxValue <= minValue) maxValue = minValue + 1;
  const span = maxValue - minValue;

  // Connected data wins; the "Value" setting is the fallback.
  const fromData =
    data && data.length > 0 && aggregation !== 'none'
      ? aggregate(data, dataField, aggregation)
      : null;
  const current = fromData ?? toNumber(value, 0);

  const percent = Math.min(Math.max((current - minValue) / span, 0), 1) * 100;

  // Colour zones
  const low = toNumber(lowThreshold, minValue + span * 0.4);
  const high = toNumber(highThreshold, minValue + span * 0.7);
  const LOW_COLOR = higherIsBetter ? HEX.red : HEX.green;
  const HIGH_COLOR = higherIsBetter ? HEX.green : HEX.red;
  const zoneColor = current < low ? LOW_COLOR : current < high ? HEX.amber : HIGH_COLOR;
  const activeColor = colorMode === 'zones' ? zoneColor : (HEX[color] ?? HEX.blue);

  // Zone segments for the needle style, as percentages of the whole arc.
  const lowPct = Math.min(Math.max(((low - minValue) / span) * 100, 0), 100);
  const highPct = Math.min(Math.max(((high - minValue) / span) * 100, lowPct), 100);
  const segments =
    colorMode === 'zones'
      ? [
          { from: 0, to: lowPct, color: LOW_COLOR },
          { from: lowPct, to: highPct, color: HEX.amber },
          { from: highPct, to: 100, color: HIGH_COLOR },
        ]
      : [{ from: 0, to: 100, color: activeColor }];

  const track = arcPath(geometry.start, geometry.sweep);
  const needleAngle = geometry.start + (percent / 100) * geometry.sweep;
  const [minX, minY] = pointAt(geometry.start, RADIUS);
  const [maxX, maxY] = pointAt(geometry.start + geometry.sweep, RADIUS);
  const labelOffset = shape === 'semi' ? 16 : 14;
  const valueY = shape === 'semi' ? 92 : 112;

  const display = `${prefix}${formatNumber(current, digits)}${suffix}`;

  return (
    <div className="w-full rounded-xl border border-border bg-background p-5">
      {title && <p className="mb-3 text-center text-sm font-semibold text-foreground">{title}</p>}

      <div style={{ maxWidth: MAX_WIDTH[size] ?? MAX_WIDTH.md, margin: '0 auto' }}>
        <svg
          viewBox={geometry.viewBox}
          role="meter"
          aria-label={title || 'Gauge'}
          aria-valuenow={current}
          aria-valuemin={minValue}
          aria-valuemax={maxValue}
          aria-valuetext={display}
          className="text-muted-foreground"
          style={{ display: 'block', width: '100%', height: 'auto' }}
        >
          {gaugeStyle === 'fill' ? (
            <>
              {/* Track */}
              <path
                d={track}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.18}
                strokeWidth={STROKE}
                strokeLinecap="round"
              />
              {/* Progress (pathLength=100 lets the dash length equal the percentage) */}
              {percent > 0 && (
                <path
                  d={track}
                  pathLength={100}
                  fill="none"
                  stroke={activeColor}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  strokeDasharray={`${percent} 100`}
                  style={{ transition: 'stroke-dasharray 500ms ease, stroke 300ms ease' }}
                />
              )}
            </>
          ) : (
            <>
              {/* Coloured zones */}
              {segments.map((segment) =>
                segment.to - segment.from > 0 ? (
                  <path
                    key={`${segment.from}-${segment.color}`}
                    d={track}
                    pathLength={100}
                    fill="none"
                    stroke={segment.color}
                    strokeWidth={STROKE}
                    strokeDasharray={`${segment.to - segment.from} 100`}
                    strokeDashoffset={-segment.from}
                    opacity={0.9}
                  />
                ) : null,
              )}
              {/* Needle */}
              <g
                style={{
                  transform: `rotate(${needleAngle}deg)`,
                  transformOrigin: `${CX}px ${CY}px`,
                  transition: 'transform 500ms ease',
                }}
              >
                <line
                  x1={CX}
                  y1={CY}
                  x2={CX + RADIUS - STROKE / 2 - 4}
                  y2={CY}
                  stroke="currentColor"
                  className="text-foreground"
                  strokeWidth={3}
                  strokeLinecap="round"
                />
              </g>
              <circle cx={CX} cy={CY} r={6} fill="currentColor" className="text-foreground" />
            </>
          )}

          {/* Min / max labels */}
          {showMinMax && (
            <>
              <text x={minX} y={minY + labelOffset} textAnchor="middle" fontSize={10} fill="currentColor">
                {formatNumber(minValue, 0)}
              </text>
              <text x={maxX} y={maxY + labelOffset} textAnchor="middle" fontSize={10} fill="currentColor">
                {formatNumber(maxValue, 0)}
              </text>
            </>
          )}

          {/* Value (hidden behind the needle hub in needle style, so it sits lower) */}
          {gaugeStyle === 'fill' && (
            <text
              x={CX}
              y={valueY}
              textAnchor="middle"
              fontSize={display.length > 7 ? 22 : 28}
              fontWeight={700}
              fill={activeColor}
            >
              {display}
            </text>
          )}
        </svg>
      </div>

      {gaugeStyle === 'needle' && (
        <p className="mt-1 text-center text-2xl font-bold" style={{ color: activeColor }}>
          {display}
        </p>
      )}
      {caption && <p className="mt-1 text-center text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const GaugePlugin: ViewBuilderPlugin<GaugeConfigs, GaugeSchema> = {
  id: 'gauge',
  pluginType: 'form',

  toolbar: {
    name: 'Gauge',
    element: <GaugeIcon className="h-5 w-5" />,
    toolTip: 'Add a gauge',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<GaugeConfigs, GaugeSchema> {...props}>
        {({ data, configs }) => <GaugeCanvas configs={configs} data={data} />}
      </BasePluginView>
    ),
  },

  settings: [
    { field_id: 'title', label: 'Title', type: 'text', defaultValue: 'Target Completion' },
    { field_id: 'value', label: 'Value', type: 'text', defaultValue: '72' },
    { field_id: 'min', label: 'Minimum', type: 'text', defaultValue: '0' },
    { field_id: 'max', label: 'Maximum', type: 'text', defaultValue: '100' },
    { field_id: 'prefix', label: 'Prefix (e.g. $)', type: 'text', defaultValue: '' },
    { field_id: 'suffix', label: 'Suffix (e.g. %)', type: 'text', defaultValue: '%' },
    { field_id: 'decimals', label: 'Decimal Places', type: 'text', defaultValue: '0' },
    { field_id: 'caption', label: 'Caption', type: 'text', defaultValue: 'of monthly target' },
    {
      field_id: 'shape',
      label: 'Shape',
      type: 'select',
      defaultValue: 'semi',
      enum: ['semi', 'arc'],
    },
    {
      field_id: 'gaugeStyle',
      label: 'Style',
      type: 'select',
      defaultValue: 'fill',
      enum: ['fill', 'needle'],
    },
    {
      field_id: 'colorMode',
      label: 'Colour Mode',
      type: 'select',
      defaultValue: 'zones',
      enum: ['zones', 'single'],
    },
    {
      field_id: 'color',
      label: 'Colour (single mode)',
      type: 'select',
      defaultValue: 'blue',
      enum: ['blue', 'green', 'amber', 'red', 'purple'],
    },
    { field_id: 'lowThreshold', label: 'Low Zone Ends At', type: 'text', defaultValue: '40' },
    { field_id: 'highThreshold', label: 'High Zone Starts At', type: 'text', defaultValue: '70' },
    {
      field_id: 'higherIsBetter',
      label: 'Higher Is Better (green at high end)',
      type: 'checkbox',
      defaultValue: true,
    },
    { field_id: 'showMinMax', label: 'Show Min / Max Labels', type: 'checkbox', defaultValue: true },
    {
      field_id: 'size',
      label: 'Size',
      type: 'select',
      defaultValue: 'md',
      enum: ['sm', 'md', 'lg'],
    },
    {
      field_id: 'aggregation',
      label: 'Calculate Value From Data',
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
    value: { type: 'string', label: 'Gauge Value' },
  },
};