import { hapticPrimaryAction, hapticSelection } from '@/lib/haptics';
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
 * Theme and Disappearing messages: Theme is fully wired (bottom-sheet grid →
 * full-screen preview → apply, PR 3); Disappearing messages toggles a real
 * server-persisted flag with a minimal "opportunistic sweep" auto-delete
 * (see docs/dm-flows.md) rather than a real-time push-based one.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Modal, Pressable, TextInput, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUser } from '@clerk/expo';
import { SheetRise } from '@/components/motion/SheetRise';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { PressableScale, HapticSwitch} from '@/components/BrandthreadUI';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { showAlert } from '@/lib/actionSheet';
import { CachedImage } from '@/components/CachedImage';
import { Sheet } from '@/components/ui/BottomSheet';
import { BrandthreadAvatar } from '@/components/branding/BrandthreadAvatar';
import { ThemePickerSheet } from '@/components/chat/ThemePickerSheet';
import { ThemePreviewScreen } from '@/components/chat/ThemePreviewScreen';
import { CONVERSATION_THEMES, getConversationTheme } from '@/lib/conversationThemes';
import { haptics } from '@/lib/haptics';
import { reportHref, confirmBlock, confirmUnblock, apiErrorMessage } from '@/lib/safety';
import { useApi } from '@/lib/api';
import {
  isPreviewConversationId, getPreviewConversation,
  setPreviewConversationTheme, setPreviewConversationDisappearing, appendPreviewMessage,
} from '@/lib/previewInbox';
import { muteConversation, setConversationTheme, setConversationDisappearing } from '@/services/socialService';
import { isSellerDevPreview, isBuyerDevPreview } from '@/lib/devPreview';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { firstParam, resolveConversationParticipant, type ParticipantLike } from '@/lib/conversationParticipantPresentation';

type MuteOption = { label: string; minutes: number | null };
const MUTE_OPTIONS: MuteOption[] = [
  { label: '15 minutes', minutes: 15 },
  { label: '1 hour', minutes: 60 },
  { label: '8 hours', minutes: 480 },
  { label: 'Until I turn it back on', minutes: -1 },
];

const THEME_NEW_SEEN_KEY = '@brandthread/chat-theme-new-seen:v1';

