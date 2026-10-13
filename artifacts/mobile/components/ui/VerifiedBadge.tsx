/**
 * The one verified badge (less-AI pass item 61): a small solid check seal,
 * always 14pt, white on dark/media and the foreground colour elsewhere.
 * Same seal as the official-community VerifiedMark, so every "verified"
 * in the app reads as one mark.
 */
import React from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
const MEDIA_FOREGROUND = '#FFFFFF'; // theme-exempt: white glyph only on authored photo/video; app chrome uses active theme


export const VERIFIED_BADGE_SIZE = 14;

export function VerifiedBadge({ onMedia = false, style }: { onMedia?: boolean; style?: StyleProp<TextStyle> }) {
  const colors = useColors();
  return (
    <Ionicons
      name="checkmark-circle"
      size={VERIFIED_BADGE_SIZE}
      color={onMedia ? MEDIA_FOREGROUND : colors.foreground}
      accessibilityLabel="Verified"
      style={style}
    />
  );
}
