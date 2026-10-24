import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, FlatList,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import {
  getFriendSuggestions, sendFriendRequest, blockUser,
} from '@/services/socialService';
import type { FriendSuggestion } from '@/services/socialTypes';
import { useApi } from '@/lib/api';
import { hapticFollow } from '@/lib/haptics';
import { useAuth } from '@clerk/expo';
import { requestContextualPushPermission } from '@/lib/contextualPushPermission';
import { ListSkeleton } from '@/components/layout';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { RetryRow } from '@/components/ui/RetryRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Avatar, Button, SegmentedControl } from '@/components/ui';
import { PressableScale, EmptyState } from '@/components/BrandthreadUI';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { Icon } from '@/components/ui/Icon';
import { CONTACT_SYNC_ENABLED } from '@/lib/contactSyncFlag';
import { showAlert } from '@/lib/actionSheet';
import { friendlyError } from '@/lib/friendlyError';

type Tab = 'incoming' | 'sent' | 'suggested';

// ── Normalized row used for both incoming and sent ─────────────────────────────
type FollowRow = {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  isFollowingBack?: boolean; // for incoming: have I followed back?
};

// Real incoming follow requests to a private account (server-backed).
type RequestRow = { userId: string; name: string; handle: string; avatarUrl: string | null };

// Which row has a request in flight, and which button started it — so Delete
// and Confirm each show their own spinner.
type PendingAction = { userId: string; action: 'approve' | 'decline' | 'follow' | 'unfollow' };

