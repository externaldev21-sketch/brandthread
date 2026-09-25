/**
 * Brandthread Design System — small animated primitives (Phase 1)
 *
 * Tab icon bounce-on-selection already exists (components/tab-bar/TabBarParts.tsx
 * useTabMotion) and is left as-is. This file adds the remaining primitives
 * called out in the Phase 1 spec: a like/heart pop, a Follow → Following
 * morph, and a count-up number, for later screen-level adoption.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Feather, FontAwesome } from '@expo/vector-icons';
import Animated, {
  interpolateColor, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { hapticSuccessAction, hapticToggle } from '@/lib/haptics';
import { FONT, RED } from '@/lib/theme';
import { TABULAR_NUMS, TYPE_SCALE, TypeRoleName } from '@/constants/typography';

// ─── Heart pop ────────────────────────────────────────────────────────────────

const HEART_POP_UP = { mass: 0.5, stiffness: 650, damping: 12 } as const;
const HEART_POP_SETTLE = { mass: 0.6, stiffness: 320, damping: 14 } as const;

export interface HeartToggleProps {
  liked: boolean;
  onChange: (next: boolean) => void;
  size?: number;
  accessibilityLabel?: string;
  /** Optional secondary action (e.g. "save to a specific collection"). */
  onLongPress?: () => void;
}

/** A heart icon that pops (scales past 1, then settles back to 1) when liked. */
export function HeartToggle({ liked, onChange, size = 22, accessibilityLabel, onLongPress }: HeartToggleProps) {
  const palette = useColors();
  const scale = useSharedValue(1);
  const wasLiked = useRef(liked);

  useEffect(() => {
    if (liked && !wasLiked.current) {
      scale.set(withSequence(withSpring(1.3, HEART_POP_UP), withSpring(1, HEART_POP_SETTLE)));
    }
    wasLiked.current = liked;
  }, [liked, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (liked ? 'Unlike' : 'Like')}
      accessibilityState={{ selected: liked }}
      onPress={() => { hapticSuccessAction(); onChange(!liked); }}
      onLongPress={onLongPress}
      hitSlop={8}
    >
      <Animated.View style={style}>
        {liked
          ? <FontAwesome name="heart" size={size} color={RED} />
          : <Feather name="heart" size={size} color={palette.mutedForeground} />}
      </Animated.View>
    </Pressable>
  );
}

// ─── Follow button morph ──────────────────────────────────────────────────────

export interface FollowMorphButtonProps {
  following: boolean;
  onChange: (next: boolean) => void;
  small?: boolean;
}

/** Text/style cross-fades between "Follow" (solid) and "Following" (outline). */
export function FollowMorphButton({ following, onChange, small }: FollowMorphButtonProps) {
  const { theme } = useAppTheme();
  const progress = useSharedValue(following ? 1 : 0);

  useEffect(() => {
    progress.set(withTiming(following ? 1 : 0, { duration: 180 }));
  }, [following, progress]);

  const style = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [theme.accent, 'transparent']),
    borderWidth: 1,
    borderColor: interpolateColor(progress.value, [0, 1], [theme.accent, theme.text]),
  }));
  const textStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [theme.onAccent, theme.text]),
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={following ? 'Following, tap to unfollow' : 'Follow'}
      accessibilityState={{ selected: following }}
      onPress={() => { hapticToggle(); onChange(!following); }}
    >
      <Animated.View style={[styles.followBtn, small && styles.followBtnSmall, style]}>
        <Animated.Text style={[TYPE_SCALE.footnote, { fontFamily: FONT.semibold }, textStyle]}>
          {following ? 'Following' : 'Follow'}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

// ─── Count-up number ──────────────────────────────────────────────────────────

export interface CountUpNumberProps {
  value: number;
  role?: TypeRoleName;
  color?: string;
  durationMs?: number;
  formatter?: (value: number) => string;
}

/** Animates the displayed integer toward `value` whenever it changes. Tabular figures keep width stable. */
export function CountUpNumber({ value, role = 'headline', color, durationMs = 400, formatter }: CountUpNumberProps) {
  const palette = useColors();
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    startRef.current = null;
    const tick = (timestamp: number) => {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [value, durationMs]);

  const text = formatter ? formatter(display) : String(display);
  return (
    <Text style={[TYPE_SCALE[role], TABULAR_NUMS, { color: color ?? palette.foreground }]}>{text}</Text>
  );
}

const styles = StyleSheet.create({
  followBtn: { height: 36, paddingHorizontal: 18, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
  followBtnSmall: { height: 30, paddingHorizontal: 14 },
});
