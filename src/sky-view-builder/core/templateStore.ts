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
  /** Project this template was saved for (absent / null = none). */
  projectId?: string | null;
  projectName?: string | null;
  /** Flat index of every project / page / block id inside this snapshot, so a
   *  published page can locate the exact saved block without walking the tree. */
  refs?: SavedRef[];
}

/** One row of the id index stored with every saved page/block. */
export interface SavedRef {
  projectId: string | null;
  /** Page the block sits on (null when the snapshot has no Page). */
  pageId: string | null;
  /** Block instance id (== configs.blockId). */
  blockId: string;
}

/** Config key on the snapshot root that persists `refs` inside the stored JSON,
 *  so it round-trips through the backend without a schema change. */
export const SAVED_REF_KEY = '__savedRefs';

/** Builds the project/page/block index for an instance tree. */
export function collectRefs(root: ComponentInstance, projectId: string | null): SavedRef[] {
  const refs: SavedRef[] = [];
  const walk = (inst: any, pageId: string | null) => {
    if (!inst || typeof inst !== 'object') return;
    const c = inst.configs ?? {};
    let page = pageId;
    if (inst.pluginId === 'page-plugin') page = c.pageId || c.pageMeta?.id || inst.id;
    if (inst.pluginId === 'block-plugin') refs.push({ projectId, pageId: page, blockId: c.blockId || inst.id });
    (c.blocks ?? []).forEach((b: any) => walk(b, page));
    (c.components ?? []).forEach((b: any) => walk(b, page));
  };
  walk(root, null);
  return refs;
}

/** Stamps the id index onto a snapshot's root configs (mutates + returns it). */
function stampRefs(snapshot: ComponentInstance, projectId: string | null): ComponentInstance {
  snapshot.configs = { ...(snapshot.configs as any), [SAVED_REF_KEY]: collectRefs(snapshot, projectId) };
  return snapshot;
}

