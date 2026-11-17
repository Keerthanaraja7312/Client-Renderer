import type {
  StatePath,
  StateNode,
  StateScope,
  EventHandler,
  StateEvent,
  PageMeta,
  BlockMeta,
  ComponentMeta,
  GlobalStateDef,
} from './types';

// ─── Path Builder ─────────────────────────────────────────────────────────────

/**
 * Builds the canonical path for a state key given its context.
 *
 * Rules:
 *   component alone       → "selectedValue"
 *   block context         → "block.selectedValue"         (block-scoped view)
 *   page > block > comp   → "page.blockInstanceId.selectedValue"
 */
export function buildStatePath(
  key: string,
  context: {
    componentId?: string;
    blockInstanceId?: string;
    pageId?: string;
  }
): StatePath {
  // Runtime state is global. A leaf component owns its namespace directly;
  // it never needs to know which Page or Block happens to render it.
  if (context.componentId) {
    return `global.components.${context.componentId}.${key}`;
  }
  if (context.blockInstanceId) {
    return `global.blocks.${context.blockInstanceId}.${key}`;
  }
  if (context.pageId) {
    return `global.pages.${context.pageId}.${key}`;
  }
  return `global.shared.${key}`;
}

export type StateContext = {
  componentId?: string;
  blockInstanceId?: string;
  pageId?: string;
};

function buildCandidatePaths(key: string, context: StateContext): StatePath[] {
  const candidates: StatePath[] = [];

  if (context.componentId) {
    candidates.push(`global.components.${context.componentId}.${key}`);
  }
  if (context.blockInstanceId) {
    candidates.push(`global.blocks.${context.blockInstanceId}.${key}`);
  }
  if (context.pageId) {
    candidates.push(`global.pages.${context.pageId}.${key}`);
  }
  candidates.push(`global.shared.${key}`);

  return candidates;
}

// ─── Central State Hub ────────────────────────────────────────────────────────

export class StateHub {
  /** Flat map of all state nodes keyed by their full path */
  private nodes = new Map<StatePath, StateNode>();

  /** Event subscriptions: eventName → list of handlers */
  private eventListeners = new Map<string, Set<EventHandler>>();

  /** Event history (last N events) */
  private eventLog: StateEvent[] = [];
  private maxLogSize = 200;

  /**
   * Per-path change listeners. Unlike `eventListeners` (which only fire for
   * events a node explicitly declares in `publishes`), these fire for ANY
   * value change on a path — this is what lets a consumer (e.g. a table
   * filtered by a dropdown) react to state without the producer having to
   * declare an event for it. Subscribing is allowed before the node exists,
   * so consumers can mount before the component that owns the state does.
   */
  private pathListeners = new Map<StatePath, Set<() => void>>();

  // ── Registration ────────────────────────────────────────────────────────────

  /**
   * Registers all state nodes for a component instance inside a block+page context.
   *
   * Called during page/block hydration.
   */
  registerComponentState(
    componentMeta: ComponentMeta,
    context: {
      componentId?: string;
      blockInstanceId: string;
      pageId: string;
    }
  ): void {
    const { state } = componentMeta;
    if (!state?.values) return;

    for (const [key, defaultValue] of Object.entries(state.values)) {
      const path = buildStatePath(key, {
        componentId: context.componentId ?? componentMeta.id,
        blockInstanceId: context.blockInstanceId,
        pageId: context.pageId,
      });

      this.nodes.set(path, {
        path,
        scope: 'component',
        key,
        value: defaultValue,
        publishedEvents: state.publishes ?? [],
        subscribedEvents: state.subscribes ?? [],
      });
    }
  }

  /**
   * Registers block-level state values.
   * Block state key path: "global.blocks.{blockInstanceId}.{key}"
   */
  registerBlockState(
    blockMeta: BlockMeta,
    context: { blockInstanceId: string; pageId: string }
  ): void {
    const { state } = blockMeta;
    if (!state?.values) return;

    for (const [key, defaultValue] of Object.entries(state.values)) {
      const path = buildStatePath(key, {
        blockInstanceId: context.blockInstanceId,
        pageId: context.pageId,
      });

      this.nodes.set(path, {
        path,
        scope: 'block',
        key,
        value: defaultValue,
        publishedEvents: state.publishes ?? [],
        subscribedEvents: state.subscribes ?? [],
      });
    }
  }

