import { AreaChart as AreaChartIcon } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

type AreaColor = 'blue' | 'green' | 'amber' | 'red' | 'purple';
type FillStrength = 'light' | 'medium' | 'strong';
type GroupAggregation = 'none' | 'count' | 'sum' | 'average';
type AreaChartConfigs = {
  title: string; data: string; xAxisData: string; yAxisData: string; seriesNames: string; color: AreaColor; stacked: boolean;
  smooth: boolean; fillStrength: FillStrength; showPoints: boolean; showGrid: boolean;
  showLegend: boolean; prefix: string; suffix: string; height: string;
  aggregation: GroupAggregation; groupField: string; valueField: string; sortLabels: boolean;
};
type AreaChartSchema = { selectedPoint: string };
type AreaPoint = { label: string; values: (number | null)[] };

const COLOR_ORDER: AreaColor[] = ['blue', 'green', 'amber', 'red', 'purple'];
const HEX: Record<AreaColor, string> = { blue: '#3b82f6', green: '#22c55e', amber: '#f59e0b', red: '#ef4444', purple: '#a855f7' };
const EXTRA_COLORS = ['#06b6d4', '#ec4899', '#84cc16'];
const FILL_OPACITY: Record<FillStrength, number> = { light: 0.15, medium: 0.3, strong: 0.5 };
const MAX_SERIES = 3;

function parseData(raw: string): AreaPoint[] {
  return (raw ?? '').split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const colon = part.lastIndexOf(':');
    if (colon === -1) return null;
    const label = part.slice(0, colon).trim();
    const values = part.slice(colon + 1).split('|').slice(0, MAX_SERIES).map((value) => {
      const number = Number(value.trim());
      return value.trim() !== '' && Number.isFinite(number) ? number : null;
    });
    return label && values.length ? { label, values } : null;
  }).filter((point): point is AreaPoint => point !== null);
}

function groupRows(rows: Record<string, unknown>[], groupField: string, valueField: string, aggregation: Exclude<GroupAggregation, 'none'>): AreaPoint[] {
  const groups = new Map<string, number[]>();
  rows.forEach((row) => {
    const key = String(row[groupField] ?? 'Unknown');
    groups.set(key, [...(groups.get(key) ?? []), Number(row[valueField])]);
  });
  return Array.from(groups, ([label, numbers]) => {
    const valid = numbers.filter(Number.isFinite);
    const sum = valid.reduce((total, value) => total + value, 0);
    const value = aggregation === 'count' ? numbers.length : aggregation === 'sum' ? sum : valid.length ? sum / valid.length : 0;
    return { label, values: [value] };
  });
}

function parseSeparateData(xAxisData: string, yAxisData: string): AreaPoint[] {
  const labels = (xAxisData ?? '').split(',').map((label) => label.trim()).filter(Boolean);
  const values = (yAxisData ?? '').split(',').map((value) => value.trim());
  return labels.flatMap((label, index) => {
    const value = Number(values[index]);
    return Number.isFinite(value) ? [{ label, values: [value] }] : [];
  });
}

