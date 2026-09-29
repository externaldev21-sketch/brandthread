/**
 * Shared "call chrome" pieces used by every call surface (outgoing, incoming,
 * in-call, ended) so the four screens read as one continuous piece of UI
 * rather than four bolted-together components — mirrors Instagram's Calling
 * flow, where the background/header treatment is identical across states and
 * only the center content and bottom controls change.
 *
 * Monochrome hard rule: every color below comes from `useAppTheme()` except
 * the one deliberate exception, `CALL_DANGER_RED` (see its own doc comment).
 */
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { RED } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';

/**
 * The one allowed accent color in the whole call UI (end-call / decline).
 * `theme.error` is theme-tinted per preset (e.g. '#FFB4B4' on Monochrome,
 * '#FFD0D0' on Maroon/Leopard Red) rather than a guaranteed true red, so it
 * can't be used here. `components/ui/Button.tsx`'s `destructive` variant
 * already establishes the app's actual pattern for a control that must look
 * the same red on every one of the 12 presets: it imports `RED` from
 * `@/lib/theme` directly, unthemed. This reuses that same shared token
 * instead of re-introducing app/call-screen.tsx's separate hardcoded
 * `MUTE_RED`/`HANG_RED` ('#FF3B30') literals.
 * // theme-exempt: the one allowed accent, per the call-UI hard rule
 */
export const CALL_DANGER_RED = RED;

export function formatCallDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ─── CallScreenShell ──────────────────────────────────────────────────────────
// The one background/top-bar treatment every full-screen call surface shares.
// Background reads from `theme.background` (not a hardcoded near-black) so
// the call UI still renders correctly in all 12 monochrome presets, per the
// hard rule — every preset's background is already a near-black/near-dark
// tone, which is what gives the Instagram-mirrored "near-black" read.

export interface CallScreenShellProps {
  children: React.ReactNode;
  topLeft?: React.ReactNode;
  topRight?: React.ReactNode;
  style?: ViewStyle;
}

export function CallScreenShell({ children, topLeft, topRight, style }: CallScreenShellProps) {
  const { theme } = useAppTheme();
  const topInset = useHeaderTopInset();
  return (
    <View style={[styles.root, { backgroundColor: theme.background }, style]}>
      <View style={[styles.topBar, { paddingTop: topInset + 8 }]}>
        <View style={styles.topSlot}>{topLeft}</View>
        <View style={[styles.topSlot, styles.topSlotRight]}>{topRight}</View>
      </View>
      {children}
    </View>
  );
}

export function TopBarIconButton({
  name, onPress, accessibilityLabel,
}: { name: keyof typeof Feather.glyphMap; onPress: () => void; accessibilityLabel: string }) {
  const { theme } = useAppTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      noMinHeight
      style={styles.topBarBtn}
    >
      <Feather name={name} size={24} color={theme.text} />
    </PressableScale>
  );
}

// ─── Bottom control capsule ───────────────────────────────────────────────────
// "a horizontal row of circular pill-shaped controls sitting inside a
// slightly lighter rounded capsule bar" — icon-only circles, evenly spaced,
// no labels (matches Instagram; the app's existing app/call-screen.tsx uses a
// label under each icon instead — an intentional deviation here to mirror
// Instagram exactly, see the PR deviations list).

export function ControlCapsule({ children }: { children: React.ReactNode }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.capsule, { backgroundColor: theme.surfaceGlass, borderColor: theme.borderSubtle }]}>
      {children}
    </View>
  );
}

export interface ControlButtonProps {
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  /** Toggled-on visual state (e.g. camera off, muted) — a tinted/filled circle. */
  active?: boolean;
  /** The one red circle (end call). */
  danger?: boolean;
  size?: number;
}

export function ControlButton({ icon, onPress, accessibilityLabel, active, danger, size = 56 }: ControlButtonProps) {
  const { theme } = useAppTheme();
  const bg = danger ? CALL_DANGER_RED : active ? theme.text : 'transparent';
  const iconColor = danger ? theme.background : active ? theme.background : theme.text;
  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      noMinHeight
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={[
        styles.controlCircle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
        !active && !danger && { borderWidth: 1, borderColor: theme.borderSubtle },
      ]}
    >
      <Feather name={icon} size={22} color={iconColor} />
    </PressableScale>
  );
}

// ─── Large circular buttons (incoming accept/decline, ended-call rating) ─────

export interface BigCircleButtonProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  danger?: boolean;
  filled?: boolean;
  size?: number;
}

export function BigCircleButton({
  icon, label, onPress, accessibilityLabel, danger, filled, size = 64,
}: BigCircleButtonProps) {
  const { theme } = useAppTheme();
  const bg = danger ? CALL_DANGER_RED : filled ? theme.text : theme.surfaceGlass;
  const iconColor = danger ? theme.background : filled ? theme.background : theme.text;
  return (
    <View style={styles.bigBtnWrap}>
      <PressableScale
        onPress={onPress}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityRole="button"
        noMinHeight
        style={[
          styles.controlCircle,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
          !danger && !filled && { borderWidth: 1, borderColor: theme.borderSubtle },
        ]}
      >
        <Feather name={icon} size={28} color={iconColor} />
      </PressableScale>
      <Text style={[TYPE_SCALE.footnote, { color: theme.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  topSlot: { minWidth: 40, minHeight: 40, justifyContent: 'center' },
  topSlotRight: { alignItems: 'flex-end' },
  topBarBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    alignSelf: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 10,
    minWidth: '78%',
  },
  controlCircle: { alignItems: 'center', justifyContent: 'center' },
  bigBtnWrap: { alignItems: 'center', gap: 10 },
});