  /**
   * Registers page-level state values.
   * Page state key path: "global.pages.{pageId}.{key}"
   */
  registerPageState(pageMeta: PageMeta): void {
    const { state, id: pageId } = pageMeta;
    if (!state?.values) return;

    const subscribedEvents = 'subscribes' in state ? state.subscribes ?? [] : [];
    for (const [key, defaultValue] of Object.entries(state.values)) {
      const path = buildStatePath(key, { pageId });
      this.nodes.set(path, {
        path,
        scope: 'page',
        key,
        value: defaultValue,
        publishedEvents: state.publishes ?? [],
        subscribedEvents,
      });
    }
  }

  /**
   * Registers globally shared state values.
   * Global state key path: "global.{key}"
   */
  registerGlobalState(state: GlobalStateDef): void {
    if (!state?.values) return;

    for (const [key, defaultValue] of Object.entries(state.values)) {
      const path = `global.shared.${key}`;
      this.nodes.set(path, {
        path,
        scope: 'global',
        key,
        value: defaultValue,
        publishedEvents: state.publishes ?? [],
        subscribedEvents: state.subscribes ?? [],
      });
      this.notifyPath(path);
    }
  }

  // ── Hydration Helper ────────────────────────────────────────────────────────

  /**
   * Full hydration: given page metadata + resolved block/component metas,
   * registers everything in one call.
   *
   * blockRefsMap: { blockRefId → BlockMeta }
   * componentRefsMap: { componentRefId → ComponentMeta }
   */
  hydratePage(
    pageMeta: PageMeta,
    blockRefsMap: Record<string, BlockMeta>,
    componentRefsMap: Record<string, ComponentMeta>
  ): void {
    // 1. Page state
    this.registerPageState(pageMeta);

    // 2. Each block instance on the page
    for (const blockInstance of pageMeta.blocks ?? []) {
      const blockMeta = blockRefsMap[blockInstance.ref];
      if (!blockMeta) continue;

      const ctx = { blockInstanceId: blockInstance.id, pageId: pageMeta.id };

      // Block-level state
      this.registerBlockState(blockMeta, ctx);

      // 3. Each component instance within the block
      for (const compInstance of blockMeta.components ?? []) {
        const compMeta = componentRefsMap[compInstance.ref];
        if (!compMeta) continue;

        this.registerComponentState(compMeta, {
          ...ctx,
          componentId: compInstance.id,
        });
      }
    }
  }

  // ── Read / Write ────────────────────────────────────────────────────────────

  get(path: StatePath): unknown {
    return this.nodes.get(path)?.value;
  }

  getResolved(key: string, context: StateContext = {}): unknown {
    for (const path of buildCandidatePaths(key, context)) {
      const node = this.nodes.get(path);
      if (node) return node.value;
    }
    return undefined;
  }

  set(path: StatePath, value: unknown): void {
    const node = this.nodes.get(path);
    console.log('[StateHub] set', { path, value, existing: node?.value });
    if (!node) {
      console.warn(`[StateHub] set() – unknown path: "${path}"`);
      return;
    }
    const prev = node.value;
    node.value = value;

    // Fire any events this node publishes when its value changes
    if (prev !== value) {
      this.notifyPath(path);
      for (const eventName of node.publishedEvents) {
        this.emit(eventName, value, path);
      }
    }
  }

  setResolved(key: string, value: unknown, context: StateContext = {}): void {
    const candidates = buildCandidatePaths(key, context);
    const targetPath = candidates.find((path) => this.nodes.has(path)) ?? candidates[0];

    if (!this.nodes.has(targetPath)) {
      const scope: StateScope = context.componentId ? 'component' : context.blockInstanceId ? 'block' : context.pageId ? 'page' : 'global';
      this.nodes.set(targetPath, {
        path: targetPath,
        scope,
        key,
        value,
        publishedEvents: [],
        subscribedEvents: [],
      });
      this.notifyPath(targetPath);
      return;
    }

    this.set(targetPath, value);
  }

