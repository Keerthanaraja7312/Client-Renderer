import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  Eye,
  Loader2,
  MousePointerClick,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';
import { getToken } from '../api/authApi';

// ─── Types ────────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'default' | 'lg';
type ButtonIcon = 'none' | 'refresh' | 'plus' | 'delete' | 'download' | 'save' | 'send' | 'check' | 'view';
type ButtonAction = 'none' | 'refreshPage' | 'goBack' | 'openUrl' | 'printPage' | 'delete' | 'download';

type ButtonConfigs = {
  label: string;
  variant: ButtonVariant;
  size: ButtonSize;
  icon: ButtonIcon;
  iconPosition: 'left' | 'right';
  fullWidth: boolean;
  disabled: boolean;
  showLoadingOnClick: boolean;
  action: ButtonAction;
  actionUrl: string;
  downloadFileName: string;
  openInNewTab: boolean;
  confirmBeforeAction: boolean;
  confirmMessage: string;
};

type ButtonSchema = {
  isLoading: boolean;
};

// ─── Style maps ───────────────────────────────────────────────────────────────

const ICONS: Record<Exclude<ButtonIcon, 'none'>, LucideIcon> = {
  refresh: RefreshCw,
  plus: Plus,
  delete: Trash2,
  download: Download,
  save: Save,
  send: Send,
  check: Check,
  view: Eye,
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'bg-muted text-foreground hover:opacity-80',
  outline: 'border border-border text-foreground hover:bg-muted',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-foreground hover:bg-muted',
};

const SIZE_CLASSES: Record<ButtonSize, { button: string; icon: string }> = {
  sm: { button: 'h-8 gap-1.5 px-3 text-xs', icon: 'h-3.5 w-3.5' },
  default: { button: 'h-10 gap-2 px-4 text-sm', icon: 'h-4 w-4' },
  lg: { button: 'h-12 gap-2.5 px-6 text-base', icon: 'h-5 w-5' },
};

const LOADING_MS = 1500;

// ─── Canvas Component ─────────────────────────────────────────────────────────

