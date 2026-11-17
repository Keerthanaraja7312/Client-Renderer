import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanelLeft, Home, Users, Settings, BarChart3, FileText, Calendar, Inbox, Folder,
  Mail, Bell, Search, ShoppingCart, Package, CreditCard, Info, LayoutGrid,
  ChevronUp, ChevronDown, Trash2, Plus, Link2,
  type LucideIcon,
} from 'lucide-react';
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu,
  SidebarMenuItem, SidebarMenuButton, SidebarMenuSub,
  SidebarMenuSubItem, SidebarMenuSubButton, SidebarInset, SidebarTrigger,
  SidebarRail, useSidebar,
} from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useHub } from '@/store/StateHubContext';
import { useComponentState } from '@/sky-view-builder/hooks/useComponentState';
import type { ViewBuilderPlugin } from '@/sky-view-builder/core/plugin';
import {
  listPages, listSavedPages, isTemplateLink, findLinkedPage, firstLinkedPage, navPagePath, type PageOption,
} from '@/sky-view-builder/core/navigation';
import { useTemplates } from '@/sky-view-builder/core/templateStore';

// ─── Sidebar Plugin ──────────────────────────────────────────────────────────
// Uses the real shadcn <Sidebar> (collapse to icons / offcanvas, rail, trigger,
// tooltips, sub-menus, floating/inset variants, Ctrl/Cmd+B).
//
// CONTAINMENT: shadcn's Sidebar is `position: fixed; h-svh` (pinned to the
// browser window). Any ancestor with a CSS `transform` becomes the containing
// block for fixed descendants, so the wrapper below uses `translateZ(0)` and the
// sidebar is overridden to `h-full`. Result: the real sidebar, but living
// inside its canvas box and resizable like any other component.
//
// MENU: configured visually in Settings via <SidebarMenuEditor/> (groups →
// items → sub-items, with icon and label) and stored in configs.groups.
//
// STATE: clicking an item writes its label to global.shared.{hubKey}, stores it
// in global.components.{id}.selectedValue and emits `{hubKey}Changed`.
//
// PAGE LINKS: every item / sub-item can be linked to a Page (Settings → Menus →
// "Opens page"). Clicking it writes the page id to global.shared.{hubKey}Page;
// in Live Preview the Canvas shows only that page (see core/navigation.ts).

// ─── Types / data ────────────────────────────────────────────────────────────

const ICONS: Record<string, LucideIcon> = {
  home: Home, users: Users, settings: Settings, chart: BarChart3, file: FileText,
  calendar: Calendar, inbox: Inbox, folder: Folder, mail: Mail, bell: Bell,
  search: Search, cart: ShoppingCart, package: Package, billing: CreditCard,
  info: Info, grid: LayoutGrid,
};
const ICON_KEYS = Object.keys(ICONS);

type NavSubItem = { id: string; label: string; pageId?: string };
type NavItem = { id: string; label: string; icon: string; pageId?: string; children?: NavSubItem[] };
type NavGroup = { id: string; label: string; items: NavItem[] };

type SidebarConfigs = {
  title?: string;
  groups?: NavGroup[];
  activeItem?: string;          // id of the active item / sub-item
  collapsible?: 'icon' | 'offcanvas' | 'none';
  side?: 'left' | 'right';
  variant?: 'sidebar' | 'floating' | 'inset';
  defaultOpen?: boolean;
  footerText?: string;
  showContentArea?: boolean;
  hubKey?: string;
  /** Box size when placed on a Page; width is synced to the sidebar's collapsed/expanded state. */
  width?: number;
  expandedWidth?: number;
  _pageId?: string;
  _blockId?: string;
};

// No predefined menus: the sidebar starts empty and the user adds items.
const DEFAULT_GROUPS: NavGroup[] = [];
const DEFAULT_HEADING = 'Sidebar Heading';

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

/** Appends a new menu item to the last group, creating an (unlabelled) group if none exists. */
function withNewItem(groups: NavGroup[]): NavGroup[] {
  const item: NavItem = { id: uid('i'), label: 'New menu', icon: 'file' };
  if (!groups.length) return [{ id: uid('g'), label: '', items: [item] }];
  return groups.map((g, i) => (i === groups.length - 1 ? { ...g, items: [...g.items, item] } : g));
}

function findLabel(groups: NavGroup[], id?: string): string | undefined {
  for (const g of groups) for (const it of g.items) {
    if (it.id === id) return it.label;
    const c = it.children?.find((s) => s.id === id);
    if (c) return c.label;
  }
}

