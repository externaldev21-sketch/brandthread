import AsyncStorage from '@react-native-async-storage/async-storage';

export const STYLE_BADGE_LABEL_KEY   = 'buyer_style_badge_label';
export const STYLE_BADGE_EMOJI_KEY   = 'buyer_style_badge_emoji';
export const STYLE_BADGE_ENABLED_KEY = 'buyer_style_badge_enabled';

export const DEFAULT_STYLE_BADGE = { label: 'Archive Fashion', emoji: '🎞️', color: '#00C853' };

export interface StyleBadgeState {
  label: string;
  emoji: string;
  enabled: boolean;
}

export async function loadStyleBadge(): Promise<StyleBadgeState> {
  const pairs = await AsyncStorage.multiGet([
    STYLE_BADGE_LABEL_KEY,
    STYLE_BADGE_EMOJI_KEY,
    STYLE_BADGE_ENABLED_KEY,
  ]);
  const [label, emoji, enabled] = pairs.map(p => p[1]);
  return {
    label: label ?? DEFAULT_STYLE_BADGE.label,
    emoji: emoji ?? DEFAULT_STYLE_BADGE.emoji,
    enabled: enabled === null || enabled === undefined ? true : enabled === 'true',
  };
}

export async function saveStyleBadge(state: StyleBadgeState): Promise<void> {
  await AsyncStorage.multiSet([
    [STYLE_BADGE_LABEL_KEY, state.label],
    [STYLE_BADGE_EMOJI_KEY, state.emoji],
    [STYLE_BADGE_ENABLED_KEY, String(state.enabled)],
  ]);
}
