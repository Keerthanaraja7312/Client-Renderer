// styles/index.ts

export type { VisualStyleConfig } from './visualStyles';
export {
  defaultVisualStyle,
  darkVisualStyle,
  lightVisualStyle,
  themes,
  colorUtils,
} from './visualStyles';
export { VisualStyleProvider, useVisualStyle } from './VisualStyleProvider';
export { VisualStyleSettings } from './VisualStyleSettings';
export {
  generateStyleClasses,
  generateInlineStyles,
  generateCardStyles,
  generateButtonStyles,
  generateTableStyles,
  generateTypographyStyles,
  RADIUS_MAP,
} from './styleGenerator';

// The recommended entry point for plugin authors — wraps a plugin
// definition with the shared visual-style setting + provider in one call.
export { withVisualStyle, StyledSurface, type WithVisualStyleConfigs } from './withVisualStyle';