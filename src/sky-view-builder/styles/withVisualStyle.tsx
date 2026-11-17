// styles/withVisualStyle.tsx
import React, { useRef, useEffect } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { ViewBuilderPlugin, SettingFieldDefinition } from '../core/plugin';
import { VisualStyleProvider, useVisualStyle } from './VisualStyleProvider';
import { VisualStyleSettings } from './VisualStyleSettings';
import type { VisualStyleConfig } from './visualStyles';

const CAPTURED_STYLE_PROPS = [
  // backgroundColor deliberately excluded — it's already handled
  // deterministically via the visualStyle CSS-var mechanism. Capturing it
  // again here risks snapshotting a TRANSIENT interactive state (e.g. the
  // :hover/:focus-within background from the styleId pseudo-class rules)
  // as if it were the permanent resting color, since this effect can run
  // during any render — including one where the element happens to be
  // hovered/focused at that exact moment.
  'color', 'fontFamily', 'fontSize', 'fontWeight',
  'borderRadius', 'borderColor', 'borderWidth', 'borderStyle', 'boxShadow',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'lineHeight', 'letterSpacing', 'textTransform',
] as const;

function captureComputedStyle(el: HTMLElement): Record<string, string> {
  const computed = window.getComputedStyle(el);
  const result: Record<string, string> = {};
  for (const prop of CAPTURED_STYLE_PROPS) {
    result[prop] = computed[prop as keyof CSSStyleDeclaration] as string;
  }
  return result;
}

export type WithVisualStyleConfigs = {
  visualStyle?: Partial<VisualStyleConfig>;
};

// Which color rows a plugin's Visual Style panel actually shows — e.g.
// "Dropdown List" only makes sense for GenericDropdownPlugin, not a table
// or a page. Undefined means "show every field" (unchanged behavior for
// any plugin that doesn't opt in).
export type VisualStyleColorField = 'background' | 'surface' | 'dropdownList' | 'buttonAccent' | 'fontColor';

type CanvasProps<T> = {
  id: string;
  configs: T;
  [key: string]: any;
};

/**
 * Wraps a plugin's canvas in the shared visual-style context and injects
 * the "Visual Style" setting field. Call this around the plugin object
 * you'd otherwise export directly.
 */
export function withVisualStyle<T extends WithVisualStyleConfigs, S = Record<string, any>>(
  plugin: ViewBuilderPlugin<T, S>,
  options?: { colorFields?: VisualStyleColorField[] },
): ViewBuilderPlugin<T, S> {
  const InnerCanvas = plugin.canvas.element;

  const StyledCanvas: ComponentType<CanvasProps<T>> = (props) => (
    <VisualStyleProvider styleConfig={props.configs?.visualStyle}>
      <InnerCanvas {...props} />
    </VisualStyleProvider>
  );

  // Wrapper closes over this specific plugin's colorFields, so each
  // plugin's own withVisualStyle(...) call gets its own filtered panel
  // without needing SettingsPanel.tsx to know anything about it.
  const VisualStyleSettingsForPlugin: SettingFieldDefinition['component'] = (props: any) => (
    <VisualStyleSettings {...props} colorFields={options?.colorFields} />
  );

  const visualStyleSetting: SettingFieldDefinition = {
    field_id: 'visualStyle',
    label: 'Visual Style',
    type: 'custom',
    defaultValue: {},
    component: VisualStyleSettingsForPlugin,
  };

  // Avoid double-registering the field if a plugin author already added
  // one manually — last-registered definition wins either way, but this
  // keeps the settings panel from showing "Visual Style" twice.
  const settingsWithoutVisualStyle = plugin.settings.filter(s => s.field_id !== 'visualStyle');

  return {
    ...plugin,
    canvas: { ...plugin.canvas, element: StyledCanvas },
    settings: [...settingsWithoutVisualStyle, visualStyleSetting],
  };
}

/**
 * Generic bordered/rounded/shadowed surface that fills its container and
 * reflects the resolved visual style. Most plugins can just drop their
 * content in here instead of hand-rolling the same wrapper div.
 */
/**
 * Generic bordered/rounded/shadowed surface that fills its container and
 * reflects the resolved visual style. Most plugins can just drop their
 * content in here instead of hand-rolling the same wrapper div.
 *
 * Also captures this element's real getComputedStyle() and mirrors it into
 * configs.computedStyle, content-compared via a ref so it only writes when
 * the actual rendered style changes (color picker edits, theme swap, etc.)
 * — not on every render. Purely a JSON-export snapshot, same pattern as
 * configs.rows/configs.options elsewhere; nothing at runtime reads it.
 * Pass `updateConfigs` explicitly at each call site to opt a plugin in.
 */
export const StyledSurface: React.FC<{
  children: ReactNode;
  className?: string;
  updateConfigs?: (c: Partial<{ computedStyle: Record<string, string> }>) => void;
  styleId?: string;
  /** When true, drops the border/shadow chrome — Live Preview should look
   *  like what an end user sees, not the editor's component outlines. */
  isPreview?: boolean;
}> = ({ children, className = '', updateConfigs, styleId, isPreview }) => {
  const { style, className: styleClassName, inlineStyles } = useVisualStyle();
  const ref = useRef<HTMLDivElement>(null);
  const lastSignatureRef = useRef<string>('');

  useEffect(() => {
    if (!ref.current || !updateConfigs) return;
    const captured = captureComputedStyle(ref.current);
    const signature = JSON.stringify(captured);
    if (signature !== lastSignatureRef.current) {
      lastSignatureRef.current = signature;
      updateConfigs({ computedStyle: captured });
    }
    // Mount-only: re-running on every render (as before) meant this could
    // fire while the element happened to be mid-interaction (hovered,
    // focused, dropdown open), baking a transient visual state into the
    // export as if permanent. Capturing once, right after initial paint,
    // avoids that — style/font/radius/shadow property values are unlikely
    // to change afterward for a components that isn't the background-color
    // case we already excluded above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // CSS.escape guards against '.' and other selector-special characters
  // inside pageId/blockId/componentId segments — attribute selectors don't
  // need it structurally, but escaping keeps this safe if any segment ever
  // contains a quote character.
  const selector = styleId ? `[data-style-id="${CSS.escape(styleId)}"]` : null;
  const c = style.colors;
  const pseudoStateCss = selector
    ? `${selector}:hover { background-color: ${c.surface}; }\n${selector}:focus-within { outline: 2px solid ${c.accent.primary}; outline-offset: -1px; }`
    : null;

  return (
    <>
      {pseudoStateCss && <style>{pseudoStateCss}</style>}
      <div
        ref={ref}
        data-style-id={styleId}
        className={`h-full w-full flex flex-col overflow-visible ${isPreview ? '' : 'border shadow-sm'} ${styleClassName} ${className}`}
        style={inlineStyles}
      >
        {children}
      </div>
    </>
  );
};

export { useVisualStyle };