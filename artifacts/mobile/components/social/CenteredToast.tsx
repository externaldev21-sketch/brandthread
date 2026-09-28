/**
 * Small, brief, centered toast — not the app's usual bottom-anchored wide
 * Snackbar. Shared between the Activity tab (PR1) and the standalone
 * Followers/Following lists (PR2) for "Removed" / "Unfollowed" confirmations.
 *
 * Mobbin: "Instagram iOS Removing a follower" flow, screen 5 —
 * https://mobbin.com/screens/674b1826-5513-4f83-ad23-89b4454e2129
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export function CenteredToast({ message }: { message: string | null }) {
  const { theme } = useAppTheme();
  if (!message) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(150)}
      pointerEvents="none"
      style={styles.wrap}
    >
      <View style={[styles.pill, { backgroundColor: theme.cardElevated }]}>
        <Text style={[styles.text, { color: theme.text }]}>{message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: '42%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: SP.lg,
    paddingVertical: SP.sm + 2,
    borderRadius: RADIUS.pill,
  },
  text: { fontFamily: FONT.semibold, fontSize: FS.base },
});

export default CenteredToast;
