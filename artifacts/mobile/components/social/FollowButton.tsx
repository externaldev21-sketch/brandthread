import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Icon } from '@/components/ui/Icon';
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
  /** Shown when a follow/unfollow fails (after the rollback). Defaults to a native alert. */
  onError?: (message: string) => void;
};

/**
 * Optimistic follow/unfollow control. Flips state immediately on tap and
 * rolls back if the request fails — the network round trip never blocks the
 * UI. Wire `onChange` to update follower counts shown elsewhere on screen.
 *
 * Never a silent no-op: seeded preview people (`preview-*` ids) follow
 * through lib/previewFollowStore, a signed-out viewer is sent to sign in,
 * and a failed request rolls back AND says so (`onError`, else an alert).
 */
export default function FollowButton({ userId, initial, onChange, disabled, size = 'default', style, onError, guard }: Props) {
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
    else if (Platform.OS !== 'web') Alert.alert('Something went wrong', message);
  };

  const handlePress = async () => {
    if (busy || disabled || userId.startsWith('u_')) return;
    if (guard && !guard()) return;
    touchedRef.current = true;
    if (!previewId && !isSignedIn) {
      router.push('/sign-in' as never);
      return;
    }
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

  const label = state.isFollowing
    ? (state.isMutual ? 'Friends' : 'Following')
    : (state.isFollowedBy ? 'Follow back' : 'Follow');
  const isPrimary = !state.isFollowing;

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
      {busy ? (
        <ActivityIndicator size="small" color={isPrimary ? theme.onAccent : theme.text} />
      ) : (
        <>
          {state.isFollowing && (
            <Icon name="check" size={14} color={disabled ? TEXT_DISABLED : isPrimary ? theme.onAccent : theme.text} style={styles.icon} />
          )}
          <Text style={[styles.label, { color: disabled ? TEXT_DISABLED : isPrimary ? theme.onAccent : theme.text }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

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
  label: { fontFamily: FONT.semibold, fontSize: size === 'compact' ? FS.meta : FS.sm },
});
