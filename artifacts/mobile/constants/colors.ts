/**
 * Brandthread design tokens — "Vault Archive" editorial theme.
 * Light palette = bone/paper lookbook with black ink and a blood-orange accent.
 * Dark palette  = warm ink-black archive room with the same orange accent.
 * Both share the same key names so useColors() can swap seamlessly.
 */
const colors = {
  light: {
    text: '#17140F',
    tint: '#B33F1E',
    background: '#F2EEE3',
    foreground: '#17140F',
    card: '#FFFFFF',
    cardForeground: '#17140F',
    primary: '#B33F1E',
    primaryForeground: '#FFFFFF',
    secondary: '#E8E1CF',
    secondaryForeground: '#7A2D14',
    muted: '#EDE8DC',
    mutedForeground: '#6E6759',
    accent: '#E8E1CF',
    accentForeground: '#7A2D14',
    destructive: '#DC2626',
    destructiveForeground: '#FFFFFF',
    border: '#DBD3C0',
    input: '#EDE7D9',
    success: '#3F7A4F',
    warning: '#A66A1E',
    info: '#3D5A80',
  },
  dark: {
    text: '#EDE7D9',
    tint: '#C94D1F',
    background: '#121110',
    foreground: '#EDE7D9',
    card: '#1B1917',
    cardForeground: '#EDE7D9',
    primary: '#C94D1F',
    primaryForeground: '#FFFFFF',
    secondary: '#201D18',
    secondaryForeground: '#E2DDD0',
    muted: '#201D18',
    mutedForeground: '#8C8577',
    accent: '#201D18',
    accentForeground: '#E2DDD0',
    destructive: '#EF4444',
    destructiveForeground: '#FFFFFF',
    border: '#33302A',
    input: '#201D18',
    success: '#4C9A5E',
    warning: '#B98A2E',
    info: '#4A6FA5',
  },
  radius: 6,
};

export default colors;
