/**
 * domainViewConfig — per-domain "how should this domain be displayed"
 * settings (table / form / card-gallery), now owned by the page builder.
 *
 * This used to live in the Schema Inspector app as part of the
 * "Domain View Configuration" section on the Domain Model tab. It has been
 * moved here so it's configured in the same place the resulting views are
 * actually built and previewed.
 *
 * There is currently no `/datastore/*` backend endpoint for this data (the
 * Schema Inspector never persisted it server-side either — it only kept it
 * in in-memory/export state), so for now it's persisted to localStorage,
 * keyed per domain. Swap `loadDomainViewConfig` / `saveDomainViewConfig`
 * for real API calls once a backend endpoint exists.
 */

export interface DomainViewConfig {
  /** How domain instances (rows) are displayed in table/grid view */
  tableView?: {
    enabled: boolean;
    visibleFields?: string[]; // field ids to show (omit = all)
    sortable?: boolean;
    filterable?: boolean;
    searchable?: boolean;
    pageSize?: number;
  };
  /** How domain instances are displayed in form/edit view */
  formView?: {
    enabled: boolean;
    layout?: 'single' | 'two-column' | 'multi-column';
  };
  /** How domain instances are displayed in card/gallery view */
  cardView?: {
    enabled: boolean;
    titleField?: string;
    subtitleField?: string;
    imageField?: string;
  };
}

const STORAGE_PREFIX = 'skloide:pagebuilder:domain-view-config:';

function storageKey(domainName: string): string {
  return `${STORAGE_PREFIX}${domainName}`;
}

/** Read the saved view config for a domain, or `{}` if none has been saved yet. */
export function loadDomainViewConfig(domainName: string): DomainViewConfig {
  if (!domainName) return {};
  try {
    const raw = window.localStorage.getItem(storageKey(domainName));
    return raw ? (JSON.parse(raw) as DomainViewConfig) : {};
  } catch {
    return {};
  }
}

/** Persist the view config for a domain. Pass `{}` to clear it. */
export function saveDomainViewConfig(domainName: string, cfg: DomainViewConfig): void {
  if (!domainName) return;
  try {
    const isEmpty = !cfg || (!cfg.tableView && !cfg.formView && !cfg.cardView);
    if (isEmpty) {
      window.localStorage.removeItem(storageKey(domainName));
    } else {
      window.localStorage.setItem(storageKey(domainName), JSON.stringify(cfg));
    }
  } catch {
    // localStorage unavailable (e.g. private mode) — silently no-op, same
    // as the old Schema Inspector behaviour when export/save wasn't used.
  }
}

/** Move a saved config from one domain name to another (e.g. after a rename). */
export function renameDomainViewConfig(oldName: string, newName: string): void {
  if (!oldName || !newName || oldName === newName) return;
  const cfg = loadDomainViewConfig(oldName);
  if (cfg.tableView || cfg.formView || cfg.cardView) {
    saveDomainViewConfig(newName, cfg);
  }
  try {
    window.localStorage.removeItem(storageKey(oldName));
  } catch {
    // no-op
  }
}