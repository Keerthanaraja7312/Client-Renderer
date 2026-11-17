import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { Menu, PanelTop, X } from 'lucide-react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type NavTheme = 'dark' | 'light' | 'primary';
type NavAlign = 'left' | 'center' | 'right';

// Each menu item has its own Label and URL setting: item1Label / item1Url ... item8Label / item8Url
const ITEM_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
type Slot = (typeof ITEM_SLOTS)[number];
type ItemFields = { [K in `item${Slot}Label` | `item${Slot}Url`]: string };

type TopNavConfigs = {
  brandText: string;
  logoUrl: string;
  activeItem: string;
  theme: NavTheme;
  alignment: NavAlign;
  sticky: boolean;
  collapseWidth: string; // below this width (px) the menu becomes a hamburger
  enableNavigation: boolean;
} & ItemFields;

type TopNavSchema = {
  activeItem: string;
};

type NavItem = { label: string; url: string };

// ─── Theme colours (inline so they never depend on the Tailwind build) ───────

const THEMES: Record<
  NavTheme,
  { background: string; text: string; muted: string; border: string; accent: string }
> = {
  dark: {
    background: '#000000',
    text: '#ffffff',
    muted: '#d1d5db',
    border: 'rgba(255,255,255,0.18)',
    accent: '#ffffff',
  },
  light: {
    background: '#ffffff',
    text: '#111827',
    muted: '#4b5563',
    border: '#e5e7eb',
    accent: '#2563eb',
  },
  primary: {
    background: '#2563eb',
    text: '#ffffff',
    muted: 'rgba(255,255,255,0.8)',
    border: 'rgba(255,255,255,0.3)',
    accent: '#ffffff',
  },
};

const JUSTIFY: Record<NavAlign, CSSProperties['justifyContent']> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
};

