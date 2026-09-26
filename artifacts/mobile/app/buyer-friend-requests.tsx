import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, FlatList,
  Alert, StyleSheet,
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
import { useAuth } from '@clerk/expo';
import { requestContextualPushPermission } from '@/lib/contextualPushPermission';
import { Header, ListSkeleton } from '@/components/layout';
import { Button, SegmentedControl } from '@/components/ui';
import { PressableScale, EmptyState } from '@/components/BrandthreadUI';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';

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
  const [actionId, setActionId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [followers, following, sugs] = await Promise.all([
        api.social.followers(),
        api.social.following(),
        getFriendSuggestions(),
      ]);

      // Incoming = people who follow me but I don't follow back
      setIncoming(
        followers
          .filter(f => !f.isFollowingBack)
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
      // Cross-reference: followersSet = set of user IDs who follow me
      const followersSet = new Set(followers.map(f => f.userId));
      setSent(
        following
          .filter(f => !followersSet.has(f.userId))
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
      // Degrade to empty lists on error
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  // ── Follow back (accept incoming) ───────────────────────────────────────────
  const handleFollowBack = async (row: FollowRow) => {
    setActionId(row.userId);
    try {
      await api.social.follow(row.userId);
      setIncoming(prev => prev.filter(r => r.userId !== row.userId));
      void requestContextualPushPermission(userId, api);
    } catch {
      Alert.alert('Error', 'Could not follow back.');
    } finally {
      setActionId(null);
    }
  };

  // ── Dismiss incoming (do nothing — they still follow me) ────────────────────
  const handleDismiss = (row: FollowRow) => {
    setIncoming(prev => prev.filter(r => r.userId !== row.userId));
  };

  // ── Cancel sent (unfollow) ───────────────────────────────────────────────────
  const handleCancel = async (row: FollowRow) => {
    setActionId(row.userId);
    try {
      await api.social.unfollow(row.userId);
      setSent(prev => prev.filter(r => r.userId !== row.userId));
    } catch {
      Alert.alert('Error', 'Could not unfollow.');
    } finally {
      setActionId(null);
    }
  };

  // ── Follow a suggestion ──────────────────────────────────────────────────────
  const handleFollowSuggestion = async (sug: FriendSuggestion) => {
    setSentSet(prev => new Set([...prev, sug.userId]));
    try {
      await api.social.follow(sug.userId);
      // Keep the local social service in sync for anything that reads it.
      await sendFriendRequest({ userId: sug.userId, name: sug.name, handle: sug.handle, initials: sug.initials, color: sug.color }).catch(() => {});
    } catch {
      setSentSet(prev => {
        const next = new Set(prev);
        next.delete(sug.userId);
        return next;
      });
      Alert.alert('Couldn’t follow. Try again.');
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
    { id: 'incoming',  label: incoming.length > 0 ? `Incoming · ${incoming.length}` : 'Incoming' },
    { id: 'sent',      label: sent.length > 0 ? `Sent · ${sent.length}` : 'Sent' },
    { id: 'suggested', label: 'Suggested' },
  ];

  // ── Render incoming ──────────────────────────────────────────────────────

  function renderIncoming() {
    if (loading) return <ListSkeleton rows={4} />;
    if (incoming.length === 0) {
      return (
        <EmptyState
          icon="inbox"
          title="No new followers"
          description="When someone follows you, they'll appear here."
        />
      );
    }
    return (
      <FlatList
        data={incoming}
        keyExtractor={r => r.userId}
        scrollEnabled={false}
        renderItem={({ item: row }) => (
          <View style={s.row}>
            <PressableScaleRow onPress={() => goToProfile(row)} onLongPress={() =>
              Alert.alert(row.name, undefined, [
                { text: 'Block',  style: 'destructive', onPress: () => blockUser({ userId: row.userId, name: row.name, handle: row.handle, initials: row.initials, color: row.color }) },
                { text: 'Cancel', style: 'cancel' },
              ])
            }>
              <View style={[s.avatar48, { backgroundColor: row.color }]}>
                <Text style={[TYPE_SCALE.headline, s.avatar48Text]}>{row.initials}</Text>
              </View>
              <View style={s.rowCenter}>
                <Text style={[TYPE_SCALE.body, s.rowName]} numberOfLines={1}>{row.name}</Text>
                <Text style={[TYPE_SCALE.footnote, s.rowHandle]} numberOfLines={1}>{row.handle}</Text>
                <Text style={[TYPE_SCALE.caption, s.rowMutual]}>Follows you</Text>
              </View>
            </PressableScaleRow>
            <View style={s.rowActions}>
              <Button label="Dismiss" variant="secondary" size="small" onPress={() => handleDismiss(row)} />
              <Button
                label="Follow"
                variant="primary"
                size="small"
                loading={actionId === row.userId}
                onPress={() => handleFollowBack(row)}
              />
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
          title="All caught up"
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
                <Text style={[TYPE_SCALE.footnote, s.rowHandle]} numberOfLines={1}>{row.handle}</Text>
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
                loading={actionId === row.userId}
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
                  <Text style={[TYPE_SCALE.footnote, s.rowHandle]} numberOfLines={1}>{sug.handle}</Text>
                  {sug.reason ? <Text style={[TYPE_SCALE.caption, s.rowMutual]} numberOfLines={1}>{sug.reason}</Text> : null}
                </View>
              </PressableScaleRow>
              <View style={s.rowActions}>
                {followed ? (
                  <View style={[s.requestedPill, { borderColor: theme.accent }]}>
                    <Text style={[TYPE_SCALE.caption, s.requestedPillText, { color: theme.accent }]}>Following</Text>
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
      <Header
        title="Connections"
        actions={[{ icon: 'search', onPress: () => router.push('/(buyer)/search' as never), accessibilityLabel: 'Search' }]}
      />

      {/* Tabs */}
      <View style={s.tabBarWrap}>
        <SegmentedControl options={tabOptions} selectedId={tab} onChange={(id) => setTab(id as Tab)} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.huge + SPACING.xxl }}>
        {tab === 'incoming'  && renderIncoming()}
        {tab === 'sent'      && renderSent()}
        {tab === 'suggested' && renderSuggested()}
      </ScrollView>
    </View>
  );
}

// A row's tap area (open profile) built on the shared press-scale feel, kept
// separate from the row's trailing action buttons so they don't nest presses.
function PressableScaleRow({ children, onPress, onLongPress }: { children: React.ReactNode; onPress: () => void; onLongPress?: () => void }) {
  return (
    <PressableScale onPress={onPress} onLongPress={onLongPress} style={rowStyles.wrap}>
      {children}
    </PressableScale>
  );
}
const rowStyles = StyleSheet.create({
  wrap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
});

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme'], palette: ReturnType<typeof useColors>) => StyleSheet.create({
  container:       { flex: 1, backgroundColor: palette.background },
  tabBarWrap:      { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
  row:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.border, gap: SPACING.sm },
  avatar48:        { width: 48, height: 48, borderRadius: RADII.avatar, alignItems: 'center', justifyContent: 'center' },
  avatar48Text:    { color: '#FFFFFF' }, // theme-exempt: initials on a per-user identity color
  rowCenter:       { flex: 1, marginLeft: SPACING.sm, gap: 2 },
  rowName:         { color: palette.foreground },
  rowHandle:       { color: palette.mutedForeground },
  rowMutual:       { color: palette.mutedForeground },
  rowActions:      { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  requestedPill:   { paddingHorizontal: SPACING.sm, paddingVertical: 4, backgroundColor: palette.card, borderWidth: 1, borderRadius: RADII.pill },
  requestedPillText: {},
});
