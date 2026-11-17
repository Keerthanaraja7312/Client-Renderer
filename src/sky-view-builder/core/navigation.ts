import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useHub } from '@/store/StateHubContext';
import type { ComponentInstance } from './plugin';
import { useTemplates, getTemplate, cloneInstanceWithNewIds } from './templateStore';

// ─── Sidebar → Page navigation ───────────────────────────────────────────────
// Each sidebar menu item / sub-item can be linked to a Page (by the Page
// instance id). In Live Preview only the "active" page of a sidebar is shown;
// clicking another menu item switches to its linked page.
//
//   • Pages that NO sidebar links to are always visible (old behaviour).
//   • Pages linked by a sidebar are hidden unless they are that sidebar's
//     active page.
//   • Design mode always shows every page so they can all be edited.
//
// The active page of a sidebar lives in the StateHub at
//   global.shared.{hubKey}Page      (e.g. global.shared.activeNavPage)

export const SIDEBAR_PLUGIN_ID = 'sidebar';
export const PAGE_PLUGIN_ID = 'page-plugin';

/** Link value prefix for a saved (reusable) Page template: `tpl:<templateId>`. */
export const TPL_PREFIX = 'tpl:';
export const isTemplateLink = (id?: string | null): id is string => !!id && id.startsWith(TPL_PREFIX);

export const navPageHubKey = (hubKey?: string) => `${hubKey || 'activeNav'}Page`;
export const navPagePath = (hubKey?: string) => `global.shared.${navPageHubKey(hubKey)}`;

export interface PageOption {
  id: string;
  label: string;
}

/** Top-level Pages that a menu item can link to. */
export function listPages(instances: ComponentInstance[] = []): PageOption[] {
  return instances
    .filter((i) => i?.pluginId === PAGE_PLUGIN_ID)
    .map((p, idx) => ({
      id: p.id,
      label: p.configs?.title || p.configs?.pageId || `Page ${idx + 1}`,
    }));
}

/** Saved Page templates (Save button in the config panel) that a menu item can open. */
export function listSavedPages(templates: { id: string; name: string; pluginId: string }[] = []): PageOption[] {
  return templates
    .filter((t) => t.pluginId === PAGE_PLUGIN_ID)
    .map((t) => ({ id: `${TPL_PREFIX}${t.id}`, label: t.name }));
}

// One stable clone per saved template, so a saved page keeps its ids (and
// hydrated state) when the user navigates away and back.
const tplInstances = new Map<string, ComponentInstance>();
function materializeTemplatePage(link: string): ComponentInstance | null {
  const tpl = getTemplate(link.slice(TPL_PREFIX.length));
  if (!tpl) return null;
  const key = `${tpl.id}@${tpl.savedAt}`;
  let inst = tplInstances.get(key);
  if (!inst) {
    inst = cloneInstanceWithNewIds(tpl.instance);
    tplInstances.set(key, inst);
  }
  return inst;
}

/** Finds the page linked to a menu item / sub-item id inside a sidebar's groups. */
export function findLinkedPage(groups: any[] | undefined, itemId?: string): string | undefined {
  if (!itemId || !Array.isArray(groups)) return undefined;
  for (const g of groups) {
    for (const it of g.items ?? []) {
      if (it.id === itemId) return it.pageId || undefined;
      const c = it.children?.find((s: any) => s.id === itemId);
      if (c) return c.pageId || undefined;
    }
  }
  return undefined;
}

/** First page linked anywhere in the menu (used as the initial page). */
export function firstLinkedPage(groups: any[] | undefined): string | undefined {
  if (!Array.isArray(groups)) return undefined;
  for (const g of groups) {
    for (const it of g.items ?? []) {
      if (it.pageId) return it.pageId;
      for (const c of it.children ?? []) if (c.pageId) return c.pageId;
    }
  }
  return undefined;
}

function allLinkedPages(groups: any[] | undefined): string[] {
  const out = new Set<string>();
  for (const g of groups ?? []) {
    for (const it of g.items ?? []) {
      if (it.pageId) out.add(it.pageId);
      for (const c of it.children ?? []) if (c.pageId) out.add(c.pageId);
    }
  }
  return [...out];
}

export interface SidebarNav {
  /** Instance id of the sidebar itself. */
  sidebarId: string;
  /** Id of the ROOT instance that contains the sidebar (== sidebarId when it sits at root level). */
  hostId: string;
  hubKey: string;
  pageIds: string[];
  defaultPageId: string | null;
}

