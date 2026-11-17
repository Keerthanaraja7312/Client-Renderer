import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import {
  AlertTriangle,
  FileText,
  ImagePlus,
  Paperclip,
  UploadCloud,
  X,
} from 'lucide-react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type UploadMode = 'file' | 'image';

type UploadConfigs = {
  label: string;
  placeholder: string;
  helpText: string;
  required: boolean;
  disabled: boolean;
  acceptPdf: boolean;
  acceptWord: boolean;
  acceptImage: boolean;
  acceptAll: boolean;
  acceptJpg: boolean;
  acceptPng: boolean;
  acceptJpeg: boolean;
  maxFileSizeMb: string;
  enableImageQualityCheck: boolean;
  multiple: boolean;
  hideFormFilledData: boolean;
  clearOnNextStep: boolean;
  useCodeBlockAsCondition: boolean;
  enablePrefixCodeBlock: boolean;
  enableSuffixCodeBlock: boolean;
};

type UploadSchema = {
  fileNames: string;
};

type UploadItem = {
  id: string;
  file: File;
  url?: string;
  warning?: string;
};

// Image quality check: images smaller than this are flagged.
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

// ─── Accept rules ─────────────────────────────────────────────────────────────

function buildRules(c: UploadConfigs, mode: UploadMode) {
  const exts: string[] = [];
  if (c.acceptPdf) exts.push('.pdf');
  if (c.acceptWord) exts.push('.doc', '.docx');
  if (c.acceptJpg) exts.push('.jpg');
  if (c.acceptJpeg) exts.push('.jpeg');
  if (c.acceptPng) exts.push('.png');

  let anyImage = Boolean(c.acceptImage);
  let anyFile = mode === 'file' && Boolean(c.acceptAll);

  // Nothing ticked: file mode allows everything, image mode allows all images.
  if (!anyFile && !anyImage && exts.length === 0) {
    if (mode === 'file') anyFile = true;
    else anyImage = true;
  }

  const accept = anyFile ? '' : [...exts, anyImage ? 'image/*' : ''].filter(Boolean).join(',');

  const matches = (file: File) => {
    if (anyFile) return true;
    const name = file.name.toLowerCase();
    if (exts.some((ext) => name.endsWith(ext))) return true;
    return anyImage && file.type.startsWith('image/');
  };

  const description = anyFile
    ? 'Any file type'
    : Array.from(
        new Set([
          ...exts.map((e) => e.slice(1).toUpperCase()),
          ...(anyImage ? ['Images'] : []),
        ]),
      ).join(', ');

  return { accept, matches, description };
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Canvas Component ─────────────────────────────────────────────────────────

function UploadCanvas({
  mode,
  configs,
}: {
  mode: UploadMode;
  configs: UploadConfigs;
}) {
  const c = configs;
  const inputId = useId();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const urlsRef = useRef<string[]>([]);

  // Free preview URLs when the component goes away.
  useEffect(() => {
    return () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const disabled = Boolean(c.disabled);
  const multiple = Boolean(c.multiple);
  const rules = buildRules(c, mode);
  const maxMb = Number(c.maxFileSizeMb);
  const maxBytes = maxMb > 0 ? maxMb * 1024 * 1024 : 0;
  const Icon = mode === 'image' ? ImagePlus : UploadCloud;

  const checkQuality = (item: UploadItem) => {
    if (!item.url) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth < MIN_WIDTH || img.naturalHeight < MIN_HEIGHT) {
        const warning = `Low resolution (${img.naturalWidth}×${img.naturalHeight}). Recommended at least ${MIN_WIDTH}×${MIN_HEIGHT}.`;
        setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, warning } : p)));
      }
    };
    img.src = item.url;
  };

  const addFiles = (list: FileList | File[]) => {
    if (disabled) return;
    const incoming = Array.from(list);
    const errs: string[] = [];
    const accepted: UploadItem[] = [];

    if (!multiple && incoming.length > 1) {
      errs.push('Only one file can be uploaded.');
    }

    for (const file of multiple ? incoming : incoming.slice(0, 1)) {
      if (!rules.matches(file)) {
        errs.push(`${file.name}: file type not allowed.`);
        continue;
      }
      if (maxBytes && file.size > maxBytes) {
        errs.push(`${file.name}: larger than ${c.maxFileSizeMb} MB.`);
        continue;
      }
      const url = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      if (url) urlsRef.current.push(url);
      accepted.push({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        url,
      });
    }

    setErrors(errs);
    if (accepted.length === 0) return;

    if (multiple) {
      setItems((prev) => [...prev, ...accepted]);
    } else {
      items.forEach((p) => p.url && URL.revokeObjectURL(p.url));
      setItems(accepted);
    }
    if (c.enableImageQualityCheck) accepted.forEach(checkQuality);
  };

  const removeItem = (item: UploadItem) => {
    if (item.url) URL.revokeObjectURL(item.url);
    setItems((prev) => prev.filter((p) => p.id !== item.id));
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = ''; // allow picking the same file again
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const limitText = maxBytes ? ` · Max ${c.maxFileSizeMb} MB` : '';

  return (
    <div className="w-full min-w-[16rem]">
      {c.label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-foreground">
          {c.label}
          {c.required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}

      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center transition-colors ${
          disabled
            ? 'cursor-not-allowed opacity-50'
            : 'cursor-pointer hover:bg-muted'
        } ${dragging ? 'border-primary bg-muted' : 'border-border'}`}
      >
        <Icon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm text-foreground">
          {c.placeholder || (mode === 'image' ? 'Click to upload an image or drag and drop' : 'Click to upload or drag and drop')}
        </span>
        <span className="text-xs text-muted-foreground">
          {rules.description}
          {limitText}
        </span>
        <input
          id={inputId}
          type="file"
          className="sr-only"
          accept={rules.accept}
          multiple={multiple}
          disabled={disabled}
          onChange={onPick}
        />
      </label>

      <button
        type="button"
        disabled={disabled}
        onClick={() => document.getElementById(inputId)?.click()}
        className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {mode === 'image' ? 'Upload Image' : 'Upload File'}
      </button>

      {c.helpText && <p className="mt-1.5 text-xs text-muted-foreground">{c.helpText}</p>}

      {errors.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-red-500" role="alert">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-md border border-border p-2"
            >
              {item.url ? (
                <img
                  src={item.url}
                  alt=""
                  className={`shrink-0 rounded object-cover ${mode === 'image' ? 'h-14 w-14' : 'h-10 w-10'}`}
                />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                </span>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{item.file.name}</p>
                <p className="text-xs text-muted-foreground">{formatSize(item.file.size)}</p>
                {item.warning && (
                  <p className="mt-0.5 flex items-start gap-1 text-xs text-amber-500">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                    {item.warning}
                  </p>
                )}
              </div>

              <button
                type="button"
                aria-label={`Remove ${item.file.name}`}
                disabled={disabled}
                onClick={() => removeItem(item)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Settings builder ─────────────────────────────────────────────────────────

type UploadSettings = NonNullable<
  ViewBuilderPlugin<UploadConfigs, UploadSchema>['settings']
>;

function buildUploadSettings(mode: UploadMode): UploadSettings {
  const isImage = mode === 'image';

  return [
    {
      field_id: 'label',
      label: 'Label',
      type: 'text',
      defaultValue: isImage ? 'Image' : 'File',
    },
    {
      field_id: 'placeholder',
      label: 'Placeholder',
      type: 'text',
      defaultValue: '',
    },
    {
      field_id: 'helpText',
      label: 'Help Text',
      type: 'text',
      defaultValue: '',
    },
    { field_id: 'required', label: 'Required', type: 'checkbox', defaultValue: false },
    { field_id: 'disabled', label: 'Disable Field', type: 'checkbox', defaultValue: false },
    {
      field_id: 'useCodeBlockAsCondition',
      label: 'Use Code Block As Condition',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      field_id: 'hideFormFilledData',
      label: 'Hide Form Filled Data',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      field_id: 'clearOnNextStep',
      label: 'Clear On Next Step (Do Not Carry Forward)',
      type: 'checkbox',
      defaultValue: false,
    },

    // Accept types
    ...(isImage
      ? []
      : [
          { field_id: 'acceptPdf', label: 'Accept: PDF', type: 'checkbox', defaultValue: false },
          { field_id: 'acceptWord', label: 'Accept: MS Word', type: 'checkbox', defaultValue: false },
        ]),
    {
      field_id: 'acceptImage',
      label: isImage ? 'Accept: All Images' : 'Accept: Image',
      type: 'checkbox',
      defaultValue: isImage,
    },
    ...(isImage
      ? []
      : [
          { field_id: 'acceptAll', label: 'Accept: All Files', type: 'checkbox', defaultValue: true },
        ]),
    { field_id: 'acceptJpg', label: 'Accept: JPG', type: 'checkbox', defaultValue: false },
    { field_id: 'acceptPng', label: 'Accept: PNG', type: 'checkbox', defaultValue: false },
    { field_id: 'acceptJpeg', label: 'Accept: JPEG', type: 'checkbox', defaultValue: false },

    {
      field_id: 'maxFileSizeMb',
      label: 'Max File Size (MB)',
      type: 'text',
      defaultValue: '5',
    },
    {
      field_id: 'enableImageQualityCheck',
      label: 'Enable Image Quality Check',
      type: 'checkbox',
      defaultValue: false,
    },
    { field_id: 'multiple', label: 'Multiple', type: 'checkbox', defaultValue: false },

    // Document naming rules
    {
      field_id: 'enablePrefixCodeBlock',
      label: 'Enable Prefix CodeBlock',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      field_id: 'enableSuffixCodeBlock',
      label: 'Enable Suffix CodeBlock',
      type: 'checkbox',
      defaultValue: false,
    },
  ] as UploadSettings;
}

// ─── File Upload Plugin ───────────────────────────────────────────────────────

export const FileUploadPlugin: ViewBuilderPlugin<UploadConfigs, UploadSchema> = {
  id: 'file-upload',
  pluginType: 'form',

  toolbar: {
    name: 'File Upload',
    element: <Paperclip className="h-5 w-5" />,
    toolTip: 'Add a file upload field',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<UploadConfigs, UploadSchema> {...props}>
        {({ configs }) => <UploadCanvas mode="file" configs={configs} />}
      </BasePluginView>
    ),
  },

  settings: buildUploadSettings('file'),

  componentDataSchema: {
    fileNames: '',
  },

  componentDataMetadata: {
    fileNames: { type: 'string', label: 'Uploaded Files' },
  },
};

// ─── Image Upload Plugin ──────────────────────────────────────────────────────

export const ImageUploadPlugin: ViewBuilderPlugin<UploadConfigs, UploadSchema> = {
  id: 'image-upload',
  pluginType: 'form',

  toolbar: {
    name: 'Image Upload',
    element: <ImagePlus className="h-5 w-5" />,
    toolTip: 'Add an image upload field',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<UploadConfigs, UploadSchema> {...props}>
        {({ configs }) => <UploadCanvas mode="image" configs={configs} />}
      </BasePluginView>
    ),
  },

  settings: buildUploadSettings('image'),

  componentDataSchema: {
    fileNames: '',
  },

  componentDataMetadata: {
    fileNames: { type: 'string', label: 'Uploaded Images' },
  },
};