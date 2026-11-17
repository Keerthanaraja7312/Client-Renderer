/**
 * State-bound filters
 * ───────────────────
 * A "state filter" says: keep only the rows where <column> <operator> <the
 * current value of a state variable>. The state variable is whatever another
 * component publishes to the hub — e.g. a Dropdown writing its selection to
 * `global.shared.<hubKey>`.
 *
 *   Dropdown (hubKey "clinic")  ──►  hub: global.shared.clinic  ──►  Table
 *                                                      filter: clinic_id = {clinic}
 *
 * This file is pure (no React, no hub) so it is trivially testable. The React
 * wiring lives in useStateFilteredRows.ts.
 */

export type StateFilterOperator =
  | '='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'LIKE'
  | 'IN'
  | 'NOT IN';

export const STATE_FILTER_OPERATORS: StateFilterOperator[] = [
  '=',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  'LIKE',
  'IN',
  'NOT IN',
];

/**
 * What to do while the bound state variable has no value yet (nothing
 * selected in the dropdown):
 *   'ignore' → skip this filter, so rows are not narrowed (show everything)
 *   'noRows' → treat the filter as unmet and show no rows until a value exists
 */
export type StateFilterWhenEmpty = 'ignore' | 'noRows';

export interface StateFilter {
  id: string;
  /** Row field to compare, e.g. "clinic_id" */
  column: string;
  operator: StateFilterOperator;
  /** State variable name, e.g. a Dropdown's hubKey ("clinic") */
  stateKey: string;
  /**
   * Optional. When the state variable is a whole record (a Dropdown publishes
   * its selected row), compare against ONE field of that record instead of the
   * dropdown's value. This is how a Book dropdown can drive an Author table:
   *   Author.id = {book}.authorId
   */
  stateField?: string;
  whenEmpty?: StateFilterWhenEmpty;
}

/** Hub path that holds the full selected record for a shared state key. */
export function sharedRowPath(stateKey: string): string {
  return `${sharedStatePath(stateKey)}__row`;
}

/** Unique id for a (stateKey, stateField) pair — used as the values-map key. */
export function stateBindingId(f: { stateKey: string; stateField?: string }): string {
  return f.stateField ? `${f.stateKey}::${f.stateField}` : f.stateKey;
}

/** Hub path a filter reads from. */
export function filterStatePath(f: { stateKey: string; stateField?: string }): string {
  return f.stateField ? sharedRowPath(f.stateKey) : sharedStatePath(f.stateKey);
}

/** Pulls the compared value out of what the hub returned for `filterStatePath`. */
export function resolveFilterValue(f: { stateField?: string }, raw: unknown): unknown {
  if (!f.stateField) return raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return (raw as Record<string, unknown>)[f.stateField];
  return undefined;
}

/** A filter is only active once both ends are chosen. */
export function isActiveStateFilter(f: Partial<StateFilter> | null | undefined): f is StateFilter {
  return !!f && !!f.column && !!f.stateKey;
}

/**
 * Resolves a state variable name to its hub path. Bare names are shared
 * (global) state — the same convention the Dropdown uses for its hubKey.
 * A fully-qualified path ("global.components.abc.selectedValue") is used as-is.
 */
export function sharedStatePath(stateKey: string): string {
  return stateKey.startsWith('global.') ? stateKey : `global.shared.${stateKey}`;
}

export function isEmptyStateValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

// ── Matching ──────────────────────────────────────────────────────────────

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

// Dropdown values are always strings ("3") while row values may be numbers (3),
// so equality is compared on the normalised string form.
const looseEquals = (a: unknown, b: unknown) => norm(a) === norm(b);

function toList(target: unknown): unknown[] {
  if (Array.isArray(target)) return target;
  return String(target ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function compare(a: unknown, b: unknown): number {
  const na = Number(a);
  const nb = Number(b);
  const bothNumeric =
    String(a ?? '').trim() !== '' && String(b ?? '').trim() !== '' && Number.isFinite(na) && Number.isFinite(nb);
  if (bothNumeric) return na - nb;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

export function matchesStateFilter(row: Record<string, any>, filter: StateFilter, stateValue: unknown): boolean {
  const cell = row?.[filter.column];

  switch (filter.operator) {
    case '=':
      // An array-valued state (multi-select) means "equals any of".
      return Array.isArray(stateValue) ? stateValue.some((v) => looseEquals(cell, v)) : looseEquals(cell, stateValue);
    case '!=':
      return Array.isArray(stateValue) ? !stateValue.some((v) => looseEquals(cell, v)) : !looseEquals(cell, stateValue);
    case '>':
      return compare(cell, stateValue) > 0;
    case '<':
      return compare(cell, stateValue) < 0;
    case '>=':
      return compare(cell, stateValue) >= 0;
    case '<=':
      return compare(cell, stateValue) <= 0;
    case 'LIKE':
      return norm(cell).includes(norm(stateValue));
    case 'IN':
      return toList(stateValue).some((v) => looseEquals(cell, v));
    case 'NOT IN':
      return !toList(stateValue).some((v) => looseEquals(cell, v));
    default:
      return true;
  }
}

export interface StateFilterResult<T> {
  rows: T[];
  /** State keys that are still empty AND marked `whenEmpty: 'noRows'` — i.e. what the user still has to pick. */
  pending: string[];
}

/**
 * Applies every active filter (AND-ed) against already-fetched rows.
 * `values` maps stateKey → current value.
 *
 * Returns the SAME `rows` array reference when nothing narrows it, so
 * downstream useMemo/React.memo checks stay cheap.
 */
export function applyStateFilters<T extends Record<string, any>>(
  rows: T[],
  filters: Array<Partial<StateFilter>> | null | undefined,
  values: Record<string, unknown>
): StateFilterResult<T> {
  const active = (filters ?? []).filter(isActiveStateFilter);
  if (active.length === 0) return { rows, pending: [] };

  const pending: string[] = [];
  const live: Array<{ filter: StateFilter; value: unknown }> = [];

  for (const filter of active) {
    const value = values[stateBindingId(filter)];
    if (isEmptyStateValue(value)) {
      if (filter.whenEmpty === 'noRows' && !pending.includes(filter.stateKey)) pending.push(filter.stateKey);
      continue; // 'ignore' (default): this filter doesn't narrow anything yet
    }
    live.push({ filter, value });
  }

  if (pending.length > 0) return { rows: [], pending };
  if (live.length === 0) return { rows, pending: [] };

  return {
    rows: rows.filter((row) => live.every(({ filter, value }) => matchesStateFilter(row, filter, value))),
    pending: [],
  };
}