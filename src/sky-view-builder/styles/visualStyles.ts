// styles/visualStyles.ts
//
// Single source of truth for plugin visual styling. `defaultVisualStyle`
// is the app-wide theme (dark, brand-emerald) — every plugin that uses
// `withVisualStyle` (see ./withVisualStyle.tsx) inherits this automatically
// unless a specific instance overrides it via its `visualStyle` setting.

export type VisualStyleConfig = {
  layout: {
    variant: 'default' | 'compact' | 'spacious' | 'minimal';
    borderRadius: 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
    spacing: 'none' | 'tight' | 'normal' | 'relaxed' | 'loose';
    maxWidth: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
  };
  colors: {
    background: string;
    surface: string;
    border: string;
    /** Background for floating dropdown/select option panels. Independent
     *  from `surface` (which drives the header/toolbar bar) so a dropdown's
     *  option list can be themed separately from the header. Defaults to
     *  the same value as `surface`/`background` per theme, but is
     *  individually overridable per instance. */
    dropdownList: string;
    text: {
      primary: string;
      secondary: string;
      muted: string;
    };
    accent: {
      primary: string;
      secondary: string;
      success: string;
      warning: string;
      error: string;
    };
  };
  typography: {
    fontFamily: string;
    scale: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    weight: {
      normal: number;
      medium: number;
      semibold: number;
      bold: number;
    };
  };
  shadows: {
    none: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  animations: {
    enabled: boolean;
    duration: number;
    easing: string;
  };
};

// ─── Brand palettes ─────────────────────────────────────────────────────────
// These mirror the app's globals.css design tokens (see :root / .dark) so
// a plugin left at defaults looks identical to the surrounding chrome.
// Both themes share the same emerald accent as the brand anchor.

const darkPalette = {
  background: '#12151c',
  surface: '#1c212b',
  border: '#262c38',
  dropdownList: '#1c212b',
  text: {
    primary: '#f5f7fa',
    secondary: '#a8b0bf',
    muted: '#6b7280',
  },
  accent: {
    primary: '#34d399',
    secondary: '#60a5fa',
    success: '#34d399',
    warning: '#fbbf24',
    error: '#f87171',
  },
};

const lightPalette = {
  background: '#ffffff',
  surface: '#f3f8f5',
  border: '#e6ebf0',
  dropdownList: '#ffffff',
  text: {
    primary: '#2f3a4c',
    secondary: '#5b6b80',
    muted: '#94a3b8',
  },
  accent: {
    primary: '#34d399',
    secondary: '#60a5fa',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
  },
};

const baseTypography = {
  fontFamily: 'Inter, system-ui, sans-serif',
  scale: 'md' as const,
  weight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
};

const baseLayout = {
  variant: 'default' as const,
  borderRadius: 'lg' as const,
  spacing: 'normal' as const,
  maxWidth: 'full' as const,
};

const baseAnimations = {
  enabled: true,
  duration: 200,
  easing: 'ease-in-out',
};

export const darkVisualStyle: VisualStyleConfig = {
  layout: baseLayout,
  colors: darkPalette,
  typography: baseTypography,
  shadows: {
    none: 'none',
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.35)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.45)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.55)',
  },
  animations: baseAnimations,
};

export const lightVisualStyle: VisualStyleConfig = {
  layout: baseLayout,
  colors: lightPalette,
  typography: baseTypography,
  shadows: {
    none: 'none',
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
  },
  animations: baseAnimations,
};

/** App-wide default. Dark is the brand default — see globals.css. */
export const defaultVisualStyle: VisualStyleConfig = darkVisualStyle;

export const themes: Record<string, VisualStyleConfig> = {
  dark: darkVisualStyle,
  light: lightVisualStyle,

};

export const colorUtils = {
  hexToRgb: (hex: string): { r: number; g: number; b: number } | null => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : null;
  },
  rgbToHex: (r: number, g: number, b: number): string => {
    return '#' + [r, g, b].map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  },
  isLight: (hex: string): boolean => {
    const rgb = colorUtils.hexToRgb(hex);
    if (!rgb) return true;
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return luminance > 0.5;
  },
  getContrastColor: (hex: string): string => {
    return colorUtils.isLight(hex) ? '#000000' : '#ffffff';
  },
};