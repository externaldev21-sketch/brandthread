/**
 * Chat details — Instagram DM's chat-settings page, opened by tapping the
 * conversation header's name (buyer-conversation.tsx / seller-conversation.tsx
 * both route here; see docs/dm-flows.md for the pattern reference). Shared by
 * both buyer and seller since a 1:1 DM's settings are identical either way —
 * only the caller (which screen it was opened from) differs.
 *
 * Big avatar, name, then a Profile / Search / Mute / Options action row, then
 * list rows: Theme, Nicknames, Disappearing messages, Privacy & safety,
 * Create a group chat, Something isn't working.
 *
 * Theme and Disappearing messages are intentionally UI stubs here — PR 3
 * implements their real behavior (theme picker/apply, real
 * disappear-after-seen logic). Every other row is fully functional.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Alert, Modal, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { SheetRise } from '@/components/motion/SheetRise';
import { hapticPrimaryAction, hapticSelection, hapticToggle } from '@/lib/haptics';
import { reportHref, confirmBlock, confirmUnblock, apiErrorMessage } from '@/lib/safety';
import { useApi } from '@/lib/api';
import { isPreviewConversationId, getPreviewConversation } from '@/lib/previewInbox';
import { muteConversation } from '@/services/socialService';
import { goBackOr } from '@/lib/navigation/goBackOr';

type MuteOption = { label: string; minutes: number | null };
const MUTE_OPTIONS: MuteOption[] = [
  { label: '15 minutes', minutes: 15 },
  { label: '1 hour', minutes: 60 },
  { label: '8 hours', minutes: 480 },
  { label: 'Until I turn it back on', minutes: -1 },
];

export default function ConversationDetailsScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const headerTopPad = Platform.OS === 'web' ? Math.max(insets.top, 54) : insets.top;
  const router = useRouter();
  const api = useApi();
  const params = useLocalSearchParams<{
    id: string; role?: string; isBlocked?: string;
    participantUserId?: string; participantName?: string; participantHandle?: string;
    participantInitials?: string; participantColor?: string; participantAvatarUri?: string;
    participantNickname?: string;
  }>();

  const [muteVisible, setMuteVisible] = useState(false);
  const [mutedUntil, setMutedUntil] = useState<string | null>(null);
  const [disappearing, setDisappearing] = useState(false);
  const [isBlocked, setIsBlocked] = useState(params.isBlocked === '1');
  const [busy, setBusy] = useState(false);

  const isPreview = isPreviewConversationId(params.id);
  const displayName = params.participantName ?? 'Conversation';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isPreview) {
        const conv = getPreviewConversation(params.id);
        if (!cancelled) setMutedUntil(conv?.mutedUntil ?? null);
        return;
      }
      try {
        const conv = await api.conversations.get(params.id);
        if (!cancelled) setMutedUntil((conv as { mutedUntil?: string })?.mutedUntil ?? null);
      } catch { /* best-effort — mute row just reads as "Off" */ }
    })();
    return () => { cancelled = true; };
  }, [params.id, isPreview, api]);

  const isMuted = !!mutedUntil && new Date(mutedUntil).getTime() > Date.now();

  function openProfile() {
    if (!params.participantUserId) return;
    hapticPrimaryAction();
    const qs = new URLSearchParams({
      userId: params.participantUserId,
      name: params.participantName ?? '',
      handle: params.participantHandle ?? '',
      initials: params.participantInitials ?? '',
      color: params.participantColor ?? '#8B5CF6',
    });
    router.push(('/buyer-other-profile?' + qs.toString()) as never);
  }

  function openSearch() {
    hapticPrimaryAction();
    router.push(('/conversation-search?id=' + encodeURIComponent(params.id) + '&role=' + (params.role ?? 'buyer')) as never);
  }

  async function applyMute(minutes: number | null) {
    setMuteVisible(false);
    hapticToggle();
    setBusy(true);
    try {
      if (isPreview) {
        const until = minutes == null ? null : minutes === -1
          ? '9999-12-31T00:00:00.000Z'
          : new Date(Date.now() + minutes * 60_000).toISOString();
        setMutedUntil(until);
      } else {
        const until = await muteConversation(params.id, minutes);
        setMutedUntil(until);
      }
    } catch (e) {
      Alert.alert('Couldn’t update mute', apiErrorMessage(e, 'Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  function openNicknames() {
    hapticPrimaryAction();
    const qs = new URLSearchParams({
      id: params.id,
      role: params.role ?? 'buyer',
      participantUserId: params.participantUserId ?? '',
      participantName: params.participantName ?? '',
      participantNickname: params.participantNickname ?? '',
    });
    router.push(('/conversation-nicknames?' + qs.toString()) as never);
  }

  function openPrivacySafety() {
    hapticPrimaryAction();
    const qs = new URLSearchParams({
      id: params.id,
      participantUserId: params.participantUserId ?? '',
      participantName: params.participantName ?? '',
    });
    router.push(('/conversation-privacy-safety?' + qs.toString()) as never);
  }

  function openCreateGroup() {
    hapticPrimaryAction();
    router.push(('/conversation-group-create?role=' + (params.role ?? 'buyer')) as never);
  }

  function reportConversation() {
    hapticSelection();
    if (!params.participantUserId) return;
    router.push(reportHref({
      targetType: 'profile',
      targetId: params.participantUserId,
      ownerId: params.participantUserId,
      ownerName: displayName,
    }) as never);
  }

  function openOptions() {
    Alert.alert(displayName, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: isBlocked ? `Unblock ${displayName}` : `Block ${displayName}`,
        style: isBlocked ? 'default' : 'destructive',
        onPress: async () => {
          if (!params.participantUserId) return;
          const subject = { userId: params.participantUserId, name: displayName };
          const ok = isBlocked
            ? await confirmUnblock(subject, api.social.unblock)
            : await confirmBlock(subject, api.social.block);
          if (ok) setIsBlocked((v) => !v);
        },
      },
    ]);
  }

  return (
    <View style={[s.root, { backgroundColor: theme.background }]}>
      <View style={[s.header, { paddingTop: headerTopPad + SP.xs }]}>
        <PressableScale rippleEnabled={false}
          onPress={() => { hapticPrimaryAction(); goBackOr(router); }}
          style={s.roundBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="chat-details-back"
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={ICON.md} color={theme.text} />
        </PressableScale>
        <Text style={[s.headerTitle, { color: theme.text }]}>Details</Text>
        <View style={s.roundBtn} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + SP.xl }}>
        <View style={s.profileBlock}>
          <View style={[s.bigAvatar, { backgroundColor: params.participantColor ?? theme.accent }]}>
            {params.participantAvatarUri ? (
              <CachedImage source={{ uri: params.participantAvatarUri }} style={s.bigAvatarImg} />
            ) : (
              <Text style={s.bigAvatarInitials}>{params.participantInitials ?? '?'}</Text>
            )}
          </View>
          <Text style={[s.bigName, { color: theme.text }]} testID="chat-details-name">{displayName}</Text>
          {!!params.participantHandle && (
            <Text style={[s.bigHandle, { color: theme.muted }]}>{params.participantHandle}</Text>
          )}

          <View style={s.actionRow}>
            <ActionButton icon="user" label="Profile" theme={theme} onPress={openProfile} testID="chat-details-action-profile" />
            <ActionButton icon="search" label="Search" theme={theme} onPress={openSearch} testID="chat-details-action-search" />
            <ActionButton
              icon={isMuted ? 'bell-off' : 'bell'}
              label={isMuted ? 'Unmute' : 'Mute'}
              theme={theme}
              onPress={() => { hapticPrimaryAction(); isMuted ? applyMute(null) : setMuteVisible(true); }}
              testID="chat-details-action-mute"
            />
            <ActionButton icon="more-horizontal" label="Options" theme={theme} onPress={openOptions} testID="chat-details-action-options" />
          </View>
        </View>

        <View style={[s.list, { borderColor: theme.border }]}>
          <ListRow
            icon="droplet" theme={theme}
            title="Theme"
            subtitle="Default"
            pill="New"
            onPress={() => { hapticSelection(); Alert.alert('Themes', 'Chat themes are coming in the next update.'); }}
            testID="chat-details-row-theme"
          />
          <ListRow
            icon="user-plus" theme={theme}
            title="Nicknames"
            onPress={openNicknames}
            testID="chat-details-row-nicknames"
          />
          <ListRow
            icon="clock" theme={theme}
            title="Disappearing messages"
            subtitle={disappearing ? 'On' : 'Off'}
            right={(
              <Switch
                value={disappearing}
                onValueChange={(v) => { hapticToggle(); setDisappearing(v); }}
                trackColor={{ false: theme.border, true: theme.accent }}
                thumbColor={theme.onAccent}
                testID="chat-details-disappearing-switch"
              />
            )}
            testID="chat-details-row-disappearing"
          />
          <ListRow
            icon="lock" theme={theme}
            title="Privacy & safety"
            onPress={openPrivacySafety}
            testID="chat-details-row-privacy"
          />
          <ListRow
            icon="users" theme={theme}
            title="Create a group chat"
            onPress={openCreateGroup}
            testID="chat-details-row-group"
          />
          <ListRow
            icon="alert-circle" theme={theme}
            title="Something isn't working"
            onPress={reportConversation}
            last
            testID="chat-details-row-report"
          />
        </View>
      </ScrollView>

      <Modal visible={muteVisible} transparent animationType="fade" onRequestClose={() => setMuteVisible(false)}>
        <PressableScale rippleEnabled={false} style={s.modalBackdrop} activeOpacity={1} onPress={() => setMuteVisible(false)} />
        <SheetRise style={[s.muteSheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + SP.md }]}>
          <View style={s.sheetHandle} />
          <Text style={[s.muteSheetTitle, { color: theme.text }]}>Mute notifications</Text>
          {MUTE_OPTIONS.map((opt) => (
            <PressableScale rippleEnabled={false}
              key={opt.label}
              style={s.muteOption}
              onPress={() => applyMute(opt.minutes)}
              testID={`chat-details-mute-${opt.minutes}`}
            >
              <Text style={[s.muteOptionText, { color: theme.text }]}>{opt.label}</Text>
            </PressableScale>
          ))}
        </SheetRise>
      </Modal>
    </View>
  );
}

