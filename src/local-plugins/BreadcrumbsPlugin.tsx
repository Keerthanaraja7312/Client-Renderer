import { Fragment, useState } from 'react';
import type { MouseEvent } from 'react';
import { ChevronRight, Home, Navigation } from 'lucide-react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type BreadcrumbSeparator = 'chevron' | 'slash' | 'dot' | 'arrow';
type BreadcrumbSize = 'sm' | 'default' | 'lg';

type BreadcrumbsConfigs = {
  items: string; // "Home|/, Products|/products, Details"
  separator: BreadcrumbSeparator;
  size: BreadcrumbSize;
  showHomeIcon: boolean;
  maxVisibleItems: string; // "0" = show all
  enableNavigation: boolean;
  openInNewTab: boolean;
};

type BreadcrumbsSchema = {
  currentPage: string;
};

type Crumb = { label: string; url: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SIZE_CLASSES: Record<BreadcrumbSize, { text: string; icon: string }> = {
  sm: { text: 'text-xs', icon: 'h-3 w-3' },
  default: { text: 'text-sm', icon: 'h-4 w-4' },
  lg: { text: 'text-base', icon: 'h-5 w-5' },
};

// "Home|/, Products|/products, Details" → [{label, url}, ...]
function parseItems(raw: string): Crumb[] {
  return (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const pipe = part.indexOf('|');
      if (pipe === -1) return { label: part, url: '' };
      return { label: part.slice(0, pipe).trim(), url: part.slice(pipe + 1).trim() };
    })
    .filter((crumb) => crumb.label);
}

function isSafeUrl(url: string) {
  return url !== '' && !/^\s*javascript:/i.test(url);
}

function Separator({
  type,
  iconClass,
}: {
  type: BreadcrumbSeparator;
  iconClass: string;
}) {
  return (
    <span className="mx-2 flex items-center text-muted-foreground" aria-hidden="true">
      {type === 'chevron' && <ChevronRight className={iconClass} />}
      {type === 'slash' && '/'}
      {type === 'dot' && '•'}
      {type === 'arrow' && '→'}
    </span>
  );
}

// ─── Canvas Component ─────────────────────────────────────────────────────────

function BreadcrumbsCanvas({ configs }: { configs: BreadcrumbsConfigs }) {
  const {
    items = '',
    separator = 'chevron',
    size = 'default',
    showHomeIcon = false,
    maxVisibleItems = '0',
    enableNavigation = false,
    openInNewTab = false,
  } = configs;

  const [expanded, setExpanded] = useState(false);

  const crumbs = parseItems(items);
  const sizeClasses = SIZE_CLASSES[size] ?? SIZE_CLASSES.default;

  if (crumbs.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        Add breadcrumb items in Settings, e.g. Home|/, Products|/products, Details
      </p>
    );
  }

  // Long trails collapse to: first … last (max - 1) items.
  const max = Number(maxVisibleItems);
  const collapse = !expanded && max >= 2 && crumbs.length > max;
  const visible: Array<{ crumb: Crumb; index: number } | 'ellipsis'> = collapse
    ? [
        { crumb: crumbs[0], index: 0 },
        'ellipsis',
        ...crumbs
          .slice(-(max - 1))
          .map((crumb, i) => ({ crumb, index: crumbs.length - (max - 1) + i })),
      ]
    : crumbs.map((crumb, index) => ({ crumb, index }));

  const handleLinkClick = (event: MouseEvent<HTMLAnchorElement>, url: string) => {
    // Links stay inert unless navigation is enabled, so clicking in the
    // builder never navigates away from the page being designed.
    event.preventDefault();
    if (!enableNavigation || !isSafeUrl(url)) return;
    if (openInNewTab) window.open(url, '_blank', 'noopener,noreferrer');
    else window.location.assign(url);
  };

  return (
    <nav aria-label="Breadcrumb" className="w-full">
      <ol className={`flex flex-wrap items-center ${sizeClasses.text}`}>
        {visible.map((entry, position) => {
          const isLast = position === visible.length - 1;

          return (
            <Fragment key={entry === 'ellipsis' ? 'ellipsis' : `${entry.index}-${entry.crumb.label}`}>
              <li className="flex items-center">
                {entry === 'ellipsis' ? (
                  <button
                    type="button"
                    aria-label="Show all breadcrumb items"
                    onClick={() => setExpanded(true)}
                    className="rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    …
                  </button>
                ) : isLast ? (
                  <span
                    aria-current="page"
                    className="flex items-center gap-1.5 font-medium text-foreground"
                  >
                    {entry.index === 0 && showHomeIcon && (
                      <Home className={sizeClasses.icon} aria-hidden="true" />
                    )}
                    {entry.crumb.label}
                  </span>
                ) : (
                  <a
                    href={isSafeUrl(entry.crumb.url) ? entry.crumb.url : undefined}
                    onClick={(e) => handleLinkClick(e, entry.crumb.url)}
                    className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground hover:underline"
                  >
                    {entry.index === 0 && showHomeIcon && (
                      <Home className={sizeClasses.icon} aria-hidden="true" />
                    )}
                    {entry.crumb.label}
                  </a>
                )}
              </li>
              {!isLast && <Separator type={separator} iconClass={sizeClasses.icon} />}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const BreadcrumbsPlugin: ViewBuilderPlugin<
  BreadcrumbsConfigs,
  BreadcrumbsSchema
> = {
  id: 'breadcrumbs',
  pluginType: 'form',

  toolbar: {
    name: 'Breadcrumbs',
    element: <Navigation className="h-5 w-5" />,
    toolTip: 'Add breadcrumbs navigation',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<BreadcrumbsConfigs, BreadcrumbsSchema> {...props}>
        {({ configs }) => <BreadcrumbsCanvas configs={configs} />}
      </BasePluginView>
    ),
  },

  settings: [
    {
      field_id: 'items',
      label: 'Items (comma separated, Label|URL)',
      type: 'text',
      defaultValue: 'Home|/, Products|/products, Details',
    },
    {
      field_id: 'separator',
      label: 'Separator',
      type: 'select',
      defaultValue: 'chevron',
      enum: ['chevron', 'slash', 'dot', 'arrow'],
    },
    {
      field_id: 'size',
      label: 'Size',
      type: 'select',
      defaultValue: 'default',
      enum: ['sm', 'default', 'lg'],
    },
    {
      field_id: 'showHomeIcon',
      label: 'Show Home Icon On First Item',
      type: 'checkbox',
      defaultValue: true,
    },
    {
      field_id: 'maxVisibleItems',
      label: 'Max Visible Items (0 = show all)',
      type: 'text',
      defaultValue: '0',
    },
    {
      field_id: 'enableNavigation',
      label: 'Enable Link Navigation',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      field_id: 'openInNewTab',
      label: 'Open Links In New Tab',
      type: 'checkbox',
      defaultValue: false,
    },
  ],

  componentDataSchema: {
    currentPage: '',
  },

  componentDataMetadata: {
    currentPage: { type: 'string', label: 'Current Page' },
  },
};