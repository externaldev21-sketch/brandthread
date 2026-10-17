/**
 * Brandthread Design System — Avatar (Phase 1)
 *
 * A round avatar with graceful initials fallback (no photo, or a photo that
 * fails to load), built on the shared
 * CachedImage component (components/CachedImage.tsx) so caching/placeholder
 * behavior is consistent with the rest of the app.
 *
 * Seamless by design: the photo fills the circle and is cut off by it — no
 * border, ring or halo around it, and the initials fallback is a plain solid
 * disc. Story/LIVE rings are drawn by their own wrappers, never here.
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
  size?: number;
  style?: StyleProp<ViewStyle>;
}

function initialsFor(name?: string) {
  return initialsOf(name) || '?';
}

export function Avatar({ uri, name, size = 40, style }: AvatarProps) {
  const { theme } = useAppTheme();
  const dimension = { width: size, height: size, borderRadius: size / 2, overflow: 'hidden' as const };
  // A photo that fails to load falls back to the initials, never a blank
  // circle or a generic person glyph (less-AI pass, item 50).
  const [failedUri, setFailedUri] = useState<string | null>(null);

  if (uri && failedUri !== uri) {
    return (
      <CachedImage
        source={{ uri }}
        contentFit="cover"
        style={[dimension, style] as StyleProp<ImageStyle>}
        accessibilityLabel={name ? `${name}'s avatar` : 'Avatar'}
        onError={() => setFailedUri(uri)}
      />
    );
  }

  return (
    <View
      accessibilityLabel={name ? `${name}'s avatar` : 'Avatar'}
      style={[dimension, styles.fallback, { backgroundColor: theme.accentDim }, style]}
    >
      <Text style={[styles.initials, { fontSize: size * 0.38, color: theme.accentLight }]}>{initialsFor(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: FONT.semibold },
});