export default function BuyerFriendRequestsScreen() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const s = makeStyles(theme, palette);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api    = useApi();
  const { userId } = useAuth();
  const params = useLocalSearchParams<{ tab?: string }>();
  const initialTab: Tab = params.tab === 'suggested' || params.tab === 'sent' ? params.tab : 'incoming';

  const [tab,      setTab]      = useState<Tab>(initialTab);
  const [incoming, setIncoming] = useState<FollowRow[]>([]);   // followers I haven't followed back
  const [sent,     setSent]     = useState<FollowRow[]>([]);   // people I follow who don't follow back
  const [suggestions, setSuggestions] = useState<FriendSuggestion[]>([]);
  const [sentSet,  setSentSet]  = useState<Set<string>>(new Set()); // local optimistic follows
  const [loading,  setLoading]  = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const isPending = (id: string, action: PendingAction['action']) => pending?.userId === id && pending.action === action;
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set()); // follows that became requests (private accounts)
  const [loadFailed, setLoadFailed] = useState(false);
  const pull = usePullToRefresh(() => loadData(true));

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadFailed(false);
    try {
      const [followers, following, sugs, reqs] = await Promise.all([
        api.social.followers(),
        api.social.following(),
        getFriendSuggestions(),
        api.followRequests.list().catch(() => [] as RequestRow[]),
      ]);
      setRequests(Array.isArray(reqs) ? reqs : []);

      // Incoming = people who follow me but I don't follow back (and whose
      // follow-back prompt I haven't dismissed — persisted server-side)
      setIncoming(
        followers
          .filter(f => !f.isFollowingBack && !f.followBackDismissed)
          .map(f => ({
            userId:          f.userId,
            name:            f.name,
            handle:          f.handle,
            initials:        f.initials,
            color:           f.color,
            isFollowingBack: false,
          }))
      );

      // Sent = people I follow but who don't follow me back
      // Cross-reference: followersSet = set of user IDs who follow me (plus
      // the following row's own followsMe flag, so a mutual never lands here)
      const followersSet = new Set(followers.map(f => f.userId));
      setSent(
        following
          .filter(f => !followersSet.has(f.userId) && !f.followsMe)
          .map(f => ({
            userId:   f.userId,
            name:     f.name,
            handle:   f.handle,
            initials: f.initials,
            color:    f.color,
          }))
      );

      setSuggestions(sugs);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void loadData(); }, [loadData]));

  // ── Follow back (accept incoming) ───────────────────────────────────────────
  const handleFollowBack = async (row: FollowRow) => {
    hapticFollow(true);
    setPending({ userId: row.userId, action: 'follow' });
    try {
      await api.social.follow(row.userId);
      setIncoming(prev => prev.filter(r => r.userId !== row.userId));
      void requestContextualPushPermission(userId, api);
    } catch (err) {
      showAlert('Couldn’t follow back', friendlyError(err, 'Try again in a moment.'));
    } finally {
      setPending(null);
    }
  };

  // ── Follow requests (private account): Confirm creates the follow, Delete drops it ──
  const handleRequest = async (row: RequestRow, action: 'approve' | 'decline') => {
    setPending({ userId: row.userId, action });
    try {
      if (action === 'approve') await api.followRequests.approve(row.userId);
      else await api.followRequests.decline(row.userId);
      setRequests(prev => prev.filter(r => r.userId !== row.userId));
      if (action === 'approve') void loadData();
    } catch (err) {
      showAlert(action === 'approve' ? 'Couldn’t confirm request' : 'Couldn’t delete request', friendlyError(err, 'Try again in a moment.'));
    } finally {
      setPending(null);
    }
  };

  // ── Dismiss incoming (they still follow me; the prompt stays hidden) ─────
  // Optimistic: the row leaves at once and comes back if the server refuses.
  const handleDismiss = async (row: FollowRow) => {
    const index = incoming.findIndex(r => r.userId === row.userId);
    setIncoming(prev => prev.filter(r => r.userId !== row.userId));
    try {
      await api.social.dismissFollower(row.userId);
    } catch (err) {
      setIncoming(prev => {
        if (prev.some(r => r.userId === row.userId)) return prev;
        const next = [...prev];
        next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, row);
        return next;
      });
      showAlert('Couldn’t dismiss', friendlyError(err, 'Try again in a moment.'));
    }
  };

  // ── Block from the long-press menu ──────────────────────────────────────────
  const handleBlock = async (row: FollowRow) => {
    try {
      await blockUser({ userId: row.userId, name: row.name, handle: row.handle, initials: row.initials, color: row.color });
      setIncoming(prev => prev.filter(r => r.userId !== row.userId));
      setSent(prev => prev.filter(r => r.userId !== row.userId));
      showAlert(`Blocked ${row.name}`, 'They won’t be notified. You can unblock them from Blocked accounts.');
    } catch (err) {
      showAlert('Couldn’t block', friendlyError(err, 'Try again in a moment.'));
    }
  };

  // ── Cancel sent (unfollow) ───────────────────────────────────────────────────
  const handleCancel = async (row: FollowRow) => {
    hapticFollow(false);
    setPending({ userId: row.userId, action: 'unfollow' });
    try {
      await api.social.unfollow(row.userId);
      setSent(prev => prev.filter(r => r.userId !== row.userId));
    } catch (err) {
      showAlert('Couldn’t unfollow', friendlyError(err, 'Try again in a moment.'));
    } finally {
      setPending(null);
    }
  };

  // ── Follow a suggestion ──────────────────────────────────────────────────────
  const handleFollowSuggestion = async (sug: FriendSuggestion) => {
    hapticFollow(true);
    setSentSet(prev => new Set([...prev, sug.userId]));
    try {
      const res = await api.social.follow(sug.userId);
      if (res?.status === 'requested') setRequestedIds(prev => new Set([...prev, sug.userId]));
      // Keep the local social service in sync for anything that reads it.
      await sendFriendRequest({ userId: sug.userId, name: sug.name, handle: sug.handle, initials: sug.initials, color: sug.color }).catch(() => {});
    } catch (err) {
      setSentSet(prev => {
        const next = new Set(prev);
        next.delete(sug.userId);
        return next;
      });
      showAlert('Couldn’t follow', friendlyError(err, 'Try again in a moment.'));
    }
  };

  // ── Navigate to profile ──────────────────────────────────────────────────────
  const goToProfile = (row: FollowRow) => {
    router.push({
      pathname: '/buyer-other-profile' as any,
      params: { userId: row.userId, name: row.name, handle: row.handle, initials: row.initials, color: row.color },
    });
  };

  // ── Tab bar ────────────────────────────────────────────────────────────────

  const tabOptions: { id: Tab; label: string; count?: number }[] = [
    { id: 'incoming',  label: incoming.length + requests.length > 0 ? `Incoming · ${incoming.length + requests.length}` : 'Incoming' },
    { id: 'sent',      label: sent.length > 0 ? `Sent · ${sent.length}` : 'Sent' },
    { id: 'suggested', label: 'Suggested' },
  ];

  // ── Render incoming ──────────────────────────────────────────────────────

  function renderIncoming() {
    if (loading) return <ListSkeleton rows={4} />;
    const requestRows = requests.length === 0 ? null : (
      <View>
        <Text style={[TYPE_SCALE.footnote, s.sectionLabel]}>Follow requests</Text>
        {requests.map(row => (
          <View key={row.userId} style={s.row} testID={`follow-request-${row.userId}`}>
            <PressableScaleRow onPress={() => goToProfile({ userId: row.userId, name: row.name, handle: row.handle, initials: '', color: '' })}>
              <Avatar uri={row.avatarUrl} name={row.name} size={48} />
              <View style={s.rowCenter}>
                <Text style={[TYPE_SCALE.body, s.rowName]} numberOfLines={2}>{row.name}</Text>
                <Text style={[TYPE_SCALE.footnote, s.rowHandle]} numberOfLines={1}>{row.handle}</Text>
              </View>
            </PressableScaleRow>
            <View style={s.rowActions}>
              <View style={s.requestBtn}><Button label="Delete" variant="secondary" size="small" fullWidth style={{ paddingHorizontal: 12 }} loading={isPending(row.userId, 'decline')} disabled={pending?.userId === row.userId && !isPending(row.userId, 'decline')} onPress={() => handleRequest(row, 'decline')} /></View>
              <View style={s.requestBtn}><Button label="Confirm" variant="primary" size="small" fullWidth style={{ paddingHorizontal: 12 }} loading={isPending(row.userId, 'approve')} disabled={pending?.userId === row.userId && !isPending(row.userId, 'approve')} onPress={() => handleRequest(row, 'approve')} /></View>
            </View>
          </View>
        ))}
        {incoming.length > 0 ? <Text style={[TYPE_SCALE.footnote, s.sectionLabel]}>Followers</Text> : null}
      </View>
    );
    if (incoming.length === 0 && requestRows) return requestRows;
    if (incoming.length === 0) {
      return (
        <EmptyState
          icon="inbox"
          title="No incoming requests"
          description="When someone follows you, you can follow them back from here."
        />
      );
    }
    return (
      <FlatList
        data={incoming}
        keyExtractor={r => r.userId}
        scrollEnabled={false}
        ListHeaderComponent={requestRows}
        renderItem={({ item: row }) => (
          <View style={s.row}>
            <PressableScaleRow onPress={() => goToProfile(row)} onLongPress={() =>
              showAlert(row.name, undefined, [
                { text: 'Block',  style: 'destructive', onPress: () => { void handleBlock(row); } },
                { text: 'Cancel', style: 'cancel' },
              ])
            }>
              <View style={[s.avatar48, { backgroundColor: row.color }]}>
                <Text style={[TYPE_SCALE.headline, s.avatar48Text]}>{row.initials}</Text>
              </View>
              <View style={s.rowCenter}>
                <Text style={[TYPE_SCALE.body, s.rowName]} numberOfLines={2}>{row.name}</Text>
                <Text style={[TYPE_SCALE.footnote, s.rowHandle]} numberOfLines={1}>{row.handle}</Text>
                <Text style={[TYPE_SCALE.caption, s.rowMutual]}>Follows you</Text>
              </View>
            </PressableScaleRow>
            <View style={s.rowActions}>
              <View style={s.requestBtn}><Button label="Dismiss" variant="secondary" size="small" fullWidth style={{ paddingHorizontal: 12 }} onPress={() => { void handleDismiss(row); }} /></View>
              <View style={s.requestBtn}><Button label="Follow" variant="primary" size="small" fullWidth style={{ paddingHorizontal: 12 }} loading={isPending(row.userId, 'follow')} onPress={() => handleFollowBack(row)} /></View>
            </View>
          </View>
        )}
      />
    );
  }

  // ── Render sent ──────────────────────────────────────────────────────────

  function renderSent() {
    if (loading) return <ListSkeleton rows={4} />;
    if (sent.length === 0) {
      return (
        <EmptyState
          icon="user-check"
          title="No friend requests"
          description="Everyone you follow also follows you back."
        />
      );
    }
    return (
      <FlatList
        data={sent}
        keyExtractor={r => r.userId}
        scrollEnabled={false}
        renderItem={({ item: row }) => (
          <View style={s.row}>
            <PressableScaleRow onPress={() => goToProfile(row)}>
              <View style={[s.avatar48, { backgroundColor: row.color }]}>
                <Text style={[TYPE_SCALE.headline, s.avatar48Text]}>{row.initials}</Text>
              </View>
              <View style={s.rowCenter}>
                <Text style={[TYPE_SCALE.body, s.rowName]} numberOfLines={1}>{row.name}</Text>
                <Text style={[TYPE_SCALE.footnote, s.rowHandle]} numberOfLines={1}>{atHandle(row.handle)}</Text>
                <Text style={[TYPE_SCALE.caption, s.rowMutual]}>You follow them</Text>
              </View>
            </PressableScaleRow>
            <View style={s.rowActions}>
              <View style={[s.requestedPill, { borderColor: theme.accent }]}>
                <Text style={[TYPE_SCALE.caption, s.requestedPillText, { color: theme.accent }]}>Following</Text>
              </View>
              <Button
                label="Unfollow"
                variant="tertiary"
                size="small"
                loading={isPending(row.userId, 'unfollow')}
                onPress={() => handleCancel(row)}
              />
            </View>
          </View>
        )}
      />
    );
  }

  // ── Render suggested ───────────────────────────────────────────────────────

  function renderSuggested() {
    if (loading) return <ListSkeleton rows={4} />;
    if (suggestions.length === 0) {
      return (
        <EmptyState
          icon="users"
          title="No suggestions yet"
          description="Use Search to find buyers to follow."
        />
      );
    }
    return (
      <FlatList
        data={suggestions}
        keyExtractor={sug => sug.id}
        scrollEnabled={false}
        renderItem={({ item: sug }) => {
          const followed = sentSet.has(sug.userId);
          return (
            <View style={s.row}>
              <PressableScaleRow onPress={() => router.push({
                pathname: '/buyer-other-profile' as any,
                params: { userId: sug.userId, name: sug.name, handle: sug.handle, initials: sug.initials, color: sug.color },
              })}>
                <View style={[s.avatar48, { backgroundColor: sug.color }]}>
                  <Text style={[TYPE_SCALE.headline, s.avatar48Text]}>{sug.initials}</Text>
                </View>
                <View style={s.rowCenter}>
                  <Text style={[TYPE_SCALE.body, s.rowName]} numberOfLines={1}>{sug.name}</Text>
                  <Text style={[TYPE_SCALE.footnote, s.rowHandle]} numberOfLines={1}>{atHandle(sug.handle)}</Text>
                  {sug.reason ? <Text style={[TYPE_SCALE.caption, s.rowMutual]} numberOfLines={1}>{sug.reason}</Text> : null}
                </View>
              </PressableScaleRow>
              <View style={s.rowActions}>
                {followed ? (
                  <View style={[s.requestedPill, { borderColor: theme.accent }]}>
                    <Text style={[TYPE_SCALE.caption, s.requestedPillText, { color: theme.accent }]}>{requestedIds.has(sug.userId) ? 'Requested' : 'Following'}</Text>
                  </View>
                ) : (
                  <Button label="Follow" variant="primary" size="small" onPress={() => handleFollowSuggestion(sug)} />
                )}
              </View>
            </View>
          );
        }}
      />
    );
  }

  return (
    <View style={s.container}>
      <ScreenHeader
        title="Follow requests"
        actions={[{ icon: 'search', onPress: () => router.push('/buyer-search' as never), accessibilityLabel: 'Search' }]}
      />

      {/* Tabs */}
      <View style={s.tabBarWrap}>
        <SegmentedControl options={tabOptions} selectedId={tab} onChange={(id) => setTab(id as Tab)} />
      </View>

      <ScrollView
        refreshControl={pull.refreshControl}
        contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.huge + SPACING.xxl }}
      >
        {/* A failed load shows the retry row instead of the tab's empty state, which would contradict it. */}
        {loadFailed && !loading && incoming.length === 0 && sent.length === 0 && suggestions.length === 0 ? (
          <View style={{ padding: SPACING.md }}><RetryRow label="Couldn't load people" onRetry={() => { void loadData(); }} /></View>
        ) : (<>
        {CONTACT_SYNC_ENABLED && (
          <PressableScale
            testID="find-from-contacts"
            style={s.contactsRow}
            accessibilityRole="button"
            accessibilityLabel="Find from contacts"
            onPress={() => router.push('/find-friends-contacts' as never)}
          >
            <Icon name="book-open" size={20} color={palette.foreground} />
            <Text style={[TYPE_SCALE.body, s.contactsRowText]}>Find from contacts</Text>
            <Icon name="chevron-right" size={18} color={palette.mutedForeground} />
          </PressableScale>
        )}
        {tab === 'incoming'  && renderIncoming()}
        {tab === 'sent'      && renderSent()}
        {tab === 'suggested' && renderSuggested()}
        </>)}
      </ScrollView>
    </View>
  );
}

