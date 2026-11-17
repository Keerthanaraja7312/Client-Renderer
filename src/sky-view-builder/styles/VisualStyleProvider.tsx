// styles/VisualStyleProvider.tsx

import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { defaultVisualStyle, colorUtils } from './visualStyles';
import type { VisualStyleConfig } from './visualStyles';
import { generateTypographyStyles } from './styleGenerator';

/**
 * CONFIRMED via DevTools (Computed tab, "Show all" checked, on an actual
 * text-foreground element): --color-foreground computes to the DEFAULT
 * base-theme value (oklch(0.9842 ...)) regardless of what Font Color is
 * set to — proving Tailwind v4's `@theme` block resolves --color-X tokens
 * to FIXED values at CSS compile time, not as live `var(--X)` references.
 * Every compiled utility class (text-foreground, bg-card, border-border,
 * ...) reads --color-X directly — e.g. `.text-foreground { color:
 * var(--color-foreground) }`. Overriding the bare --X variable (an earlier
 * version of this file, based on a Tailwind v3-style assumption) has NO
 * effect, because nothing downstream ever reads --X at runtime — only
 * --color-X.
 *
 * Fix: override --color-X directly, inline, on this element's subtree.
 * A hex string is already a complete, valid CSS color — no conversion
 * needed for either variable naming scheme.
 */
function toCssColor(hex: string): string {
  return hex;
}

interface VisualStyleContextValue {
  style: VisualStyleConfig;
  className: string;
  inlineStyles: React.CSSProperties;
}

const VisualStyleContext = createContext<VisualStyleContextValue>({
  style: defaultVisualStyle,
  className: '',
  inlineStyles: {},
});

interface VisualStyleProviderProps {
  children: ReactNode;
  styleConfig?: Partial<VisualStyleConfig>;
}

export const VisualStyleProvider: React.FC<VisualStyleProviderProps> = ({
  children,
  styleConfig,
}) => {
  const style = useMemo(() => {
    const merged = {
      ...defaultVisualStyle,
      ...styleConfig,
      layout: { ...defaultVisualStyle.layout, ...(styleConfig?.layout || {}) },
      colors: {
        ...defaultVisualStyle.colors,
        ...(styleConfig?.colors || {}),
        text: { ...defaultVisualStyle.colors.text, ...(styleConfig?.colors?.text || {}) },
        accent: { ...defaultVisualStyle.colors.accent, ...(styleConfig?.colors?.accent || {}) },
      },
      typography: { ...defaultVisualStyle.typography, ...(styleConfig?.typography || {}) },
      shadows: { ...defaultVisualStyle.shadows, ...(styleConfig?.shadows || {}) },
      animations: { ...defaultVisualStyle.animations, ...(styleConfig?.animations || {}) },
    };
    return merged as VisualStyleConfig;
  }, [styleConfig]);

  const className = useMemo(() => {
    const classes: string[] = [];
    if (style.layout.variant) {
      classes.push(`style-variant-${style.layout.variant}`);
    }
    if (style.layout.borderRadius) {
      classes.push(`style-radius-${style.layout.borderRadius}`);
    }
    if (style.layout.spacing) {
      classes.push(`style-spacing-${style.layout.spacing}`);
    }
    return classes.join(' ');
  }, [style]);

const RADIUS_MAP: Record<string, string> = {
    none: '0px', sm: '4px', md: '8px', lg: '12px', xl: '16px', '2xl': '24px',
  };

const inlineStyles = useMemo(() => {
    const c = style.colors;
    const primaryFg = colorUtils.getContrastColor(c.accent.primary);
    const destructiveFg = colorUtils.getContrastColor(c.accent.error);

    const typography = generateTypographyStyles(style);

    return {
      backgroundColor: c.background,
      color: c.text.primary,
      fontFamily: style.typography.fontFamily,
      fontSize: typography.body.fontSize,
      borderRadius: RADIUS_MAP[style.layout.borderRadius] ?? '12px',

      // These are the ACTUAL tokens compiled Tailwind v4 utility classes
      // reference at runtime (--color-*), confirmed via DevTools.
      '--color-background': toCssColor(c.background),
      '--color-foreground': toCssColor(c.text.primary),
      '--color-card': toCssColor(c.surface),
      '--color-card-foreground': toCssColor(c.text.primary),
      '--color-popover': toCssColor(c.surface),
      '--color-popover-foreground': toCssColor(c.text.primary),
      // Independent background for floating dropdown/select option panels —
      // driven by colors.dropdownList (separate from --color-popover/
      // --color-card so a dropdown's list can diverge from the header/
      // toolbar color). See the "Dropdown List" field in
      // VisualStyleSettings and its use in Dropdown.tsx.
      '--dropdown-list-bg': toCssColor(c.dropdownList),
      '--color-secondary': toCssColor(c.surface),
      '--color-secondary-foreground': toCssColor(c.text.primary),
      '--color-muted': toCssColor(c.surface),
      // Deliberately driven by the SAME Font Color (c.text.primary) as
      // --color-foreground, not the separate c.text.muted value — by
      // request, every text token (including previously-dimmed
      // "secondary" text like table headers, IDs, subtitles) now follows
      // Font Color uniformly instead of keeping an independent muted tone.
      '--color-muted-foreground': toCssColor(c.text.primary),
      '--color-border': toCssColor(c.border),
      '--color-input': toCssColor(c.border),
      '--color-primary': toCssColor(c.accent.primary),
      '--color-primary-foreground': toCssColor(primaryFg),
      '--color-accent': toCssColor(c.accent.secondary),
      '--color-accent-foreground': toCssColor(c.text.primary),
      '--color-destructive': toCssColor(c.accent.error),
      '--color-destructive-foreground': toCssColor(destructiveFg),
      '--color-ring': toCssColor(c.accent.primary),
    } as React.CSSProperties;
  }, [style]);

  return (
    <VisualStyleContext.Provider value={{ style, className, inlineStyles }}>
      {children}
    </VisualStyleContext.Provider>
  );
};

export const useVisualStyle = () => {
  const context = useContext(VisualStyleContext);
  if (!context) {
    throw new Error('useVisualStyle must be used within a VisualStyleProvider');
  }
  return context;
};