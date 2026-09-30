/**
 * Community group chat — /community-chat?id=<communityId>.
 *
 * A Discord-style topic room: unlimited members, no pings, per-member mute.
 * State, realtime and optimistic sends live in
 * components/community-chat/useCommunityChat.ts; the merge rules are pure and
 * unit-tested in lib/communities/chatMerge.ts. The bubble look is the DM one.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, NativeScrollEvent, NativeSyntheticEvent, Platform, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView, KeyboardGestureArea } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState, PressableScale } from '@/components/BrandthreadUI';
import { CommunityAvatar } from '@/components/community/CommunityAvatar';
import { SignInPrompt } from '@/components/community/SignInPrompt';
import { VerifiedMark } from '@/components/community/VerifiedMark';
import { ReactionOverlay, type ReactionOverlayAnchor, type ReactionOverlayMenuItem } from '@/components/chat/ReactionOverlay';
import MediaViewer from '@/components/chat/MediaViewer';
import { ErrorState } from '@/components/ui/ErrorState';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { Snackbar } from '@/components/ui/Snackbar';
import { CommunityComposer, COMMUNITY_CHAT_INPUT_ID } from '@/components/community-chat/CommunityComposer';
import {
  CommunityMessageRow, communityBubbleStyle, communityBubbleTextStyle,
} from '@/components/community-chat/CommunityMessageRow';
import { useCommunityChat } from '@/components/community-chat/useCommunityChat';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useApi } from '@/lib/api';
import { hapticPrimaryAction, hapticSelection } from '@/lib/haptics';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { apiErrorMessage, reportHref } from '@/lib/safety';
import { COMP, FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { formatMemberCount, type CommunityAttachment } from '@/lib/communities/types';
import { isNearBottom, myReactionType, newMessagesLabel, type ChatRow, type DisplayMessage } from '@/lib/communities/chatMerge';
import type { ReactionType } from '@/services/socialTypes';
import { radius } from '@/constants/radii';

export default function CommunityChatScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const headerTopPad = useHeaderTopInset();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const communityId = Array.isArray(params.id) ? params.id[0] : params.id;
  const chat = useCommunityChat(communityId);
  const { community, myId } = chat;

  const listRef = React.useRef<FlatList<ChatRow>>(null);
  const [replyTo, setReplyTo] = useState<DisplayMessage | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [menuMsg, setMenuMsg] = useState<DisplayMessage | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<ReactionOverlayAnchor | null>(null);

  const isLive = chat.client.mode === 'live';
  const back = useCallback(() => { hapticPrimaryAction(); goBackOr(router); }, [router]);
  const openMembers = useCallback(() => {
    if (communityId) router.push(`/community-members?id=${encodeURIComponent(communityId)}` as never);
  }, [communityId, router]);

  // ─── Header menu ──────────────────────────────────────────────────────────
  const confirmLeave = useCallback(() => {
    showActionSheet('Leave this group?', 'You’ll stop getting its messages. You can rejoin later if the group is open.', [
      {
        text: 'Leave group',
        style: 'destructive',
        onPress: async () => {
          const res = await chat.leave();
          if (res.ok) goBackOr(router);
          else chat.flash(res.message);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [chat, router]);

  const openChatMenu = useCallback(() => {
    if (!community) return;
    hapticSelection();
    showActionSheet(community.name, undefined, [
      { text: community.muted ? 'Unmute notifications' : 'Mute notifications', onPress: () => { void chat.setMuted(!community.muted); } },
      { text: 'Members', onPress: openMembers },
      ...(community.kind === 'user'
        ? [{
            text: 'Report group',
            onPress: () => {
              if (isLive) {
                router.push(reportHref({ targetType: 'community', targetId: community.id, label: community.name }) as never);
              } else {
                chat.flash('Thanks. We’ll take a look at this group.');
              }
            },
          }]
        : []),
      { text: 'Leave group', style: 'destructive' as const, onPress: confirmLeave },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [chat, community, confirmLeave, isLive, openMembers, router]);

  // ─── Message menu (long-press) ────────────────────────────────────────────
  const closeMenu = useCallback(() => { setMenuMsg(null); setMenuAnchor(null); }, []);

  const openMessageMenu = useCallback((msg: DisplayMessage, anchor: ReactionOverlayAnchor | null) => {
    if (!anchor) return;
    hapticSelection();
    setMenuAnchor(anchor);
    setMenuMsg(msg);
  }, []);

  const blockSender = useCallback((msg: DisplayMessage) => {
    showActionSheet(`Block ${msg.fromName}?`, 'You won’t see their messages in groups. They aren’t notified.', [
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          try {
            if (isLive) await api.social.block(msg.fromId);
            chat.hideSender(msg.fromId);
            chat.flash(`${msg.fromName} is blocked.`);
          } catch (e) {
            chat.flash(apiErrorMessage(e, 'Couldn’t block that person. Try again.'));
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [api, chat, isLive]);

  const menuItems = useMemo<ReactionOverlayMenuItem[]>(() => {
    const msg = menuMsg;
    if (!msg) return [];
    const own = msg.fromId === myId;
    const items: ReactionOverlayMenuItem[] = [
      { key: 'reply', label: 'Reply', icon: 'corner-up-left', onPress: () => { setReplyTo(msg); closeMenu(); } },
    ];
    if (msg.text) {
      items.push({
        key: 'copy', label: 'Copy', icon: 'copy',
        onPress: () => { void Clipboard.setStringAsync(msg.text); chat.flash('Copied'); closeMenu(); },
      });
    }
    if (!own) {
      items.push({
        key: 'report', label: 'Report message', icon: 'flag', destructive: true,
        onPress: () => {
          closeMenu();
          if (isLive) {
            router.push(reportHref({
              targetType: 'community_message', targetId: msg.id, label: `${msg.fromName}’s message`,
              ownerId: msg.fromId, ownerName: msg.fromName,
            }) as never);
          } else {
            chat.flash('Thanks. We’ll take a look at this message.');
          }
        },
      });
      items.push({ key: 'block', label: 'Block user', icon: 'slash', destructive: true, onPress: () => { closeMenu(); blockSender(msg); } });
    }
    if (own || chat.canModerate) {
      items.push({ key: 'delete', label: 'Delete', icon: 'trash-2', destructive: true, onPress: () => { closeMenu(); void chat.deleteMessage(msg); } });
    }
    return items;
  }, [blockSender, chat, closeMenu, isLive, menuMsg, myId, router]);

  // ─── List ─────────────────────────────────────────────────────────────────
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    chat.setNearBottom(isNearBottom(e.nativeEvent.contentOffset.y));
  }, [chat]);

  const scrollToNewest = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  const sendPayload = useCallback(async (payload: { text: string; attachments: CommunityAttachment[] }) => {
    const reply = replyTo;
    setReplyTo(null);
    scrollToNewest();
    const outcome = await chat.send({ ...payload, replyTo: reply });
    if (!outcome.ok && outcome.code === 'MODERATED') setReplyTo(reply);
    return outcome;
  }, [chat, replyTo, scrollToNewest]);

  const renderItem = useCallback(({ item }: { item: ChatRow }) => {
    if (item.type === 'day') {
      return <View style={s.dayWrap}><Text style={s.dayText}>{item.label}</Text></View>;
    }
    return (
      <CommunityMessageRow
        msg={item.msg}
        isOwn={item.msg.fromId === myId}
        isFirstInGroup={item.isFirstInGroup}
        isLastInGroup={item.isLastInGroup}
        myId={myId}
        onReply={setReplyTo}
        onOpenMenu={openMessageMenu}
        onToggleReaction={chat.toggleReaction}
        onOpenPhoto={setViewerUri}
        onRetry={chat.retry}
        onRemovePending={chat.removePending}
      />
    );
  }, [chat.removePending, chat.retry, chat.toggleReaction, myId, openMessageMenu, s]);

  const listHeader = chat.loadingOlder
    ? <View style={s.olderSpinner}><ActivityIndicator size="small" color={theme.muted} /></View>
    : !chat.hasMore && community
      ? <Text style={s.startNote}>This is the start of {community.name}.</Text>
      : null;

  // ─── Body by state ────────────────────────────────────────────────────────
  function renderBody() {
    switch (chat.status) {
      case 'loading':
        return <View style={s.center}><ActivityIndicator color={theme.muted} /></View>;
      case 'error':
        return <View style={s.center}><ErrorState message={chat.error ?? undefined} onRetry={chat.reload} /></View>;
      case 'auth':
        return <View style={s.centerPad}><SignInPrompt message="Sign in to join this group and chat." /></View>;
      case 'removed':
        return (
          <View style={s.center}>
            <EmptyState
              icon="user-x"
              title="You’re no longer in this group"
              description="You can’t see or send messages here anymore."
              action={{ label: 'Back', onPress: back }}
            />
          </View>
        );
      case 'deleted':
        return (
          <View style={s.center}>
            <EmptyState icon="archive" title="This group was deleted" description="Its owner closed it, so the chat is no longer available." action={{ label: 'Back', onPress: back }} />
          </View>
        );
      case 'notfound':
        return (
          <View style={s.center}>
            <EmptyState icon="users" title="This group isn’t available" description="It may have been removed or the link is out of date." action={{ label: 'Back', onPress: back }} />
          </View>
        );
      default:
        return (
          <>
            {chat.fallback && (
              <Text style={s.reconnect} accessibilityLiveRegion="polite">Reconnecting… new messages may be delayed.</Text>
            )}
            <View style={s.listWrap}>
              {chat.empty ? (
                <View style={s.center}>
                  <EmptyState
                    compact
                    icon="message-circle"
                    title="Say hello"
                    description={`Be the first to start the conversation in ${community?.name ?? 'this group'}.`}
                  />
                </View>
              ) : (
                <KeyboardGestureArea style={{ flex: 1 }} textInputNativeID={COMMUNITY_CHAT_INPUT_ID}>
                  <FlatList
                    ref={listRef}
                    inverted
                    data={chat.rows}
                    keyExtractor={(item) => item.key}
                    renderItem={renderItem}
                    onEndReached={() => { void chat.loadOlder(); }}
                    onEndReachedThreshold={0.4}
                    onScroll={onScroll}
                    scrollEventThrottle={64}
                    ListFooterComponent={listHeader}
                    contentContainerStyle={s.listContent}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="interactive"
                    // Keeps what you're reading in place when messages land below while scrolled up.
                    maintainVisibleContentPosition={Platform.OS === 'web' ? undefined : { minIndexForVisible: 0 }}
                  />
                </KeyboardGestureArea>
              )}

              {chat.newCount > 0 && (
                <View pointerEvents="box-none" style={s.pillWrap}>
                  <PressableScale
                    rippleEnabled={false}
                    bounce={false}
                    noMinHeight
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => { hapticSelection(); scrollToNewest(); }}
                    style={s.newPill}
                    accessibilityRole="button"
                    accessibilityLabel={`${newMessagesLabel(chat.newCount)}. Jump to latest`}
                    testID="community-new-messages"
                  >
                    <Feather name="arrow-down" size={14} color={theme.onAccent} />
                    <Text style={s.newPillText}>{newMessagesLabel(chat.newCount)}</Text>
                  </PressableScale>
                </View>
              )}
            </View>

            <CommunityComposer
              onSend={sendPayload}
              uploadPhoto={chat.client.uploadPhoto}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              onNotice={chat.flash}
              bottomInset={insets.bottom}
            />
          </>
        );
    }
  }

  const menuOwn = !!menuMsg && menuMsg.fromId === myId;

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
      {/* Same metrics as ScreenHeader (top inset + SP.sm, 56pt row, 44pt targets), with the
          group avatar/name/member count in the title slot, which ScreenHeader's string title can't hold. */}
      <View style={[s.header, { paddingTop: headerTopPad + SP.sm, paddingRight: SP.md + insets.right }]}>
        <PressableScale
          rippleEnabled={false}
          onPress={back}
          style={s.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          testID="community-chat-back"
        >
          <Feather name="arrow-left" size={ICON.md} color={theme.text} />
        </PressableScale>

        <View style={s.titleWrap}>
          {community && (
            <PressableScale
              rippleEnabled={false}
              noMinHeight
              onPress={() => { hapticSelection(); openMembers(); }}
              style={s.titleRow}
              accessibilityRole="button"
              accessibilityLabel={`${community.name}, ${formatMemberCount(community.memberCount)}. View members`}
              testID="community-chat-title"
            >
              <CommunityAvatar community={community} size={36} />
              <View style={s.titleText}>
                <View style={s.nameRow}>
                  <Text style={s.name} numberOfLines={1}>{community.name}</Text>
                  {community.verified && <VerifiedMark size={14} />}
                </View>
                <Text style={s.members} numberOfLines={1}>{formatMemberCount(community.memberCount)}</Text>
              </View>
            </PressableScale>
          )}
        </View>

        {community?.muted && (
          <View style={s.mutedGlyph} accessible accessibilityLabel="Notifications muted">
            <Feather name="bell-off" size={ICON.sm} color={theme.muted} />
          </View>
        )}
        {community && (
          <PressableScale
            rippleEnabled={false}
            onPress={openChatMenu}
            style={s.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Group options"
            testID="community-chat-menu"
          >
            <Feather name="more-horizontal" size={ICON.md} color={theme.text} />
          </PressableScale>
        )}
      </View>

      {renderBody()}

      <ReactionOverlay
        visible={menuMsg != null}
        anchor={menuAnchor}
        isOwn={menuOwn}
        bubbleStyle={menuMsg ? communityBubbleStyle(theme, menuOwn) : undefined}
        bubbleContent={menuMsg ? (
          <Text style={[s.overlayText, communityBubbleTextStyle(theme, menuOwn)]}>
            {menuMsg.text || (menuMsg.attachments.length > 1 ? `${menuMsg.attachments.length} photos` : 'Photo')}
          </Text>
        ) : null}
        selected={(menuMsg ? myReactionType(menuMsg.reactions, myId) : null) as ReactionType | null}
        onSelectReaction={(type) => {
          if (menuMsg) void chat.toggleReaction(menuMsg, type);
          closeMenu();
        }}
        menuItems={menuItems}
        onClose={closeMenu}
      />

      <MediaViewer visible={viewerUri != null} uri={viewerUri} onClose={() => setViewerUri(null)} />

      <Snackbar visible={!!chat.notice} message={chat.notice ?? ''} />
    </KeyboardAvoidingView>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  header: {
    flexDirection: 'row', alignItems: 'center', minHeight: COMP.headerH,
    paddingLeft: SP.md, paddingBottom: SP.sm, gap: SP.xs,
    backgroundColor: theme.background, zIndex: 5,
  },
  iconBtn: { width: COMP.iconBtn, height: COMP.iconBtn, alignItems: 'center', justifyContent: 'center' },
  mutedGlyph: { width: 28, height: COMP.iconBtn, alignItems: 'center', justifyContent: 'center' },
  // flex + minWidth 0 down the chain is what lets a long group name truncate instead of pushing the icons.
  titleWrap: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: COMP.iconBtn },
  titleText: { flexShrink: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, fontSize: FS.md, fontFamily: FONT.bold, color: theme.text, letterSpacing: -0.2 },
  members: { fontSize: FS.meta, fontFamily: FONT.regular, color: theme.muted, marginTop: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg },
  centerPad: { flex: 1, justifyContent: 'center', paddingHorizontal: SP.md },
  listWrap: { flex: 1 },
  listContent: { paddingVertical: SP.sm },
  dayWrap: { alignItems: 'center', marginVertical: SP.lg },
  dayText: { fontSize: FS.meta, fontFamily: FONT.medium, color: theme.muted },
  olderSpinner: { paddingVertical: SP.md },
  startNote: { textAlign: 'center', fontSize: FS.meta, fontFamily: FONT.regular, color: theme.muted, paddingVertical: SP.lg, paddingHorizontal: SP.lg },
  reconnect: { textAlign: 'center', fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, paddingVertical: SP.xs },
  pillWrap: { position: 'absolute', left: 0, right: 0, bottom: SP.sm, alignItems: 'center' },
  newPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 34,
    paddingHorizontal: SP.md, borderRadius: radius.sm, backgroundColor: theme.accent,
  },
  newPillText: { fontSize: FS.meta, fontFamily: FONT.semibold, color: theme.onAccent },
  overlayText: { fontSize: 15, fontFamily: FONT.regular, lineHeight: 21 },
});
