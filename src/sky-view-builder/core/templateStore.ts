import { useEffect, useState } from 'react';
import type { ComponentInstance } from './plugin';
import { fetchSavedTemplates, createSavedTemplate, updateSavedTemplate, deleteSavedTemplate } from '../../api/templatesApi';

// ─── Reusable Page/Block/Component templates ────────────────────────────────
// "Save as reusable" on any selected instance (Page, Block, or a leaf
// component) snapshots its full config tree here under a name. It then
// shows up in the Toolbar's "Saved" section, draggable into any other
// page/block exactly like a fresh palette item — except instead of building
// a blank default instance, the drop target clones this saved tree (with
// brand-new ids so multiple drops never collide) and inserts that instead.
//
// Backed by the `/saved-templates` API (see ../../api/templatesApi.ts and
// the backend's saved_templates table) so saved blocks sync across devices
// instead of staying in one browser. A module-level in-memory cache mirrors
// the server list so every read here (listTemplates, getTemplate,
// resolveDroppedTemplate) can stay synchronous — none of the many onDrop
// call sites across pagePlugin/blockplugin/domainTabsPlugin/ViewBuilder
// need to become async just to resolve a dropped template. Writes
// (save/delete) update the cache optimistically and fire the network call
// in the background, reconciling — or rolling back — once it resolves.

const CHANGE_EVENT = 'skiode-templates-changed';

/** Drag payload prefix. Reuses the existing PLUGIN_DRAG_MIME channel — a
 *  saved template drags as `TEMPLATE_DRAG_PREFIX + templateId` instead of a
 *  plain plugin id, so every existing onDrop handler (which already reads
 *  that MIME type) keeps working; they just need one extra check up front
 *  via `resolveDroppedTemplate` to tell a template reference apart from an
 *  ordinary plugin id. */
export const TEMPLATE_DRAG_PREFIX = '__template__:';

/** Config key stamped on the ROOT of every instance that was created from a
 *  saved template (drag-and-drop or the Edit button). It remembers which
 *  template the copy came from, so "Save" can overwrite that template
 *  instead of creating another one. Never stored inside a snapshot. */
export const TEMPLATE_SOURCE_KEY = '__templateId';

export interface SavedTemplate {
  id: string;
  name: string;
  /** The root instance's plugin id (page-plugin / block-plugin / a leaf
   *  component's id) — used to pick an icon/label in the palette without
   *  needing to inspect the full instance. */
  pluginId: string;
  savedAt: number;
  instance: ComponentInstance;
}

let cache: SavedTemplate[] = [];
let loaded = false;
let loadingPromise: Promise<void> | null = null;

// A save that is still in flight has a temporary "pending-xxx" id. If the
// user edits/updates it before the server answers, we wait for the create to
// finish and remember pending → real id so stamped canvas copies still resolve.
const pendingCreates = new Map<string, Promise<string | null>>();
const idAliases = new Map<string, string>();
const resolveId = (id: string) => idAliases.get(id) ?? id;

/** Deep-clones an instance and removes every template-source stamp, so what
 *  we persist is always a clean snapshot. */
function stripSourceStamps(instance: ComponentInstance): ComponentInstance {
  const deep: ComponentInstance = JSON.parse(JSON.stringify(instance));
  const walk = (inst: ComponentInstance) => {
    const configs = inst.configs as Record<string, any> | undefined;
    if (!configs || typeof configs !== 'object') return;
    delete configs[TEMPLATE_SOURCE_KEY];
    if (Array.isArray(configs.blocks)) configs.blocks.forEach(walk);
    if (Array.isArray(configs.components)) configs.components.forEach(walk);
  };
  walk(deep);
  return deep;
}

/** The saved template an instance was created from, or null if it wasn't
 *  created from one (or that template has since been deleted). */
export function getSourceTemplate(instance: ComponentInstance | null | undefined): SavedTemplate | null {
  const id = (instance?.configs as Record<string, any> | undefined)?.[TEMPLATE_SOURCE_KEY];
  return typeof id === 'string' ? getTemplate(id) : null;
}

