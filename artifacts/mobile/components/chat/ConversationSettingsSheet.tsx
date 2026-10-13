import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { PressableScale } from '@/components/BrandthreadUI';
import { Sheet } from '@/components/ui/BottomSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { apiErrorMessage } from '@/lib/safety';
import { FONT, FS, SP } from '@/lib/theme';

type Confirmation = 'block' | 'unblock' | 'unfollow';

type Props = {
  visible: boolean;
  onClose: () => void;
  conversationId: string;
  counterpart: { userId: string; name: string };
  isMuted: boolean;
  blockedByMe: boolean;
  onMutedChange: (muted: boolean) => void;
  onBlockedChange: (blocked: boolean) => void;
  onArchive?: () => Promise<void>;
  onReport?: () => void;
};

export function ConversationSettingsSheet({
  visible, onClose, conversationId, counterpart, isMuted, blockedByMe,
  onMutedChange, onBlockedChange, onArchive, onReport,
}: Props) {
  const { theme } = useAppTheme();
  const { userId } = useAuth();
  const api = useApi();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [followError, setFollowError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<Confirmation | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setFollowing(null);
    setFollowError(false);
    setError('');
    setConfirm(null);
    api.social.status(counterpart.userId)
      .then((status) => { if (!cancelled) setFollowing(status.isFollowing); })
      .catch(() => { if (!cancelled) setFollowError(true); });
    return () => { cancelled = true; };
  }, [visible, counterpart.userId, userId, api]);

  const retryFollowStatus = () => {
    setFollowing(null);
    setFollowError(false);
    api.social.status(counterpart.userId)
      .then((status) => setFollowing(status.isFollowing))
      .catch(() => setFollowError(true));
  };

  const toggleMute = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.conversations.mute(conversationId, isMuted ? null : -1);
      onMutedChange(result.mutedUntil !== null);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not update this conversation. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const applyConfirmation = async () => {
    if (!confirm || busy) return;
    const action = confirm;
    setBusy(true);
    setError('');
    try {
      if (action === 'unfollow') {
        await api.social.unfollow(counterpart.userId);
        setFollowing(false);
      } else if (action === 'block') {
        await api.social.block(counterpart.userId);
        onBlockedChange(true);
        setFollowing(false);
      } else {
        await api.social.unblock(counterpart.userId);
        onBlockedChange(false);
      }
      setConfirm(null);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not save this change. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!onArchive || busy) return;
    setBusy(true);
    setError('');
    try {
      await onArchive();
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not archive this conversation. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const row = (
    icon: keyof typeof Feather.glyphMap,
    label: string,
    detail: string,
    onPress: () => void,
    disabled = false,
    destructive = false,
  ) => (
    <PressableScale
      rippleEnabled={false}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy }}
      style={[styles.row, { borderColor: theme.border, opacity: disabled ? 0.5 : 1 }]}
    >
      <Feather name={icon} size={19} color={destructive ? theme.error : theme.text} />
      <View style={styles.rowCopy}>
        <Text style={[styles.label, { color: destructive ? theme.error : theme.text }]}>{label}</Text>
        <Text style={[styles.detail, { color: theme.muted }]}>{detail}</Text>
      </View>
      <Feather name="chevron-right" size={17} color={theme.muted} />
    </PressableScale>
  );

  const confirmLabel = confirm === 'block' ? 'Block' : confirm === 'unblock' ? 'Unblock' : 'Unfollow';

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={confirm ? `${confirmLabel} ${counterpart.name}?` : counterpart.name}
      accessibilityLabel="Conversation settings"
      primaryAction={confirm ? {
        label: confirmLabel,
        onPress: applyConfirmation,
        loading: busy,
        variant: confirm === 'unblock' ? 'primary' : 'destructive',
      } : undefined}
      secondaryAction={confirm ? {
        label: 'Cancel',
        onPress: () => { setConfirm(null); setError(''); },
        disabled: busy,
      } : undefined}
      testID="conversation-settings-sheet"
    >
      {confirm ? (
        <Text style={[styles.confirmText, { color: theme.muted }]}>
          {confirm === 'block'
            ? "They won't be able to message you or see your content."
            : confirm === 'unblock'
              ? 'They will be able to message you again.'
              : 'You can follow them again later.'}
        </Text>
      ) : (
        <>
          {row(isMuted ? 'bell' : 'bell-off', isMuted ? 'Unmute conversation' : 'Mute conversation',
            isMuted ? 'Turn push alerts for this chat back on' : 'Stop push alerts, keep messages in your inbox', toggleMute)}
          {row('user-minus', 'Unfollow user',
            followError ? 'Could not check follow status — tap to retry' : following === null ? 'Checking follow status…' : following ? 'Stop following this user' : 'You are not following this user',
            followError ? retryFollowStatus : () => setConfirm('unfollow'), !followError && following !== true)}
          {row(blockedByMe ? 'user-check' : 'slash', blockedByMe ? 'Unblock user' : 'Block user',
            blockedByMe ? 'Allow messages from this user again' : 'Stop messages and hide your content from this user',
            () => setConfirm(blockedByMe ? 'unblock' : 'block'), false, !blockedByMe)}
          {(onArchive || onReport) && <View style={[styles.divider, { backgroundColor: theme.border }]} />}
          {onArchive && row('archive', 'Archive conversation', 'Remove it from your inbox', archive)}
          {onReport && row('flag', 'Report user', 'Tell us about a safety concern', () => { onClose(); onReport(); })}
        </>
      )}
      {!!error && <Text style={[styles.error, { color: theme.error }]} accessibilityRole="alert">{error}</Text>}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, gap: SP.md, paddingVertical: SP.sm },
  rowCopy: { flex: 1 },
  label: { fontSize: FS.base, fontFamily: FONT.semibold },
  detail: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 3 },
  divider: { height: 1, marginTop: SP.sm },
  confirmText: { fontSize: FS.base, fontFamily: FONT.regular, lineHeight: 22, marginBottom: SP.sm },
  error: { fontSize: FS.sm, fontFamily: FONT.medium, marginTop: SP.sm },
});