function ActionButton({
  icon, label, theme, onPress, testID,
}: { icon: keyof typeof Feather.glyphMap; label: string; theme: AppThemePreset; onPress: () => void; testID?: string }) {
  const s = makeStyles(theme);
  return (
    <PressableScale rippleEnabled={false} style={s.actionBtn} onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[s.actionIconWrap, { backgroundColor: theme.cardElevated }]}>
        <Feather name={icon} size={ICON.md} color={theme.text} />
      </View>
      <Text style={[s.actionLabel, { color: theme.muted }]}>{label}</Text>
    </PressableScale>
  );
}

function ListRow({
  icon, theme, title, subtitle, pill, right, onPress, last, testID,
}: {
  icon: keyof typeof Feather.glyphMap; theme: AppThemePreset; title: string; subtitle?: string;
  pill?: string; right?: React.ReactNode; onPress?: () => void; last?: boolean; testID?: string;
}) {
  const s = makeStyles(theme);
  const content = (
    <View style={[s.row, !last && { borderBottomWidth: StyleSheetHairline, borderBottomColor: theme.border }]}>
      <Feather name={icon} size={ICON.md} color={theme.text} style={{ width: 28 }} />
      <View style={{ flex: 1 }}>
        <Text style={[s.rowTitle, { color: theme.text }]}>{title}</Text>
        {!!subtitle && <Text style={[s.rowSubtitle, { color: theme.muted }]}>{subtitle}</Text>}
      </View>
      {pill && (
        <View style={[s.pill, { backgroundColor: theme.accent }]}>
          <Text style={[s.pillText, { color: theme.onAccent }]}>{pill}</Text>
        </View>
      )}
      {right ?? (onPress && <Feather name="chevron-right" size={ICON.sm} color={theme.subtle} />)}
    </View>
  );
  if (!onPress) return content;
  return (
    <PressableScale rippleEnabled={false} onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={title}>
      {content}
    </PressableScale>
  );
}

