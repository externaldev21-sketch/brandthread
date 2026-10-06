import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useApi } from '@/lib/api';
import { canUsePreviewFollow, getPreviewFollowing, setPreviewFollowing } from '@/lib/previewFollowStore';
import { apiErrorMessage } from '@/lib/safety';

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
export default function FollowButton({ userId, initial, onChange, disabled, size = 'default', style, onError }: Props) {
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
    touchedRef.current = true;
    if (!previewId && !isSignedIn) {
      router.push('/sign-in' as never);
      return;
    }
    const wasFollowing = state.isFollowing;
    const optimistic: FollowState = wasFollowing
      ? { isFollowing: false, isFollowedBy: state.isFollowedBy, isMutual: false }
      : { isFollowing: true, isFollowedBy: state.isFollowedBy, isMutual: state.isFollowedBy };

    setState(optimistic);
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onChange?.(optimistic, wasFollowing ? -1 : 1);

    try {
      if (previewId) {
        setPreviewFollowing(userId, !wasFollowing);
      } else if (wasFollowing) {
        await api.social.unfollow(userId);
      } else {
        await api.social.follow(userId);
      }
    } catch (error) {
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
    : (state.isFollowedBy ? 'Follow Back' : 'Follow');
  const isPrimary = !state.isFollowing;

  return (
    <Pressable
      testID="follow-button"
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        isPrimary
          ? { backgroundColor: theme.accent }
          : { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border },
        pressed && styles.pressed,
        (disabled) && styles.disabled,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={isPrimary ? theme.onAccent : theme.text} />
      ) : (
        <>
          {state.isFollowing && (
            <Feather name="check" size={14} color={isPrimary ? theme.onAccent : theme.text} style={styles.icon} />
          )}
          <Text style={[styles.label, { color: isPrimary ? theme.onAccent : theme.text }]}>{label}</Text>
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
  disabled: { opacity: 0.5 },
  icon: { marginRight: 4 },
  label: { fontFamily: FONT.semibold, fontSize: size === 'compact' ? FS.xs : FS.sm },
});