export default function ConversationDetailsScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const params = useLocalSearchParams<{
    id: string; role?: string; isBlocked?: string; openTheme?: string;
    participantUserId?: string; participantName?: string; participantHandle?: string;
    participantInitials?: string; participantColor?: string; participantAvatarUri?: string;
    participantNickname?: string;
  }>();

  const [muteVisible, setMuteVisible] = useState(false);
  const [mutedUntil, setMutedUntil] = useState<string | null>(null);
  const [themeId, setThemeId] = useState<string | null>(null);
  const [themePickerVisible, setThemePickerVisible] = useState(params.openTheme === '1');
  const [previewThemeId, setPreviewThemeId] = useState<string | null>(null);
  const [applyingTheme, setApplyingTheme] = useState(false);
  const [disappearing, setDisappearing] = useState(false);
  const [isBlocked, setIsBlocked] = useState(params.isBlocked === '1');
  const [busy, setBusy] = useState(false);
  // Default hidden until storage answers, so a returning user never sees the
  // pill flash in and back out.
  const [themeNewSeen, setThemeNewSeen] = useState(true);
  const [bugVisible, setBugVisible] = useState(false);
  const [bugText, setBugText] = useState('');
  const [bugSending, setBugSending] = useState(false);
  const { user } = useUser();

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(THEME_NEW_SEEN_KEY)
      .then((v) => { if (!cancelled) setThemeNewSeen(v === '1'); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!themePickerVisible) return;
    setThemeNewSeen(true);
    AsyncStorage.setItem(THEME_NEW_SEEN_KEY, '1').catch(() => {});
  }, [themePickerVisible]);

  // isSellerDevPreview()/isBuyerDevPreview() (not just a seeded conversation
  // id): this screen is opened by query params rather than a file-based
  // dynamic segment, so a direct/audited load can land here with no id at
  // all, or (as the audit's own generic `id` param synthesis does) one that
  // collides with an unrelated entity's id. Either way, in a dev-preview
  // session there is never a real conversation to fetch, so treat ANY
  // preview session as preview here too rather than relying on the id
  // string happening to look like a seeded one.
  const conversationId = firstParam(params.id);
  const isPreview = isPreviewConversationId(conversationId ?? undefined) || isSellerDevPreview() || isBuyerDevPreview();
  // The loaded conversation's other participant — fills in whatever the
  // opening screen didn't put in the URL (a bare `?id=` deep link, etc.).
  const [loadedParticipant, setLoadedParticipant] = useState<ParticipantLike | null>(null);
  // 'loading' only matters when the URL carries no participant name: until
  // the conversation resolves there's nothing honest to show in the header.
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'notFound' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const participant = resolveConversationParticipant(params, loadedParticipant);
  const displayName = participant?.name ?? '';

  useEffect(() => {
    let cancelled = false;
    if (!conversationId) { setLoadState('notFound'); return; }
    setLoadState('loading');
    (async () => {
      if (isPreview) {
        const conv = getPreviewConversation(conversationId);
        if (!cancelled) {
          setMutedUntil(conv?.mutedUntil ?? null);
          setThemeId(conv?.themeId ?? null);
          setDisappearing(!!conv?.disappearingEnabled);
          setLoadedParticipant(conv?.participants?.[0] ?? null);
          setLoadState(conv ? 'ready' : 'notFound');
        }
        return;
      }
      try {
        const conv = await api.conversations.get(conversationId) as {
          mutedUntil?: string; themeId?: string | null; disappearingEnabled?: boolean;
          participants?: ParticipantLike[];
        };
        if (!cancelled) {
          setMutedUntil(conv?.mutedUntil ?? null);
          setThemeId(conv?.themeId ?? null);
          setDisappearing(!!conv?.disappearingEnabled);
          setLoadedParticipant(conv?.participants?.[0] ?? null);
          setLoadState(conv ? 'ready' : 'notFound');
        }
      } catch {
        // Best-effort when the URL already names the participant (rows just
        // read as "Off"/Default); otherwise surfaced as a retryable error.
        if (!cancelled) setLoadState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId, isPreview, api, reloadKey]);

  const isMuted = !!mutedUntil && new Date(mutedUntil).getTime() > Date.now();

  function openProfile() {
    if (!participant?.userId) return;
    hapticPrimaryAction();
    const qs = new URLSearchParams({
      userId: participant.userId,
      name: participant.name,
      handle: participant.handle ?? '',
      initials: participant.initials,
      color: participant.color,
    });
    router.push(('/buyer-other-profile?' + qs.toString()) as never);
  }

  function openSearch() {
    hapticPrimaryAction();
    router.push(('/conversation-search?id=' + encodeURIComponent(conversationId ?? '') + '&role=' + (params.role ?? 'buyer')) as never);
  }

  async function applyMute(minutes: number | null) {
    setMuteVisible(false);
    haptics.selection();
    setBusy(true);
    try {
      if (isPreview) {
        const until = minutes == null ? null : minutes === -1
          ? '9999-12-31T00:00:00.000Z'
          : new Date(Date.now() + minutes * 60_000).toISOString();
        setMutedUntil(until);
      } else {
        const until = await muteConversation(conversationId!, minutes);
        setMutedUntil(until);
      }
    } catch (e) {
      Alert.alert('Couldn’t update mute', apiErrorMessage(e, 'Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function commitTheme(nextThemeId: string | null) {
    setApplyingTheme(true);
    try {
      if (isPreview) {
        setPreviewConversationTheme(conversationId!, nextThemeId);
        appendPreviewMessage(conversationId!, {
          id: `local-theme-${Date.now()}`, conversationId: conversationId!,
          fromId: 'me', fromName: 'You', fromInitials: 'Y', fromColor: theme.accent,
          text: '', attachment: { type: 'system', title: 'theme_changed', meta: { themeId: nextThemeId ?? '' } },
          reactions: [], status: 'sent', ts: Date.now(), deletedForMe: false,
        });
      } else {
        await setConversationTheme(conversationId!, nextThemeId);
      }
      setThemeId(nextThemeId);
      haptics.success();
      setPreviewThemeId(null);
      setThemePickerVisible(false);
    } catch (e) {
      Alert.alert('Couldn’t apply theme', apiErrorMessage(e, 'Try again.'));
    } finally {
      setApplyingTheme(false);
    }
  }

  async function toggleDisappearing(next: boolean) {
    haptics.selection();
    setDisappearing(next);
    try {
      if (isPreview) {
        setPreviewConversationDisappearing(conversationId!, next);
        appendPreviewMessage(conversationId!, {
          id: `local-disappearing-${Date.now()}`, conversationId: conversationId!,
          fromId: 'me', fromName: 'You', fromInitials: 'Y', fromColor: theme.accent,
          text: '', attachment: { type: 'system', title: next ? 'disappearing_on' : 'disappearing_off', meta: {} },
          reactions: [], status: 'sent', ts: Date.now(), deletedForMe: false,
        });
      } else {
        await setConversationDisappearing(conversationId!, next);
      }
    } catch (e) {
      setDisappearing(!next);
      Alert.alert('Couldn’t update disappearing messages', apiErrorMessage(e, 'Try again.'));
    }
  }

  function openNicknames() {
    const qs = new URLSearchParams({
      id: conversationId ?? '',
      role: params.role ?? 'buyer',
      participantUserId: participant?.userId ?? '',
      participantName: displayName,
      participantNickname: participant?.nickname ?? '',
    });
    router.push(('/conversation-nicknames?' + qs.toString()) as never);
  }

  function openPrivacySafety() {
    const qs = new URLSearchParams({
      id: conversationId ?? '',
      participantUserId: participant?.userId ?? '',
      participantName: displayName,
    });
    router.push(('/conversation-privacy-safety?' + qs.toString()) as never);
  }

  function openCreateGroup() {
    router.push(('/conversation-group-create?role=' + (params.role ?? 'buyer')) as never);
  }

  // "Something isn't working" is a bug report about the chat itself, not a
  // report against the other person — it files a real support ticket
  // (POST /api/support/tickets, category "bug", the same endpoint Help &
  // Support's form uses) with this conversation attached as context.
  function openBugReport() {
    hapticSelection();
    setBugText('');
    setBugVisible(true);
  }

  async function submitBugReport() {
    const text = bugText.trim();
    if (!text || bugSending) return;
    setBugSending(true);
    try {
      await api.support.submitTicket({
        subject: 'Something isn’t working in a chat',
        body: `${text}\n\n— Conversation: ${params.id ?? 'unknown'} (${params.role ?? 'buyer'} view)`,
        category: 'bug',
        email: user?.primaryEmailAddress?.emailAddress ?? 'unknown@brandthread.app',
        name: user?.fullName ?? user?.firstName ?? 'Brandthread User',
      });
      setBugVisible(false);
      Alert.alert('Thanks for letting us know', 'Our team will look into it.');
    } catch (e) {
      Alert.alert('Couldn’t send your report', apiErrorMessage(e, 'Please try again.'));
    } finally {
      setBugSending(false);
    }
  }

  function openOptions() {
    // Alert.alert() with a button array is a silent no-op on web — this left
    // the "Options" action button completely dead in the web preview. See
    // components/ui/ActionSheet.tsx's header comment.
    showActionSheet(displayName, undefined, [
      {
        text: isBlocked ? `Unblock ${displayName}` : `Block ${displayName}`,
        style: isBlocked ? 'default' : 'destructive',
        onPress: async () => {
          if (!participant?.userId) return;
          const subject = { userId: participant.userId, name: displayName };
          // Preview applies the block locally (like mute / theme / disappearing
          // above) — the confirm still shows, but no real API call is made.
          const previewNoop = async () => {};
          const ok = isBlocked
            ? await confirmUnblock(subject, isPreview ? previewNoop : api.social.unblock, showAlert)
            : await confirmBlock(subject, isPreview ? previewNoop : api.social.block, showAlert);
          if (ok) setIsBlocked((v) => !v);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const goBack = () => { hapticPrimaryAction(); goBackOr(router); };
  const header = (
    <ScreenHeader title="Details" onBack={goBack} backTestID="chat-details-back" />
  );

  // No conversation named (bare /conversation-details), or one that doesn't
  // exist / failed to load with nothing in the URL to show instead: never a
  // blank avatar over a generic "Conversation" placeholder.
  if (!participant) {
    if (loadState === 'loading') {
      return <View style={[s.root, { backgroundColor: theme.background }]}>{header}</View>;
    }
    return (
      <View style={[s.root, { backgroundColor: theme.background }]}>
        {header}
        {loadState === 'error' ? (
          <EmptyState
            variant="error"
            icon="alert-circle"
            title="Couldn’t load this conversation"
            message="Check your connection and try again."
            actionLabel="Retry"
            onAction={() => setReloadKey(k => k + 1)}
            style={s.stateFill}
            testID="chat-details-error"
          />
        ) : (
          <EmptyState
            icon="message-circle"
            title="Conversation not found"
            message="This conversation may have been deleted or the link is incomplete."
            actionLabel="Go back"
            onAction={goBack}
            style={s.stateFill}
            testID="chat-details-not-found"
          />
        )}
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: theme.background }]}>
      {header}

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + SP.xl }}>
        <View style={s.profileBlock}>
          {params.participantUserId === 'brandthread-agent' ? <BrandthreadAvatar size={88} style={s.bigAvatar} /> : (
          <View style={[s.bigAvatar, { backgroundColor: participant.color }]}>
            {participant.avatarUri ? (
              <CachedImage source={{ uri: participant.avatarUri }} style={s.bigAvatarImg} />
            ) : (
              <Text style={s.bigAvatarInitials}>{participant.initials}</Text>
            )}
          </View>
          )}
          <Text style={[s.bigName, { color: theme.text }]} numberOfLines={2} testID="chat-details-name">{displayName}</Text>
          {!!participant.handle && (
            <Text style={[s.bigHandle, { color: theme.muted }]}>{participant.handle}</Text>
          )}

          <View style={s.actionRow}>
            <ActionButton icon="user" label="Profile" theme={theme} onPress={openProfile} testID="chat-details-action-profile" />
            <ActionButton icon="search" label="Search" theme={theme} onPress={openSearch} testID="chat-details-action-search" />
            <ActionButton
              icon={isMuted ? 'bell-off' : 'bell'}
              label={isMuted ? 'Unmute' : 'Mute'}
              theme={theme}
              onPress={() => { isMuted ? applyMute(null) : setMuteVisible(true); }}
              testID="chat-details-action-mute"
            />
            <ActionButton icon="more-horizontal" label="Options" theme={theme} onPress={openOptions} testID="chat-details-action-options" />
          </View>
        </View>

        <View style={[s.list, { borderColor: theme.border }]}>
          <ListRow
            icon="droplet" theme={theme}
            title="Theme"
            subtitle={getConversationTheme(themeId)?.name ?? 'Default'}
            pill={themeNewSeen ? undefined : 'New'}
            onPress={() => { setThemePickerVisible(true); }}
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
              <HapticSwitch
                value={disappearing}
                onValueChange={toggleDisappearing}
                accessibilityLabel="Disappearing messages"
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
            onPress={openBugReport}
            last
            testID="chat-details-row-report"
          />
        </View>
      </ScrollView>

      <Sheet visible={muteVisible} onClose={() => setMuteVisible(false)} title="Mute notifications" testID="chat-details-mute-sheet">
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
      </Sheet>

      <Modal visible={bugVisible} transparent animationType="fade" onRequestClose={() => setBugVisible(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setBugVisible(false)} accessibilityRole="button" accessibilityLabel="Close" />
        <SheetRise style={[s.muteSheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + SP.md }]}>
          <View style={s.sheetHandle} />
          <Text style={[s.muteSheetTitle, { color: theme.text }]}>Something isn’t working</Text>
          <Text style={[s.bugHint, { color: theme.muted }]}>Tell us what went wrong in this chat. We’ll include the conversation so the team can look into it.</Text>
          <TextInput
            value={bugText}
            onChangeText={setBugText}
            placeholder="What happened?"
            placeholderTextColor={theme.muted}
            multiline
            maxLength={1000}
            style={[s.bugInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.cardElevated }, WEB_INPUT_RESET]}
            accessibilityLabel="Describe the problem"
            testID="chat-details-bug-input"
          />
          <PressableScale
            rippleEnabled={false}
            onPress={submitBugReport}
            disabled={!bugText.trim() || bugSending}
            style={[s.bugSend, { backgroundColor: theme.accent, opacity: !bugText.trim() ? 0.5 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Send report"
            testID="chat-details-bug-send"
          >
            {bugSending
              ? <ActivityIndicator color={theme.onAccent} />
              : <Text style={[s.bugSendText, { color: theme.onAccent }]}>Send report</Text>}
          </PressableScale>
        </SheetRise>
      </Modal>

      <ThemePickerSheet
        visible={themePickerVisible}
        theme={theme}
        currentThemeId={themeId}
        bottomInset={insets.bottom}
        onClose={() => setThemePickerVisible(false)}
        onPickDefault={() => commitTheme(null)}
        onPickTheme={(id) => setPreviewThemeId(id)}
      />
      <ThemePreviewScreen
        visible={!!previewThemeId}
        theme={theme}
        candidate={CONVERSATION_THEMES.find((t) => t.id === previewThemeId) ?? null}
        applying={applyingTheme}
        onCancel={() => setPreviewThemeId(null)}
        onApply={() => previewThemeId && commitTheme(previewThemeId)}
      />
    </View>
  );
}

function ActionButton({
  icon, label, theme, onPress, testID,
}: { icon: IconName; label: string; theme: AppThemePreset; onPress: () => void; testID?: string }) {
  const s = makeStyles(theme);
  return (
    <PressableScale rippleEnabled={false} style={s.actionBtn} onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[s.actionIconWrap, { backgroundColor: theme.cardElevated }]}>
        <Icon name={icon} size={ICON.md} color={theme.text} />
      </View>
      <Text style={[s.actionLabel, { color: theme.muted }]}>{label}</Text>
    </PressableScale>
  );
}

function ListRow({
  icon, theme, title, subtitle, pill, right, onPress, last, testID,
}: {
  icon: IconName; theme: AppThemePreset; title: string; subtitle?: string;
  pill?: string; right?: React.ReactNode; onPress?: () => void; last?: boolean; testID?: string;
}) {
  const s = makeStyles(theme);
  const content = (
    <View style={[s.row, !last && { borderBottomWidth: StyleSheetHairline, borderBottomColor: theme.border }]}>
      <Icon name={icon} size={ICON.md} color={theme.text} style={{ width: 28 }} />
      <View style={{ flex: 1 }}>
        <Text style={[s.rowTitle, { color: theme.text }]}>{title}</Text>
        {!!subtitle && <Text style={[s.rowSubtitle, { color: theme.muted }]}>{subtitle}</Text>}
      </View>
      {pill && (
        <View style={[s.pill, { backgroundColor: theme.accent }]}>
          <Text style={[s.pillText, { color: theme.onAccent }]}>{pill}</Text>
        </View>
      )}
      {right ?? (onPress && <Icon name="chevron-right" size={ICON.sm} color={theme.subtle} />)}
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
  stateFill: { flex: 1, justifyContent: 'center' },
  profileBlock: { alignItems: 'center', paddingTop: SP.md, paddingBottom: SP.lg, gap: 4 },
  bigAvatar: {
    width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', marginBottom: SP.sm,
  },
  bigAvatarImg: { width: 88, height: 88 },
  bigAvatarInitials: { fontSize: FS.xl, fontFamily: FONT.bold, color: '#FFFFFF' },
  bigName: { fontSize: FS.lg, fontFamily: FONT.bold, textAlign: 'center', paddingHorizontal: SP.lg },
  bigHandle: { fontSize: FS.sm, fontFamily: FONT.regular, marginBottom: SP.sm },
  actionRow: { flexDirection: 'row', gap: SP.lg, marginTop: SP.sm },
  actionBtn: { alignItems: 'center', gap: 6, width: 64 },
  actionIconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: FS.meta, fontFamily: FONT.medium },
  list: { marginTop: SP.md, borderTopWidth: StyleSheetHairline },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.md, paddingVertical: SP.md },
  rowTitle: { fontSize: FS.base, fontFamily: FONT.medium },
  rowSubtitle: { fontSize: FS.meta, fontFamily: FONT.regular, marginTop: 2 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.pill, marginRight: SP.sm },
  pillText: { fontSize: 11, fontFamily: FONT.bold },
  muteOption: { paddingVertical: SP.md, alignItems: 'center' },
  muteOptionText: { fontFamily: FONT.regular, fontSize: FS.base },
  bugHint: { fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', marginBottom: SP.md },
  bugInput: {
    minHeight: 96, maxHeight: 160, borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth,
    padding: SP.md, fontFamily: FONT.regular, fontSize: FS.base, textAlignVertical: 'top',
  },
  bugSend: { height: 48, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', marginTop: SP.md },
  bugSendText: { fontFamily: FONT.semibold, fontSize: FS.base },
});