function notify() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function fromRow(row: { id: number; name: string; plugin_id: string; instance: any; updated_at: string }): SavedTemplate {
  return {
    id: String(row.id),
    name: row.name,
    pluginId: row.plugin_id,
    savedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    instance: row.instance as ComponentInstance,
  };
}

/** Loads the list from the backend once; subsequent calls reuse the same
 *  in-flight promise instead of firing duplicate requests. */
function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loadingPromise) return loadingPromise;

  loadingPromise = fetchSavedTemplates()
    .then(rows => {
      cache = rows.map(fromRow);
      loaded = true;
      notify();
    })
    .catch(err => {
      console.error('Failed to load saved templates:', err);
      // Leave `loaded` false so a later call can retry.
    })
    .finally(() => {
      loadingPromise = null;
    });

  return loadingPromise;
}

/** Pre-fills the in-memory cache without touching the backend.
 *
 *  Used by the client renderer: a published page carries every saved template
 *  it links to (sidebar "tpl:<id>" links), so the viewer seeds them here and
 *  never calls /saved-templates. With `markLoaded` the list is treated as
 *  final, so `useTemplates()` does not fetch (and cannot overwrite the seed).
 *  Without it (builder), seeded templates are merged in by id. */
export function seedTemplates(rows: SavedTemplate[], markLoaded = false): void {
  const byId = new Map(cache.map(t => [t.id, t] as const));
  for (const t of rows) byId.set(t.id, t);
  cache = [...byId.values()];
  if (markLoaded) loaded = true;
  notify();
}

export function listTemplates(): SavedTemplate[] {
  return [...cache].sort((a, b) => b.savedAt - a.savedAt);
}

export function saveTemplate(name: string, instance: ComponentInstance): void {
  const tempId = `pending-${Math.random().toString(36).slice(2, 10)}`;
  const optimistic: SavedTemplate = {
    id: tempId,
    name: name.trim() || 'Untitled',
    pluginId: instance.pluginId,
    savedAt: Date.now(),
    // Deep-clone into a frozen snapshot — later edits to the live instance
    // on the canvas shouldn't retroactively change what's saved.
    instance: stripSourceStamps(instance),
  };
  cache = [...cache, optimistic];
  notify();

  const creation = createSavedTemplate({
    name: optimistic.name,
    plugin_id: optimistic.pluginId,
    instance: optimistic.instance,
  })
    .then(row => {
      const saved = fromRow(row);
      idAliases.set(tempId, saved.id);
      cache = cache.map(t => (t.id === tempId ? saved : t));
      notify();
      return saved.id;
    })
    .catch(err => {
      console.error('Failed to save template:', err);
      cache = cache.filter(t => t.id !== tempId);
      notify();
      return null;
    })
    .finally(() => {
      pendingCreates.delete(tempId);
    });
  pendingCreates.set(tempId, creation);
}

/** Overwrites an existing saved template (same id, same row) with the current
 *  state of `instance` — this is the "edit & replace" path; no new template
 *  is created. Optimistic: the Saved Blocks list updates immediately and is
 *  rolled back if the server rejects the change. */
export async function updateTemplate(
  id: string,
  instance: ComponentInstance,
  name?: string,
): Promise<void> {
  // Saved a moment ago and the server hasn't answered yet: wait for the real id.
  const inFlight = pendingCreates.get(id);
  if (inFlight) await inFlight;
  const realId = resolveId(id);

  const previous = cache.find(t => t.id === realId);
  if (!previous) throw new Error('Saved template no longer exists');

  const snapshot = stripSourceStamps(instance);
  const finalName = name?.trim() || previous.name;
  cache = cache.map(t =>
    t.id === realId
      ? { ...t, name: finalName, pluginId: snapshot.pluginId, instance: snapshot, savedAt: Date.now() }
      : t,
  );
  notify();

  try {
    const row = await updateSavedTemplate(realId, {
      name: finalName,
      plugin_id: snapshot.pluginId,
      instance: snapshot,
    });
    cache = cache.map(t => (t.id === realId ? fromRow(row) : t));
    notify();
  } catch (err) {
    console.error('Failed to update template:', err);
    cache = cache.map(t => (t.id === realId ? previous : t));
    notify();
    throw err;
  }
}

