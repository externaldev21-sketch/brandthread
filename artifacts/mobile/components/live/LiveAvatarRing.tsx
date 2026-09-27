/**
 * LIVE ring for a creator avatar (TikTok / Instagram style): a static red
 * ring drawn *outside* the avatar, with a soft red glow, plus a small
 * "LIVE" tag on its bottom edge. Drawn with absolute positioning so
 * wrapping an existing avatar never changes its layout size. Renders
 * children untouched when `live` is false.
 *
 * Deliberately no scale/size animation anywhere (the owner's explicit
 * direction: "it can just be a red circle around the profile picture
 * like glowing… not bouncing in and out") — the ring and avatar never
 * change size, and nothing here ever moves the layout. The only motion is
 * the glow's own shadow opacity gently breathing, which `reduceMotion`
 * turns off entirely (a static glow).
 */
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { FONT } from '@/lib/theme';
import { useLiveStreamForHost, useOpenLive } from '@/lib/live/useLiveDirectory';

export const LIVE_RED = '#FF3B30';

export function LiveAvatarRing({
  live,
  size,
  children,
  ringGap = 3,
  ringWidth = 2,
  showTag = true,
  testID,
}: {
  live: boolean;
  /** Diameter of the wrapped avatar. */
  size: number;
  children: React.ReactNode;
  /** Space between avatar edge and ring. -2 draws the ring on the avatar's
   *  own edge (nothing outside its box) for clipping containers. */
  ringGap?: number;
  /** Ring stroke width. Defaults to 2 (existing call sites); the feed rail
   *  passes 1.5 for a thinner ring at its small 38pt avatar size. */
  ringWidth?: number;
  showTag?: boolean;
  testID?: string;
}) {
  // Glow shadow opacity only — never a scale/transform, so the ring and
  // avatar never change size and the layout never moves. Starts at the
  // brighter end of the breathing range so a freshly-mounted ring doesn't
  // pop in dim.
  const glowOpacity = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    if (!live) return undefined;
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled?.().then(reduce => {
      if (cancelled || reduce) return;
      loop = Animated.loop(Animated.sequence([
        Animated.timing(glowOpacity, { toValue: 0.45, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(glowOpacity, { toValue: 0.8, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]));
      loop.start();
    }).catch(() => {});
    return () => { cancelled = true; loop?.stop(); };
  }, [live, glowOpacity]);

  if (!live) return <>{children}</>;

  const ringSize = size + ringGap * 2 + 4;
  const tagScale = Math.max(0.75, Math.min(1.15, size / 48));
  // An inset ring sits on the avatar's own edge, so it must paint above it.
  const inset = ringGap < 0;
  const ring = (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        { borderWidth: ringWidth },
        inset && { borderWidth: ringWidth + 0.5 },
        {
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
          top: -(ringGap + 2),
          left: -(ringGap + 2),
          // Soft glow around the static ring — shadow only, no transform.
          // react-native-web translates these shadow* props to a CSS
          // box-shadow automatically, so this covers both native (iOS —
          // Android's View shadow is a plain elevation, uncolored, a known
          // RN limitation) and web with one style.
          shadowColor: LIVE_RED,
          shadowOffset: { width: 0, height: 0 },
          shadowRadius: 7,
          shadowOpacity: glowOpacity,
          elevation: 6,
        },
      ]}
    />
  );
  return (
    <View style={{ width: size, height: size }} testID={testID}>
      {!inset && ring}
      {children}
      {inset && ring}
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
  hostId, size, children, ringGap, ringWidth, showTag, testID, pressToWatch = false, hostName,
}: {
  hostId: string | null | undefined;
  size: number;
  children: React.ReactNode;
  ringGap?: number;
  ringWidth?: number;
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
      ringWidth={ringWidth}
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
      // react-native-web renders a "button" role as a real <button>, and
      // these avatars sit inside rows that already are one — nested
      // <button>s are invalid HTML, so web keeps it a labelled div.
      accessibilityRole={Platform.OS === 'web' ? undefined : 'button'}
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
