// ─── Scope Levels ─────────────────────────────────────────────────────────────

export type StateScope = 'component' | 'block' | 'page' | 'global';

// ─── Metadata Definitions ─────────────────────────────────────────────────────

export interface ComponentStateDef {
  scope: 'component';
  values: Record<string, unknown>;
  publishes?: string[];
  subscribes?: string[];
}

export interface BlockStateDef {
  scope: 'block';
  values: Record<string, unknown>;
  publishes?: string[];
  subscribes?: string[];
}

export interface PageStateDef {
  scope: 'page';
  values: Record<string, unknown>;
  publishes?: string[];
  subscribes?: string[];
}

export interface GlobalStateDef {
  scope: 'global';
  values: Record<string, unknown>;
  publishes?: string[];
  subscribes?: string[];
}

// ─── Metadata Schemas (from your JSON) ────────────────────────────────────────

export interface ComponentMeta {
  id: string;
  type?: string;
  state?: ComponentStateDef | GlobalStateDef;
  [key: string]: unknown;
}

export interface BlockMeta {
  id: string;
  state?: BlockStateDef | GlobalStateDef;
  components?: Array<{ id: string; ref: string }>;
  [key: string]: unknown;
}

export interface PageMeta {
  id: string;
  state?: PageStateDef | GlobalStateDef;
  blocks?: Array<{ id: string; ref: string }>;
  [key: string]: unknown;
}

// ─── Runtime State Path ───────────────────────────────────────────────────────
//
//  Component alone:  component.selectedValue
//  Block context:    block.country                 (block.{componentStateKey})
//  Page context:     page.customerSearch.country   (page.{blockInstanceId}.{componentStateKey})
//
// When a block is reused (e.g. "customerSearch" and "supplierSearch" both ref "search-block"),
// each gets its OWN isolated state namespace under the page:
//   page.customerSearch.country
//   page.supplierSearch.country

export type StatePath = string; // e.g. "page.customerSearch.country"

// ─── State Node ───────────────────────────────────────────────────────────────

export interface StateNode {
  /** Fully-qualified path: "page.customerSearch.country" */
  path: StatePath;
  scope: StateScope;
  /** The raw state key from the metadata (e.g. "selectedValue") */
  key: string;
  value: unknown;
  /** Which paths this node publishes events to */
  publishedEvents: string[];
  /** Which events this node subscribes to */
  subscribedEvents: string[];
}

// ─── Event Bus ────────────────────────────────────────────────────────────────

export type EventHandler = (payload: unknown, sourcePath: StatePath) => void;

export interface StateEvent {
  eventName: string;
  sourcePath: StatePath;
  payload: unknown;
  timestamp: number;
}