function ButtonCanvas({ configs }: { configs: ButtonConfigs }) {
  const {
    label,
    variant = 'primary',
    size = 'default',
    icon = 'none',
    iconPosition = 'left',
    fullWidth = false,
    disabled = false,
    showLoadingOnClick = false,
    action = 'none',
    actionUrl = '',
    downloadFileName = '',
    openInNewTab = false,
    confirmBeforeAction = false,
    confirmMessage = 'Are you sure?',
  } = configs;

  const [isLoading, setIsLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the loading timer if the component goes away.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const runAction = async () => {
    switch (action) {
      case 'refreshPage':
        window.location.reload();
        break;
      case 'goBack':
        window.history.back();
        break;
      case 'openUrl': {
        const url = (actionUrl ?? '').trim();
        if (!url || /^\s*javascript:/i.test(url)) return;
        if (openInNewTab) window.open(url, '_blank', 'noopener,noreferrer');
        else window.location.assign(url);
        break;
      }
      case 'printPage':
        window.print();
        break;
      case 'download': {
        const url = (actionUrl ?? '').trim();
        if (!url || /^\s*javascript:/i.test(url)) return;
        const token = getToken();
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) throw new Error(`Download failed (${response.status})`);

        const blob = await response.blob();
        const objectUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = downloadFileName.trim() || 'download';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(objectUrl);
        break;
      }
      case 'delete': {
        const url = (actionUrl ?? '').trim();
        if (!url || /^\s*javascript:/i.test(url)) return;
        const token = getToken();
        const response = await fetch(url, {
          method: 'DELETE',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) throw new Error(`Delete failed (${response.status})`);
        window.dispatchEvent(new Event('sky-view-builder:data-changed'));
        break;
      }
      default:
        break;
    }
  };

  const handleClick = async () => {
    if (isLoading) return;
    if (
      confirmBeforeAction &&
      action !== 'none' &&
      !window.confirm(confirmMessage || 'Are you sure?')
    ) {
      return;
    }
    if (showLoadingOnClick) {
      setIsLoading(true);
      timerRef.current = setTimeout(() => setIsLoading(false), LOADING_MS);
    }
    try {
      await runAction();
    } catch (error) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : 'Action failed');
    }
  };

  const sizeClasses = SIZE_CLASSES[size] ?? SIZE_CLASSES.default;
  const variantClasses = VARIANT_CLASSES[variant] ?? VARIANT_CLASSES.primary;

  const IconComponent = icon !== 'none' ? ICONS[icon] : null;
  const iconNode = isLoading ? (
    <Loader2 className={`${sizeClasses.icon} animate-spin`} aria-hidden="true" />
  ) : IconComponent ? (
    <IconComponent className={sizeClasses.icon} aria-hidden="true" />
  ) : null;

  return (
    <div className="flex w-full">
      <button
        type="button"
        disabled={disabled || isLoading}
        onClick={handleClick}
        aria-busy={isLoading}
        className={`inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses} ${sizeClasses.button} ${
          fullWidth ? 'w-full' : ''
        }`}
      >
        {iconPosition === 'left' && iconNode}
        <span>{label || 'Button'}</span>
        {iconPosition === 'right' && iconNode}
      </button>
    </div>
  );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const ButtonPlugin: ViewBuilderPlugin<ButtonConfigs, ButtonSchema> = {
  id: 'button',
  pluginType: 'form',

  toolbar: {
    name: 'Button',
    element: <MousePointerClick className="h-5 w-5" />,
    toolTip: 'Add a button',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<ButtonConfigs, ButtonSchema> {...props}>
        {({ configs }) => <ButtonCanvas configs={configs} />}
      </BasePluginView>
    ),
  },

  settings: [
    {
      field_id: 'label',
      label: 'Button Label',
      type: 'text',
      defaultValue: 'Button',
    },
    {
      field_id: 'variant',
      label: 'Style',
      type: 'select',
      defaultValue: 'primary',
      enum: ['primary', 'secondary', 'outline', 'danger', 'ghost'],
    },
    {
      field_id: 'size',
      label: 'Size',
      type: 'select',
      defaultValue: 'default',
      enum: ['sm', 'default', 'lg'],
    },
    {
      field_id: 'icon',
      label: 'Icon',
      type: 'select',
      defaultValue: 'none',
      enum: ['none', 'refresh', 'plus', 'delete', 'download', 'save', 'send', 'check', 'view'],
    },
    {
      field_id: 'iconPosition',
      label: 'Icon Position',
      type: 'select',
      defaultValue: 'left',
      enum: ['left', 'right'],
    },
    {
      field_id: 'fullWidth',
      label: 'Full Width',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      field_id: 'disabled',
      label: 'Disabled',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      field_id: 'showLoadingOnClick',
      label: 'Show Loading On Click',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      field_id: 'action',
      label: 'On Click Action',
      type: 'select',
      defaultValue: 'none',
      enum: ['none', 'refreshPage', 'goBack', 'openUrl', 'printPage', 'delete', 'download'],
    },
    {
      field_id: 'actionUrl',
      label: 'URL (Open URL / Delete / Download)',
      type: 'text',
      defaultValue: '',
    },
    {
      field_id: 'downloadFileName',
      label: 'Download File Name',
      type: 'text',
      defaultValue: '',
    },
    {
      field_id: 'openInNewTab',
      label: 'Open URL In New Tab',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      field_id: 'confirmBeforeAction',
      label: 'Ask Confirmation First',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      field_id: 'confirmMessage',
      label: 'Confirmation Message',
      type: 'text',
      defaultValue: 'Are you sure?',
    },
  ],

  componentDataSchema: {
    isLoading: false,
  },

  componentDataMetadata: {
    isLoading: {
      type: 'boolean',
      label: 'Loading State',
    },
  },
};