  /**
   * Patch multiple paths at once.
   */
  patch(updates: Record<StatePath, unknown>): void {
    for (const [path, value] of Object.entries(updates)) {
      this.set(path, value);
    }
  }

  // ── Snapshots ───────────────────────────────────────────────────────────────

  /**
   * Returns a snapshot of all state under a given path prefix.
   * e.g. getSubtree("customer-dashboard.customerSearch") returns everything
   * in the customerSearch block instance.
   */
  getSubtree(prefix: StatePath): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [path, node] of this.nodes) {
      if (path.startsWith(prefix)) {
        const relative = path.slice(prefix.length + 1); // strip prefix + dot
        result[relative] = node.value;
      }
    }
    return result;
  }

  /**
   * Full flat snapshot of the entire state hub.
   */
  snapshot(): Record<StatePath, unknown> {
    const out: Record<StatePath, unknown> = {};
    for (const [path, node] of this.nodes) {
      out[path] = node.value;
    }
    return out;
  }

  // ── Path subscriptions ──────────────────────────────────────────────────────

  /**
   * Calls `listener` whenever the value at `path` changes. Returns an
   * unsubscribe fn. Shaped to plug straight into React's useSyncExternalStore.
   */
  subscribe(path: StatePath, listener: () => void): () => void {
    let set = this.pathListeners.get(path);
    if (!set) {
      set = new Set();
      this.pathListeners.set(path, set);
    }
    set.add(listener);
    return () => {
      const current = this.pathListeners.get(path);
      current?.delete(listener);
      if (current && current.size === 0) this.pathListeners.delete(path);
    };
  }

  private notifyPath(path: StatePath): void {
    const listeners = this.pathListeners.get(path);
    if (!listeners) return;
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch (err) {
        console.error(`[StateHub] Error in path listener for "${path}":`, err);
      }
    }
  }

  // ── Event Bus ───────────────────────────────────────────────────────────────

  on(eventName: string, handler: EventHandler): () => void {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, new Set());
    }
    this.eventListeners.get(eventName)!.add(handler);

    // Return an unsubscribe fn
    return () => this.eventListeners.get(eventName)?.delete(handler);
  }

  emit(eventName: string, payload: unknown, sourcePath: StatePath): void {
    console.log('[StateHub] emit', { eventName, payload, sourcePath });
    const event: StateEvent = {
      eventName,
      sourcePath,
      payload,
      timestamp: Date.now(),
    };

    // Log
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxLogSize) this.eventLog.shift();

    // Dispatch
    const handlers = this.eventListeners.get(eventName);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload, sourcePath);
        } catch (err) {
          console.error(`[StateHub] Error in handler for "${eventName}":`, err);
        }
      }
    }
  }

  getEventLog(): StateEvent[] {
    return [...this.eventLog];
  }

  // ── Introspection ───────────────────────────────────────────────────────────

  getNode(path: StatePath): StateNode | undefined {
    return this.nodes.get(path);
  }

  /**
   * Removes a state node (used by useComponentState's unmount cleanup).
   * Path subscribers are notified so state-bound consumers (e.g. a filtered
   * table) fall back to "no value" when the producing component goes away.
   */
  removeNode(path: StatePath): void {
    if (!this.nodes.delete(path)) return;
    this.notifyPath(path);
  }

  getAllNodes(): StateNode[] {
    return Array.from(this.nodes.values());
  }

  getNodesByScope(scope: StateScope): StateNode[] {
    return this.getAllNodes().filter((n) => n.scope === scope);
  }

  /**
   * Returns all paths (useful for debugging / the DevTools panel).
   */
  getPaths(): StatePath[] {
    return Array.from(this.nodes.keys());
  }

  reset(): void {
    this.nodes.clear();
    this.eventListeners.clear();
    this.eventLog.length = 0;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
export const stateHub = new StateHub();