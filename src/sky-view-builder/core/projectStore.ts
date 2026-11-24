import { useEffect, useState } from 'react';
import { fetchProjects, type Project } from '../../api/datastoreApi';

// ─── Current project (top-nav selector) ─────────────────────────────────────
// One module-level value shared by everything in the builder:
//   • the Project selector in the top nav writes it,
//   • Saved Blocks (Toolbar) only lists templates of this project,
//   • the Save dialog / Publish dialog default to it, so whatever the user
//     saves lands under this project.
// `null` = "All projects" (no filtering, saves go to "No project" unless the
// dialog says otherwise). The choice is remembered in localStorage.

const STORAGE_KEY = 'svb_current_project';
const CHANGE_EVENT = 'skiode-current-project-changed';

function readStored(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function writeStored(id: string | null) {
  try { id ? localStorage.setItem(STORAGE_KEY, id) : localStorage.removeItem(STORAGE_KEY); } catch { /* storage blocked */ }
}

let currentProjectId: string | null = readStored();
let projectsCache: Project[] = [];
let projectsLoaded = false;
let projectsError: string | null = null;
let loadingPromise: Promise<void> | null = null;

function notify() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function ensureProjectsLoaded(): Promise<void> {
  if (projectsLoaded) return Promise.resolve();
  if (loadingPromise) return loadingPromise;
  loadingPromise = fetchProjects()
    .then((list) => {
      projectsCache = list;
      projectsLoaded = true;
      projectsError = null;
      // A remembered project that no longer exists (or the user lost access to) is dropped.
      if (currentProjectId && !list.some((p) => String(p.id) === currentProjectId)) {
        currentProjectId = null;
        writeStored(null);
      }
      // Only one project available: just use it.
      if (!currentProjectId && list.length === 1) {
        currentProjectId = String(list[0].id);
        writeStored(currentProjectId);
      }
    })
    .catch((e) => {
      projectsError = e?.message ?? 'Could not load projects';
    })
    .finally(() => {
      loadingPromise = null;
      notify();
    });
  return loadingPromise;
}

export function getCurrentProjectId(): string | null {
  return currentProjectId;
}

export function setCurrentProjectId(id: string | null): void {
  currentProjectId = id;
  writeStored(id);
  notify();
}

/** Live view of the project list + the selected project. */
export function useCurrentProject() {
  const [, bump] = useState(0);

  useEffect(() => {
    const handler = () => bump((v) => v + 1);
    window.addEventListener(CHANGE_EVENT, handler);
    ensureProjectsLoaded();
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);

  const project = currentProjectId
    ? projectsCache.find((p) => String(p.id) === currentProjectId) ?? null
    : null;

  return {
    projects: projectsCache,
    /** Selected project id, or null for "All projects". */
    projectId: currentProjectId,
    project,
    setProjectId: setCurrentProjectId,
    loading: !projectsLoaded && !projectsError,
    error: projectsError,
  };
}