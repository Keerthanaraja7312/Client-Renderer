import { PieChart as PieChartIcon } from 'lucide-react';
import { Cell, Label, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

type ChartType = 'donut' | 'pie';
type Thickness = 'thin' | 'medium' | 'thick';
type LegendPosition = 'right' | 'bottom' | 'none';
type Palette = 'default' | 'cool' | 'warm';
type SortOrder = 'none' | 'asc' | 'desc';
type ChartSize = 'sm' | 'md' | 'lg';
type GroupAggregation = 'none' | 'count' | 'sum' | 'average';
type PieChartConfigs = {
  title: string; data: string; xAxisData: string; yAxisData: string; chartType: ChartType; thickness: Thickness; legend: LegendPosition;
  showPercentLabels: boolean; showTotal: boolean; totalLabel: string; palette: Palette;
  sort: SortOrder; maxSlices: string; prefix: string; suffix: string; size: ChartSize;
  aggregation: GroupAggregation; groupField: string; valueField: string;
};
type PieChartSchema = { selectedSlice: string };
type Item = { label: string; value: number };

const PALETTES: Record<Palette, string[]> = {
  default: ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16'],
  cool: ['#3b82f6', '#06b6d4', '#14b8a6', '#6366f1', '#8b5cf6', '#0ea5e9', '#22c55e', '#64748b'],
  warm: ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#ec4899', '#e11d48', '#d97706', '#a16207'],
};
const INNER_RATIO: Record<Thickness, number> = { thin: 0.76, medium: 0.62, thick: 0.46 };
const MAX_WIDTH: Record<ChartSize, number> = { sm: 260, md: 360, lg: 460 };

function parseData(raw: string): Item[] {
  return (raw ?? '').split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const colon = part.lastIndexOf(':');
    if (colon === -1) return null;
    const label = part.slice(0, colon).trim();
    const value = Number(part.slice(colon + 1).replace(/\s/g, ''));
    return label && Number.isFinite(value) ? { label, value } : null;
  }).filter((item): item is Item => item !== null);
}

function groupRows(rows: Record<string, unknown>[], groupField: string, valueField: string, aggregation: Exclude<GroupAggregation, 'none'>): Item[] {
  const groups = new Map<string, number[]>();
  rows.forEach((row) => {
    const key = String(row[groupField] ?? 'Unknown');
    groups.set(key, [...(groups.get(key) ?? []), Number(row[valueField])]);
  });
  return Array.from(groups, ([label, numbers]) => {
    const valid = numbers.filter(Number.isFinite);
    const sum = valid.reduce((total, value) => total + value, 0);
    const value = aggregation === 'count' ? numbers.length : aggregation === 'sum' ? sum : valid.length ? sum / valid.length : 0;
    return { label, value };
  });
}

function parseSeparateData(xAxisData: string, yAxisData: string): Item[] {
  const labels = (xAxisData ?? '').split(',').map((label) => label.trim()).filter(Boolean);
  const values = (yAxisData ?? '').split(',').map((value) => value.trim());
  return labels.flatMap((label, index) => {
    const value = Number(values[index]);
    return Number.isFinite(value) ? [{ label, value }] : [];
  });
}