const DEFAULT_ITEMS: { label: string; url: string }[] = [
  { label: 'BD Editing', url: '/bd-editing' },
  { label: 'Prop Editing', url: '/prop-editing' },
  { label: 'Reports', url: '/reports' },
  { label: 'Board', url: '/board' },
  { label: 'Administration', url: '/administration' },
  { label: 'Logout', url: '/logout' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readItems(configs: TopNavConfigs): NavItem[] {
  const items: NavItem[] = [];
  for (const slot of ITEM_SLOTS) {
    const label = String(configs[`item${slot}Label`] ?? '').trim();
    const url = String(configs[`item${slot}Url`] ?? '').trim();
    if (label) items.push({ label, url });
  }
  return items;
}

function isSafeUrl(url: string) {
  return url !== '' && !/^\s*javascript:/i.test(url);
}

// True when the item's URL is the page we are currently on.
function isCurrentPage(url: string): boolean {
  if (!isSafeUrl(url)) return false;
  try {
    return new URL(url, window.location.origin).pathname === window.location.pathname;
  } catch {
    return false;
  }
}

// ─── Canvas Component ─────────────────────────────────────────────────────────

function TopNavCanvas({ configs }: { configs: TopNavConfigs }) {
  const {
    brandText = '',
    logoUrl = '',
    activeItem = '',
    theme = 'dark',
    alignment = 'right',
    sticky = false,
    collapseWidth = '720',
    enableNavigation = false,
  } = configs;

  const containerRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const list = readItems(configs);
  const pageItem = list.find((item) => isCurrentPage(item.url))?.label ?? '';
  const [active, setActive] = useState(activeItem || pageItem);

  // Follow the "Active Item" setting when it changes.
  useEffect(() => {
    setActive(activeItem || pageItem);
  }, [activeItem, pageItem]);

  // Collapse based on the nav's own width, not the browser window,
  // because the builder canvas can be narrower than the screen.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const colors = THEMES[theme] ?? THEMES.dark;
  const breakpoint = Number(collapseWidth) > 0 ? Number(collapseWidth) : 720;
  const collapsed = width !== null && width < breakpoint;

  const handleClick = (event: MouseEvent<HTMLAnchorElement>, item: NavItem) => {
    // Always stop the browser's own link handling. When navigation is switched
    // off, clicking in the builder never leaves the page being designed.
    event.preventDefault();
    setActive(item.label);
    setMenuOpen(false);
    if (!enableNavigation || !isSafeUrl(item.url)) return;
    window.location.assign(item.url); // opens exactly the page this item points to
  };

  return (
    <nav
      ref={containerRef}
      aria-label="Main navigation"
      style={{
        background: colors.background,
        color: colors.text,
        borderBottom: `1px solid ${colors.border}`,
        position: sticky ? 'sticky' : 'relative',
        top: 0,
        zIndex: 20,
        width: '100%',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 20px',
          minHeight: 60,
        }}
      >
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {logoUrl && (
            <img src={logoUrl} alt={brandText || 'Logo'} style={{ height: 30, width: 'auto' }} />
          )}
          {(brandText || !logoUrl) && (
            <span style={{ fontSize: 20, fontWeight: 700 }}>{brandText || 'Brand'}</span>
          )}
        </div>

        {/* Desktop items */}
        {!collapsed && (
          <ul
            style={{
              display: 'flex',
              flex: 1,
              flexWrap: 'wrap',
              alignItems: 'stretch',
              justifyContent: JUSTIFY[alignment] ?? 'flex-end',
              gap: 4,
              margin: 0,
              padding: 0,
              listStyle: 'none',
            }}
          >
            {list.map((item) => {
              const isActive = item.label === active;
              return (
                <li key={item.label} style={{ display: 'flex' }}>
                  <a
                    href={isSafeUrl(item.url) ? item.url : undefined}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={(e) => handleClick(e, item)}
                    className="hover:opacity-80"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '18px 14px 16px',
                      fontSize: 16,
                      textDecoration: 'none',
                      cursor: 'pointer',
                      color: isActive ? colors.text : colors.muted,
                      fontWeight: isActive ? 600 : 500,
                      borderBottom: `2px solid ${isActive ? colors.accent : 'transparent'}`,
                    }}
                  >
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>
        )}

        {/* Hamburger button */}
        {collapsed && (
          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            style={{
              marginLeft: 'auto',
              color: colors.text,
              background: 'transparent',
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: 8,
              display: 'flex',
              cursor: 'pointer',
            }}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        )}
      </div>

      {/* Mobile menu */}
      {collapsed && menuOpen && (
        <ul
          style={{
            margin: 0,
            padding: '4px 12px 12px',
            listStyle: 'none',
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          {list.map((item) => {
            const isActive = item.label === active;
            return (
              <li key={item.label}>
                <a
                  href={isSafeUrl(item.url) ? item.url : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={(e) => handleClick(e, item)}
                  style={{
                    display: 'block',
                    padding: '12px 8px',
                    fontSize: 16,
                    textDecoration: 'none',
                    cursor: 'pointer',
                    color: isActive ? colors.text : colors.muted,
                    fontWeight: isActive ? 600 : 500,
                    borderLeft: `3px solid ${isActive ? colors.accent : 'transparent'}`,
                  }}
                >
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {list.length === 0 && (
        <p style={{ padding: '0 20px 12px', fontSize: 12, fontStyle: 'italic', color: colors.muted }}>
          Add menu items in Settings (Menu Item 1 – Label and URL).
        </p>
      )}
    </nav>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────

type TopNavSettings = NonNullable<ViewBuilderPlugin<TopNavConfigs, TopNavSchema>['settings']>;

// Label + URL pair for every menu item slot.
const itemSettings = ITEM_SLOTS.flatMap((slot) => [
  {
    field_id: `item${slot}Label`,
    label: `Menu Item ${slot} – Label`,
    type: 'text',
    defaultValue: DEFAULT_ITEMS[slot - 1]?.label ?? '',
  },
  {
    field_id: `item${slot}Url`,
    label: `Menu Item ${slot} – Page URL`,
    type: 'text',
    defaultValue: DEFAULT_ITEMS[slot - 1]?.url ?? '',
  },
]);

const topNavSettings = [
  {
    field_id: 'brandText',
    label: 'Brand Name',
    type: 'text',
    defaultValue: 'Propeller',
  },
  {
    field_id: 'logoUrl',
    label: 'Logo Image URL (optional)',
    type: 'text',
    defaultValue: '',
  },
  ...itemSettings,
  {
    field_id: 'activeItem',
    label: 'Active Item (type the label)',
    type: 'text',
    defaultValue: 'Reports',
  },
  {
    field_id: 'enableNavigation',
    label: 'Enable Link Navigation',
    type: 'checkbox',
    defaultValue: false,
  },
  {
    field_id: 'theme',
    label: 'Theme',
    type: 'select',
    defaultValue: 'dark',
    enum: ['dark', 'light', 'primary'],
  },
  {
    field_id: 'alignment',
    label: 'Menu Alignment',
    type: 'select',
    defaultValue: 'right',
    enum: ['left', 'center', 'right'],
  },
  {
    field_id: 'sticky',
    label: 'Stick To Top',
    type: 'checkbox',
    defaultValue: false,
  },
  {
    field_id: 'collapseWidth',
    label: 'Collapse To Menu Below Width (px)',
    type: 'text',
    defaultValue: '720',
  },
] as TopNavSettings;

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const TopNavPlugin: ViewBuilderPlugin<TopNavConfigs, TopNavSchema> = {
  id: 'top-nav',
  pluginType: 'form',

  toolbar: {
    name: 'Top Nav',
    element: <PanelTop className="h-5 w-5" />,
    toolTip: 'Add a top navigation bar',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<TopNavConfigs, TopNavSchema> {...props}>
        {({ configs }) => <TopNavCanvas configs={configs} />}
      </BasePluginView>
    ),
  },

  settings: topNavSettings,

  componentDataSchema: {
    activeItem: '',
  },

  componentDataMetadata: {
    activeItem: { type: 'string', label: 'Active Menu Item' },
  },
};