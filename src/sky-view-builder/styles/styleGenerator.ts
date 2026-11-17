// styles/styleGenerator.ts
//
// Pure functions that turn a VisualStyleConfig into concrete Tailwind
// classes / inline styles. These back both `useVisualStyle()` (raw
// context) and `useStyledClass()` (the convenience hook most plugin
// components should reach for).

import type { CSSProperties } from 'react';
import type { VisualStyleConfig } from './visualStyles';
import { colorUtils } from './visualStyles';

export const RADIUS_MAP: Record<string, string> = {
  none: '0px',
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '24px',
};

const SPACING_MAP: Record<string, string> = {
  none: '0px',
  tight: '6px',
  normal: '10px',
  relaxed: '16px',
  loose: '24px',
};

const FONT_SIZE_SCALE: Record<string, { body: string; label: string; h1: string; h2: string; h3: string }> = {
  xs: { body: '0.75rem', label: '0.6875rem', h1: '1.25rem', h2: '1.05rem', h3: '0.9rem' },
  sm: { body: '0.8125rem', label: '0.6875rem', h1: '1.375rem', h2: '1.125rem', h3: '0.95rem' },
  md: { body: '0.875rem', label: '0.75rem', h1: '1.5rem', h2: '1.25rem', h3: '1rem' },
  lg: { body: '0.9375rem', label: '0.8125rem', h1: '1.75rem', h2: '1.375rem', h3: '1.125rem' },
  xl: { body: '1rem', label: '0.875rem', h1: '2rem', h2: '1.5rem', h3: '1.25rem' },
};

export const generateStyleClasses = (style: VisualStyleConfig): string => {
  const classes: string[] = [];

  if (style.layout.variant) {
    const variantMap: Record<string, string> = {
      compact: 'p-2 gap-2',
      spacious: 'p-6 gap-6',
      minimal: 'p-0 gap-0',
      default: 'p-4 gap-4',
    };
    classes.push(variantMap[style.layout.variant] || 'p-4 gap-4');
  }

  const radiusMap: Record<string, string> = {
    none: 'rounded-none',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    '2xl': 'rounded-2xl',
  };
  classes.push(radiusMap[style.layout.borderRadius] || 'rounded-lg');

  const spacingMap: Record<string, string> = {
    none: 'gap-0',
    tight: 'gap-1.5',
    normal: 'gap-2.5',
    relaxed: 'gap-4',
    loose: 'gap-6',
  };
  classes.push(spacingMap[style.layout.spacing] || 'gap-2.5');

  return classes.join(' ');
};

export const generateInlineStyles = (style: VisualStyleConfig): CSSProperties => {
  return {
    backgroundColor: style.colors.background,
    color: style.colors.text.primary,
    fontFamily: style.typography.fontFamily,
    borderColor: style.colors.border,
    transition: style.animations.enabled ? `all ${style.animations.duration}ms ${style.animations.easing}` : 'none',
  };
};

/** Styling for a card/panel-like surface (modals, table wrappers, tab content). */
export const generateCardStyles = (style: VisualStyleConfig): CSSProperties => ({
  backgroundColor: style.colors.surface,
  borderColor: style.colors.border,
  borderWidth: '1px',
  borderStyle: 'solid',
  borderRadius: RADIUS_MAP[style.layout.borderRadius] ?? '12px',
  boxShadow: style.shadows.md,
  padding: SPACING_MAP[style.layout.spacing] ?? '10px',
  transition: style.animations.enabled ? `all ${style.animations.duration}ms ${style.animations.easing}` : 'none',
});

/** Styling for interactive buttons, keyed by semantic variant. */
export const generateButtonStyles = (
  style: VisualStyleConfig,
  variant: 'primary' | 'secondary' | 'success' | 'warning' | 'error' = 'primary',
): CSSProperties => {
  const bg = variant === 'secondary' ? style.colors.surface : style.colors.accent[variant];
  const fg = variant === 'secondary' ? style.colors.text.primary : colorUtils.getContrastColor(bg);
  return {
    backgroundColor: bg,
    color: fg,
    borderRadius: RADIUS_MAP[style.layout.borderRadius] ?? '12px',
    fontWeight: style.typography.weight.semibold,
    border: variant === 'secondary' ? `1px solid ${style.colors.border}` : 'none',
    transition: style.animations.enabled ? `all ${style.animations.duration}ms ${style.animations.easing}` : 'none',
    cursor: 'pointer',
  };
};

/** Styling for data tables — wrapper, header row, and body cells. */
export const generateTableStyles = (style: VisualStyleConfig): {
  wrapper: CSSProperties;
  header: CSSProperties;
  cell: CSSProperties;
} => ({
  wrapper: {
    borderColor: style.colors.border,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderRadius: RADIUS_MAP[style.layout.borderRadius] ?? '12px',
    overflow: 'hidden',
  },
  header: {
    backgroundColor: style.colors.surface,
    color: style.colors.text.muted,
    fontWeight: style.typography.weight.bold,
    borderColor: style.colors.border,
  },
  cell: {
    color: style.colors.text.primary,
    borderColor: style.colors.border,
    fontFamily: style.typography.fontFamily,
  },
});

/** Font-size/weight tokens per semantic role, driven by the configured scale. */
export const generateTypographyStyles = (style: VisualStyleConfig): {
  h1: CSSProperties;
  h2: CSSProperties;
  h3: CSSProperties;
  body: CSSProperties;
  label: CSSProperties;
} => {
  const sizes = FONT_SIZE_SCALE[style.typography.scale] ?? FONT_SIZE_SCALE.md;
  const shared: CSSProperties = {
    fontFamily: style.typography.fontFamily,
    color: style.colors.text.primary,
  };
  return {
    h1: { ...shared, fontSize: sizes.h1, fontWeight: style.typography.weight.bold },
    h2: { ...shared, fontSize: sizes.h2, fontWeight: style.typography.weight.semibold },
    h3: { ...shared, fontSize: sizes.h3, fontWeight: style.typography.weight.semibold },
    body: { ...shared, fontSize: sizes.body, fontWeight: style.typography.weight.normal },
    label: {
      ...shared,
      fontSize: sizes.label,
      fontWeight: style.typography.weight.bold,
      color: style.colors.text.muted,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
    },
  };
};