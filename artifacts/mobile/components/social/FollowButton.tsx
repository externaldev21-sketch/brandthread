import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useApi } from '@/lib/api';

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
};

/**
 * Optimistic follow/unfollow control. Flips state immediately on tap and
 * rolls back if the request fails — the network round trip never blocks the
 * UI. Wire `onChange` to update follower counts shown elsewhere on screen.
 */
export default function FollowButton({ userId, initial, onChange, disabled, size = 'default', style }: Props) {
  const { theme } = useAppTheme();
  const api = useApi();
  const [state, setState] = useState<FollowState>(initial);
  const [busy, setBusy] = useState(false);
  const styles = React.useMemo(() => makeStyles(theme, size), [theme, size]);

  const handlePress = async () => {
    if (busy || disabled || userId.startsWith('u_')) return;
    const wasFollowing = state.isFollowing;
    const optimistic: FollowState = wasFollowing
      ? { isFollowing: false, isFollowedBy: state.isFollowedBy, isMutual: false }
      : { isFollowing: true, isFollowedBy: state.isFollowedBy, isMutual: state.isFollowedBy };

    setState(optimistic);
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onChange?.(optimistic, wasFollowing ? -1 : 1);

    try {
      if (wasFollowing) {
        await api.social.unfollow(userId);
      } else {
        await api.social.follow(userId);
      }
    } catch {
      // Roll back on failure.
      setState(state);
      onChange?.(state, wasFollowing ? 1 : -1);
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
