/**
 * InlineFeedback — shared compact primitives for loading, error, and empty states.
 *
 * All three are intentionally small and calm — they fit inline within list
 * sections, comment threads, and search results without dominating the layout.
 *
 * Design tokens: read live from the active theme via useColors() — never
 * hardcoded, so every surface re-skins correctly across all app themes.
 * Icons: Feather only.
 * No external dependencies beyond BrandthreadUI tokens.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, ViewStyle, StyleProp,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';

// ─── InlineSpinner ────────────────────────────────────────────────────────────
/**
 * Compact pulsing dots — the "pending" primitive for inline use.
 * Replaces bare ActivityIndicator in comment lists and section heads.
 *
 * Usage:
 *   <InlineSpinner />                      — default, centered row
 *   <InlineSpinner label="Loading…" />     — with descriptive label
 *   <InlineSpinner style={…} />            — position override
 */
interface InlineSpinnerProps {
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function InlineSpinner({ label, style }: InlineSpinnerProps) {
  const colors = useColors();
  const sp = useMemo(() => makeSpinnerStyles(colors), [colors]);
  const dots = [0, 1, 2].map(() => useRef(new Animated.Value(0.3)).current);

  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot, { toValue: 1, duration: 380, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 380, useNativeDriver: true }),
        ]),
      ),
    );
    anims.forEach(a => a.start());
    return () => anims.forEach(a => a.stop());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[sp.root, style]} accessibilityRole="progressbar" accessibilityLabel={label ?? 'Loading'}>
      <View style={sp.dots}>
        {dots.map((dot, i) => (
          <Animated.View key={i} style={[sp.dot, { opacity: dot }]} />
        ))}
      </View>
      {label ? <Text style={sp.label}>{label}</Text> : null}
    </View>
  );
}

const makeSpinnerStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingVertical: SP.md },
  dots:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.mutedForeground },
  label: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.subtle },
});

// ─── InlineError ─────────────────────────────────────────────────────────────
/**
 * Compact single-line error with optional retry action.
 * Used in place of Alert() for non-destructive fetch failures.
 *
 * Usage:
 *   <InlineError message="Could not load comments." onRetry={load} />
 *   <InlineError message="Post failed." />   — no retry (e.g. temporary sending failure)
 */
interface InlineErrorProps {
  message: string;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function InlineError({ message, onRetry, style }: InlineErrorProps) {
  const colors = useColors();
  const ie = useMemo(() => makeErrorStyles(colors), [colors]);
  return (
    <View style={[ie.root, style]}>
      <Feather name="alert-circle" size={14} color={colors.destructive} style={{ flexShrink: 0 }} />
      <Text style={ie.message} numberOfLines={2}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity
          onPress={onRetry}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          style={ie.retryBtn}
        >
          <Text style={ie.retryText}>Retry</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const makeErrorStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root:      { flexDirection: 'row', alignItems: 'center', gap: SP.sm,
               backgroundColor: `${colors.destructive}22`, borderRadius: RADIUS.sm,
               borderWidth: 1, borderColor: `${colors.destructive}33`,
               paddingHorizontal: SP.sm, paddingVertical: SP.xs,
               marginHorizontal: SP.md, marginVertical: SP.xs },
  message:   { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: colors.destructive },
  retryBtn:  { paddingLeft: SP.xs },
  retryText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: colors.destructive },
});

// ─── InlineEmpty ─────────────────────────────────────────────────────────────
/**
 * Compact no-results state — icon + label + optional sub label.
 * Smaller and calmer than the full EmptyState component.
 * Suited to inline list sections (comment threads, search, discover sections).
 *
 * Usage:
 *   <InlineEmpty icon="message-circle" label="No comments yet — drop the first one." />
 *   <InlineEmpty icon="search" label="No results." sub="Try a broader phrase." />
 */
interface InlineEmptyProps {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  sub?: string;
  style?: StyleProp<ViewStyle>;
}

export function InlineEmpty({ icon, label, sub, style }: InlineEmptyProps) {
  const colors = useColors();
  const iem = useMemo(() => makeEmptyStyles(colors), [colors]);
  return (
    <View style={[iem.root, style]}>
      <View style={iem.iconWrap}>
        <Feather name={icon} size={20} color={colors.subtle} />
      </View>
      <Text style={iem.label}>{label}</Text>
      {sub ? <Text style={iem.sub}>{sub}</Text> : null}
    </View>
  );
}

const makeEmptyStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root:    { alignItems: 'center', justifyContent: 'center', gap: SP.xs,
             paddingVertical: SP.lg, paddingHorizontal: SP.xl },
  iconWrap:{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card,
             borderWidth: 1, borderColor: colors.border,
             alignItems: 'center', justifyContent: 'center', marginBottom: SP.xs },
  label:   { fontSize: FS.sm, fontFamily: FONT.medium, color: colors.mutedForeground, textAlign: 'center' },
  sub:     { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.subtle, textAlign: 'center', maxWidth: 280 },
});

// ─── SectionError ────────────────────────────────────────────────────────────
/**
 * Section-level error: tighter than InlineError, used inside discover sections
 * where each section manages its own retry.
 *
 * Usage:
 *   {highDemandError ? <SectionError message={highDemandError} onRetry={fetchHighDemand} /> : null}
 */
interface SectionErrorProps {
  message: string;
  onRetry: () => void;
  style?: StyleProp<ViewStyle>;
}

export function SectionError({ message, onRetry, style }: SectionErrorProps) {
  const colors = useColors();
  const se = useMemo(() => makeSectionErrorStyles(colors), [colors]);
  return (
    <View style={[se.root, style]}>
      <Feather name="wifi-off" size={13} color={colors.mutedForeground} />
      <Text style={se.message} numberOfLines={1}>{message}</Text>
      <TouchableOpacity
        onPress={onRetry}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={`Retry — ${message}`}
        style={se.retryBtn}
      >
        <Feather name="refresh-cw" size={12} color={colors.mutedForeground} />
        <Text style={se.retryText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeSectionErrorStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root:      { flexDirection: 'row', alignItems: 'center', gap: SP.sm,
               backgroundColor: colors.card, borderRadius: RADIUS.sm,
               borderWidth: 1, borderColor: colors.border,
               paddingHorizontal: SP.sm, paddingVertical: 10 },
  message:   { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
  retryBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  retryText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: colors.mutedForeground },
});
