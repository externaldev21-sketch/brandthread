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
  // Keep this compatibility hook as the bridge for older screens while the
  // app migrates from static constants to the runtime theme context. New
  // presets expose the complete palette; the fallbacks keep hot reloads and
  // older persisted contexts safe during an incremental rollout.
  const palette = theme as typeof theme & Record<string, any>;
  const value = (key: string, fallback: string) => palette[key] ?? fallback;
  return {
    ...colors.dark,
    text: value('text', colors.dark.text),
    foreground: value('text', colors.dark.foreground),
    background: value('background', colors.dark.background),
    card: value('card', colors.dark.card),
    cardForeground: value('text', colors.dark.cardForeground),
    secondary: value('surface', colors.dark.secondary),
    secondaryForeground: value('text', colors.dark.secondaryForeground),
    muted: value('surfaceGlass', colors.dark.muted),
    mutedForeground: value('muted', colors.dark.mutedForeground),
    tint: theme.accent,
    primary: theme.accent,
    primaryForeground: theme.onAccent,
    accent: value('accentDim', theme.accentDim),
    accentForeground: value('accentLight', theme.accentLight),
    border: value('border', colors.dark.border),
    input: value('input', colors.dark.input),
    destructive: value('error', colors.dark.destructive),
    success: value('success', colors.dark.success),
    warning: value('warning', colors.dark.warning),
    info: value('info', theme.secondary),
    infoDim: value('infoDim', theme.secondaryDim),
    subtle: value('subtle', colors.dark.info),
    surface: value('surface', colors.dark.secondary),
    elevated: value('cardElevated', colors.dark.card),
    gradient: theme.primaryGradient,
    heroGradient: theme.heroGradient,
    glowGradient: theme.glowGradient,
    tabBarBackground: value('tabBarBackground', colors.dark.background),
    shadowColor: theme.shadowColor,
    radius: colors.radius,
  };
}