export function deleteTemplate(id: string): void {
  const removed = cache.find(t => t.id === id);
  cache = cache.filter(t => t.id !== id);
  notify();

  // Nothing to delete server-side for a save that never made it past the
  // optimistic stage (id starts with "pending-").
  if (!removed || id.startsWith('pending-')) return;

  deleteSavedTemplate(id).catch(err => {
    console.error('Failed to delete template:', err);
    // Put it back — the delete didn't actually happen.
    cache = [...cache, removed];
    notify();
  });
}

export function getTemplate(id: string): SavedTemplate | null {
  const real = resolveId(id);
  return cache.find(t => t.id === real) ?? null;
}

/** Regenerates every id in an instance tree (the instance itself, plus any
 *  nested configs.blocks / configs.components) so dropping the same saved
 *  template twice — or twice into the same page — never produces two
 *  components sharing an id. Also keeps configs.blockId in sync with the
 *  new id, since BlockCanvas reads its own id from there in a couple of
 *  places rather than the instance id directly. */
export function cloneInstanceWithNewIds(instance: ComponentInstance): ComponentInstance {
  const deep: ComponentInstance = JSON.parse(JSON.stringify(instance));

  const assignIds = (inst: ComponentInstance) => {
    inst.id = Math.random().toString(36).slice(2, 9);
    const configs = inst.configs as Record<string, any> | undefined;
    if (configs && typeof configs === 'object') {
      if ('blockId' in configs) configs.blockId = inst.id;
      if (Array.isArray(configs.blocks)) configs.blocks.forEach((b: ComponentInstance) => assignIds(b));
      if (Array.isArray(configs.components)) configs.components.forEach((c: ComponentInstance) => assignIds(c));
    }
  };

  assignIds(deep);
  return deep;
}

/** If `pluginIdOrRef` is actually a reference to a saved template (dragged
 *  from the Toolbar's "Saved" section), resolves + clones it with fresh
 *  ids. Returns null for an ordinary plugin id, so every call site can just
 *  do `resolveDroppedTemplate(x) ?? buildDefaultInstanceAsBefore(x)`. */
export function resolveDroppedTemplate(pluginIdOrRef: string): ComponentInstance | null {
  if (!pluginIdOrRef.startsWith(TEMPLATE_DRAG_PREFIX)) return null;
  const id = pluginIdOrRef.slice(TEMPLATE_DRAG_PREFIX.length);
  return instantiateTemplate(id);
}

/** Clones a saved template with fresh ids and stamps the root with the
 *  template it came from, so editing the copy and pressing Save replaces the
 *  original rather than adding a second block. */
export function instantiateTemplate(templateId: string): ComponentInstance | null {
  const tpl = getTemplate(templateId);
  if (!tpl) return null;
  const clone = cloneInstanceWithNewIds(tpl.instance);
  clone.configs = { ...(clone.configs as Record<string, any>), [TEMPLATE_SOURCE_KEY]: tpl.id };
  return clone;
}

/** Live-updating list of saved templates. Triggers the initial fetch from
 *  the backend on first mount (a no-op if already loaded), then re-reads
 *  the in-memory cache on every save/delete/load so the Toolbar's "Saved"
 *  section never goes stale without a manual refresh. */
export function useTemplates(): SavedTemplate[] {
  const [templates, setTemplates] = useState<SavedTemplate[]>(() => listTemplates());

  useEffect(() => {
    const handler = () => setTemplates(listTemplates());
    window.addEventListener(CHANGE_EVENT, handler);
    ensureLoaded();
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler);
    };
  }, []);

  return templates;
}