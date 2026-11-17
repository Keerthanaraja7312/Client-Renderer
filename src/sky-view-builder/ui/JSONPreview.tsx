import React, { useEffect, useState } from 'react';
import { X, Download } from 'lucide-react';
import { saveUserInteraction } from '@/api/userInteractionApi';

interface SaveJsonResponse {
  data?: { id?: number };
}

interface JSONPreviewProps {
  open: boolean;
  json: any;
  pageName?: string;
  /** Modal heading - lets the same component serve different JSONs. */
  title?: string;
  /** Pre-filled Label value shown in the editable field when the modal
   *  opens. Each caller (interaction JSON vs layout JSON) passes its own
   *  sensible default; the person can still edit it before saving. */
  defaultLabel?: string;
  /** Defaults to saveUserInteraction (the interaction/component-tree JSON).
   *  Pass a different function (e.g. one wrapping saveGridLayout) to save
   *  a different JSON - such as the react-grid-layout-only JSON - through
   *  the same modal UI without duplicating any of this component. */
  saveFn?: (payload: {
    page_name: string;
    page_data: any;
    label: string;
    created_by: string | null;
  }) => Promise<SaveJsonResponse>;
  onClose: () => void;
}

export const JSONPreview: React.FC<JSONPreviewProps> = ({
  open,
  json,
  pageName = 'test_page_2',
  title = 'Generated JSON Preview',
  defaultLabel = 'Untitled',
  saveFn = saveUserInteraction,
  onClose,
}) => {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [label, setLabel] = useState(defaultLabel);

  // Reset the label back to this JSON's default each time the modal opens,
  // so a label edited/saved last time doesn't leak into the next open.
  useEffect(() => {
    if (open) {
      setLabel(defaultLabel);
      setMessage(null);
    }
  }, [open, defaultLabel]);

  if (!open) return null;

  const formatted = JSON.stringify(json, null, 2);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const res = await saveFn({
        page_name: pageName,
        page_data: json,
        label: label.trim() || defaultLabel,
        created_by: null,
      });
      setMessage({ type: 'ok', text: `Saved successfully${res.data?.id ? ` (#${res.data.id})` : ''}.` });
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message ?? 'Save failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatted);
    } catch (err) {
      console.error('Copy failed', err);
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-70 w-[820px] max-w-full max-h-[90vh] bg-card rounded-2xl border border-border shadow-xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-bold">{title}</h3>
          <div className="flex items-center gap-2">
            <button onClick={handleCopy} className="px-3 py-1 rounded bg-secondary text-sm">Copy</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1 rounded bg-primary text-primary-foreground flex items-center gap-2 disabled:opacity-60"
            >
              <Download className="w-4 h-4" /> {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={onClose} className="p-2 rounded text-muted-foreground/60 hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="p-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Label
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={defaultLabel}
            className="w-full mb-3 bg-secondary rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <textarea readOnly value={formatted} className="w-full h-[55vh] resize-none bg-secondary rounded p-3 text-xs font-mono" />
          {message && (
            <p className={`mt-3 text-sm ${message.type === 'ok' ? 'text-green-600' : 'text-destructive'}`}>
              {message.text}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-secondary">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};