// styles/VisualStyleSettings.tsx

import React, { useState } from 'react';
import { themes, defaultVisualStyle, colorUtils } from './visualStyles';
import type { VisualStyleConfig } from './visualStyles';
import { ChevronDown, Palette, Layout, Type, Wand2, Check } from 'lucide-react';
import { LayoutField } from '../ui/LayoutField';
import type { GridLayoutItem } from '../ui/layoutUtils';

type VisualStyleColorField = 'background' | 'surface' | 'dropdownList' | 'buttonAccent' | 'fontColor';

interface VisualStyleSettingsProps {
  value: Partial<VisualStyleConfig>;
  onChange: (value: Partial<VisualStyleConfig>) => void;
  layoutItem?: GridLayoutItem | null;
  onUpdateLayout?: (partial: Partial<Pick<GridLayoutItem, "x" | "y" | "w" | "h">>) => void;
  layoutUnit?: 'grid' | 'px';
  /** Which color rows to show. Omit to show all (unchanged default). */
  colorFields?: VisualStyleColorField[];
}

export const VisualStyleSettings: React.FC<VisualStyleSettingsProps> = ({
  value = {},
  onChange,
  layoutItem = null,
  onUpdateLayout,
  layoutUnit = 'grid',
  colorFields,
}) => {
  // undefined colorFields means "show everything" — unchanged behavior
  // for any plugin that doesn't opt into filtering.
  const showField = (key: VisualStyleColorField) => !colorFields || colorFields.includes(key);
  const [expanded, setExpanded] = useState<string[]>(['theme']);

  const toggleSection = (section: string) => {
    setExpanded(prev => 
      prev.includes(section) 
        ? prev.filter(s => s !== section)
        : [...prev, section]
    );
  };

  // Immutable nested-path setter. Unlike `{ ...value }` (which only clones
  // the top level), this rebuilds every object along `path` so the result
  // never shares a nested object reference with `value` — critical because
  // `value` itself may currently BE a theme preset object (see applyTheme
  // below), and mutating a shared nested object corrupts that preset for
  // every instance that reads it afterwards.
  const updateStyle = (path: string, newValue: any) => {
    const pathParts = path.split('.');

    const setIn = (obj: any, parts: string[]): any => {
      const [key, ...rest] = parts;
      const currentChild = obj?.[key];
      return {
        ...obj,
        [key]: rest.length === 0 ? newValue : setIn(currentChild ?? {}, rest),
      };
    };

    onChange(setIn(value ?? {}, pathParts));
  };

  // Deep-clone the preset before handing it to onChange — `themes[themeName]`
  // is the actual shared module-level object. Passing it by reference means
  // any later updateStyle() call on this instance mutates the shared
  // preset itself, breaking theme switching for every other instance (and
  // for the "isActive" comparison below) from then on.
  const applyTheme = (themeName: keyof typeof themes) => {
    onChange(JSON.parse(JSON.stringify(themes[themeName])));
  };

  return (
    <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
      {/* Theme Presets */}
      <div className="space-y-2">
        <button
          onClick={() => toggleSection('theme')}
          className="flex items-center justify-between w-full text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="flex items-center gap-2">
            <Palette className="w-3.5 h-3.5" />
            Theme Presets
          </span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded.includes('theme') ? 'rotate-180' : ''}`} />
        </button>
        
        {expanded.includes('theme') && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            {Object.entries(themes).map(([name, theme]) => {
              const isActive = 
                value.colors?.background === theme.colors.background &&
                value.colors?.accent?.primary === theme.colors.accent?.primary;
              return (
                <button
                  key={name}
                  onClick={() => applyTheme(name as keyof typeof themes)}
                  className={`flex items-center gap-2 p-2 rounded-lg border transition-colors text-left ${
                    isActive 
                      ? 'border-primary bg-primary/5' 
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <div 
                    className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ 
                      backgroundColor: theme.colors.background,
                      border: `1px solid ${theme.colors.border}`,
                    }}
                  >
                    <div 
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: theme.colors.accent.primary }}
                    />
                  </div>
                  <span className="text-xs font-medium capitalize flex-1">{name}</span>
                  {isActive && <Check className="w-3 h-3 text-primary flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Layout Section */}
      <div className="space-y-2">
        <button
          onClick={() => toggleSection('layout')}
          className="flex items-center justify-between w-full text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="flex items-center gap-2">
            <Layout className="w-3.5 h-3.5" />
            Layout
          </span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded.includes('layout') ? 'rotate-180' : ''}`} />
        </button>
        
        {expanded.includes('layout') && (
          <div className="space-y-3 pt-1 bg-secondary/10 rounded-lg p-3">
            {layoutItem && onUpdateLayout ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <LayoutField
                    label={layoutUnit === 'grid' ? 'Width (cols)' : 'Width (px)'}
                    value={layoutItem.w}
                    min={layoutUnit === 'grid' ? 1 : 0}
                    onCommit={(w) => onUpdateLayout({ w })}
                  />
                  <LayoutField
                    label={layoutUnit === 'grid' ? 'Height (rows)' : 'Height (px)'}
                    value={layoutItem.h}
                    min={layoutUnit === 'grid' ? 1 : 0}
                    onCommit={(h) => onUpdateLayout({ h })}
                  />
                  <LayoutField
                    label={layoutUnit === 'grid' ? 'X Position' : 'X (px)'}
                    value={layoutItem.x}
                    min={0}
                    onCommit={(x) => onUpdateLayout({ x })}
                  />
                  <LayoutField
                    label={layoutUnit === 'grid' ? 'Y Position' : 'Y (px)'}
                    value={layoutItem.y}
                    min={0}
                    onCommit={(y) => onUpdateLayout({ y })}
                  />
                </div>
                <p className="text-[9px] text-muted-foreground/40 font-mono italic">
                  {layoutUnit === 'grid'
                    ? 'Grid units — updates live as you drag or resize on the canvas.'
                    : 'Pixels — updates live as you drag or resize on the canvas.'}
                </p>
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground/40 italic">
                Drop this onto the canvas to capture its size and position.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Colors Section */}
      <div className="space-y-2">
        <button
          onClick={() => toggleSection('colors')}
          className="flex items-center justify-between w-full text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="flex items-center gap-2">
            <Palette className="w-3.5 h-3.5" />
            Colors
          </span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded.includes('colors') ? 'rotate-180' : ''}`} />
        </button>
        
        {expanded.includes('colors') && (
          <div className="space-y-2 pt-1 bg-secondary/10 rounded-lg p-3">
            {/* Background — drives --background (the plugin's own outer
                background) via VisualStyleProvider's inline CSS vars. */}
            {showField('background') && (
              <div>
                <label className="text-[10px] text-muted-foreground/60 block mb-1">Background</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={value.colors?.background || '#ffffff'}
                    onChange={(e) => updateStyle('colors.background', e.target.value)}
                    className="w-8 h-8 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
                  />
                  <input
                    type="text"
                    value={value.colors?.background || '#ffffff'}
                    onChange={(e) => updateStyle('colors.background', e.target.value)}
                    className="flex-1 h-8 rounded-lg border border-border bg-secondary px-2 text-xs outline-none focus:border-primary/60 font-mono"
                  />
                </div>
              </div>
            )}

            {/* Header — stored as colors.surface, which already drives
                --card/--popover/--secondary/--muted (the toolbar/header bar
                + table header background in styleGenerator's generateTableStyles). */}
            {showField('surface') && (
              <div>
                <label className="text-[10px] text-muted-foreground/60 block mb-1">Header</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={value.colors?.surface || '#f8f9fa'}
                    onChange={(e) => updateStyle('colors.surface', e.target.value)}
                    className="w-8 h-8 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
                  />
                  <input
                    type="text"
                    value={value.colors?.surface || '#f8f9fa'}
                    onChange={(e) => updateStyle('colors.surface', e.target.value)}
                    className="flex-1 h-8 rounded-lg border border-border bg-secondary px-2 text-xs outline-none focus:border-primary/60 font-mono"
                  />
                </div>
              </div>
            )}

            {/* Dropdown List — stored as colors.dropdownList, drives
                --dropdown-list-bg, applied to the floating options panel
                background of dropdown/select components, independently of
                Header. See VisualStyleProvider and Dropdown.tsx. */}
            {showField('dropdownList') && (
              <div>
                <label className="text-[10px] text-muted-foreground/60 block mb-1">Dropdown List</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={value.colors?.dropdownList || '#f8f9fa'}
                    onChange={(e) => updateStyle('colors.dropdownList', e.target.value)}
                    className="w-8 h-8 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
                  />
                  <input
                    type="text"
                    value={value.colors?.dropdownList || '#f8f9fa'}
                    onChange={(e) => updateStyle('colors.dropdownList', e.target.value)}
                    className="flex-1 h-8 rounded-lg border border-border bg-secondary px-2 text-xs outline-none focus:border-primary/60 font-mono"
                  />
                </div>
              </div>
            )}

            {/* Button — stored as colors.accent.primary, which already
                drives --primary (used by bg-primary buttons like "Create"). */}
            {showField('buttonAccent') && (
              <div>
                <label className="text-[10px] text-muted-foreground/60 block mb-1">Button</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={value.colors?.accent?.primary || '#3b82f6'}
                    onChange={(e) => updateStyle('colors.accent.primary', e.target.value)}
                    className="w-8 h-8 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
                  />
                  <input
                    type="text"
                    value={value.colors?.accent?.primary || '#3b82f6'}
                    onChange={(e) => updateStyle('colors.accent.primary', e.target.value)}
                    className="flex-1 h-8 rounded-lg border border-border bg-secondary px-2 text-xs outline-none focus:border-primary/60 font-mono"
                  />
                </div>
              </div>
            )}

            {/* Font Color — stored as colors.text.primary, which already
                drives generateInlineStyles/generateTableStyles/
                generateTypographyStyles body text color. */}
            {showField('fontColor') && (
              <div>
                <label className="text-[10px] text-muted-foreground/60 block mb-1">Font Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={value.colors?.text?.primary || '#2f3a4c'}
                    onChange={(e) => updateStyle('colors.text.primary', e.target.value)}
                    className="w-8 h-8 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
                  />
                  <input
                    type="text"
                    value={value.colors?.text?.primary || '#2f3a4c'}
                    onChange={(e) => updateStyle('colors.text.primary', e.target.value)}
                    className="flex-1 h-8 rounded-lg border border-border bg-secondary px-2 text-xs outline-none focus:border-primary/60 font-mono"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Typography Section */}
      <div className="space-y-2">
        <button
          onClick={() => toggleSection('typography')}
          className="flex items-center justify-between w-full text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="flex items-center gap-2">
            <Type className="w-3.5 h-3.5" />
            Typography
          </span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded.includes('typography') ? 'rotate-180' : ''}`} />
        </button>
        
        {expanded.includes('typography') && (
          <div className="space-y-2 pt-1 bg-secondary/10 rounded-lg p-3">
            <div>
              <label className="text-[10px] text-muted-foreground/60 block mb-1">Font Family</label>
              <select
                value={value.typography?.fontFamily || 'Inter, system-ui, sans-serif'}
                onChange={(e) => updateStyle('typography.fontFamily', e.target.value)}
                className="w-full h-8 rounded-lg border border-border bg-secondary px-2 text-xs outline-none focus:border-primary/60"
              >
                <option value="Inter, system-ui, sans-serif">Inter</option>
                <option value="'Helvetica Neue', Helvetica, Arial, sans-serif">Helvetica</option>
                <option value="Georgia, 'Times New Roman', serif">Georgia (Serif)</option>
                <option value="'Courier New', Courier, monospace">Courier (Mono)</option>
                <option value="'Poppins', system-ui, sans-serif">Poppins</option>
                <option value="'Roboto', system-ui, sans-serif">Roboto</option>
                <option value="'Playfair Display', Georgia, serif">Playfair Display</option>
                <option value="system-ui, -apple-system, sans-serif">System Default</option>
              </select>
            </div>

            {/* Font Size — stored as typography.scale, which FONT_SIZE_SCALE
                in styleGenerator.ts maps to concrete rem sizes for h1/h2/h3/
                body/label via generateTypographyStyles. Dropdown.tsx now reads
                this via useVisualStyle() + generateTypographyStyles() to size
                its trigger and option-list text. */}
            <div>
              <label className="text-[10px] text-muted-foreground/60 block mb-1">Font Size</label>
              <select
                value={value.typography?.scale || 'md'}
                onChange={(e) => updateStyle('typography.scale', e.target.value)}
                className="w-full h-8 rounded-lg border border-border bg-secondary px-2 text-xs outline-none focus:border-primary/60"
              >
                <option value="xs">Extra Small</option>
                <option value="sm">Small</option>
                <option value="md">Medium</option>
                <option value="lg">Large</option>
                <option value="xl">Extra Large</option>
              </select>
            </div>
          </div>
        )}
      </div>

      

      {/* Reset */}
      <div className="pt-2 border-t border-border/30">
        <button
          onClick={() => onChange(JSON.parse(JSON.stringify(defaultVisualStyle)))}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-secondary/50 transition-colors text-xs text-muted-foreground hover:text-foreground"
        >
          Reset to Default
        </button>
      </div>
    </div>
  );
};