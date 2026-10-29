import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, runOnJS, useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Icon } from '@/components/ui/Icon';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { showAlert } from '@/lib/actionSheet';
import { hapticFollow } from '@/lib/haptics';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FILL_ELEVATED, FONT, FS, RADIUS, SP, TEXT_DISABLED } from '@/lib/theme';
import { useApi } from '@/lib/api';
import { canUsePreviewFollow, getPreviewFollowing, setPreviewFollowing } from '@/lib/previewFollowStore';
import { apiErrorMessage } from '@/lib/safety';
import { enqueueEngagementRetry, ensureEngagementRetryPump, isRetryableFailure } from '@/lib/engagementRetryQueue';

export type FollowState = {
  isFollowing: boolean;
  isFollowedBy: boolean;
  isMutual: boolean;
};

type Props = {
  userId: string;
  initial: FollowState;
  /** Called after a successful follow/unfollow so the parent can sync counts. */
  onChange?: (next: FollowState, delta: 1 | -1) => void;
  disabled?: boolean;
  size?: 'default' | 'compact';
  /** Runs before following/unfollowing; return false to stop (e.g. useSignInGate's requireSignIn for guests). */
  guard?: () => boolean;
  style?: any;
  /** Shown when a follow/unfollow fails (after the rollback). Defaults to an alert. */
  onError?: (message: string) => void;
  /** The account's display name, for the unfollow confirm's title ("Unfollow {name}?"). */
  name?: string;
};

/**
 * Optimistic follow/unfollow control. Flips state immediately on tap and
 * rolls back if the request fails — the network round trip never blocks the
 * UI. Wire `onChange` to update follower counts shown elsewhere on screen.
 *
 * Never a silent no-op: seeded preview people (`preview-*` ids) follow
 * through lib/previewFollowStore, a signed-out viewer is sent to sign in,
 * and a failed request rolls back AND says so (`onError`, else an alert).
 * Unfollowing confirms first (the Following list's two-option sheet,
 * app/connections.tsx), so no screen using this button unfollows on one tap.
 *
 * Instagram's in-place morph: the label swaps the instant it's tapped (no
 * spinner — the write is optimistic), the new label fades in over the old
 * one and the pill's width eases to the new label's width, so neighbours
 * slide rather than jump. The resting look of each state is unchanged.
 */
