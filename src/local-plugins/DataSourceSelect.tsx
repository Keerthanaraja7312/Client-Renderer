import { useEffect, useState } from 'react';
import { fetchAvailableDataSources, type DataSource } from '@/api/datastoreApi';
import { useProjectScope } from '@/sky-view-builder/hooks/useProjectScope';

// ─── Reusable "table picker" for settings fields ───────────────────────────
// Any SettingFieldDefinition can set `component: DataSourceSelect` to get a
// real dropdown of existing tables instead of a free-text input — same list
// of tables (fetchAvailableDataSources -> GET /datastore/schemas) that backs
// the built-in "Primary Data Source" picker in the Data Context section, so
// you can only ever pick a table that actually exists.

export function DataSourceSelect({
  value,
  onChange,
}: {
  value: any;
  onChange: (val: any) => void;
}) {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAvailableDataSources()
      .then((data) => {
        if (!cancelled) setSources(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? 'Failed to load tables');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Project → Domain model: pick a project first, then only its tables are listed.
  const projectScope = useProjectScope(sources, value);

  return (
    <div className="space-y-1.5">
      {(projectScope.enabled || projectScope.loading) && (
      <div className="relative">
        <select
          className="w-full bg-secondary border border-border rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none appearance-none cursor-pointer transition-all disabled:opacity-50"
          value={projectScope.projectId ?? ''}
          disabled={loading || projectScope.loading}
          onChange={(e) => {
            const next = e.target.value || null;
            projectScope.setProjectId(next);
            if (next !== projectScope.projectId && value) onChange('');
          }}
        >
          <option value="">{projectScope.loading ? 'Loading projects…' : 'Select Project...'}</option>
          {projectScope.projectOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground/60">
          ↓
        </div>
      </div>
      )}
      <div className="relative">
        <select
          className="w-full bg-secondary border border-border rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none appearance-none cursor-pointer transition-all disabled:opacity-50"
          value={value || ''}
          disabled={loading || (projectScope.enabled && !projectScope.projectId)}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">
            {loading ? 'Loading tables…' : projectScope.enabled && !projectScope.projectId ? 'Select a project first...' : 'Select Table/Source...'}
          </option>
          {projectScope.scopedSources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label?.trim() || s.name}
            </option>
          ))}
        </select>
        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground/60">
          ↓
        </div>
      </div>
      {(error || projectScope.error) && <p className="text-[10px] text-destructive">{error ?? `${projectScope.error} Showing all tables.`}</p>}
    </div>
  );
}