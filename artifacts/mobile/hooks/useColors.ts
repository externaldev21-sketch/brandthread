import colors from '@/constants/colors';
import { useAppTheme } from '@/contexts/AppThemeContext';

/**
 * Returns the design tokens for the current color scheme.
 *
 * The returned object contains all color tokens for the active palette
 * plus scheme-independent values like `radius`.
 */
export function useColors() {
  const { theme } = useAppTheme();
  return {
    ...colors.dark,
    tint: theme.accent,
    primary: theme.accent,
    accent: theme.accentDim,
    accentForeground: theme.accentLight,
    info: theme.secondary,
    radius: colors.radius,
  };
}
