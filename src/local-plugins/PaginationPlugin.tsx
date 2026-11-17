import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreHorizontal,
} from 'lucide-react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type PaginationSize = 'sm' | 'default' | 'lg';
type PaginationAlign = 'left' | 'center' | 'right';

type PaginationConfigs = {
  totalItems: string;
  pageSize: string;
  defaultPage: string;
  siblingCount: string;
  showFirstLast: boolean;
  showPageSizeSelector: boolean;
  showSummary: boolean;
  size: PaginationSize;
  alignment: PaginationAlign;
};

type PaginationSchema = {
  currentPage: string;
};

type PageEntry = number | 'dots-left' | 'dots-right';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SIZE_STYLES: Record<
  PaginationSize,
  { height: number; minWidth: number; text: string; icon: string }
> = {
  sm: { height: 32, minWidth: 32, text: 'text-xs', icon: 'h-3.5 w-3.5' },
  default: { height: 36, minWidth: 36, text: 'text-sm', icon: 'h-4 w-4' },
  lg: { height: 44, minWidth: 44, text: 'text-base', icon: 'h-5 w-5' },
};

const ALIGN_CLASSES: Record<PaginationAlign, string> = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
};

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];

function toPositiveInt(value: string, fallback: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

// Returns e.g. [1, 'dots-left', 4, 5, 6, 'dots-right', 20]
function getPageList(current: number, total: number, siblings: number): PageEntry[] {
  const maxNumbers = siblings * 2 + 5; // first + last + current + 2 dots + siblings
  if (total <= maxNumbers) return range(1, total);

  const left = Math.max(current - siblings, 1);
  const right = Math.min(current + siblings, total);
  const showLeftDots = left > 2;
  const showRightDots = right < total - 1;
  const edgeCount = 3 + siblings * 2;

  if (!showLeftDots && showRightDots) {
    return [...range(1, edgeCount), 'dots-right', total];
  }
  if (showLeftDots && !showRightDots) {
    return [1, 'dots-left', ...range(total - edgeCount + 1, total)];
  }
  return [1, 'dots-left', ...range(left, right), 'dots-right', total];
}

// ─── Page button ──────────────────────────────────────────────────────────────

function PageButton({
  size,
  active = false,
  disabled = false,
  label,
  onClick,
  children,
}: {
  size: PaginationSize;
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const s = SIZE_STYLES[size];
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
      style={{ height: s.height, minWidth: s.minWidth }}
      className={`inline-flex items-center justify-center rounded-md px-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${s.text} ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'border border-border text-foreground hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Canvas Component ─────────────────────────────────────────────────────────

function PaginationCanvas({
  configs,
  data,
}: {
  configs: PaginationConfigs;
  data: unknown[] | null;
}) {
  const {
    totalItems = '95',
    pageSize = '10',
    defaultPage = '1',
    siblingCount = '1',
    showFirstLast = true,
    showPageSizeSelector = false,
    showSummary = true,
    size = 'default',
    alignment = 'left',
  } = configs;

  // Real data wins: when the builder passes rows, the total is their count.
  // The "Total Items" setting is only the fallback when nothing is connected.
  const staticTotal = Math.max(0, Math.floor(Number(totalItems)) || 0);
  const total = data && data.length > 0 ? data.length : staticTotal;
  const cfgPageSize = toPositiveInt(pageSize, 10);
  const cfgDefaultPage = toPositiveInt(defaultPage, 1);
  const siblings = Math.min(toPositiveInt(siblingCount, 1), 3);

  const [page, setPage] = useState(cfgDefaultPage);
  const [perPage, setPerPage] = useState(cfgPageSize);

  // Follow the Settings panel when these values change.
  useEffect(() => setPage(cfgDefaultPage), [cfgDefaultPage]);
  useEffect(() => setPerPage(cfgPageSize), [cfgPageSize]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(page, 1), totalPages); // always a valid page
  const from = total === 0 ? 0 : (current - 1) * perPage + 1;
  const to = Math.min(current * perPage, total);

  const s = SIZE_STYLES[size] ?? SIZE_STYLES.default;
  const pages = getPageList(current, totalPages, siblings);
  const sizeOptions = Array.from(new Set([...PAGE_SIZE_OPTIONS, cfgPageSize])).sort(
    (a, b) => a - b,
  );

  const goTo = (target: number) => setPage(Math.min(Math.max(target, 1), totalPages));

  return (
    <div
      className={`flex w-full flex-wrap items-center gap-x-6 gap-y-3 ${
        ALIGN_CLASSES[alignment] ?? ALIGN_CLASSES.left
      }`}
    >
      {showSummary && (
        <p className={`${s.text} text-muted-foreground`}>
          {total === 0 ? 'No items' : `Showing ${from}–${to} of ${total}`}
        </p>
      )}

      <nav aria-label="Pagination">
        <ul className="flex flex-wrap items-center gap-1">
          {showFirstLast && (
            <li>
              <PageButton
                size={size}
                label="First page"
                disabled={current === 1}
                onClick={() => goTo(1)}
              >
                <ChevronsLeft className={s.icon} aria-hidden="true" />
              </PageButton>
            </li>
          )}

          <li>
            <PageButton
              size={size}
              label="Previous page"
              disabled={current === 1}
              onClick={() => goTo(current - 1)}
            >
              <ChevronLeft className={s.icon} aria-hidden="true" />
            </PageButton>
          </li>

          {pages.map((entry) =>
            typeof entry === 'number' ? (
              <li key={entry}>
                <PageButton
                  size={size}
                  label={`Page ${entry}`}
                  active={entry === current}
                  onClick={() => goTo(entry)}
                >
                  {entry}
                </PageButton>
              </li>
            ) : (
              <li
                key={entry}
                aria-hidden="true"
                style={{ minWidth: s.minWidth, height: s.height }}
                className="inline-flex items-center justify-center text-muted-foreground"
              >
                <MoreHorizontal className={s.icon} />
              </li>
            ),
          )}

          <li>
            <PageButton
              size={size}
              label="Next page"
              disabled={current === totalPages}
              onClick={() => goTo(current + 1)}
            >
              <ChevronRight className={s.icon} aria-hidden="true" />
            </PageButton>
          </li>

          {showFirstLast && (
            <li>
              <PageButton
                size={size}
                label="Last page"
                disabled={current === totalPages}
                onClick={() => goTo(totalPages)}
              >
                <ChevronsRight className={s.icon} aria-hidden="true" />
              </PageButton>
            </li>
          )}
        </ul>
      </nav>

      {showPageSizeSelector && (
        <label className={`flex items-center gap-2 ${s.text} text-muted-foreground`}>
          Rows per page
          <select
            value={perPage}
            onChange={(e) => {
              setPerPage(Number(e.target.value));
              setPage(1);
            }}
            style={{ height: s.height }}
            className="rounded-md border border-border bg-background px-2 text-foreground"
          >
            {sizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const PaginationPlugin: ViewBuilderPlugin<PaginationConfigs, PaginationSchema> = {
  id: 'pagination',
  pluginType: 'form',

  toolbar: {
    name: 'Pagination',
    element: <MoreHorizontal className="h-5 w-5" />,
    toolTip: 'Add pagination',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<PaginationConfigs, PaginationSchema> {...props}>
        {({ data, configs }) => <PaginationCanvas configs={configs} data={data} />}
      </BasePluginView>
    ),
  },

  settings: [
    {
      field_id: 'totalItems',
      label: 'Total Items (used when no data is connected)',
      type: 'text',
      defaultValue: '95',
    },
    {
      field_id: 'pageSize',
      label: 'Items Per Page',
      type: 'text',
      defaultValue: '10',
    },
    {
      field_id: 'defaultPage',
      label: 'Default Page',
      type: 'text',
      defaultValue: '1',
    },
    {
      field_id: 'siblingCount',
      label: 'Pages Shown Beside Current (1-3)',
      type: 'text',
      defaultValue: '1',
    },
    {
      field_id: 'showFirstLast',
      label: 'Show First / Last Buttons',
      type: 'checkbox',
      defaultValue: true,
    },
    {
      field_id: 'showSummary',
      label: 'Show Summary (Showing 1–10 of 95)',
      type: 'checkbox',
      defaultValue: true,
    },
    {
      field_id: 'showPageSizeSelector',
      label: 'Show Rows Per Page Selector',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      field_id: 'size',
      label: 'Size',
      type: 'select',
      defaultValue: 'default',
      enum: ['sm', 'default', 'lg'],
    },
    {
      field_id: 'alignment',
      label: 'Alignment',
      type: 'select',
      defaultValue: 'left',
      enum: ['left', 'center', 'right'],
    },
  ],

  componentDataSchema: {
    currentPage: '1',
  },

  componentDataMetadata: {
    currentPage: { type: 'string', label: 'Current Page' },
  },
};