export default function FollowButton({ userId, initial, onChange, disabled, size = 'default', style, onError, guard, name }: Props) {
  const { theme } = useAppTheme();
  const api = useApi();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const previewId = canUsePreviewFollow(userId);
  const [state, setState] = useState<FollowState>(() => {
    const previewFollowing = previewId ? getPreviewFollowing(userId) : undefined;
    return previewFollowing === undefined ? initial : { ...initial, isFollowing: previewFollowing, isMutual: previewFollowing && initial.isFollowedBy };
  });
  const [busy, setBusy] = useState(false);
  const styles = React.useMemo(() => makeStyles(theme, size), [theme, size]);

  // The parent may learn the real follow state after first render (an async
  // status fetch) — adopt it, unless the viewer has already tapped.
  const touchedRef = useRef(false);
  useEffect(() => {
    if (touchedRef.current || (previewId && getPreviewFollowing(userId) !== undefined)) return;
    setState(initial);
  }, [initial.isFollowing, initial.isFollowedBy, initial.isMutual]); // eslint-disable-line react-hooks/exhaustive-deps

  const reportError = (message: string) => {
    if (onError) onError(message);
    else showAlert('Something went wrong', message);
  };

  const handlePress = () => {
    if (busy || disabled || userId.startsWith('u_')) return;
    if (guard && !guard()) return;
    touchedRef.current = true;
    if (!previewId && !isSignedIn) {
      router.push('/sign-in' as never);
      return;
    }
    if (!state.isFollowing) { void toggle(); return; }
    showActionSheet(name ? `Unfollow ${name}?` : 'Unfollow this account?', undefined, [
      { text: 'Unfollow', style: 'destructive', onPress: () => { void toggle(); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const toggle = async () => {
    const wasFollowing = state.isFollowing;
    const optimistic: FollowState = wasFollowing
      ? { isFollowing: false, isFollowedBy: state.isFollowedBy, isMutual: false }
      : { isFollowing: true, isFollowedBy: state.isFollowedBy, isMutual: state.isFollowedBy };

    hapticFollow(!wasFollowing);
    setState(optimistic);
    setBusy(true);
    onChange?.(optimistic, wasFollowing ? -1 : 1);

    try {
      if (previewId) {
        setPreviewFollowing(userId, !wasFollowing);
      } else if (wasFollowing) {
        await api.social.unfollow(userId);
      } else {
        const res = await api.social.follow(userId);
        if (res?.status === 'requested') {
          // Private account: request sent, not following yet.
          setState(state);
          onChange?.(state, -1);
        }
      }
    } catch (error) {
      // Bad connection: keep what the user tapped and deliver it in the
      // background (lib/engagementRetryQueue.ts). Only a real refusal rolls back.
      if (isRetryableFailure(error)) {
        void enqueueEngagementRetry({ kind: 'follow', targetId: userId, payload: { value: wasFollowing ? 'unfollow' : undefined } });
        ensureEngagementRetryPump();
        return;
      }
      // Roll back on failure.
      setState(state);
      onChange?.(state, wasFollowing ? 1 : -1);
      reportError(apiErrorMessage(error, wasFollowing ? 'Could not unfollow. Try again.' : 'Could not follow. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  // Width morph: at rest the content lays out naturally (exactly as before).
  // Only when the label changes is the width pinned to the old label's width
  // and eased to the new one, then released again.
  const contentWidth = useSharedValue(0);
  const morphing = useSharedValue(false);
  const lastMeasured = useRef<{ label: string; width: number } | null>(null);
  const endMorph = () => { morphing.value = false; };
  const onMeasure = (e: LayoutChangeEvent, measuredLabel: string) => {
    const w = Math.ceil(e.nativeEvent.layout.width);
    if (w <= 0) return;
    const prev = lastMeasured.current;
    lastMeasured.current = { label: measuredLabel, width: w };
    // First layout, or the same label re-measured (e.g. the font finished
    // loading): nothing to animate.
    if (!prev || prev.label === measuredLabel || prev.width === w) return;
    contentWidth.value = prev.width;
    morphing.value = true;
    contentWidth.value = withTiming(w, { duration: 220, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(endMorph)();
    });
  };
  const widthStyle = useAnimatedStyle(() => (morphing.value ? { width: contentWidth.value } : {}));

  const label = state.isFollowing
    ? (state.isMutual ? 'Friends' : 'Following')
    : (state.isFollowedBy ? 'Follow back' : 'Follow');
  const isPrimary = !state.isFollowing;
  const fg = disabled ? TEXT_DISABLED : isPrimary ? theme.onAccent : theme.text;
  const content = (
    <>
      {state.isFollowing && <Icon name="check" size={14} color={fg} style={styles.icon} />}
      <Text style={[styles.label, styles.noShrink, { color: fg }]}>{label}</Text>
    </>
  );

  return (
    <Pressable
      testID="follow-button"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || busy), busy }}
      hitSlop={size === 'compact' ? { top: 6, bottom: 6 } : undefined}
      disabled={disabled || busy}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        // Disabled: solid gray fill + gray label, never a faded button.
        disabled
          ? { backgroundColor: FILL_ELEVATED }
          : isPrimary
            ? { backgroundColor: theme.accent }
            : { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border },
        pressed && styles.pressed,
        style,
      ]}
    >
      <Animated.View style={[styles.morph, widthStyle]}>
        <Animated.View key={label} entering={FadeIn.duration(160)} style={[styles.row, styles.noShrink]}>
          {content}
        </Animated.View>
        {/* Invisible copy at natural width: drives the width ease above. */}
        <View style={[styles.measureBox, { width: MEASURE_ROOM }]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.row} onLayout={(e) => onMeasure(e, label)}>{content}</View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

/** Room for the invisible measuring copy to lay out at natural width (it is
 *  clipped by the morph box, never seen, never scrollable). */
const MEASURE_ROOM = 1000;

const makeStyles = (theme: AppThemePreset, size: 'default' | 'compact') => StyleSheet.create({
  base: {
    minHeight: size === 'compact' ? 32 : 40,
    paddingHorizontal: size === 'compact' ? SP.sm : SP.md,
    borderRadius: RADIUS.pill ?? 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  icon: { marginRight: 4 },
  morph: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center' },
  noShrink: { flexShrink: 0 },
  measureBox: { position: 'absolute', left: 0, top: 0, flexDirection: 'row', alignItems: 'flex-start', opacity: 0 },
  label: { fontFamily: FONT.semibold, fontSize: size === 'compact' ? FS.meta : FS.sm },
});
