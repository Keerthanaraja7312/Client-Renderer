import { BarChart3 } from 'lucide-react';
import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

type Orientation = 'vertical' | 'horizontal';
type BarColor = 'blue' | 'green' | 'amber' | 'red' | 'purple';
type SortOrder = 'none' | 'asc' | 'desc';
type BarChartConfigs = {
  title: string;
  data: string;
  xAxisData: string;
  yAxisData: string;
  orientation: Orientation;
  color: BarColor;
  multiColor: boolean;
  showValueLabels: boolean;
  showGrid: boolean;
  sort: SortOrder;
  prefix: string;
  suffix: string;
  height: string;
};

type BarChartSchema = { selectedBar: string };
type BarItem = { label: string; value: number };

const COLORS: Record<BarColor, string> = {
  blue: '#3b82f6',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  purple: '#a855f7',
};
const MULTI_PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899'];

function parseData(raw: string): BarItem[] {
  return (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const colon = part.lastIndexOf(':');
      if (colon === -1) return null;
      const label = part.slice(0, colon).trim();
      const value = Number(part.slice(colon + 1).replace(/\s/g, ''));
      return label && Number.isFinite(value) ? { label, value } : null;
    })
    .filter((item): item is BarItem => item !== null);
}

function parseSeparateData(xAxisData: string, yAxisData: string): BarItem[] {
  const labels = (xAxisData ?? '').split(',').map((label) => label.trim()).filter(Boolean);
  const values = (yAxisData ?? '').split(',').map((value) => value.trim()).filter(Boolean);

  return labels.flatMap((label, index) => {
    const value = Number(values[index]);
    return Number.isFinite(value) ? [{ label, value }] : [];
  });
}

function BarChartCanvas({ configs, data }: { configs: BarChartConfigs; data: Record<string, unknown>[] | null }) {
  const {
    title = '',
    data: rawData = '',
    xAxisData = '',
    yAxisData = '',
    orientation = 'vertical',
    color = 'blue',
    multiColor = false,
    showValueLabels = true,
    showGrid = true,
    sort = 'none',
    prefix = '',
    suffix = '',
    height = '300',
  } = configs;

  let items = (xAxisData.trim() || yAxisData.trim())
    ? parseSeparateData(xAxisData, yAxisData)
    : parseData(rawData);
  items = items.map((item) => ({ ...item, value: Math.max(item.value, 0) }));
  if (sort === 'asc') items = [...items].sort((a, b) => a.value - b.value);
  if (sort === 'desc') items = [...items].sort((a, b) => b.value - a.value);

  const chartHeight = Math.min(Math.max(Number(height) || 300, 160), 700);
  const horizontal = orientation === 'horizontal';
  const formatted = (value: number) => `${prefix}${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}${suffix}`;

  if (!items.length) {
    return (
      <div className="w-full rounded-xl border border-border bg-background p-5">
        {title && <p className="mb-2 text-sm font-semibold text-foreground">{title}</p>}
        <p className="text-sm italic text-muted-foreground">Enter X-axis labels and Y-axis values in Settings.</p>
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl border border-border bg-background p-4">
      {title && <p className="mb-4 text-sm font-semibold text-foreground">{title}</p>}
      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <RechartsBarChart data={items} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            {showGrid && <CartesianGrid stroke="var(--border)" strokeOpacity={0.7} horizontal={!horizontal} vertical={horizontal} />}
            {horizontal ? (
              <>
                <XAxis type="number" tickFormatter={(value) => formatted(Number(value))} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
                <YAxis type="category" dataKey="label" width={90} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
              </>
            ) : (
              <>
                <XAxis dataKey="label" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} tickLine={false} />
                <YAxis tickFormatter={(value) => formatted(Number(value))} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
              </>
            )}
            <Tooltip
              cursor={{ fill: 'transparent' }}
              formatter={(value) => formatted(Number(value))}
              contentStyle={{
                background: 'transparent',
                border: 'none',
                boxShadow: 'none',
                padding: 0,
              }}
              itemStyle={{ color: 'var(--foreground)' }}
              labelStyle={{ color: 'var(--muted-foreground)' }}
            />
            <Bar dataKey="value" fill={COLORS[color] ?? COLORS.blue} radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]} maxBarSize={56}>
              {multiColor && items.map((_, index) => <Cell key={index} fill={MULTI_PALETTE[index % MULTI_PALETTE.length]} />)}
              {showValueLabels && <LabelList dataKey="value" position={horizontal ? 'right' : 'top'} formatter={(value) => formatted(Number(value))} style={{ fill: 'var(--foreground)', fontSize: 11 }} />}
            </Bar>
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export const BarChartPlugin: ViewBuilderPlugin<BarChartConfigs, BarChartSchema> = {
  id: 'bar-chart',
  pluginType: 'form',
  toolbar: { name: 'Bar Chart', element: <BarChart3 className="h-5 w-5" />, toolTip: 'Add a bar chart' },
  canvas: {
    element: (props) => (
      <BasePluginView<BarChartConfigs, BarChartSchema> {...props}>
        {({ data, configs }) => <BarChartCanvas configs={configs} data={data} />}
      </BasePluginView>
    ),
  },
  settings: [
    { field_id: 'title', label: 'Chart Title', type: 'text', defaultValue: 'Monthly Sales' },
    { field_id: 'xAxisData', label: 'X-axis labels (comma separated)', type: 'text', defaultValue: 'Jan, Feb, Mar, Apr, May, Jun' },
    { field_id: 'yAxisData', label: 'Y-axis values (comma separated)', type: 'text', defaultValue: '120, 180, 150, 220, 190, 260' },
    { field_id: 'orientation', label: 'Orientation', type: 'select', enum: ['vertical', 'horizontal'], defaultValue: 'vertical' },
    { field_id: 'color', label: 'Bar Colour', type: 'select', enum: ['blue', 'green', 'amber', 'red', 'purple'], defaultValue: 'blue' },
    { field_id: 'multiColor', label: 'Different Colour Per Bar', type: 'checkbox', defaultValue: false },
    { field_id: 'showValueLabels', label: 'Show Value Labels', type: 'checkbox', defaultValue: true },
    { field_id: 'showGrid', label: 'Show Grid Lines', type: 'checkbox', defaultValue: true },
    { field_id: 'sort', label: 'Sort Bars', type: 'select', enum: ['none', 'asc', 'desc'], defaultValue: 'none' },
    { field_id: 'prefix', label: 'Value Prefix (e.g. $)', type: 'text', defaultValue: '' },
    { field_id: 'suffix', label: 'Value Suffix (e.g. %)', type: 'text', defaultValue: '' },
    { field_id: 'height', label: 'Chart Height (px)', type: 'text', defaultValue: '300' },
  ],
  componentDataSchema: { selectedBar: '' },
};