const StyleSheetHairline = 0.5;

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingBottom: SP.sm,
  },
  roundBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: FONT.semibold, fontSize: FS.md },
  profileBlock: { alignItems: 'center', paddingTop: SP.md, paddingBottom: SP.lg, gap: 4 },
  bigAvatar: {
    width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', marginBottom: SP.sm,
  },
  bigAvatarImg: { width: 88, height: 88 },
  bigAvatarInitials: { fontSize: FS.xl, fontFamily: FONT.bold, color: '#FFFFFF' },
  bigName: { fontSize: FS.lg, fontFamily: FONT.bold },
  bigHandle: { fontSize: FS.sm, fontFamily: FONT.regular, marginBottom: SP.sm },
  actionRow: { flexDirection: 'row', gap: SP.lg, marginTop: SP.sm },
  actionBtn: { alignItems: 'center', gap: 6, width: 64 },
  actionIconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: FS.xs, fontFamily: FONT.medium },
  list: { marginTop: SP.md, borderTopWidth: StyleSheetHairline },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.md, paddingVertical: SP.md },
  rowTitle: { fontSize: FS.base, fontFamily: FONT.medium },
  rowSubtitle: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.pill, marginRight: SP.sm },
  pillText: { fontSize: 10, fontFamily: FONT.bold },
  modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#00000066' },
  muteSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, paddingHorizontal: SP.md, paddingTop: SP.sm },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, alignSelf: 'center', marginBottom: SP.md },
  muteSheetTitle: { fontFamily: FONT.semibold, fontSize: FS.md, textAlign: 'center', marginBottom: SP.sm },
  muteOption: { paddingVertical: SP.md, alignItems: 'center' },
  muteOptionText: { fontFamily: FONT.regular, fontSize: FS.base },
});
