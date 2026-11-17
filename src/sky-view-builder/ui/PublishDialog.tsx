import React, { useEffect, useMemo, useState } from 'react';
import { Rocket, FolderOpen, Save, ExternalLink, Loader2, Copy, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { ComponentInstance } from '../index';
import { buildPageDocument, parsePageDocument, seedDocumentTemplates } from '../core/pageDocument';
import {
  fetchPageForEditing,
  listPages,
  publishPage,
  savePageDraft,
  type PageSummary,
} from '../../api/pagesApi';
import { fetchProjects, type Project } from '../../api/datastoreApi';

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const toSlug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);

/** Base URL of the client renderer app. Set VITE_CLIENT_URL in production;
 *  in development it falls back to this host on port 5173 (change if your client runs elsewhere). */
const CLIENT_URL = (
  (import.meta.env.VITE_CLIENT_URL as string | undefined) ||
  `${window.location.protocol}//${window.location.hostname}:5173`
).replace(/\/$/, '');

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instances: ComponentInstance[];
  layouts: any;
  /** Replace the canvas with a page opened from the server. */
  onLoad: (instances: ComponentInstance[], layouts: any) => void;
  /** Slug the canvas is currently bound to (set after Open / first Save). */
  slug: string;
  onSlugChange: (slug: string) => void;
  /** Suggested title/slug when none is set yet (e.g. the first Page's title). */
  suggestedTitle?: string;
}

export const PublishDialog: React.FC<Props> = ({
  open, onOpenChange, instances, layouts, onLoad, slug, onSlugChange, suggestedTitle,
}) => {
  const [title, setTitle] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<null | 'draft' | 'publish' | 'open'>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    setTitle((t) => t || suggestedTitle || '');
    if (!slug && suggestedTitle) onSlugChange(toSlug(suggestedTitle));
    setPages(null);
    setPagesError(null);
    listPages().then(setPages).catch((e) => setPagesError(e?.message ?? 'Could not load pages'));
    setProjectsError(null);
    fetchProjects()
      .then((list) => {
        setProjects(list);
        // Only one project available: pick it automatically.
        if (list.length === 1) setProjectId((id) => id || String(list[0].id));
      })
      .catch((e) => {
        setProjects([]);
        setProjectsError(e?.message ?? 'Could not load projects');
      });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const slugOk = SLUG_RE.test(slug);
  const nothingToSave = instances.length === 0;
  const noProject = !projectId;
  const liveUrl = useMemo(() => (slugOk ? `${CLIENT_URL}/p/${slug}` : null), [slugOk, slug]);

  const copyLink = async () => {
    if (!liveUrl) return;
    try {
      await navigator.clipboard.writeText(liveUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the link is still selectable in the box */
    }
  };

  const save = async (): Promise<boolean> => {
    const { document, missingTemplates } = buildPageDocument(instances, layouts);
    await savePageDraft(slug, {
      title: title.trim() || slug,
      document,
      label: label.trim() || undefined,
      project_id: projectId ? Number(projectId) : undefined,
    });
    if (missingTemplates.length) {
      setMsg({
        ok: false,
        text: `Saved, but ${missingTemplates.length} saved page(s) linked from a sidebar could not be found (ids: ${missingTemplates.join(', ')}). Those menu items will be empty in the client.`,
      });
      return false;
    }
    return true;
  };

  const run = async (kind: 'draft' | 'publish') => {
    setBusy(kind);
    setMsg(null);
    try {
      const clean = await save();
      if (kind === 'publish') {
        const row = await publishPage(slug);
        setMsg({ ok: clean, text: `Published version ${row.version}${clean ? '.' : ' (with warnings above).'}` });
      } else if (clean) {
        setMsg({ ok: true, text: 'Draft saved.' });
      }
      listPages().then(setPages).catch(() => {});
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? 'Failed.' });
    } finally {
      setBusy(null);
    }
  };

  const openPage = async (p: PageSummary) => {
    setBusy('open');
    setMsg(null);
    try {
      const row = await fetchPageForEditing(p.slug);
      const doc = parsePageDocument(row.document);
      seedDocumentTemplates(doc);
      onLoad(doc.instances, doc.layouts);
      onSlugChange(p.slug);
      setTitle(p.title);
      setProjectId(p.project_id != null ? String(p.project_id) : '');
      setMsg({ ok: true, text: `Opened "${p.title}" (${row.status} v${row.version}).` });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? 'Could not open page.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" /> Save &amp; publish to client
          </DialogTitle>
          <DialogDescription>
            Stores the whole canvas (all pages, blocks, components, actions and layout). The client app shows the
            <b> published</b> version at <code>{liveUrl ?? `/p/${slug || 'your-slug'}`}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Customer dashboard" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">URL name (slug)</label>
            <Input
              value={slug}
              onChange={(e) => onSlugChange(toSlug(e.target.value))}
              placeholder="customer-dashboard"
            />
            {slug && !slugOk && <p className="text-[11px] text-destructive">Use lowercase letters, numbers, - or _.</p>}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Project</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">
                {projectsError ? 'Could not load projects' : projects.length ? 'Select a project...' : 'No projects found'}
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {projectsError && <p className="text-[11px] text-destructive">{projectsError}</p>}
            <p className="text-[11px] text-muted-foreground">Only users added to this project can sign in to the page.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Page link (client app)</label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={liveUrl ?? ''}
                placeholder="Enter a URL name to see the link"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button type="button" variant="outline" disabled={!liveUrl} onClick={copyLink} title="Copy link">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Works after you click Publish.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Version note (optional)</label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Added KPI row" />
          </div>
          {nothingToSave && <p className="text-[11px] text-destructive">The canvas is empty - add a Page first.</p>}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <FolderOpen className="h-3.5 w-3.5" /> Open an existing page
          </div>
          <div className="max-h-36 overflow-auto rounded-lg border border-border">
            {pagesError && <p className="p-2 text-[11px] text-destructive">{pagesError}</p>}
            {!pagesError && pages === null && <p className="p-2 text-[11px] text-muted-foreground">Loading...</p>}
            {pages?.length === 0 && <p className="p-2 text-[11px] text-muted-foreground">No pages yet.</p>}
            {pages?.map((p) => (
              <button
                key={p.slug}
                type="button"
                disabled={busy !== null}
                onClick={() => openPage(p)}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-secondary/60 disabled:opacity-50"
              >
                <span className="truncate">{p.title} <span className="text-muted-foreground">/{p.slug}</span></span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {p.published_version ? `live v${p.published_version}` : 'unpublished'}{p.has_draft ? ' + draft' : ''}
                </span>
              </button>
            ))}
          </div>
        </div>

        {msg && <p className={`text-sm ${msg.ok ? 'text-green-600' : 'text-destructive'}`}>{msg.text}</p>}
        {msg?.ok && liveUrl && (
          <a href={liveUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
            <ExternalLink className="h-3.5 w-3.5" /> View live: {liveUrl}
          </a>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" disabled={!slugOk || nothingToSave || noProject || busy !== null} onClick={() => run('draft')}>
            {busy === 'draft' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save draft
          </Button>
          <Button type="button" disabled={!slugOk || nothingToSave || noProject || busy !== null} onClick={() => run('publish')}>
            {busy === 'publish' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />} Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};