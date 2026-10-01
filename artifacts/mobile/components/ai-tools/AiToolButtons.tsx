/**
 * Brandthread AI Tools — shared button system
 *
 * One primary/secondary button pair for the whole AI-tools family (Mockup
 * to Model, Remove Background, AI Photoshoot, and future tools in this
 * group). Introduced because the original per-screen buttons in this
 * family were inconsistent (a small floating square "+", bright gradient
 * pills, etc) — Dev's explicit ask was a single clean system applied
 * everywhere, not a one-off for whichever screen shipped first.
 *
 * - AiPrimaryButton: full-width solid white pill, 52px tall, Inter
 *   Semibold 16, black text/icon. Meant to be pinned above the
 *   home-indicator safe area; renders its own soft black gradient fade
 *   behind it so content scrolling underneath fades out before reaching
 *   the button instead of cutting off on a hard edge — wrap it in
 *   <AiButtonDock> for that.
 * - AiSecondaryButton: plain text (no fill) by default, or a quiet 1px
 *   outline pill with `variant="outline"` — never a small floating square
 *   button.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PressableScale } from '@/components/BrandthreadUI';
import { BG, FG, MUTED, BORDER, CARD, FONT, FS, SP, ICON, GRAD_DARK_FADE } from '@/lib/theme';
import { radius } from '@/constants/radii';

const PRIMARY_HEIGHT = 52;

interface AiPrimaryButtonProps {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  /** Small trailing detail, e.g. a credit/cost readout ("· 2 credits"). */
  detail?: string;
  accessibilityLabel?: string;
  testID?: string;
}

export function AiPrimaryButton({
  label, onPress, icon, disabled, loading, detail, accessibilityLabel, testID,
}: AiPrimaryButtonProps) {
  const inactive = !!disabled || !!loading;
  return (
    <PressableScale
      onPress={() => {
        if (inactive) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      style={[pS.root, inactive && pS.rootDisabled]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator size="small" color={BG} />
      ) : (
        <>
          {icon && <Feather name={icon} size={ICON.md} color={inactive ? MUTED : BG} />}
          <Text style={[pS.label, inactive && pS.labelDisabled]}>{label}</Text>
          {detail ? <Text style={[pS.detail, inactive && pS.labelDisabled]}>{detail}</Text> : null}
        </>
      )}
    </PressableScale>
  );
}

/** Wraps a pinned AiPrimaryButton with the soft gradient fade behind it. */
export function AiButtonDock({ children, bottomInset, style }: {
  children: React.ReactNode;
  bottomInset: number;
  style?: ViewStyle;
}) {
  return (
    <View style={[dS.root, style]} pointerEvents="box-none">
      <LinearGradient colors={GRAD_DARK_FADE} style={dS.fade} pointerEvents="none" />
      <View style={[dS.content, { paddingBottom: Math.max(bottomInset, SP.md) }]}>
        {children}
      </View>
    </View>
  );
}

interface AiSecondaryButtonProps {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'plain' | 'outline';
  accessibilityLabel?: string;
}

export function AiSecondaryButton({
  label, onPress, icon, disabled, loading, variant = 'plain', accessibilityLabel,
}: AiSecondaryButtonProps) {
  const inactive = !!disabled || !!loading;
  return (
    <PressableScale
      onPress={() => {
        if (inactive) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={[sS.root, variant === 'outline' && sS.rootOutline, inactive && sS.rootDisabled]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={FG} />
      ) : (
        <>
          {icon && <Feather name={icon} size={ICON.sm} color={inactive ? MUTED : FG} />}
          <Text style={[sS.label, inactive && sS.labelDisabled]}>{label}</Text>
        </>
      )}
    </PressableScale>
  );
}

const pS = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    height: PRIMARY_HEIGHT,
    borderRadius: radius.md,
    backgroundColor: FG,
    paddingHorizontal: SP.lg,
  },
  rootDisabled: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  label: {
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    color: BG,
  },
  labelDisabled: {
    color: MUTED,
  },
  detail: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: BG,
    opacity: 0.6,
  },
});

const dS = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 140,
  },
  content: {
    paddingHorizontal: SP.lg,
    paddingTop: SP.lg,
  },
});

const sS = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
    paddingVertical: SP.sm,
    paddingHorizontal: SP.md,
  },
  rootOutline: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: radius.sm,
  },
  rootDisabled: {
    opacity: 0.5,
  },
  label: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: FG,
  },
  labelDisabled: {
    color: MUTED,
  },
});
