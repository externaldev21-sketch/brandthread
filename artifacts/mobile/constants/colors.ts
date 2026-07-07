/**
 * Brandthread design tokens.
 * Light palette = clean lavender-white professional look.
 * Dark palette  = deep-space black with vivid violet accents.
 * Both share the same key names so useColors() can swap seamlessly.
 */
const colors = {
  light: {
    text: '#1A1035',
    tint: '#7C3AED',
    background: '#F8F7FF',
    foreground: '#1A1035',
    card: '#FFFFFF',
    cardForeground: '#1A1035',
    primary: '#7C3AED',
    primaryForeground: '#FFFFFF',
    secondary: '#EDE9FE',
    secondaryForeground: '#5B21B6',
    muted: '#F3F0FF',
    mutedForeground: '#6D6892',
    accent: '#EDE9FE',
    accentForeground: '#5B21B6',
    destructive: '#DC2626',
    destructiveForeground: '#FFFFFF',
    border: '#DDD6FE',
    input: '#F0EEFF',
    success: '#16A34A',
    warning: '#D97706',
    info: '#2563EB',
  },
  dark: {
    text: '#F0EEFF',
    tint: '#9F7AEA',
    background: '#08080F',
    foreground: '#F0EEFF',
    card: '#111118',
    cardForeground: '#F0EEFF',
    primary: '#9F7AEA',
    primaryForeground: '#FFFFFF',
    secondary: '#1C1C2E',
    secondaryForeground: '#C4B5FD',
    muted: '#1C1C2E',
    mutedForeground: '#6B6B8A',
    accent: '#1C1C2E',
    accentForeground: '#C4B5FD',
    destructive: '#EF4444',
    destructiveForeground: '#FFFFFF',
    border: '#252535',
    input: '#1C1C2E',
    success: '#22C55E',
    warning: '#F59E0B',
    info: '#3B82F6',
  },
  radius: 12,
};

export default colors;
