import { useEffect, useMemo, useState } from 'react';
import { LogOut, ShieldAlert } from 'lucide-react';
import { Canvas } from '@/sky-view-builder/ui/Canvas';
import { registerLocalPlugins } from '@/client/registerPlugins';
import type { ComponentInstance } from '@/sky-view-builder/core/plugin';
import { parsePageDocument, seedDocumentTemplates, type PageDocument } from '@/sky-view-builder/core/pageDocument';
import { StateHubProvider } from '@/store/StateHubContext';
import { stateHub } from '@/store/StateHub';
import { DataProvider } from '@/data/DataProvider';
import { fetchPublishedPage, ApiError, type PublishedPage } from '@/api/pagesApi';
import { clearToken, getToken } from '@/api/authApi';
import { describeAuth, refreshAuthContext } from '@/lib/permissions';
import { LoginScreen } from '@/pages/LoginScreen';
import { Button } from '@/components/ui/button';

// Registers every plugin in src/local-plugins (same discovery the builder uses).
registerLocalPlugins();

const noop = () => {};

type Load =
  | { state: 'loading' }
  | { state: 'login'; hadToken: boolean }
  | { state: 'forbidden' }
  | { state: 'error'; message: string; notFound: boolean }
  | { state: 'ready'; page: PublishedPage; doc: PageDocument };

/**
 * Renders one published page exactly like the builder's "Live Preview".
 * Who may see it is decided by the backend (page access setting):
 *   401 -> show the sign-in screen, 403 -> "no access" screen.
 */
export function PageViewer({ slug }: { slug: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0); // bump to refetch after sign-in / sign-out

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: 'loading' });
    fetchPublishedPage(slug)
      .then(async (page) => {
        // Pick up role/permission changes made in the RBAC screens since login.
        await refreshAuthContext(getToken());
        if (cancelled) return;
        const doc = parsePageDocument(page.document);
        // Saved Pages that sidebar menu items open travel inside the document.
        seedDocumentTemplates(doc, true);
        // Fresh state for this page (the hub is a module-level singleton).
        stateHub.reset();
        setLoad({ state: 'ready', page, doc });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setLoad({ state: 'login', hadToken: !!getToken() });
        } else if (err instanceof ApiError && err.status === 403) {
          setLoad({ state: 'forbidden' });
        } else {
          setLoad({
            state: 'error',
            message: err?.message ?? 'Could not load this page.',
            notFound: err instanceof ApiError && err.status === 404,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, attempt]);

  const refetch = () => setAttempt((n) => n + 1);
  const signOut = () => {
    clearToken();
    refetch();
  };

  if (load.state === 'loading') {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading...</div>;
  }
  if (load.state === 'login') {
    return (
      <LoginScreen
        onLoggedIn={refetch}
        pageSlug={slug}
        notice={load.hadToken ? 'Your session has expired. Sign in again to view this page.' : 'Sign in to view this page.'}
      />
    );
  }
  if (load.state === 'forbidden') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <ShieldAlert className="h-8 w-8 text-destructive" />
        <h1 className="text-lg font-bold">You don't have access to this page</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Your account isn't on the list of people allowed to view it. Ask the page owner to give you access,
          or sign in with a different account.
        </p>
        <Button variant="outline" onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" /> Sign in with a different account
        </Button>
      </div>
    );
  }
  if (load.state === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
        <h1 className="text-lg font-bold">{load.notFound ? 'Page not found' : 'Could not load this page'}</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {load.notFound ? `There is no published page called "${slug}".` : load.message}
        </p>
      </div>
    );
  }
  return (
    <>
      <PublishedView key={`${load.page.slug}@${load.page.version}`} doc={load.doc} title={load.page.title} />
      {new URLSearchParams(window.location.search).get('debug') === 'perms' && (
        <pre className="fixed bottom-14 right-3 z-50 max-h-72 max-w-sm overflow-auto rounded-md border border-border bg-card p-2 text-[10px] text-foreground shadow-md">
          {describeAuth()}
        </pre>
      )}
      {getToken() && (
        <button
          onClick={signOut}
          title="Sign out"
          aria-label="Sign out"
          className="fixed bottom-3 right-3 z-50 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-md hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
        </button>
      )}
    </>
  );
}

function PublishedView({ doc, title }: { doc: PageDocument; title: string }) {
  // Plugins may write back into their own configs at runtime (updateConfigs);
  // keep that in local state, exactly like the builder's preview does.
  const [instances, setInstances] = useState<ComponentInstance[]>(doc.instances);
  const layouts = useMemo(() => doc.layouts, [doc]);

  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <DataProvider>
      <StateHubProvider hub={stateHub}>
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
          <Canvas
            instances={instances}
            layouts={layouts}
            isPreview
            selectedId={null}
            onSelect={noop}
            onDelete={noop}
            onChange={setInstances}
            onLayoutChange={noop}
          />
        </div>
      </StateHubProvider>
    </DataProvider>
  );
}