/** Walks the whole instance tree and returns the navigation info of every sidebar. */
export function collectSidebarNavs(instances: ComponentInstance[] = []): SidebarNav[] {
  const navs: SidebarNav[] = [];
  const visit = (list: any[], rootId?: string) => {
    for (const inst of list ?? []) {
      if (!inst || typeof inst !== 'object') continue;
      const hostId = rootId ?? inst.id;
      if (inst.pluginId === SIDEBAR_PLUGIN_ID) {
        const c = inst.configs ?? {};
        const pageIds = allLinkedPages(c.groups);
        if (pageIds.length) {
          navs.push({
            sidebarId: inst.id,
            hostId,
            hubKey: c.hubKey || 'activeNav',
            pageIds,
            defaultPageId: findLinkedPage(c.groups, c.activeItem) ?? firstLinkedPage(c.groups) ?? null,
          });
        }
      }
      if (Array.isArray(inst.configs?.blocks)) visit(inst.configs.blocks, hostId);
      if (Array.isArray(inst.configs?.components)) visit(inst.configs.components, hostId);
    }
  };
  visit(instances);
  return navs;
}

/**
 * Lets a Page (that contains a sidebar) render the sidebar's active linked page
 * in the area to the RIGHT of the sidebar - like a real application shell -
 * instead of the linked page being stacked below it on the root canvas.
 * Provided by <Canvas/> in preview; consumed by the Page plugin.
 */
export interface NavEmbedValue {
  /** sidebar instance id -> the page that should be shown beside it */
  embeds: Record<string, ComponentInstance>;
  render: (inst: ComponentInstance) => ReactNode;
}
export const NavEmbedContext = createContext<NavEmbedValue | null>(null);

/**
 * Returns the instances that should be rendered on the root canvas.
 * In design mode (enabled = false) that is simply every instance; in preview,
 * pages linked from a sidebar are filtered down to the active one.
 */
export function useNavVisibleInstances(instances: ComponentInstance[], enabled: boolean) {
  const hub = useHub();
  useTemplates(); // loads saved pages from the backend + re-renders when they arrive
  const navs = useMemo(() => (enabled ? collectSidebarNavs(instances) : []), [instances, enabled]);
  const [, bump] = useState(0);

  const keysSig = navs.map((n) => n.hubKey).join('|');
  useEffect(() => {
    const offs = navs.map((n) => hub.subscribe(navPagePath(n.hubKey), () => bump((v) => v + 1)));
    return () => offs.forEach((off) => off());
  }, [hub, keysSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const noEmbeds: Record<string, ComponentInstance> = {};
  if (!enabled || !navs.length) {
    return { visible: instances, filtered: false, templateIds: new Set<string>(), embeds: noEmbeds };
  }

  const linked = new Set<string>();
  const active = new Set<string>();
  const keep = new Set<string>();          // pages hosting a sidebar must never disappear
  const embedded = new Set<string>();      // pages rendered beside a nested sidebar, not on the root grid
  const embeds: Record<string, ComponentInstance> = {};
  for (const n of navs) {
    n.pageIds.forEach((id) => linked.add(id));
    const current = hub.get(navPagePath(n.hubKey)) as string | null | undefined;
    const pick = current && n.pageIds.includes(current) ? current : n.defaultPageId;
    if (!pick) continue;

    if (n.hostId === n.sidebarId) { active.add(pick); continue; }   // sidebar on the root canvas: grid placement

    // Sidebar lives INSIDE a page: show the linked page to its right, inside that page.
    keep.add(n.hostId);
    if (pick === n.hostId) { active.add(pick); continue; }          // it links to its own page: nothing to embed
    const inst = isTemplateLink(pick)
      ? materializeTemplatePage(pick)
      : instances.find((i) => i.id === pick) ?? null;
    if (inst) {
      embeds[n.sidebarId] = inst;
      embedded.add(inst.id);
    } else {
      active.add(pick);
    }
  }
  const visible = instances.filter(
    (i) => (!linked.has(i.id) || active.has(i.id) || keep.has(i.id)) && !embedded.has(i.id)
  );

  // Active link is a saved Page template: render it as an extra page.
  const templateIds = new Set<string>();
  for (const link of active) {
    if (!isTemplateLink(link)) continue;
    const inst = materializeTemplatePage(link);
    if (inst && !visible.some((v) => v.id === inst.id)) {
      visible.push(inst);
      templateIds.add(inst.id);
    }
  }
  return { visible, filtered: true, templateIds, embeds };
}