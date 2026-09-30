/**
 * `fullscreen` variant — for complex screens (Design Studio, Studio menu
 * scrub). Blurred/dimmed full-screen background, title/subtitle, and a
 * vertical list of animated gesture icons + labels. Matches the house style
 * already established by components/FeedGestureGuide.tsx (the feed's own
 * first-run overlay Dev pointed to) — same blur/dim treatment, same
 * animation timing, same "tap anywhere to continue" dismiss affordance —
 * generalized here into a reusable, content-driven component instead of a
 * one-off per screen.
 *
 * Also the reskin target for the Telegram "Watching Stories"
 * (https://mobbin.com/screens/44cc1608-a319-4252-961b-26ee9db04dfa) and
 * Polarsteps (https://mobbin.com/screens/705552aa-40c7-4c47-b67d-292ca45ad647)
 * references cited in the PR.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { FONT, FS, SP, ON_DARK_MUTED } from '@/lib/theme';
import { GestureGlyph } from './GestureGlyph';
import type { GestureKind } from './types';

export interface FullScreenGuideRow {
  gesture: GestureKind;
  title: string;
  body: string;
}

export interface FullScreenGuideTipProps {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  subtitle?: string;
  rows: FullScreenGuideRow[];
  dismissLabel?: string;
  reduceMotion?: boolean;
  testID?: string;
}

export function FullScreenGuideTip({
  visible, onDismiss, title, subtitle, rows, dismissLabel = 'Tap anywhere to continue', reduceMotion = false, testID,
}: FullScreenGuideTipProps) {
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: visible ? 1 : 0, duration: reduceMotion ? 1 : 220, useNativeDriver: true }).start();
  }, [visible, fade, reduceMotion]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]}
      accessibilityViewIsModal
      testID={testID ?? 'first-run-tip-fullscreen'}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityRole="button" accessibilityLabel={dismissLabel}>
        <BlurView intensity={Platform.OS === 'ios' ? 46 : 60} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.dim]} />
        <View style={styles.content} pointerEvents="none">
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

          <View style={styles.rows}>
            {rows.map((row, i) => (
              <View key={i} style={styles.row}>
                <View style={styles.glyphSlot}>
                  <GestureGlyph gesture={row.gesture} size={30} reduceMotion={reduceMotion} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{row.title}</Text>
                  <Text style={styles.rowSubtitle}>{row.body}</Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.dismissHint}>{dismissLabel}</Text>
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
  subtitle: { color: ON_DARK_MUTED, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', marginTop: 6, marginBottom: 40 },
  rows: { width: '100%', gap: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  glyphSlot: { width: 56, height: 40, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowTitle: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: FS.base },
  rowSubtitle: { color: ON_DARK_MUTED, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  dismissHint: { color: ON_DARK_MUTED, fontFamily: FONT.medium, fontSize: FS.xs, marginTop: 48, letterSpacing: 0.3 },
});