// ─── Header row: ONE toggle icon (left) + editable heading ───────────────────
// The icon collapses / expands the sidebar. In design mode the heading is an
// inline text field, so it can be renamed right on the canvas (it is also a
// setting: "Sidebar Heading"). In preview it renders as plain text.

function SidebarBrand({ title, collapsible, editable, onTitleChange }: {
  title: string;
  collapsible: string;
  editable: boolean;
  onTitleChange: (v: string) => void;
}) {
  const { toggleSidebar } = useSidebar();
  const canToggle = collapsible !== 'none';
  const iconCls =
    'flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground';
  return (
    <div className="flex items-center gap-2 p-1">
      {canToggle ? (
        <button
          type="button"
          title="Collapse / expand"
          onClick={toggleSidebar}
          className={`${iconCls} transition-opacity hover:opacity-90`}
        >
          <PanelLeft className="size-4" />
        </button>
      ) : (
        <div className={iconCls}><PanelLeft className="size-4" /></div>
      )}
      <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
        {editable ? (
          <input
            value={title}
            placeholder="Sidebar heading"
            onChange={(e) => onTitleChange(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded bg-transparent px-1 py-0.5 text-sm font-semibold outline-none placeholder:text-sidebar-foreground/40 focus:bg-sidebar-accent"
          />
        ) : (
          <span className="block truncate text-sm font-semibold">{title}</span>
        )}
      </div>
    </div>
  );
}

// ─── Keeps the outer box the same width as the sidebar ───────────────────────
// In "icon" mode the sidebar shrinks to 3rem when collapsed. When the plugin sits
// on a Page (configs.width is set), shrink/restore the box with it so the box
// border always lines up with the sidebar's own border. It skips the first render
// so it never fights the initial state.

function WidthSync({ configs, updateConfigs, collapsible }: {
  configs: SidebarConfigs;
  updateConfigs?: (c: Partial<SidebarConfigs>) => void;
  collapsible: string;
}) {
  const { state } = useSidebar();
  const prev = useRef(state);
  useEffect(() => {
    if (prev.current === state) return;
    prev.current = state;
    if (collapsible !== 'icon' || typeof configs.width !== 'number') return;
    if (state === 'collapsed') updateConfigs?.({ expandedWidth: configs.width, width: 56 });
    else updateConfigs?.({ width: configs.expandedWidth ?? 280 });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

function SidebarCanvas({ id, configs, updateConfigs, isPreview }: {
  id: string;
  configs: SidebarConfigs;
  updateConfigs?: (c: Partial<SidebarConfigs>) => void;
  isPreview?: boolean;
}) {
  const hub = useHub();
  const groups = useMemo(
    () => (Array.isArray(configs.groups) ? configs.groups : DEFAULT_GROUPS),
    [configs.groups]
  );
  const collapsible = configs.collapsible ?? 'icon';
  const hubKey = configs.hubKey || 'activeNav';
  const publishEvent = `${hubKey}Changed`;
  const activeLabel = findLabel(groups, configs.activeItem);

  // Double-click a menu in design mode to rename it in place.
  const [editingId, setEditingId] = useState<string | null>(null);
  const renameItem = (itemId: string, label: string) =>
    updateConfigs?.({
      groups: groups.map((g) => ({
        ...g,
        items: g.items.map((it) => ({
          ...it,
          label: it.id === itemId ? label : it.label,
          children: it.children?.map((c) => (c.id === itemId ? { ...c, label } : c)),
        })),
      })),
    });
  const renameInput = (itemId: string, label: string) => (
    <input
      autoFocus
      value={label}
      onChange={(e) => renameItem(itemId, e.target.value)}
      onBlur={() => setEditingId(null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') setEditingId(null);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      className="min-w-0 flex-1 rounded bg-transparent text-sm outline-none"
    />
  );

  const { setState } = useComponentState({
    componentId: id,
    stateKeys: { selectedValue: activeLabel ?? null },
    publishes: [publishEvent],
    pageId: configs._pageId,
    blockInstanceId: configs._blockId,
  });

  useEffect(() => {
    const path = `global.shared.${hubKey}`;
    if (!hub.getNode(path)) {
      hub.registerGlobalState({ scope: 'global', values: { [hubKey]: activeLabel ?? null } });
    }
    // Active-page node used by the Canvas to switch pages in preview.
    const pagePath = navPagePath(hubKey);
    if (!hub.getNode(pagePath)) {
      const initial = findLinkedPage(groups, configs.activeItem) ?? firstLinkedPage(groups) ?? null;
      hub.registerGlobalState({ scope: 'global', values: { [`${hubKey}Page`]: initial } });
    }
  }, [hub, hubKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (itemId: string, label: string, pageId?: string) => {
    updateConfigs?.({ activeItem: itemId });
    setState('selectedValue', label);
    hub.set(`global.shared.${hubKey}`, label);
    hub.emit(publishEvent, label, `global.shared.${hubKey}`);
    // Navigate: items without a link keep whatever page is currently shown.
    if (pageId) hub.set(navPagePath(hubKey), pageId);
  };

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg" style={{ transform: 'translateZ(0)' }}>
      <TooltipProvider>
        {/* key: re-mount when "Open by default" changes so the setting applies live */}
        <SidebarProvider
          key={String(configs.defaultOpen ?? true)}
          defaultOpen={configs.defaultOpen ?? true}
          className="h-full min-h-0"
          // 100% => the sidebar fills its box exactly (no gap between the box border
          // and the sidebar border); resizing the box resizes the sidebar.
          style={{ '--sidebar-width': '100%' } as React.CSSProperties}
        >
          <WidthSync configs={configs} updateConfigs={updateConfigs} collapsible={collapsible} />
          <Sidebar
            side={configs.side ?? 'left'}
            variant={configs.variant ?? 'sidebar'}
            collapsible={collapsible}
            className="h-full"
          >
            <SidebarHeader>
              <SidebarBrand
                title={configs.title ?? DEFAULT_HEADING}
                collapsible={collapsible}
                editable={!isPreview}
                onTitleChange={(v) => updateConfigs?.({ title: v })}
              />
            </SidebarHeader>

            <SidebarContent>
              {!groups.length && !isPreview && (
                <p className="px-4 py-3 text-xs text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
                  No menus yet. Click + below to add one.
                </p>
              )}
              {groups.map((group) => (
                <SidebarGroup key={group.id}>
                  {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => {
                        const Icon = ICONS[item.icon];
                        const childActive = item.children?.some((c) => c.id === configs.activeItem);
                        return (
                          <SidebarMenuItem key={item.id}>
                            {editingId === item.id ? (
                              <div className="flex h-8 items-center gap-2 rounded-md bg-sidebar-accent px-2 text-sm text-sidebar-accent-foreground ring-2 ring-sidebar-ring">
                                {Icon && <Icon className="size-4 shrink-0" />}
                                {renameInput(item.id, item.label)}
                              </div>
                            ) : (
                              <SidebarMenuButton
                                tooltip={item.label}
                                isActive={configs.activeItem === item.id || !!childActive}
                                onClick={() => select(item.id, item.label, item.pageId)}
                                onDoubleClick={() => !isPreview && setEditingId(item.id)}
                              >
                                {Icon && <Icon />}
                                <span>{item.label}</span>
                              </SidebarMenuButton>
                            )}
                            {!!item.children?.length && (
                              <SidebarMenuSub>
                                {item.children.map((sub) => (
                                  <SidebarMenuSubItem key={sub.id}>
                                    {editingId === sub.id ? (
                                      <div className="flex h-7 items-center rounded-md bg-sidebar-accent px-2 text-sm ring-2 ring-sidebar-ring">
                                        {renameInput(sub.id, sub.label)}
                                      </div>
                                    ) : (
                                      <SidebarMenuSubButton
                                        asChild
                                        isActive={configs.activeItem === sub.id}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => select(sub.id, sub.label, sub.pageId)}
                                          onDoubleClick={() => !isPreview && setEditingId(sub.id)}
                                        >
                                          <span>{sub.label}</span>
                                        </button>
                                      </SidebarMenuSubButton>
                                    )}
                                  </SidebarMenuSubItem>
                                ))}
                              </SidebarMenuSub>
                            )}
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
              {/* Design-mode only: quick "add menu" button, right inside the sidebar. */}
              {!isPreview && (
                <SidebarGroup className="mt-auto">
                  <SidebarGroupContent>
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          tooltip="Add menu"
                          className="text-sidebar-foreground/70"
                          onClick={() => updateConfigs?.({ groups: withNewItem(groups) })}
                        >
                          <Plus />
                          <span>Add menu</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              )}
            </SidebarContent>

            {configs.footerText && (
              <SidebarFooter>
                <p className="truncate px-2 py-1 text-xs text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
                  {configs.footerText}
                </p>
              </SidebarFooter>
            )}
            {collapsible !== 'none' && <SidebarRail />}
          </Sidebar>

          {/* Optional shadcn-style inset header. Always shown for "offcanvas" mode,
              since the sidebar is fully hidden there and needs a trigger to reopen. */}
          {(configs.showContentArea || collapsible === 'offcanvas') && (
            <SidebarInset className="min-h-0 min-w-0">
              <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
                {collapsible !== 'none' && <SidebarTrigger className="-ml-1" />}
                <span className="truncate text-sm text-muted-foreground">
                  {activeLabel ?? 'Select a menu item'}
                </span>
              </header>
            </SidebarInset>
          )}
        </SidebarProvider>
      </TooltipProvider>
    </div>
  );
}

// ─── Visual menu editor (Settings panel) ─────────────────────────────────────

const inputCls =
  'min-w-0 flex-1 rounded-lg border border-border bg-secondary px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary';
const iconBtn =
  'rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30';

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function RowButtons({ i, len, onMove, onDelete }: {
  i: number; len: number; onMove: (d: -1 | 1) => void; onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center">
      <button type="button" className={iconBtn} disabled={i === 0} onClick={() => onMove(-1)} title="Move up"><ChevronUp className="h-3.5 w-3.5" /></button>
      <button type="button" className={iconBtn} disabled={i === len - 1} onClick={() => onMove(1)} title="Move down"><ChevronDown className="h-3.5 w-3.5" /></button>
      <button type="button" className={`${iconBtn} hover:text-destructive`} onClick={onDelete} title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
  );
}

/** Dropdown that links a menu item / sub-item to one of the canvas Pages. */
function PageLinkSelect({ value, pages, onChange }: {
  value?: string; pages: PageOption[]; onChange: (pageId: string | undefined) => void;
}) {
  const saved = listSavedPages(useTemplates());
  const known = pages.some((p) => p.id === value) || saved.some((p) => p.id === value);
  // linked page was deleted (don't flag saved pages while they are still loading)
  const missing = !!value && !known && !(isTemplateLink(value) && saved.length === 0);
  return (
    <div className="flex items-center gap-1">
      <Link2 className={`h-3.5 w-3.5 shrink-0 ${value && !missing ? 'text-primary' : 'text-muted-foreground'}`} />
      <select
        className="min-w-0 flex-1 rounded-lg border border-border bg-secondary px-1.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary"
        value={value ?? ''}
        title="Page this menu opens in Live Preview"
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{pages.length || saved.length ? 'Opens page: — none —' : 'No pages yet'}</option>
        {missing && <option value={value}>(deleted page)</option>}
        {isTemplateLink(value) && saved.length === 0 && <option value={value}>(loading saved page…)</option>}
        {pages.length > 0 && (
          <optgroup label="Pages on canvas">
            {pages.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </optgroup>
        )}
        {saved.length > 0 && (
          <optgroup label="Saved pages">
            {saved.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </optgroup>
        )}
      </select>
    </div>
  );
}

function SidebarMenuEditor({ value, onChange, instances }: { value: any; onChange: (val: any) => void; instances?: any[] }) {
  const groups: NavGroup[] = Array.isArray(value) ? value : DEFAULT_GROUPS;
  const pages = listPages(instances);

  const setGroup = (gi: number, patch: Partial<NavGroup>) =>
    onChange(groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const setItem = (gi: number, ii: number, patch: Partial<NavItem>) =>
    setGroup(gi, { items: groups[gi].items.map((it, i) => (i === ii ? { ...it, ...patch } : it)) });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {groups.reduce((n, g) => n + g.items.length, 0)} menu item(s)
        </span>
        <button
          type="button"
          title="Add menu item"
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90"
          onClick={() => onChange(withNewItem(groups))}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {!groups.length && (
        <p className="rounded-xl border border-dashed border-border py-4 text-center text-[11px] text-muted-foreground">
          No menus yet. Click + to add your first menu.
        </p>
      )}
      {groups.map((group, gi) => (
        <div key={group.id} className="space-y-2 rounded-xl border border-border p-2.5">
          <div className="flex items-center gap-1">
            <input
              className={`${inputCls} font-semibold`}
              placeholder="Group label (optional)"
              value={group.label}
              onChange={(e) => setGroup(gi, { label: e.target.value })}
            />
            <RowButtons
              i={gi} len={groups.length}
              onMove={(d) => onChange(move(groups, gi, d))}
              onDelete={() => onChange(groups.filter((_, i) => i !== gi))}
            />
          </div>

          {group.items.map((item, ii) => (
            <div key={item.id} className="space-y-1.5 rounded-lg bg-secondary/40 p-2">
              {/* Row 1: the menu name, full width so it is always easy to edit */}
              <input
                className={`${inputCls} w-full flex-none font-medium`}
                placeholder="Menu name"
                value={item.label}
                onChange={(e) => setItem(gi, ii, { label: e.target.value })}
              />
              {/* Row 2: icon + move/delete */}
              <div className="flex items-center gap-1">
                <select
                  className="min-w-0 flex-1 rounded-lg border border-border bg-secondary px-1.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary"
                  value={item.icon}
                  onChange={(e) => setItem(gi, ii, { icon: e.target.value })}
                >
                  {ICON_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <RowButtons
                  i={ii} len={group.items.length}
                  onMove={(d) => setGroup(gi, { items: move(group.items, ii, d) })}
                  onDelete={() => setGroup(gi, { items: group.items.filter((_, i) => i !== ii) })}
                />
              </div>
              {/* Row 3: the page this menu opens */}
              <PageLinkSelect
                value={item.pageId}
                pages={pages}
                onChange={(pageId) => setItem(gi, ii, { pageId })}
              />
              {item.children?.map((sub, si) => (
                <div key={sub.id} className="space-y-1 pl-4">
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">↳</span>
                    <input
                      className={inputCls}
                      placeholder="Sub-item label"
                      value={sub.label}
                      onChange={(e) =>
                        setItem(gi, ii, { children: item.children!.map((c, i) => (i === si ? { ...c, label: e.target.value } : c)) })
                      }
                    />
                    <RowButtons
                      i={si} len={item.children!.length}
                      onMove={(d) => setItem(gi, ii, { children: move(item.children!, si, d) })}
                      onDelete={() => setItem(gi, ii, { children: item.children!.filter((_, i) => i !== si) })}
                    />
                  </div>
                  <PageLinkSelect
                    value={sub.pageId}
                    pages={pages}
                    onChange={(pageId) =>
                      setItem(gi, ii, { children: item.children!.map((c, i) => (i === si ? { ...c, pageId } : c)) })
                    }
                  />
                </div>
              ))}
              <button
                type="button"
                className="pl-1 text-[10px] font-bold uppercase tracking-wide text-primary/80 hover:text-primary"
                onClick={() => setItem(gi, ii, { children: [...(item.children ?? []), { id: uid('s'), label: 'Sub item' }] })}
              >
                + Sub-item
              </button>
            </div>
          ))}

          <button
            type="button"
            className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-primary/80 hover:text-primary"
            onClick={() => setGroup(gi, { items: [...group.items, { id: uid('i'), label: 'New item', icon: 'file' }] })}
          >
            <Plus className="h-3 w-3" /> Add menu item
          </button>
        </div>
      ))}

      <button
        type="button"
        className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-border py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground hover:border-primary/50 hover:text-primary"
        onClick={() => onChange([...groups, { id: uid('g'), label: 'New group', items: [] }])}
      >
        <Plus className="h-3 w-3" /> Add group
      </button>
    </div>
  );
}

// ─── Plugin export ────────────────────────────────────────────────────────────

export const SidebarPlugin: ViewBuilderPlugin<SidebarConfigs> = {
  id: 'sidebar',
  pluginType: 'layout',
  toolbar: {
    name: 'Sidebar',
    element: () => <PanelLeft className="h-4 w-4" />,
    toolTip: 'Add a collapsible sidebar — click + inside it to add menus',
  },
  canvas: {
    element: ({ id, configs, updateConfigs, isPreview }) => (
      <SidebarCanvas id={id} configs={configs} updateConfigs={updateConfigs} isPreview={isPreview} />
    ),
  },
  settings: [
    { field_id: 'title', label: 'Sidebar Heading', type: 'text', defaultValue: DEFAULT_HEADING },
    { field_id: 'groups', label: 'Menus', type: 'menu', component: SidebarMenuEditor, defaultValue: DEFAULT_GROUPS },
    { field_id: 'collapsible', label: 'Collapse mode', type: 'select', enum: ['icon', 'offcanvas', 'none'], defaultValue: 'icon' },
    { field_id: 'side', label: 'Side', type: 'select', enum: ['left', 'right'], defaultValue: 'left' },
    { field_id: 'variant', label: 'Variant', type: 'select', enum: ['sidebar', 'floating', 'inset'], defaultValue: 'sidebar' },
    { field_id: 'defaultOpen', label: 'Open by default', type: 'checkbox', defaultValue: true },
    { field_id: 'footerText', label: 'Footer text', type: 'text', defaultValue: '' },
    { field_id: 'showContentArea', label: 'Show header bar beside sidebar', type: 'checkbox', defaultValue: false },
    { field_id: 'hubKey', label: 'State / Hub Key', type: 'text', defaultValue: 'activeNav' },
  ],
  componentDataSchema: {},
};