/** Project chosen in the Save dialog. `id: null` = "No project". */
export interface TemplateProject {
  id: string | null;
  name: string | null;
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

function fromRow(row: {
  id: number; name: string; plugin_id: string; instance: any; updated_at: string;
  project_id?: number | null; project_name?: string | null;
}): SavedTemplate {
  const projectId = row.project_id != null ? String(row.project_id) : null;
  const instance = row.instance as ComponentInstance;
  return {
    id: String(row.id),
    name: row.name,
    pluginId: row.plugin_id,
    savedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    instance,
    projectId,
    projectName: row.project_name ?? null,
    // The backend row is the source of truth for the project; rebuild the index from it.
    refs: collectRefs(instance, projectId),
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

export function saveTemplate(name: string, instance: ComponentInstance, project?: TemplateProject): void {
  const tempId = `pending-${Math.random().toString(36).slice(2, 10)}`;
  const optimistic: SavedTemplate = {
    id: tempId,
    name: name.trim() || 'Untitled',
    pluginId: instance.pluginId,
    savedAt: Date.now(),
    // Deep-clone into a frozen snapshot — later edits to the live instance
    // on the canvas shouldn't retroactively change what's saved.
    instance: stampRefs(stripSourceStamps(instance), project?.id ?? null),
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
  };
  optimistic.refs = collectRefs(optimistic.instance, optimistic.projectId ?? null);
  cache = [...cache, optimistic];
  notify();

  const creation = createSavedTemplate({
    name: optimistic.name,
    plugin_id: optimistic.pluginId,
    instance: optimistic.instance,
    project_id: project?.id ? Number(project.id) : null,
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
  /** Omit to keep the template's current project; pass `{ id: null }` to detach it. */
  project?: TemplateProject,
): Promise<void> {
  // Saved a moment ago and the server hasn't answered yet: wait for the real id.
  const inFlight = pendingCreates.get(id);
  if (inFlight) await inFlight;
  const realId = resolveId(id);

  const previous = cache.find(t => t.id === realId);
  if (!previous) throw new Error('Saved template no longer exists');

  const nextProjectId = project ? project.id : previous.projectId ?? null;
  const snapshot = stampRefs(stripSourceStamps(instance), nextProjectId);
  const finalName = name?.trim() || previous.name;
  cache = cache.map(t =>
    t.id === realId
      ? {
          ...t, name: finalName, pluginId: snapshot.pluginId, instance: snapshot, savedAt: Date.now(),
          ...(project ? { projectId: project.id, projectName: project.name } : {}),
        }
      : t,
  );
  notify();

  try {
    const row = await updateSavedTemplate(realId, {
      name: finalName,
      plugin_id: snapshot.pluginId,
      instance: snapshot,
      ...(project ? { project_id: project.id ? Number(project.id) : null } : {}),
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

export interface CloneOptions {
  /** Maps an old instance id to its new one. Default: a fresh random id.
   *  Pass a pure function (e.g. `old => `tpl12-${old}``) to get the SAME ids on
   *  every run - the builder and the published client then agree on them. */
  idFor?: (oldId: string) => string;
}

const randomId = () => Math.random().toString(36).slice(2, 9);

/** Rewrites every reference to a renamed id: exact string matches, ids used as
 *  a segment of a dotted state path ("global.blocks.<id>.key"), and object keys. */
function remapIds(value: any, map: Map<string, string>): any {
  if (typeof value === 'string') {
    if (map.has(value)) return map.get(value);
    if (value.includes('.')) {
      return value.split('.').map(seg => map.get(seg) ?? seg).join('.');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(v => remapIds(v, map));
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[map.get(k) ?? k] = remapIds(v, map);
    return out;
  }
  return value;
}

/** Regenerates every id in an instance tree (the instance itself, plus any
 *  nested configs.blocks / configs.components) so dropping the same saved
 *  template twice - or twice into the same page - never produces two
 *  components sharing an id.
 *
 *  Every place that REFERENCES one of those ids is rewritten too: configs.blockId,
 *  the Page's pageMeta.blocks[].id (the state hub registers block state under
 *  those), saved id refs, and any state path that embeds an id. Without this
 *  the copy's state is registered under the old ids while the blocks render
 *  with the new ones, so nothing is bound - which is how a saved page opened from
 *  a sidebar link loaded empty in the published client. */
export function cloneInstanceWithNewIds(instance: ComponentInstance, opts: CloneOptions = {}): ComponentInstance {
  const deep: ComponentInstance = JSON.parse(JSON.stringify(instance));
  const idMap = new Map<string, string>();
  const next = (old: string) => (opts.idFor ? opts.idFor(old) : randomId());

  const assignIds = (inst: ComponentInstance) => {
    const old = inst.id;
    const fresh = old ? next(old) : randomId();
    if (old) idMap.set(old, fresh);
    inst.id = fresh;
    const configs = inst.configs as Record<string, any> | undefined;
    if (configs && typeof configs === 'object') {
      if ('blockId' in configs) {
        if (configs.blockId && configs.blockId !== old) idMap.set(configs.blockId, fresh);
        configs.blockId = fresh;
      }
      if (Array.isArray(configs.blocks)) configs.blocks.forEach((b: ComponentInstance) => assignIds(b));
      if (Array.isArray(configs.components)) configs.components.forEach((c: ComponentInstance) => assignIds(c));
    }
  };
  assignIds(deep);

  const remapped = remapIds(deep, idMap) as ComponentInstance;

  // A Page's metadata id must always equal its pageId (state paths use it).
  const fix = (inst: any) => {
    const c = inst?.configs;
    if (!c || typeof c !== 'object') return;
    if (inst.pluginId === 'page-plugin' && c.pageMeta && c.pageId) c.pageMeta.id = c.pageId;
    (c.blocks ?? []).forEach(fix);
    (c.components ?? []).forEach(fix);
  };
  fix(remapped);
  return remapped;
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