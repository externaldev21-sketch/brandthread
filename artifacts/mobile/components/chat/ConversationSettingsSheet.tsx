import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/BrandthreadUI';
import { SheetRise } from '@/components/motion/SheetRise';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { apiErrorMessage } from '@/lib/safety';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';

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
  const insets = useSafeAreaInsets();
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

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close conversation settings" />
        <SheetRise style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border, paddingBottom: Math.max(insets.bottom, SP.md) + SP.md }]}>
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <View style={styles.heading}>
            <View style={styles.headingCopy}>
              <Text style={[styles.title, { color: theme.text }]}>{confirm ? 'Confirm action' : 'Conversation settings'}</Text>
              <Text style={[styles.subtitle, { color: theme.muted }]} numberOfLines={1}>{counterpart.name}</Text>
            </View>
            <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
              <Feather name="x" size={20} color={theme.text} />
            </PressableScale>
          </View>

          {confirm ? (
            <>
              <Text style={[styles.confirmText, { color: theme.text }]}>
                {confirm === 'block'
                  ? `Block ${counterpart.name}? They won't be able to message you or see your content.`
                  : confirm === 'unblock'
                    ? `Unblock ${counterpart.name}? They will be able to message you again.`
                    : `Unfollow ${counterpart.name}? You can follow them again later.`}
              </Text>
              <View style={styles.confirmActions}>
                <PressableScale onPress={() => { setConfirm(null); setError(''); }} disabled={busy} style={[styles.confirmButton, { borderColor: theme.border }]}>
                  <Text style={[styles.label, { color: theme.text }]}>Cancel</Text>
                </PressableScale>
                <PressableScale onPress={applyConfirmation} disabled={busy} style={[styles.confirmButton, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  {busy ? <ActivityIndicator color={theme.text} /> : <Text style={[styles.label, { color: confirm === 'block' ? theme.error : theme.text }]}>
                    {confirm === 'block' ? 'Block' : confirm === 'unblock' ? 'Unblock' : 'Unfollow'}
                  </Text>}
                </PressableScale>
              </View>
            </>
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
        </SheetRise>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.62)' },
  sheet: { width: '100%', maxWidth: 480, alignSelf: 'center', borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderWidth: 1, paddingHorizontal: SP.lg, paddingTop: SP.sm, gap: SP.xs },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: SP.md },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.sm },
  headingCopy: { flex: 1, paddingRight: SP.sm },
  title: { fontSize: FS.lg, fontFamily: FONT.bold },
  subtitle: { fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 3 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, gap: SP.md, paddingVertical: SP.sm },
  rowCopy: { flex: 1 },
  label: { fontSize: FS.base, fontFamily: FONT.semibold },
  detail: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 3 },
  divider: { height: 1, marginTop: SP.sm },
  confirmText: { fontSize: FS.base, fontFamily: FONT.regular, lineHeight: 23, marginVertical: SP.md },
  confirmActions: { flexDirection: 'row', gap: SP.sm, marginTop: SP.sm },
  confirmButton: { flex: 1, height: 48, borderWidth: 1, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: FS.sm, fontFamily: FONT.medium, marginTop: SP.sm },
});