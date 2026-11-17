import { useEffect, useMemo, useState } from 'react';
import { fetchProjects, type Project } from '@/api/datastoreApi';

/** Value used in the project dropdown for tables that aren't in any project. */
export const NO_PROJECT = '__none__';

interface ScopedSource {
  id: string | number;
  project_id?: string | null;
}

export interface ProjectOption {
  value: string;
  label: string;
}

/** Projects are shared by every picker on the page, so fetch them once. */
let projectsPromise: Promise<Project[]> | null = null;
function loadProjectsOnce(): Promise<Project[]> {
  if (!projectsPromise) {
    projectsPromise = fetchProjects().catch((err) => {
      projectsPromise = null; // allow a retry on the next mount
      throw err;
    });
  }
  return projectsPromise;
}

/**
 * Project → Domain model scoping for the table pickers.
 *
 * Step 1 is choosing a project; step 2 (the table dropdown) then only lists
 * the tables that live in it. The component renders the two dropdowns; this
 * hook owns the state:
 *
 *  - `projectOptions` — every project, plus "No project" when some tables
 *    have none (so those tables stay reachable).
 *  - `projectId` — the chosen project. When nothing was picked yet but a
 *    table is already bound (a saved page), it's derived from that table so
 *    the existing selection is still visible and editable.
 *  - `scopedSources` — `sources` limited to `projectId` ([] until one is chosen).
 *
 * `resetKey` (optional): pass the selected block's id.
 *
 * Pass only the *table* sources — queries have no project and shouldn't be
 * filtered.
 */
export function useProjectScope<T extends ScopedSource>(
  sources: T[],
  selectedSourceId?: string | number | null,
  /** Changes when the picker is pointed at something else (e.g. another block) — drops the manual pick. */
  resetKey?: string | number | null,
) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadProjectsOnce()
      .then((p) => { if (!cancelled) setProjects(p); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? 'Failed to load projects'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // A manual pick only lasts until a table is chosen (the table's own project
  // takes over) or the picker is pointed at another block. Clearing the table
  // while switching project must NOT reset it, hence "non-null" only.
  useEffect(() => {
    if (selectedSourceId != null && selectedSourceId !== '') setPicked(null);
  }, [selectedSourceId]);
  useEffect(() => { setPicked(null); }, [resetKey]);

  const keyOf = (s: ScopedSource) => (s.project_id ? String(s.project_id) : NO_PROJECT);

  const hasUnassigned = useMemo(() => sources.some((s) => !s.project_id), [sources]);

  const projectOptions: ProjectOption[] = useMemo(() => {
    const opts = projects.map((p) => ({ value: p.id, label: p.name?.trim() || `Unnamed (${p.id})` }));
    if (hasUnassigned) opts.push({ value: NO_PROJECT, label: 'No project' });
    return opts;
  }, [projects, hasUnassigned]);

  // The project of the table that's already selected, if any.
  const derived = useMemo(() => {
    if (selectedSourceId == null || selectedSourceId === '') return null;
    const src = sources.find((s) => String(s.id) === String(selectedSourceId));
    return src ? keyOf(src) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, selectedSourceId]);

  const projectId = picked ?? derived;

  // If projects can't be loaded, don't lock the user out of their tables:
  // drop the project step and list every table like before.
  const enabled = !error;

  const scopedSources = useMemo(
    () => (!enabled ? sources : projectId ? sources.filter((s) => keyOf(s) === projectId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources, projectId, enabled],
  );

  return {
    projectOptions,
    projectId,
    setProjectId: setPicked,
    scopedSources,
    /** false when projects failed to load — the UI then skips the project step. */
    enabled,
    loading,
    error,
  };
}