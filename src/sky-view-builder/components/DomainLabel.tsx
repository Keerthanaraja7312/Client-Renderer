import { useEffect, useState } from 'react';
import { fetchAllSchemas } from '@/api/datastoreApi';

// table_name → business label, fetched once and shared by every <DomainLabel/>.
// Lookup is case-insensitive because some callers only have a derived name
// (e.g. "clinic" from the field "clinicId" while the table is "Clinic").
let cache: Record<string, string> | null = null;
let pending: Promise<Record<string, string>> | null = null;

function loadLabels(): Promise<Record<string, string>> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = fetchAllSchemas()
      .then((res) => {
        const map: Record<string, string> = {};
        for (const s of res.schemas ?? []) {
          const label = s.label?.trim();
          if (label) map[s.table_name.toLowerCase()] = label;
        }
        cache = map;
        return map;
      })
      .catch(() => {
        pending = null; // allow a retry on the next mount
        return {} as Record<string, string>;
      });
  }
  return pending;
}

/** Call after a domain is created / renamed so dropdowns pick up the new label. */
export function invalidateDomainLabels() {
  cache = null;
  pending = null;
}

/** The domain's business label, or the name itself while loading / when it has none. */
export function useDomainLabel(name: string | null | undefined): string {
  const key = (name ?? '').toLowerCase();
  const [label, setLabel] = useState<string>(() => (cache && cache[key]) || name || '');
  useEffect(() => {
    let cancelled = false;
    loadLabels().then((m) => { if (!cancelled) setLabel(m[key] || name || ''); });
    return () => { cancelled = true; };
  }, [key, name]);
  return label;
}

/** Drop-in for printing a domain name in JSX: <DomainLabel name={domain} /> */
export function DomainLabel({ name }: { name: string | null | undefined }) {
  return <>{useDomainLabel(name)}</>;
}