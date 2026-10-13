/**
 * Brandthread Design System — Avatar (Phase 1)
 *
 * A round avatar with graceful initials fallback (no photo, or a photo that
 * fails to load), built on the shared
 * CachedImage component (components/CachedImage.tsx) so caching/placeholder
 * behavior is consistent with the rest of the app.
 */
import React, { useState } from 'react';
import { ImageStyle, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { initialsOf } from '@/lib/initials';

export interface AvatarProps {
  uri?: string | null;
  name?: string;
  size?: 24 | 32 | 40 | 48 | 56 | 72 | 84 | 96;
  style?: StyleProp<ViewStyle>;
}

function initialsFor(name?: string) {
  return initialsOf(name) || '?';
}

export function Avatar({ uri, name, size = 40, style }: AvatarProps) {
  const { theme } = useAppTheme();
  const dimension = { width: size, height: size, borderRadius: RADII.avatar };
  // A photo that fails to load falls back to the initials, never a blank
  // circle or a generic person glyph (less-AI pass, item 50).
  const [failedUri, setFailedUri] = useState<string | null>(null);

  if (uri && failedUri !== uri) {
    return (
      <CachedImage
        source={{ uri }}
        style={[dimension, style] as StyleProp<ImageStyle>}
        accessibilityLabel={name ? `${name}'s avatar` : 'Avatar'}
        onError={() => setFailedUri(uri)}
      />
    );
  }

  return (
    <View
      accessibilityLabel={name ? `${name}'s avatar` : 'Avatar'}
      style={[dimension, styles.fallback, { backgroundColor: theme.accentDim, borderColor: theme.accent + '55' }, style]}
    >
      <Text style={[styles.initials, { fontSize: size * 0.38, color: theme.accentLight }]}>{initialsFor(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  initials: { fontFamily: FONT.semibold },
});
