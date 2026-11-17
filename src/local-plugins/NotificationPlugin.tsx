import { useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import {
  Bell,
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type NotificationConfigs = {
  title: string;
  subtitle: string;
  allowMultipleRecipients: boolean;
};

type NotificationSchema = {
  recipients: string;
  subject: string;
  body: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TOOLBAR: {
  title: string;
  Icon: LucideIcon;
  command: string;
  arg?: string;
  dividerAfter?: boolean;
}[] = [
  { title: 'Bold', Icon: Bold, command: 'bold' },
  { title: 'Italic', Icon: Italic, command: 'italic' },
  { title: 'Strikethrough', Icon: Strikethrough, command: 'strikeThrough', dividerAfter: true },
  { title: 'Heading 1', Icon: Heading1, command: 'formatBlock', arg: 'H1' },
  { title: 'Heading 2', Icon: Heading2, command: 'formatBlock', arg: 'H2' },
  { title: 'Heading 3', Icon: Heading3, command: 'formatBlock', arg: 'H3', dividerAfter: true },
  { title: 'Bullet list', Icon: List, command: 'insertUnorderedList' },
  { title: 'Numbered list', Icon: ListOrdered, command: 'insertOrderedList' },
  { title: 'Quote', Icon: Quote, command: 'formatBlock', arg: 'BLOCKQUOTE' },
];

const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[6rem_1fr]">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground sm:pt-3 sm:text-right">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ─── Canvas Component ─────────────────────────────────────────────────────────

function NotificationCanvas({ configs }: { configs: NotificationConfigs }) {
  const {
    title = 'Email Composer',
    subtitle = 'Compose your email',
    allowMultipleRecipients = true,
  } = configs;

  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [subject, setSubject] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);

  const hasInvalid = emails.some((e) => !EMAIL_REGEX.test(e));

  // ── Recipients ──
  const addEmails = (raw: string) => {
    const parts = raw
      .split(/[,;\s]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;

    setEmails((prev) => {
      const merged = allowMultipleRecipients ? [...prev, ...parts] : [parts[0]];
      return Array.from(new Set(merged));
    });
    setDraft('');
  };

  const onRecipientKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === ' ') {
      if (draft.trim()) {
        e.preventDefault();
        addEmails(draft);
      }
    } else if (e.key === 'Backspace' && !draft && emails.length > 0) {
      setEmails((prev) => prev.slice(0, -1));
    }
  };

  const onRecipientPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (/[,;\s]/.test(text.trim())) {
      e.preventDefault();
      addEmails(text);
    }
  };

  // ── Rich text toolbar ──
  const runCommand = (command: string, arg?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
  };

  const showInput = allowMultipleRecipients || emails.length === 0;

  return (
    <div className="w-full min-w-[20rem] rounded-xl border border-border bg-background p-6">
      <h3 className="text-xl font-bold text-foreground">{title}</h3>
      <p className="mt-1 border-b border-border pb-5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {subtitle}
      </p>

      <div className="mt-5 flex flex-col gap-4">
        <Row label="To">
          <div
            className={`flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 ${
              hasInvalid ? 'border-red-500' : 'border-border'
            }`}
          >
            {emails.map((email) => {
              const valid = EMAIL_REGEX.test(email);
              return (
                <span
                  key={email}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
                    valid
                      ? 'bg-muted text-foreground'
                      : 'bg-red-500/15 text-red-500'
                  }`}
                >
                  {email}
                  <button
                    type="button"
                    aria-label={`Remove ${email}`}
                    onClick={() => setEmails((prev) => prev.filter((p) => p !== email))}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}

            {showInput && (
              <input
                type="email"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onRecipientKeyDown}
                onPaste={onRecipientPaste}
                onBlur={() => addEmails(draft)}
                placeholder={emails.length === 0 ? 'Enter email address' : ''}
                className="h-7 min-w-[10rem] flex-1 bg-transparent px-1 text-sm text-foreground outline-none"
              />
            )}
          </div>
          {hasInvalid && (
            <p className="mt-1 text-xs text-red-500">
              One or more email addresses are not valid.
            </p>
          )}
        </Row>

        <Row label="Subject">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Enter subject"
            className={inputClass}
          />
        </Row>
      </div>

      {/* Mail content */}
      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-foreground">
          Mail content
        </p>

        <div className="mt-3 overflow-hidden rounded-md border border-border">
          <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-2">
            {TOOLBAR.map(({ title: label, Icon, command, arg, dividerAfter }) => (
              <span key={label} className="flex items-center gap-1">
                <button
                  type="button"
                  title={label}
                  aria-label={label}
                  // mouseDown + preventDefault keeps the text selection alive
                  onMouseDown={(e) => {
                    e.preventDefault();
                    runCommand(command, arg);
                  }}
                  className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Icon className="h-4 w-4" />
                </button>
                {dividerAfter && <span className="mx-1 h-5 w-px bg-border" />}
              </span>
            ))}
          </div>

          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Mail content"
            data-placeholder="Type your message here…"
            className="min-h-40 w-full px-4 py-4 text-sm text-foreground outline-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-xl [&_h2]:font-bold [&_h3]:text-lg [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const NotificationPlugin: ViewBuilderPlugin<
  NotificationConfigs,
  NotificationSchema
> = {
  id: 'notification',
  pluginType: 'form',

  toolbar: {
    name: 'Notification',
    element: <Bell className="h-5 w-5" />,
    toolTip: 'Add an email composer',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<NotificationConfigs, NotificationSchema> {...props}>
        {({ configs }) => <NotificationCanvas configs={configs} />}
      </BasePluginView>
    ),
  },

  settings: [
    {
      field_id: 'title',
      label: 'Title',
      type: 'text',
      defaultValue: 'Email Composer',
    },
    {
      field_id: 'subtitle',
      label: 'Subtitle',
      type: 'text',
      defaultValue: 'Compose your email',
    },
    {
      field_id: 'allowMultipleRecipients',
      label: 'Allow Multiple Recipients',
      type: 'checkbox',
      defaultValue: true,
    },
  ],

  componentDataSchema: {
    recipients: '',
    subject: '',
    body: '',
  },

  componentDataMetadata: {
    recipients: { type: 'string', label: 'Recipients' },
    subject: { type: 'string', label: 'Subject' },
    body: { type: 'string', label: 'Mail Content' },
  },
};