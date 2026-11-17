/**
 * Applies the filter shape saved by sky-query-builder's QueryField
 * (see useQueryBuilder.formatOutput) against already-fetched rows, entirely
 * client-side. This is intentionally independent from the backend
 * `filter_tree` used by /query-builder/preview|execute — those endpoints
 * resolve joins across multiple domain objects, whereas a single ViewBuilder
 * component instance only ever has ONE dataSourceId, so evaluating the same
 * saved query in-memory against that instance's own rows is simpler and
 * avoids a network round trip on every keystroke/filter change.
 *
 * Shape produced by QueryField.handleSave / useQueryBuilder.formatOutput:
 *   {
 *     filters: {
 *       criteria: {
 *         conditions_group: [{ name, operator, conditions: Condition[] }],
 *         conditions_group_link: LinkNode
 *       }
 *     },
 *     _state: { groups, linkRoot }
 *   }
 */

type RawCondition = {
  column?: string;
  operator?: string;
  value?: any;
  type?: string;
  group?: { operator: string; conditions: RawCondition[] };
};

type RawGroup = {
  name: string;
  operator: string;
  conditions: RawCondition[];
};

type RawLinkNode = {
  type: 'group' | 'ref';
  operator?: 'AND' | 'OR';
  name?: string;
  children?: RawLinkNode[];
};

function coerce(value: any, type?: string): any {
  if (type === 'number') return Number(value);
  if (type === 'boolean') return value === true || value === 'true';
  return value;
}

function evalCondition(row: Record<string, any>, cond: RawCondition): boolean {
  if (cond.group) {
    return evalConditions(row, cond.group.conditions, cond.group.operator);
  }
  if (!cond.column) return true; // nothing to check against, don't exclude the row

  const rowValue = row[cond.column];
  const target = coerce(cond.value, cond.type);
  const op = (cond.operator || '=').toUpperCase();

  switch (op) {
    case '=':
      return String(rowValue ?? '').toLowerCase() === String(target ?? '').toLowerCase() || rowValue === target;
    case '!=':
      return rowValue !== target;
    case '>':
      return Number(rowValue) > Number(target);
    case '<':
      return Number(rowValue) < Number(target);
    case '>=':
      return Number(rowValue) >= Number(target);
    case '<=':
      return Number(rowValue) <= Number(target);
    case 'LIKE':
    case 'ILIKE':
      return String(rowValue ?? '').toLowerCase().includes(String(target ?? '').toLowerCase());
    case 'IN':
      return Array.isArray(target) ? target.includes(rowValue) : String(target).split(',').map(s => s.trim()).includes(String(rowValue));
    case 'NOT IN':
      return Array.isArray(target) ? !target.includes(rowValue) : !String(target).split(',').map(s => s.trim()).includes(String(rowValue));
    default:
      return true;
  }
}

function evalConditions(row: Record<string, any>, conditions: RawCondition[], operator = 'AND'): boolean {
  if (!conditions || conditions.length === 0) return true;
  if (operator === 'OR') return conditions.some((c) => evalCondition(row, c));
  return conditions.every((c) => evalCondition(row, c));
}

function evalLinkNode(row: Record<string, any>, node: RawLinkNode, groups: RawGroup[]): boolean {
  if (node.type === 'ref') {
    const group = groups.find((g) => g.name === node.name);
    if (!group) return true; // dangling ref, don't exclude
    return evalConditions(row, group.conditions, group.operator);
  }
  const children = node.children || [];
  if (children.length === 0) return true;
  if (node.operator === 'OR') return children.some((c) => evalLinkNode(row, c, groups));
  return children.every((c) => evalLinkNode(row, c, groups));
}

/**
 * Filters `rows` using a saved QueryField value. Returns all rows unchanged
 * if there's no usable query configured yet.
 */
export function applyQueryFilters(rows: Record<string, any>[], query: any): Record<string, any>[] {
  const criteria = query?.filters?.criteria;
  if (!criteria) return rows;

  const groups: RawGroup[] = criteria.conditions_group || []; 
  const link: RawLinkNode | undefined = criteria.conditions_group_link;

  const hasAnyCondition = groups.some((g) => (g.conditions || []).length > 0);
  if (!hasAnyCondition || !link) return rows;

  return rows.filter((row) => evalLinkNode(row, link, groups));
}