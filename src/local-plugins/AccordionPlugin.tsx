import { useEffect, useId, useState } from 'react';
import { ChevronDown, ChevronsUpDown, Minus, Plus } from 'lucide-react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type AccordionVariant = 'bordered' | 'separated';
type AccordionIconStyle = 'chevron' | 'plus';

type AccordionConfigs = {
  items: string; // "Title::Content||Title::Content"
  allowMultiple: boolean;
  defaultOpenFirst: boolean;
  variant: AccordionVariant;
  iconStyle: AccordionIconStyle;
};

type AccordionSchema = {
  openItems: string;
};

type AccordionItem = { title: string; content: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

// "Title::Content||Title::Content" → [{title, content}, ...]
function parseItems(raw: string): AccordionItem[] {
  return (raw ?? '')
    .split('||')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const sep = part.indexOf('::');
      if (sep === -1) return { title: part, content: '' };
      return {
        title: part.slice(0, sep).trim(),
        content: part.slice(sep + 2).trim(),
      };
    })
    .filter((item) => item.title);
}

// ─── Canvas Component ─────────────────────────────────────────────────────────

function AccordionCanvas({ configs }: { configs: AccordionConfigs }) {
  const {
    items = '',
    allowMultiple = false,
    defaultOpenFirst = true,
    variant = 'bordered',
    iconStyle = 'chevron',
  } = configs;

  const baseId = useId();
  const [openIndexes, setOpenIndexes] = useState<number[]>(
    defaultOpenFirst ? [0] : [],
  );

  // Follow the "Open First Item By Default" setting when it changes.
  useEffect(() => {
    setOpenIndexes(defaultOpenFirst ? [0] : []);
  }, [defaultOpenFirst]);

  // Turning "Allow Multiple" off keeps only one item open.
  useEffect(() => {
    if (!allowMultiple) setOpenIndexes((prev) => prev.slice(0, 1));
  }, [allowMultiple]);

  const list = parseItems(items);

  if (list.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        Add items in Settings, e.g. Question one::Answer one||Question two::Answer two
      </p>
    );
  }

  const toggle = (index: number) => {
    setOpenIndexes((prev) => {
      const isOpen = prev.includes(index);
      if (allowMultiple) {
        return isOpen ? prev.filter((i) => i !== index) : [...prev, index];
      }
      return isOpen ? [] : [index];
    });
  };

  const separated = variant === 'separated';

  return (
    <div
      className={`w-full min-w-[16rem] ${
        separated
          ? 'flex flex-col gap-2'
          : 'divide-y divide-border overflow-hidden rounded-lg border border-border'
      }`}
    >
      {list.map((item, index) => {
        const isOpen = openIndexes.includes(index);
        const buttonId = `${baseId}-button-${index}`;
        const panelId = `${baseId}-panel-${index}`;

        return (
          <div
            key={`${index}-${item.title}`}
            className={separated ? 'overflow-hidden rounded-lg border border-border' : ''}
          >
            <h3>
              <button
                type="button"
                id={buttonId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(index)}
                className="flex w-full items-center justify-between gap-3 bg-background px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <span className="min-w-0">{item.title}</span>

                {iconStyle === 'plus' ? (
                  isOpen ? (
                    <Minus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )
                ) : (
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                    aria-hidden="true"
                  />
                )}
              </button>
            </h3>

            {/* Inline styles (not Tailwind arbitrary classes) so open/close always
                works, even if the project's Tailwind build skips these classes.
                gridTemplateRows 0fr → 1fr animates the height without measuring. */}
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              aria-hidden={!isOpen}
              className="bg-background"
              style={{
                display: 'grid',
                gridTemplateRows: isOpen ? '1fr' : '0fr',
                visibility: isOpen ? 'visible' : 'hidden',
                transition: 'grid-template-rows 200ms ease, visibility 200ms',
              }}
            >
              <div style={{ overflow: 'hidden', minHeight: 0 }}>
                <p className="whitespace-pre-wrap px-4 pb-4 pt-1 text-sm leading-relaxed text-muted-foreground">
                  {item.content || 'No content added for this item.'}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const AccordionPlugin: ViewBuilderPlugin<AccordionConfigs, AccordionSchema> = {
  id: 'accordion',
  pluginType: 'form',

  toolbar: {
    name: 'Accordion',
    element: <ChevronsUpDown className="h-5 w-5" />,
    toolTip: 'Add an accordion',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<AccordionConfigs, AccordionSchema> {...props}>
        {({ configs }) => <AccordionCanvas configs={configs} />}
      </BasePluginView>
    ),
  },

  settings: [
    {
      field_id: 'items',
      label: 'Items (Title::Content, separate items with ||)',
      type: 'text',
      defaultValue:
        'What is the Page Builder?::A tool to design pages by dragging components onto a canvas.||How do I add a component?::Drag it from the sidebar onto the canvas.||Can I change a component?::Yes, select it and use the configuration panel on the right.',
    },
    {
      field_id: 'allowMultiple',
      label: 'Allow Multiple Open',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      field_id: 'defaultOpenFirst',
      label: 'Open First Item By Default',
      type: 'checkbox',
      defaultValue: true,
    },
    {
      field_id: 'variant',
      label: 'Style',
      type: 'select',
      defaultValue: 'bordered',
      enum: ['bordered', 'separated'],
    },
    {
      field_id: 'iconStyle',
      label: 'Icon',
      type: 'select',
      defaultValue: 'chevron',
      enum: ['chevron', 'plus'],
    },
  ],

  componentDataSchema: {
    openItems: '',
  },

  componentDataMetadata: {
    openItems: { type: 'string', label: 'Open Items' },
  },
};