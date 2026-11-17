// Client renderer shell.
//   /p/<slug>  -> the published page with that slug
//   /          -> VITE_DEFAULT_PAGE (if set), otherwise a short hint
//
// Theme: same dark tokens the builder app uses, so a page looks identical
// here and in the builder's Live Preview.
import { useEffect, useState, type CSSProperties } from 'react';
import { LanguageProvider } from '@/sky-view-builder/hooks/useFieldTranslations';
import { PageViewer } from '@/pages/PageViewer';

const DARK_THEME_VARS = {
  '--background': 'oklch(0.181 0.0183 259.6809)',
  '--foreground': 'oklch(0.9842 0.0034 247.8575)',
  '--card': 'oklch(0.181 0.0183 259.6809)',
  '--card-foreground': 'oklch(0.9842 0.0034 247.8575)',
  '--popover': 'oklch(0.181 0.0183 259.6809)',
  '--popover-foreground': 'oklch(0.9842 0.0034 247.8575)',
  '--primary': 'oklch(0.739 0.1118 158.4443)',
  '--primary-foreground': 'oklch(0.181 0.0183 259.6809)',
  '--secondary': 'oklch(0.3025 0.0578 256.0697)',
  '--secondary-foreground': 'oklch(0.9842 0.0034 247.8575)',
  '--muted': 'oklch(0.2795 0.0368 260.031)',
  '--muted-foreground': 'oklch(0.7107 0.0351 256.7878)',
  '--accent': 'oklch(0.3025 0.0578 256.0697)',
  '--accent-foreground': 'oklch(0.739 0.1118 158.4443)',
  '--destructive': 'oklch(0.673 0.2146 25.0397)',
  '--destructive-foreground': 'oklch(1 0 0)',
  '--border': 'oklch(0.2795 0.0368 260.031)',
  '--input': 'oklch(0.2795 0.0368 260.031)',
  '--ring': 'oklch(0.739 0.1118 158.4443)',
} as CSSProperties;

function slugFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/p\/([^/]+)\/?$/);
  if (m) return decodeURIComponent(m[1]);
  if (pathname === '/' || pathname === '') return import.meta.env.VITE_DEFAULT_PAGE || null;
  return null;
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const slug = slugFromPath(path);

  // Sign-in is requested by the page itself: the backend says whether the
  // page is public, for any signed-in user, or for selected users/roles.
  return (
    <LanguageProvider>
      <div className="dark h-screen w-full bg-background text-foreground" style={DARK_THEME_VARS}>
        {slug ? (
          <PageViewer key={slug} slug={slug} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
            <h1 className="text-lg font-bold">Nothing to show here</h1>
            <p className="text-sm text-muted-foreground">Open a published page at <code>/p/&lt;page-slug&gt;</code>.</p>
          </div>
        )}
      </div>
    </LanguageProvider>
  );
}