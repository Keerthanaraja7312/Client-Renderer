import type { ComponentInstance } from './plugin';
import {
  getTemplate,
  seedTemplates,
  TEMPLATE_SOURCE_KEY,
  type SavedTemplate,
} from './templateStore';
import { TPL_PREFIX } from './navigation';
import { getLayouts, type GridLayoutItem } from '../ui/gridLayout';

// ─── The "page document" ─────────────────────────────────────────────────────
// Everything the client renderer needs to draw a page exactly as it looked in
// the builder's Live Preview. This is what /pages/{slug}/draft stores and
// /pages/{slug}/published returns (backend: PageDocument).
//
//   instances  the builder's ComponentInstance tree, UNSTRIPPED. Every config
//              (button actions, state, queries, data sources, visual styles...)
//              is kept, because the plugins read them at render time.
//   layouts    react-grid-layout object per breakpoint.
//   templates  saved Pages that Sidebar menu items open ("tpl:<id>" links),
//              inlined so the client never calls /saved-templates and a later
//              edit to a saved block does not silently change a live page.
//
// The runtime shape (pluginId / configs) is deliberately the same as the
// builder's, so loading is just "feed it to Canvas" - no translation layer.

export const PAGE_DOCUMENT_VERSION = 1;

export interface PageDocument {
  schemaVersion: number;
  instances: ComponentInstance[];
  layouts: Record<string, GridLayoutItem[]>;
  templates: Record<string, SavedTemplate>;
  /** Informational: when the document was produced. */
  builtAt?: string;
  [key: string]: unknown;
}

export interface BuildResult {
  document: PageDocument;
  /** Template links found on the page whose template is not loaded/known. */
  missingTemplates: string[];
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Calls `fn` for every instance in the tree (Page -> blocks -> components). */
function walkInstances(list: any[] | undefined, fn: (inst: ComponentInstance) => void) {
  for (const inst of list ?? []) {
    if (!inst || typeof inst !== 'object') continue;
    fn(inst);
    walkInstances(inst.configs?.blocks, fn);
    walkInstances(inst.configs?.components, fn);
  }
}

/** Every "tpl:<id>" link (as the bare template id) used by sidebar menus in this tree. */
function templateIdsIn(list: any[] | undefined): string[] {
  const ids: string[] = [];
  const addLink = (link: unknown) => {
    if (typeof link === 'string' && link.startsWith(TPL_PREFIX)) ids.push(link.slice(TPL_PREFIX.length));
  };
  walkInstances(list, (inst) => {
    if (inst.pluginId !== 'sidebar') return;
    for (const g of (inst.configs as any)?.groups ?? []) {
      for (const it of g.items ?? []) {
        addLink(it.pageId);
        for (const c of it.children ?? []) addLink(c.pageId);
      }
    }
  });
  return ids;
}

/** Removes builder-only bookkeeping from an instance tree (in place). */
function stripBuilderMarkers(list: any[] | undefined) {
  walkInstances(list, (inst) => {
    if (inst.configs && typeof inst.configs === 'object') delete (inst.configs as any)[TEMPLATE_SOURCE_KEY];
  });
}

/**
 * Builds the document to store from the builder's live state.
 * Pulls in every saved template the page links to (including templates
 * linked from inside other templates).
 */
export function buildPageDocument(instances: ComponentInstance[], layouts: unknown): BuildResult {
  const docInstances = clone(instances);
  stripBuilderMarkers(docInstances);

  const templates: Record<string, SavedTemplate> = {};
  const missing = new Set<string>();
  const queue = templateIdsIn(docInstances);
  while (queue.length) {
    const id = queue.pop()!;
    if (templates[id] || missing.has(id)) continue;
    const tpl = getTemplate(id);
    if (!tpl) {
      missing.add(id);
      continue;
    }
    const copy = clone(tpl);
    stripBuilderMarkers([copy.instance]);
    templates[tpl.id] = copy;
    queue.push(...templateIdsIn([copy.instance]));
  }

  return {
    document: {
      schemaVersion: PAGE_DOCUMENT_VERSION,
      instances: docInstances,
      layouts: clone(getLayouts(layouts)),
      templates,
      builtAt: new Date().toISOString(),
    },
    missingTemplates: [...missing],
  };
}

/**
 * Validates + normalises a stored document (from either /draft or /published).
 * Throws a readable Error when it cannot be rendered.
 */
export function parsePageDocument(raw: unknown): PageDocument {
  const doc = raw as Partial<PageDocument> | null;
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.instances)) {
    throw new Error('This page has no content (the stored document is missing "instances").');
  }
  const version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1;
  if (version > PAGE_DOCUMENT_VERSION) {
    throw new Error(
      `This page was published with a newer format (v${version}); this app only understands up to v${PAGE_DOCUMENT_VERSION}. Update the app.`,
    );
  }
  return {
    ...doc,
    schemaVersion: version,
    instances: doc.instances as ComponentInstance[],
    layouts: getLayouts(doc.layouts),
    templates: (doc.templates && typeof doc.templates === 'object' ? doc.templates : {}) as Record<string, SavedTemplate>,
  };
}

/**
 * Makes the document's inlined templates available to templateStore.
 * Client: pass markLoaded=true (no /saved-templates call at all).
 * Builder: leave false (merges into the list it already loaded from the backend).
 */
export function seedDocumentTemplates(doc: PageDocument, markLoaded = false): void {
  seedTemplates(Object.values(doc.templates ?? {}), markLoaded);
}
