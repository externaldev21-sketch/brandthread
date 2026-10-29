/**
 * Upload progress hairline (micro-interactions pack 2, item 27): while a
 * post publishes in the background, a 2pt silver line grows across the very
 * top of the screen (just under the status bar) with the upload's real
 * progress (lib/postUploadProgress), fills on success and fades away. A
 * failed upload leaves the line in the muted tone; retrying restarts it.
 *
 * Mobbin reference: Instagram — posting returns you to the feed and a thin
 * progress bar runs along the top while the post uploads.
 *
 * Global, mounted once in app/_layout.tsx; pointer-events none so it never
 * blocks a tap. Reduce Motion: width jumps instead of easing.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { usePostUploadEntry } from '@/lib/postUploadProgress';
import { isMotionReduced } from '@/lib/reduceMotion';

const ND = Platform.OS !== 'web';

export function UploadHairline() {
  const entry = usePostUploadEntry();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const target = entry ? (entry.status === 'success' ? 1 : entry.progress) : 0;

  useEffect(() => {
    const reduce = isMotionReduced();
    if (!entry) {
      Animated.timing(opacity, { toValue: 0, duration: reduce ? 0 : 220, useNativeDriver: ND })
        .start(({ finished }) => { if (finished) progress.setValue(0); });
      return;
    }
    opacity.setValue(1);
    if (reduce) { progress.setValue(target); return; }
    Animated.timing(progress, { toValue: target, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start();
  }, [entry, opacity, progress, target]);

  // scaleX from the left edge (native-driver friendly) instead of animating width.
  const scaleX = progress.interpolate({ inputRange: [0, 1], outputRange: [0.0001, 1] });
  return (
    <View pointerEvents="none" style={[styles.track, { top: insets.top }]} testID={entry ? 'upload-hairline' : undefined}>
      <Animated.View
        style={[
          styles.bar,
          {
            backgroundColor: entry?.status === 'failed' ? theme.muted : theme.text,
            opacity,
            transform: [{ scaleX }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { position: 'absolute', left: 0, right: 0, height: 2, zIndex: 900, elevation: 900, overflow: 'hidden' },
  bar: { height: 2, width: '100%', transformOrigin: 'left center' },
});