// Seller handles come back bare ("fieldoffice"); buyer handles carry the @.
function atHandle(handle?: string | null): string {
  if (!handle) return '';
  return handle.startsWith('@') ? handle : `@${handle}`;
}

// A row's tap area (open profile) built on the shared press-scale feel, kept
// separate from the row's trailing action buttons so they don't nest presses.
function PressableScaleRow({ children, onPress, onLongPress }: { children: React.ReactNode; onPress: () => void; onLongPress?: () => void }) {
  // PressableScale puts object styles on its inner view; the cell gives the
  // outer pressable the flex so long names shrink and the actions stay on screen.
  return (
    <View style={rowStyles.cell}>
      <PressableScale onPress={onPress} onLongPress={onLongPress} style={rowStyles.wrap}>
        {children}
      </PressableScale>
    </View>
  );
}
const rowStyles = StyleSheet.create({
  cell: { flex: 1, minWidth: 0 },
  wrap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
});

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme'], palette: ReturnType<typeof useColors>) => StyleSheet.create({
  container:       { flex: 1, backgroundColor: palette.background },
  tabBarWrap:      { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
  contactsRow:     { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
  contactsRowText: { flex: 1, color: palette.foreground },
  row:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.border, gap: SPACING.sm },
  avatar48:        { width: 48, height: 48, borderRadius: RADII.avatar, alignItems: 'center', justifyContent: 'center' },
  avatar48Text:    { color: '#FFFFFF' }, // theme-exempt: initials on a per-user identity color
  rowCenter:       { flex: 1, minWidth: 0, marginLeft: SPACING.sm, gap: 2 },
  rowName:         { color: palette.foreground },
  rowHandle:       { color: palette.mutedForeground },
  rowMutual:       { color: palette.mutedForeground },
  requestBtn:      { width: 96, flexShrink: 0 }, // Delete / Confirm: equal width
  sectionLabel:    { color: palette.mutedForeground, paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.xs },
  rowActions:      { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexShrink: 0 },
  requestedPill:   { paddingHorizontal: SPACING.sm, paddingVertical: 4, backgroundColor: palette.card, borderWidth: 1, borderRadius: RADII.pill },
  requestedPillText: {},
});
