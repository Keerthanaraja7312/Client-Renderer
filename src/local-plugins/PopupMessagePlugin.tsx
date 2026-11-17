import { useEffect, useId, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  MessageSquareText,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type PopupType = 'info' | 'success' | 'warning' | 'error';
type PopupSize = 'sm' | 'default' | 'lg';

type PopupMessageConfigs = {
  title: string;
  message: string;
  popupType: PopupType;
  buttonText: string;
  showCloseButton: boolean;
  showCancelButton: boolean;
  defaultOpen: boolean;
  size: PopupSize;
};

type PopupMessageSchema = {
  isOpen: boolean;
};

type PopupTypeStyle = {
  Icon: LucideIcon;
  color: string;
  background: string;
  border: string;
};

// ─── Style maps ───────────────────────────────────────────────────────────────

const TYPE_STYLES: Record<PopupType, PopupTypeStyle> = {
  info: {
    Icon: Info,
    color: 'text-blue-600 dark:text-blue-400',
    background: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-800',
  },
  success: {
    Icon: CheckCircle2,
    color: 'text-green-600 dark:text-green-400',
    background: 'bg-green-50 dark:bg-green-950/30',
    border: 'border-green-200 dark:border-green-800',
  },
  warning: {
    Icon: AlertTriangle,
    color: 'text-amber-600 dark:text-amber-400',
    background: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800',
  },
  error: {
    Icon: XCircle,
    color: 'text-red-600 dark:text-red-400',
    background: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-800',
  },
};

const WIDTH_CLASSES: Record<PopupSize, string> = {
  sm: 'max-w-xs',
  default: 'max-w-md',
  lg: 'max-w-xl',
};

// ─── Canvas Component ─────────────────────────────────────────────────────────

function PopupMessageCanvas({
  configs,
  data,
}: {
  configs: PopupMessageConfigs;
  data: PopupMessageSchema[] | null;
}) {
  const {
    title,
    message,
    popupType = 'info',
    buttonText,
    showCloseButton,
    showCancelButton,
    defaultOpen,
    size = 'default',
  } = configs;

  const titleId = useId();

  // When live data is bound (Preview / runtime) it drives visibility;
  // otherwise (Design mode) the "Open by Default" setting does.
  const liveOpen = data ? Boolean(data[0]?.isOpen) : Boolean(defaultOpen);

  const [isOpen, setIsOpen] = useState(liveOpen);

  // Sync state when switching between Design and Preview modes.
  useEffect(() => {
    setIsOpen(liveOpen);
  }, [liveOpen]);

  // Controls are read-only while visibility is driven by live data.
  const isDisabled = Boolean(data);

  // Escape closes the popup (design mode only).
  useEffect(() => {
    if (!isOpen || isDisabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isDisabled]);

  const styles = TYPE_STYLES[popupType] ?? TYPE_STYLES.info;
  const widthClass = WIDTH_CLASSES[size] ?? WIDTH_CLASSES.default;
  const { Icon } = styles;

  return (
    <div className="w-full min-w-[16rem]">
      {!isOpen && (
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => setIsOpen(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          Open popup
        </button>
      )}

      {isOpen && (
        <div className="w-full">
          <div
            role="dialog"
            aria-modal={false}
            aria-labelledby={titleId}
            className={`w-full min-w-0 ${widthClass} rounded-xl border ${styles.border} bg-background p-4 shadow-md`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${styles.color} ${styles.background}`}
                aria-hidden="true"
              >
                <Icon className="h-5 w-5" />
              </span>

              <div className="min-w-0 flex-1">
                <h3
                  id={titleId}
                  className="text-base font-semibold text-foreground"
                >
                  {title || 'Popup title'}
                </h3>

                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {message || 'Your popup message will appear here.'}
                </p>
              </div>

              {showCloseButton && (
                <button
                  type="button"
                  disabled={isDisabled}
                  onClick={() => setIsOpen(false)}
                  aria-label="Close popup"
                  className="rounded-md px-2 py-1 text-lg leading-none text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  ×
                </button>
              )}
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {showCancelButton && (
                <button
                  type="button"
                  disabled={isDisabled}
                  onClick={() => setIsOpen(false)}
                  className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
              )}

              <button
                type="button"
                disabled={isDisabled}
                onClick={() => setIsOpen(false)}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              >
                {buttonText || 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const PopupMessagePlugin: ViewBuilderPlugin<
  PopupMessageConfigs,
  PopupMessageSchema
> = {
  id: 'popup-message',
  pluginType: 'form',

  toolbar: {
    name: 'Popup Message',
    element: <MessageSquareText className="h-5 w-5" />,
    toolTip: 'Add a popup message',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<PopupMessageConfigs, PopupMessageSchema> {...props}>
        {({ data, configs }) => (
          <PopupMessageCanvas configs={configs} data={data} />
        )}
      </BasePluginView>
    ),
  },

  settings: [
    {
      field_id: 'title',
      label: 'Popup Title',
      type: 'text',
      defaultValue: 'Success!',
    },
    {
      field_id: 'message',
      label: 'Message',
      type: 'text',
      defaultValue: 'Your action was completed successfully.',
    },
    {
      field_id: 'popupType',
      label: 'Popup Type',
      type: 'select',
      defaultValue: 'success',
      enum: ['info', 'success', 'warning', 'error'],
    },
    {
      field_id: 'size',
      label: 'Popup Size',
      type: 'select',
      defaultValue: 'default',
      enum: ['sm', 'default', 'lg'],
    },
    {
      field_id: 'buttonText',
      label: 'Button Text',
      type: 'text',
      defaultValue: 'OK',
    },
    {
      field_id: 'defaultOpen',
      label: 'Open by Default',
      type: 'checkbox',
      defaultValue: true,
    },
    {
      field_id: 'showCloseButton',
      label: 'Show Close Button',
      type: 'checkbox',
      defaultValue: true,
    },
    {
      field_id: 'showCancelButton',
      label: 'Show Cancel Button',
      type: 'checkbox',
      defaultValue: false,
    },
  ],

  componentDataSchema: {
    isOpen: true,
  },

  componentDataMetadata: {
    isOpen: {
      type: 'boolean',
      label: 'Popup Visibility',
    },
  },
};