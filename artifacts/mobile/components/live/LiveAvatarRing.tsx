/**
 * LIVE ring for a creator avatar (TikTok / Instagram style): a pulsing red
 * ring drawn *outside* the avatar plus a small "LIVE" tag on its bottom
 * edge. Drawn with absolute positioning so wrapping an existing avatar never
 * changes its layout size. Renders children untouched when `live` is false.
 */
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { FONT } from '@/lib/theme';
import { useLiveStreamForHost, useOpenLive } from '@/lib/live/useLiveDirectory';

export const LIVE_RED = '#FF3B30';

export function LiveAvatarRing({
  live,
  size,
  children,
  ringGap = 3,
  showTag = true,
  testID,
}: {
  live: boolean;
  /** Diameter of the wrapped avatar. */
  size: number;
  children: React.ReactNode;
  /** Space between avatar edge and ring. */
  ringGap?: number;
  showTag?: boolean;
  testID?: string;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!live) return undefined;
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled?.().then(reduce => {
      if (cancelled || reduce) return;
      loop = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: Platform.OS !== 'web' }),
      ]));
      loop.start();
    }).catch(() => {});
    return () => { cancelled = true; loop?.stop(); };
  }, [live, pulse]);

  if (!live) return <>{children}</>;

  const ringSize = size + ringGap * 2 + 4;
  const tagScale = Math.max(0.75, Math.min(1.15, size / 48));
  return (
    <View style={{ width: size, height: size }} testID={testID}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          {
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            top: -(ringGap + 2),
            left: -(ringGap + 2),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] }),
          },
        ]}
      />
      {children}
      {showTag && (
        <View pointerEvents="none" style={[styles.tagWrap, { bottom: -(ringGap + 6) * tagScale }]}>
          <View style={[styles.tag, { transform: [{ scale: tagScale }] }]}>
            <Text style={styles.tagText}>LIVE</Text>
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * `LiveAvatarRing` driven by the shared live directory: rings the avatar
 * whenever `hostId` is live right now. Drop-in wrapper — call sites only
 * wrap their existing avatar JSX.
 */
export function LiveHostRing({
  hostId, size, children, ringGap, showTag, testID, pressToWatch = false, hostName,
}: {
  hostId: string | null | undefined;
  size: number;
  children: React.ReactNode;
  ringGap?: number;
  showTag?: boolean;
  testID?: string;
  /** While live, the avatar itself becomes a button that opens the stream
   *  (for rows whose whole cell already navigates somewhere else). */
  pressToWatch?: boolean;
  hostName?: string;
}) {
  const streamId = useLiveStreamForHost(hostId);
  const openLive = useOpenLive();
  const ring = (
    <LiveAvatarRing
      live={!!streamId}
      size={size}
      ringGap={ringGap}
      showTag={showTag}
      testID={streamId ? testID ?? `live-ring-${hostId}` : undefined}
    >
      {children}
    </LiveAvatarRing>
  );
  if (!pressToWatch || !streamId) return ring;
  return (
    <Pressable
      onPress={() => openLive({ streamId, hostId })}
      accessibilityRole="button"
      accessibilityLabel={`${hostName ?? 'This creator'} is live. Watch now`}
      hitSlop={4}
    >
      {ring}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute', borderWidth: 2, borderColor: LIVE_RED },
  tagWrap: { position: 'absolute', left: -20, right: -20, alignItems: 'center' },
  tag: {
    backgroundColor: LIVE_RED,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1.5,
    borderColor: '#000',
  },
  tagText: { color: '#fff', fontFamily: FONT.bold, fontSize: 8.5, letterSpacing: 0.8 },
});
