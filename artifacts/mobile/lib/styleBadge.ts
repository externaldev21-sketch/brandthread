import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAccountStorageScope, resolveAccountKey } from '@/lib/accountStorage';

// Legacy device-wide key names; stored per account via lib/accountStorage
// (the first signed-in account claims any pre-scoping values).
export const STYLE_BADGE_LABEL_KEY   = 'buyer_style_badge_label';
export const STYLE_BADGE_EMOJI_KEY   = 'buyer_style_badge_emoji';
export const STYLE_BADGE_ENABLED_KEY = 'buyer_style_badge_enabled';

export const DEFAULT_STYLE_BADGE = { label: 'Archive Fashion', emoji: '🎞️', color: '#00C853' };

export interface StyleBadgeState {
  label: string;
  emoji: string;
  enabled: boolean;
}

function scopedKeys(userId = getAccountStorageScope()): Promise<[string, string, string]> {
  return Promise.all([
    resolveAccountKey(STYLE_BADGE_LABEL_KEY, 'claim', userId),
    resolveAccountKey(STYLE_BADGE_EMOJI_KEY, 'claim', userId),
    resolveAccountKey(STYLE_BADGE_ENABLED_KEY, 'claim', userId),
  ]);
}

export async function loadStyleBadge(): Promise<StyleBadgeState> {
  const pairs = await AsyncStorage.multiGet(await scopedKeys());
  const [label, emoji, enabled] = pairs.map(p => p[1]);
  return {
    label: label ?? DEFAULT_STYLE_BADGE.label,
    emoji: emoji ?? DEFAULT_STYLE_BADGE.emoji,
    enabled: enabled === null || enabled === undefined ? true : enabled === 'true',
  };
}

export async function saveStyleBadge(state: StyleBadgeState): Promise<void> {
  const [labelKey, emojiKey, enabledKey] = await scopedKeys();
  await AsyncStorage.multiSet([
    [labelKey, state.label],
    [emojiKey, state.emoji],
    [enabledKey, String(state.enabled)],
  ]);
}