function PieChartCanvas({ configs, data }: { configs: PieChartConfigs; data: Record<string, unknown>[] | null }) {
  const { title = '', data: rawData = '', xAxisData = '', yAxisData = '', chartType = 'donut', thickness = 'medium', legend = 'right', showPercentLabels = true, showTotal = true, totalLabel = 'Total', palette = 'default', sort = 'desc', maxSlices = '0', prefix = '', suffix = '', size = 'md', aggregation = 'none', groupField = '', valueField = '' } = configs;
  const canGroup = data && data.length > 0 && aggregation !== 'none' && groupField !== '' && (aggregation === 'count' || valueField !== '');
  let items = (canGroup
    ? groupRows(data, groupField, valueField, aggregation as Exclude<GroupAggregation, 'none'>)
    : (xAxisData.trim() || yAxisData.trim())
      ? parseSeparateData(xAxisData, yAxisData)
      : parseData(rawData)).filter((item) => item.value > 0);
  const limit = Math.floor(Number(maxSlices)) || 0;
  if (sort === 'asc') items = [...items].sort((a, b) => a.value - b.value);
  if (sort === 'desc' || (limit > 0 && sort === 'none')) items = [...items].sort((a, b) => b.value - a.value);
  if (limit > 0 && items.length > limit) {
    const keep = new Set([...items].sort((a, b) => b.value - a.value).slice(0, limit - 1).map((item) => item.label));
    const rest = items.filter((item) => !keep.has(item.label));
    items = [...items.filter((item) => keep.has(item.label)), { label: 'Other', value: rest.reduce((sum, item) => sum + item.value, 0) }];
  }
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const colors = PALETTES[palette] ?? PALETTES.default;
  const formatValue = (value: number) => `${prefix}${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}${suffix}`;
  const height = size === 'sm' ? 220 : size === 'md' ? 300 : 380;
  const innerRadius = chartType === 'donut' ? `${INNER_RATIO[thickness] * 100}%` : 0;

  if (!items.length) return <div className="w-full rounded-xl border border-border bg-background p-5">{title && <p className="mb-2 text-sm font-semibold">{title}</p>}<p className="text-sm italic text-muted-foreground">Add data in Settings, e.g. Chrome:60, Safari:25, Firefox:15</p></div>;

  return (
    <div className="w-full rounded-xl border border-border bg-background p-4">
      {title && <p className="mb-4 text-sm font-semibold text-foreground">{title}</p>}
      <div className={legend === 'right' ? 'mx-auto grid items-center gap-2' : 'mx-auto'} style={{ maxWidth: MAX_WIDTH[size], gridTemplateColumns: legend === 'right' ? 'minmax(0, 1fr) 120px' : undefined }}>
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={items} dataKey="value" nameKey="label" innerRadius={innerRadius} outerRadius="82%" paddingAngle={1.2} label={showPercentLabels ? ({ percent }) => `${Math.round((percent ?? 0) * 100)}%` : false}>
                {items.map((item, index) => <Cell key={item.label} fill={item.label === 'Other' ? '#9ca3af' : colors[index % colors.length]} />)}
                {chartType === 'donut' && showTotal && <Label value={`${totalLabel}: ${formatValue(total)}`} position="center" fill="var(--foreground)" />}
              </Pie>
              <Tooltip formatter={(value) => formatValue(Number(value))} contentStyle={{ background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 8 }} />
              {legend !== 'none' && legend === 'bottom' && <Legend verticalAlign="bottom" />}
            </PieChart>
          </ResponsiveContainer>
        </div>
        {legend === 'right' && <Legend layout="vertical" verticalAlign="middle" align="right" />}
      </div>
    </div>
  );
}

export const PieChartPlugin: ViewBuilderPlugin<PieChartConfigs, PieChartSchema> = {
  id: 'pie-chart', pluginType: 'form',
  toolbar: { name: 'Pie Chart', element: <PieChartIcon className="h-5 w-5" />, toolTip: 'Add a pie or donut chart' },
  canvas: { element: (props) => <BasePluginView<PieChartConfigs, PieChartSchema> {...props}>{({ data, configs }) => <PieChartCanvas configs={configs} data={data} />}</BasePluginView> },
  settings: [
    { field_id: 'title', label: 'Chart Title', type: 'text', defaultValue: 'Browser Share' },
    { field_id: 'xAxisData', label: 'Slice labels (comma separated)', type: 'text', defaultValue: 'Chrome, Safari, Firefox' },
    { field_id: 'yAxisData', label: 'Slice values (comma separated)', type: 'text', defaultValue: '60, 25, 15' },
    { field_id: 'chartType', label: 'Chart Type', type: 'select', enum: ['donut', 'pie'], defaultValue: 'donut' },
    { field_id: 'thickness', label: 'Donut Thickness', type: 'select', enum: ['thin', 'medium', 'thick'], defaultValue: 'medium' },
    { field_id: 'legend', label: 'Legend Position', type: 'select', enum: ['right', 'bottom', 'none'], defaultValue: 'right' },
    { field_id: 'showPercentLabels', label: 'Show % On Slices', type: 'checkbox', defaultValue: true },
    { field_id: 'showTotal', label: 'Show Total In Donut Centre', type: 'checkbox', defaultValue: true },
    { field_id: 'totalLabel', label: 'Centre Label', type: 'text', defaultValue: 'Total' },
    { field_id: 'palette', label: 'Colour Palette', type: 'select', enum: ['default', 'cool', 'warm'], defaultValue: 'default' },
    { field_id: 'sort', label: 'Sort Slices', type: 'select', enum: ['none', 'asc', 'desc'], defaultValue: 'desc' },
    { field_id: 'maxSlices', label: 'Maximum Slices (0 = all)', type: 'text', defaultValue: '0' },
    { field_id: 'prefix', label: 'Value Prefix (e.g. $)', type: 'text', defaultValue: '' },
    { field_id: 'suffix', label: 'Value Suffix (e.g. %)', type: 'text', defaultValue: '' },
    { field_id: 'size', label: 'Chart Size', type: 'select', enum: ['sm', 'md', 'lg'], defaultValue: 'md' },
  ],
  componentDataSchema: { selectedSlice: '' },
};
