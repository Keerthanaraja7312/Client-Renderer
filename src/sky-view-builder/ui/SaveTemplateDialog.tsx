import React, { useEffect, useState } from 'react';
import { BookmarkPlus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { registry, type ComponentInstance } from '../index';
import { saveTemplate, updateTemplate, getSourceTemplate } from '../core/templateStore';

/** Counts every Block/Component nested anywhere inside an instance. */
export function countNested(inst: any): number {
  let n = 0;
  const walk = (i: any) => {
    for (const b of i?.configs?.blocks ?? []) { n++; walk(b); }
    for (const c of i?.configs?.components ?? []) { n++; walk(c); }
  };
  walk(inst);
  return n;
}

const LABEL_KEYS = ['label', 'title', 'heading', 'pageName', 'name', 'text'];

/**
 * Name pre-filled in the Save dialog: the item's own label/title when it has
 * one, otherwise the component type's default name (e.g. "Page", "Block").
 */
export function getDefaultTemplateName(inst: ComponentInstance | null | undefined): string {
  if (!inst) return 'My Block';
  for (const key of LABEL_KEYS) {
    const v = inst.configs?.[key];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 80);
  }
  return registry.getPlugin(inst.pluginId)?.toolbar.name || 'My Block';
}

interface Props {
  instance: ComponentInstance | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (name: string, mode: 'new' | 'update') => void;
  onError?: () => void;
}

export const SaveTemplateDialog: React.FC<Props> = ({ instance, open, onOpenChange, onSaved, onError }) => {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'new' | 'update'>('new');

  // If this item came from a saved block (dragged out of Saved Blocks, or
  // opened with its Edit button), Save should REPLACE that block by default.
  const source = open ? getSourceTemplate(instance) : null;

  // Re-seed the fields every time the dialog opens (or the selection changes).
  useEffect(() => {
    if (!open) return;
    const src = getSourceTemplate(instance);
    setMode(src ? 'update' : 'new');
    setName(src ? src.name : getDefaultTemplateName(instance));
  }, [open, instance?.id]);

  if (!instance) return null;
  const what = registry.getPlugin(instance.pluginId)?.toolbar.name ?? 'item';
  const nested = countNested(instance);
  const scope = nested > 0
    ? `Saves this ${what} together with everything inside it (${nested} nested item${nested === 1 ? '' : 's'}).`
    : `Saves just this ${what}.`;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const finalName = name.trim() || getDefaultTemplateName(instance);
    try {
      if (source && mode === 'update') {
        await updateTemplate(source.id, instance, finalName);
      } else {
        await Promise.resolve(saveTemplate(finalName, instance));
      }
      onOpenChange(false);
      onSaved?.(finalName, source && mode === 'update' ? 'update' : 'new');
    } catch (err) {
      console.error('Failed to save template', err);
      onError?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookmarkPlus className="h-4 w-4 text-primary" /> {source ? 'Save changes' : 'Save as reusable'}
            </DialogTitle>
            <DialogDescription>
              {source && mode === 'update'
                ? `This ${what} came from the saved block “${source.name}”. Saving replaces that block with your changes.`
                : `${scope} Find it later in the Saved Blocks tab and drag it into any page.`}
            </DialogDescription>
          </DialogHeader>
          {source && (
            <div className="space-y-1.5" role="radiogroup" aria-label="How to save">
              {([
                ['update', `Replace “${source.name}”`, 'Overwrites the saved block — no duplicate is created.'],
                ['new', 'Save as a new block', 'Keeps the original and adds a separate copy.'],
              ] as const).map(([value, title, hint]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm transition-colors ${mode === value ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary/50'}`}
                >
                  <input
                    type="radio"
                    name="save-template-mode"
                    className="mt-1"
                    checked={mode === value}
                    onChange={() => {
                      setMode(value);
                      setName(value === 'update' ? source.name : `${source.name} copy`);
                    }}
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{title}</span>
                    <span className="text-[11px] text-muted-foreground">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="save-template-name" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Name
            </label>
            <Input
              id="save-template-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder={getDefaultTemplateName(instance)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">{source && mode === 'update' ? 'Replace' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};