function AreaChartCanvas({ configs, data }: { configs: AreaChartConfigs; data: Record<string, unknown>[] | null }) {
  const { title = '', data: rawData = '', xAxisData = '', yAxisData = '', seriesNames = '', color = 'blue', stacked = false, smooth = true, fillStrength = 'medium', showPoints = false, showGrid = true, showLegend = true, prefix = '', suffix = '', height = '300', aggregation = 'none', groupField = '', valueField = '', sortLabels = false } = configs;
  const canGroup = data && data.length > 0 && aggregation !== 'none' && groupField !== '' && (aggregation === 'count' || valueField !== '');
  let points = canGroup
    ? groupRows(data, groupField, valueField, aggregation as Exclude<GroupAggregation, 'none'>)
    : (xAxisData.trim() || yAxisData.trim())
      ? parseSeparateData(xAxisData, yAxisData)
      : parseData(rawData);
  if (sortLabels) points = [...points].sort((a, b) => a.label.localeCompare(b.label));
  const seriesCount = Math.min(Math.max(...points.map((point) => point.values.length), 0), MAX_SERIES);
  const names = seriesNames.split(',').map((name) => name.trim());
  const chartData = points.map((point) => {
    const item: Record<string, string | number | null> = { label: point.label };
    for (let index = 0; index < seriesCount; index++) item[`series${index}`] = point.values[index] ?? null;
    return item;
  });
  const chartHeight = Math.min(Math.max(Number(height) || 300, 160), 700);
  const formatValue = (value: number) => `${prefix}${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}${suffix}`;
  const firstColorIndex = COLOR_ORDER.indexOf(color);
  const colors = Array.from({ length: seriesCount }, (_, index) => index === 0 ? HEX[color] ?? HEX.blue : EXTRA_COLORS[(firstColorIndex + index - 1) % EXTRA_COLORS.length]);

  if (!points.length) return <div className="w-full rounded-xl border border-border bg-background p-5">{title && <p className="mb-2 text-sm font-semibold">{title}</p>}<p className="text-sm italic text-muted-foreground">Add data in Settings, e.g. Jan:120, Feb:180, or Jan:120|90</p></div>;

  return (
    <div className="w-full rounded-xl border border-border bg-background p-4">
      {title && <p className="mb-4 text-sm font-semibold text-foreground">{title}</p>}
      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            {showGrid && <CartesianGrid stroke="var(--border)" strokeOpacity={0.7} />}
            <XAxis dataKey="label" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} tickLine={false} />
            <YAxis tickFormatter={(value) => formatValue(Number(value))} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
            <Tooltip formatter={(value) => formatValue(Number(value))} contentStyle={{ background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 8 }} />
            {showLegend && <Legend />}
            {Array.from({ length: seriesCount }, (_, index) => (
              <Area key={index} type={smooth ? 'monotone' : 'linear'} dataKey={`series${index}`} name={names[index] || `Series ${index + 1}`} stroke={colors[index]} fill={colors[index]} fillOpacity={FILL_OPACITY[fillStrength]} stackId={stacked ? 'stack' : undefined} strokeWidth={2} dot={showPoints ? { r: 3 } : false} connectNulls />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export const AreaChartPlugin: ViewBuilderPlugin<AreaChartConfigs, AreaChartSchema> = {
  id: 'area-chart', pluginType: 'form',
  toolbar: { name: 'Area Chart', element: <AreaChartIcon className="h-5 w-5" />, toolTip: 'Add an area chart' },
  canvas: { element: (props) => <BasePluginView<AreaChartConfigs, AreaChartSchema> {...props}>{({ data, configs }) => <AreaChartCanvas configs={configs} data={data} />}</BasePluginView> },
  settings: [
    { field_id: 'title', label: 'Chart Title', type: 'text', defaultValue: 'Traffic by Source' },
    { field_id: 'xAxisData', label: 'X-axis labels (comma separated)', type: 'text', defaultValue: 'Jan, Feb, Mar, Apr, May, Jun' },
    { field_id: 'yAxisData', label: 'Y-axis values (comma separated)', type: 'text', defaultValue: '120, 180, 150, 220, 190, 260' },
    { field_id: 'seriesNames', label: 'Series Names (comma separated)', type: 'text', defaultValue: 'Direct, Organic' },
    { field_id: 'color', label: 'Primary Colour', type: 'select', enum: ['blue', 'green', 'amber', 'red', 'purple'], defaultValue: 'blue' },
    { field_id: 'stacked', label: 'Stack Areas', type: 'checkbox', defaultValue: false },
    { field_id: 'smooth', label: 'Smooth Curves', type: 'checkbox', defaultValue: true },
    { field_id: 'fillStrength', label: 'Fill Strength', type: 'select', enum: ['light', 'medium', 'strong'], defaultValue: 'medium' },
    { field_id: 'showPoints', label: 'Show Points', type: 'checkbox', defaultValue: false },
    { field_id: 'showGrid', label: 'Show Grid Lines', type: 'checkbox', defaultValue: true },
    { field_id: 'showLegend', label: 'Show Legend', type: 'checkbox', defaultValue: true },
    { field_id: 'prefix', label: 'Value Prefix (e.g. $)', type: 'text', defaultValue: '' },
    { field_id: 'suffix', label: 'Value Suffix (e.g. %)', type: 'text', defaultValue: '' },
    { field_id: 'height', label: 'Chart Height (px)', type: 'text', defaultValue: '300' },
    { field_id: 'sortLabels', label: 'Sort X Axis Labels A-Z', type: 'checkbox', defaultValue: false },
  ],
  componentDataSchema: { selectedPoint: '' },
};
