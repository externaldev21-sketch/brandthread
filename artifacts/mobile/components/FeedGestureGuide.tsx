/**
 * FeedGestureGuide — first-time buyer coach screen for the video feed.
 * Modeled on Instagram's "Watching stories" coach mark: a dim/blurred
 * overlay, a title and subtitle, four animated gesture rows, and
 * "Tap to keep watching". Any tap dismisses it; shown once per account
 * (see FEED_GESTURE_GUIDE_SEEN_KEY / dismissFeedGestureGuide below).
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { FONT, FS, SP } from '@/lib/theme';

export { feedGestureGuideKey, hasSeenFeedGestureGuide, markFeedGestureGuideSeen } from '@/lib/feedGestureGuideStorage';

// ─── Animated gesture glyphs — simple line-art hand cues, no image assets ────

function AnimatedGlyph({ children }: { children: (t: Animated.Value) => React.ReactNode }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  return <>{children(t)}</>;
}

function SwipeUpGlyph() {
  return (
    <AnimatedGlyph>
      {t => (
        <Animated.View style={{ transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [6, -6] }) }], opacity: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.35, 1, 0.35] }) }}>
          <Feather name="chevrons-up" size={30} color="#FFFFFF" />
        </Animated.View>
      )}
    </AnimatedGlyph>
  );
}

function DoubleTapGlyph() {
  return (
    <AnimatedGlyph>
      {t => (
        <Animated.View style={{ transform: [{ scale: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.8, 1.15, 0.8] }) }] }}>
          <Feather name="heart" size={28} color="#FFFFFF" />
        </Animated.View>
      )}
    </AnimatedGlyph>
  );
}

function HoldRightGlyph() {
  return (
    <AnimatedGlyph>
      {t => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Animated.View style={{ opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }}>
            <Feather name="circle" size={10} color="#FFFFFF" style={{ marginRight: -2 }} />
          </Animated.View>
          <Animated.View style={{ transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.15] }) }] }}>
            <Text style={glyphStyles.speedText}>2x</Text>
          </Animated.View>
        </View>
      )}
    </AnimatedGlyph>
  );
}

function ScrubGlyph() {
  return (
    <AnimatedGlyph>
      {t => (
        <View style={glyphStyles.scrubTrack}>
          <Animated.View
            style={[glyphStyles.scrubDot, { transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-14, 14] }) }] }]}
          />
        </View>
      )}
    </AnimatedGlyph>
  );
}

const glyphStyles = StyleSheet.create({
  speedText: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 16 },
  scrubTrack: { width: 44, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.28)', justifyContent: 'center' },
  scrubDot: { position: 'absolute', left: '50%', width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFFFFF', marginLeft: -5 },
});

const ROWS: { key: string; glyph: React.ComponentType; title: string; subtitle: string }[] = [
  { key: 'swipe', glyph: SwipeUpGlyph, title: 'Swipe up', subtitle: 'Next video' },
  { key: 'tap', glyph: DoubleTapGlyph, title: 'Double tap', subtitle: 'Like' },
  { key: 'hold', glyph: HoldRightGlyph, title: 'Hold the right side', subtitle: '2x speed' },
  { key: 'scrub', glyph: ScrubGlyph, title: 'Drag the bar', subtitle: 'Scrub through the video' },
];

export function FeedGestureGuide({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: visible ? 1 : 0, duration: 220, useNativeDriver: true }).start();
  }, [visible, fade]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]}
      accessibilityViewIsModal
      testID="feed-gesture-guide"
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Tap to keep watching">
        <BlurView
          intensity={Platform.OS === 'ios' ? 46 : 60}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, styles.dim]} />
        <View style={styles.content} pointerEvents="none">
          <Text style={styles.title}>Watching Threads</Text>
          <Text style={styles.subtitle}>A few gestures to get you moving</Text>

          <View style={styles.rows}>
            {ROWS.map(row => {
              const Glyph = row.glyph;
              return (
                <View key={row.key} style={styles.row}>
                  <View style={styles.glyphSlot}>
                    <Glyph />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{row.title}</Text>
                    <Text style={styles.rowSubtitle}>{row.subtitle}</Text>
                  </View>
                </View>
              );
            })}
          </View>

          <Text style={styles.dismissHint}>Tap to keep watching</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 9999, elevation: 9999 },
  dim: { backgroundColor: 'rgba(0,0,0,0.38)' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  title: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: FS.xxl, textAlign: 'center' },
  subtitle: { color: 'rgba(255,255,255,0.72)', fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', marginTop: 6, marginBottom: 40 },
  rows: { width: '100%', gap: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  glyphSlot: { width: 56, height: 40, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowTitle: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: FS.base },
  rowSubtitle: { color: 'rgba(255,255,255,0.65)', fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  dismissHint: { color: 'rgba(255,255,255,0.55)', fontFamily: FONT.medium, fontSize: FS.xs, marginTop: 48, letterSpacing: 0.3 },
});
