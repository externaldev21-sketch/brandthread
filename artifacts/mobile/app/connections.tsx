/**
 * Connections Screen — Followers / Following, Instagram-style.
 *
 * Params:
 *   type   — 'followers' | 'following' — which tab opens first
 *   userId — optional; the profile whose list this is (defaults to the viewer)
 *
 * Mirrors Instagram's own followers/following list flow (Mobbin references,
 * see docs/activity-flows.md and the PR description):
 *  - Followers / Following tabs with counts, a search bar filtering the
 *    active list client-side.
 *  - Followers list: on the viewer's OWN list, each row gets a "Remove"
 *    button opening the same RemoveFollowerSheet the Activity tab uses
 *    (components/social/RemoveFollowerSheet) and calling the same
 *    DELETE /api/social/followers/:userId endpoint. Viewing someone else's
 *    followers list shows a Follow/Following/Follow-back pill instead.
 *  - Following list: a Follow/Following pill per row; tapping "Following"
 *    opens a two-option unfollow confirm (Unfollow / Cancel), and a
 *    "Sort by" row above the list opens a bottom sheet (Default / Date
 *    followed: latest / Date followed: earliest).
 *  - A small "Follows you" tag marks mutual rows on the viewer's own lists.
 *
 * Every row still opens that person's profile — the brand profile for
 * sellers, the buyer profile for buyers.
 */
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { LONG_LIST_TUNING } from '@/lib/listTuning';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, FILL_ELEVATED, TEXT_TERTIARY } from '@/lib/theme';
import { useUser } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { ListSkeleton } from '@/components/layout';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState, PressableScale, SearchBar } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { ErrorState } from '@/components/ui/ErrorState';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { OptionSheet } from '@/components/ui/OptionSheet';
import { hapticDestructiveConfirm } from '@/lib/haptics';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { profileHref } from '@/lib/profileNavigation';
import { InteractionLayer, ProfileChip } from '@/components/profile/ProfileControls';
import { setSellerFollowing, removeFollower } from '@/services/socialService';
import { RemoveFollowerSheet, type RemoveFollowerPerson } from '@/components/social/RemoveFollowerSheet';
import { CenteredToast } from '@/components/social/CenteredToast';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { radius } from '@/constants/radii';

export type ConnectionsTab = 'followers' | 'following';
export type FollowSort = 'default' | 'latest' | 'earliest';

export interface ConnectionUser {
  id: string;
  name: string;
  username?: string;
  handle?: string;
  initials?: string;
  avatarUrl?: string;
  accountType: 'buyer' | 'seller';
  isFollowing?: boolean;
  /** Set on the followers list — this row already follows the list owner back. */
  isFollowingBack?: boolean;
  /** Set on the following list (own list only) — this row also follows the viewer. */
  followsMe?: boolean;
  followedAt?: string;
}

/** Adapts a GET /api/social/followers|following row. */
export function toConnectionUser(item: any): ConnectionUser {
  return {
    id: String(item?.userId ?? ''),
    name: item?.name ?? item?.displayName ?? item?.username ?? 'Unknown',
    username: item?.username ?? undefined,
    handle: item?.handle ?? undefined,
    initials: item?.initials ?? undefined,
    avatarUrl: typeof item?.avatarUrl === 'string' && item.avatarUrl ? item.avatarUrl : undefined,
    accountType: item?.accountType === 'seller' ? 'seller' : 'buyer',
    isFollowing: typeof item?.isFollowing === 'boolean'
      ? item.isFollowing
      : typeof item?.isFollowingBack === 'boolean' ? item.isFollowingBack : undefined,
    isFollowingBack: typeof item?.isFollowingBack === 'boolean' ? item.isFollowingBack : undefined,
    followsMe: typeof item?.followsMe === 'boolean' ? item.followsMe : undefined,
    followedAt: typeof item?.followedAt === 'string' ? item.followedAt : undefined,
  };
}

/** Where tapping a connection row goes. */
export function connectionHref(user: ConnectionUser): string {
  return profileHref({
    userId: user.id,
    accountType: user.accountType,
    name: user.name,
    handle: user.handle ?? (user.username ? `@${user.username}` : undefined),
    initials: user.initials,
  });
}

const SORT_OPTIONS: { id: FollowSort; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'latest', label: 'Date followed: latest' },
  { id: 'earliest', label: 'Date followed: earliest' },
];

export default function ConnectionsScreen() {
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { user, isLoaded: clerkLoaded } = useUser();
  const api = useApi();
  const { type, userId } = useLocalSearchParams<{ type?: string; userId?: string }>();

  const [tab, setTab] = useState<ConnectionsTab>(type === 'following' ? 'following' : 'followers');
  const isOwnList = !userId || userId === user?.id;

  // Two independent lists so switching tabs doesn't refetch what's already
  // loaded, and so the header can show both counts at once.
  const [followers, setFollowers] = useState<ConnectionUser[]>([]);
  const [following, setFollowing] = useState<ConnectionUser[]>([]);
  const [followersLoaded, setFollowersLoaded] = useState(false);
  const [followingLoaded, setFollowingLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [followPending, setFollowPending] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<FollowSort>('default');
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ConnectionUser | null>(null);
  const [removing, setRemoving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const listOwner = isOwnList ? undefined : userId;

  const load = useCallback((activeSort: FollowSort) => {
    if (!clerkLoaded) return;
    if (!user?.id) {
      setFollowers([]); setFollowing([]);
      setFollowersLoaded(true); setFollowingLoaded(true);
      setLoading(false);
      return;
    }
    const generation = ++generationRef.current;
    setError(false);
    setLoading(true);
    return Promise.all([
      api.social.followers(listOwner),
      api.social.following(listOwner, activeSort),
    ])
      .then(([followerRows, followingRows]) => {
        if (generation !== generationRef.current) return;
        setFollowers((Array.isArray(followerRows) ? followerRows : []).map(toConnectionUser).filter((row) => row.id));
        setFollowing((Array.isArray(followingRows) ? followingRows : []).map(toConnectionUser).filter((row) => row.id));
        setFollowersLoaded(true);
        setFollowingLoaded(true);
      })
      .catch(() => { if (generation === generationRef.current) setError(true); })
      .finally(() => { if (generation === generationRef.current) setLoading(false); });
  }, [api, clerkLoaded, user?.id, listOwner]);

  // Refetch whenever the list regains focus — following someone from their
  // profile and coming back shows the change immediately.
  useFocusEffect(useCallback(() => { load(sort); }, [load, sort]));
  const pull = usePullToRefresh(() => load(sort));

  // Re-sort the Following list server-side when the sheet's selection changes
  // (without re-showing the loading skeleton over an already-loaded screen).
  const handleSelectSort = useCallback((id: string) => {
    const nextSort = id as FollowSort;
    setSort(nextSort);
    setSortSheetOpen(false);
    if (!user?.id) return;
    api.social.following(listOwner, nextSort)
      .then((rows) => setFollowing((Array.isArray(rows) ? rows : []).map(toConnectionUser).filter((row) => row.id)))
      .catch(() => {});
  }, [api, listOwner, user?.id]);

  const list = tab === 'followers' ? followers : following;
  const listLoaded = tab === 'followers' ? followersLoaded : followingLoaded;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((row) => (
      row.name?.toLowerCase().includes(q) || row.username?.toLowerCase().includes(q)
    ));
  }, [list, query]);

  const followStateFor = useCallback((row: ConnectionUser) => (
    row.isFollowing ?? (isOwnList && tab === 'following')
  ), [isOwnList, tab]);

  const handleFollow = useCallback(async (row: ConnectionUser) => {
    if (followPending.has(row.id) || row.id === user?.id) return;
    const setList = tab === 'followers' ? setFollowers : setFollowing;
    setFollowPending((prev) => new Set(prev).add(row.id));
    setList((prev) => prev.map((u) => (u.id === row.id ? { ...u, isFollowing: true } : u)));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (row.accountType === 'seller') await setSellerFollowing(row.id, true);
      else if ((await api.social.follow(row.id))?.status === 'requested') {
        // Private account: request sent, not following yet.
        setList((prev) => prev.map((u) => (u.id === row.id ? { ...u, isFollowing: false } : u)));
      }
    } catch {
      setList((prev) => prev.map((u) => (u.id === row.id ? { ...u, isFollowing: false } : u)));
    } finally {
      setFollowPending((prev) => { const next = new Set(prev); next.delete(row.id); return next; });
    }
  }, [api, followPending, tab, user?.id]);

  const handleUnfollow = useCallback(async (row: ConnectionUser) => {
    if (followPending.has(row.id)) return;
    const setList = tab === 'followers' ? setFollowers : setFollowing;
    setFollowPending((prev) => new Set(prev).add(row.id));
    setList((prev) => prev.map((u) => (u.id === row.id ? { ...u, isFollowing: false } : u)));
    hapticDestructiveConfirm();
    try {
      if (row.accountType === 'seller') await setSellerFollowing(row.id, false);
      else await api.social.unfollow(row.id);
    } catch {
      setList((prev) => prev.map((u) => (u.id === row.id ? { ...u, isFollowing: true } : u)));
    } finally {
      setFollowPending((prev) => { const next = new Set(prev); next.delete(row.id); return next; });
    }
  }, [api, followPending, tab]);

  // Following list's own row button: not-yet-following just follows; tapping
  // "Following" opens Instagram's own inline two-option unfollow confirm
  // (Mobbin: Instagram's Following list, per-row "..."/state button).
  const handleFollowingPillPress = useCallback((row: ConnectionUser) => {
    if (!followStateFor(row)) { void handleFollow(row); return; }
    showActionSheet(undefined, undefined, [
      {
        text: 'Unfollow',
        style: 'destructive',
        onPress: () => { void handleUnfollow(row); },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [followStateFor, handleFollow, handleUnfollow]);

  const openRemoveSheet = useCallback((row: ConnectionUser) => setRemoveTarget(row), []);

  const handleConfirmRemove = useCallback(async () => {
    const row = removeTarget;
    if (!row) return;
    hapticDestructiveConfirm();
    setRemoving(true);
    try {
      await removeFollower(row.id);
      setFollowers((prev) => prev.filter((u) => u.id !== row.id));
      setRemoveTarget(null);
      showToast('Removed');
    } catch {
      // Sheet stays open; the person can retry or cancel.
    } finally {
      setRemoving(false);
    }
  }, [removeTarget, showToast]);

  const removePerson: RemoveFollowerPerson | null = removeTarget ? {
    id: removeTarget.id,
    name: removeTarget.name,
    initials: removeTarget.initials || initialsFor(removeTarget.name),
    avatarUrl: removeTarget.avatarUrl,
  } : null;

  function renderItem({ item }: { item: ConnectionUser }) {
    const initials = item.initials || initialsFor(item.name ?? item.username ?? '?');
    const isMe = item.id === user?.id;
    // "Follows you" tag: only meaningful on the viewer's own lists — the
    // followers list is by definition all "follows you" so it's skipped
    // there, and shown on the Following list when that row also follows me.
    const showsFollowsYou = isOwnList && tab === 'following' && !!item.followsMe;

    return (
      <View style={styles.row}>
        <PressableScale
          style={styles.rowTap}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.name}'s profile`}
          testID={`connection-row-${item.id}`}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push(connectionHref(item) as never);
          }}
        >
          {(state) => (
            <>
              <InteractionLayer state={state as { pressed: boolean }} radius={RADIUS.md} theme={theme} />
              {item.avatarUrl ? (
                <CachedImage source={{ uri: item.avatarUrl }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitials}>{initials}</Text>
                </View>
              )}
              <View style={styles.rowCopy}>
                <Text style={styles.name} numberOfLines={1}>{item.name ?? item.username ?? 'Unknown'}</Text>
                {item.username ? <Text style={styles.username} numberOfLines={1}>@{item.username}</Text> : null}
                <View style={styles.rowTags}>
                  {item.accountType === 'seller' ? <ProfileChip label="Seller" icon="shopping-bag" /> : null}
                  {showsFollowsYou ? <Text style={styles.mutualTag}>Follows you</Text> : null}
                </View>
              </View>
            </>
          )}
        </PressableScale>

        {isMe ? (
          <Feather name="chevron-right" size={16} color={theme.muted} />
        ) : tab === 'followers' && isOwnList ? (
          <RemovePill onPress={() => openRemoveSheet(item)} theme={theme} />
        ) : tab === 'followers' ? (
          // Viewing someone else's followers list — no reverse-follow data
          // is exposed for rows here, so a plain Follow/Following pill
          // (Instagram shows the same on another account's followers list).
          <FollowPill
            following={followStateFor(item)}
            disabled={followPending.has(item.id)}
            onPress={() => (followStateFor(item) ? handleUnfollow(item) : handleFollow(item))}
            theme={theme}
          />
        ) : (
          <FollowPill
            following={followStateFor(item)}
            followBack={!!item.followsMe && !followStateFor(item)}
            disabled={followPending.has(item.id)}
            onPress={() => handleFollowingPillPress(item)}
            theme={theme}
          />
        )}
      </View>
    );
  }

  const title = tab === 'followers' ? 'Followers' : 'Following';

  return (
    <View style={styles.root}>
      <ScreenHeader title={title} />
      <View style={styles.headerExtras}>
        <View style={styles.tabsRow}>
          <TabButton
            label={`${followers.length} ${followers.length === 1 ? 'follower' : 'followers'}`}
            active={tab === 'followers'}
            onPress={() => setTab('followers')}
            theme={theme}
          />
          <TabButton
            label={`${following.length} following`}
            active={tab === 'following'}
            onPress={() => setTab('following')}
            theme={theme}
          />
        </View>
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder={`Search ${title.toLowerCase()}`}
          style={styles.search}
        />
        {tab === 'following' ? (
          <PressableScale
            style={styles.sortRow}
            onPress={() => setSortSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Sort by"
          >
            <Text style={styles.sortLabel}>Sort by</Text>
            <View style={styles.sortValueRow}>
              <Text style={styles.sortValue}>{SORT_OPTIONS.find((o) => o.id === sort)?.label ?? 'Default'}</Text>
              <Feather name="chevron-down" size={14} color={theme.muted} />
            </View>
          </PressableScale>
        ) : null}
      </View>

      {loading && !listLoaded ? (
        <View style={styles.pad}><ListSkeleton rows={6} /></View>
      ) : error ? (
        <ErrorState message={`Couldn't load ${title.toLowerCase()}.`} onRetry={() => { setLoading(true); load(sort); }} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="users"
          title={query ? 'No results' : `No ${title.toLowerCase()} yet`}
          description={query
            ? 'Try a different name or username.'
            : tab === 'followers'
              ? 'When people follow this account, they will appear here.'
              : 'Accounts that this profile follows will appear here.'}
        />
      ) : (
        <FlatList
          {...LONG_LIST_TUNING}
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          refreshControl={pull.refreshControl}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          keyboardShouldPersistTaps="handled"
        />
      )}

      <RemoveFollowerSheet
        person={removePerson}
        busy={removing}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => { void handleConfirmRemove(); }}
      />
      <CenteredToast message={toast} />

      <OptionSheet
        visible={sortSheetOpen}
        onClose={() => setSortSheetOpen(false)}
        title="Sort by"
        options={SORT_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
        selectedId={sort}
        onSelect={handleSelectSort}
        testID="following-sort-sheet"
      />
    </View>
  );
}

function initialsFor(name: string): string {
  return (name || '?')
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function TabButton({ label, active, onPress, theme }: {
  label: string; active: boolean; onPress: () => void; theme: AppThemePreset;
}) {
  return (
    <PressableScale
      onPress={onPress}
      style={[tabStyles.tab, active && { borderBottomColor: theme.text, borderBottomWidth: 2 }]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      {() => (
        <Text style={[tabStyles.tabText, { color: active ? theme.text : theme.muted, fontFamily: active ? FONT.bold : FONT.semibold }]}>
          {label}
        </Text>
      )}
    </PressableScale>
  );
}

const tabStyles = StyleSheet.create({
  tab: { flex: 1, alignItems: 'center', paddingVertical: SP.sm, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: FS.sm },
});

/** Compact Follow/Following pill — no reanimated dependency, so this screen
 *  stays lightweight to test and mount. Monochrome: the primary pill is the
 *  app's own accent (never Instagram's blue), the "Following"/secondary
 *  state is an outline pill. */
function FollowPill({
  following, followBack, disabled, onPress, theme,
}: { following: boolean; followBack?: boolean; disabled?: boolean; onPress: () => void; theme: AppThemePreset }) {
  const label = following ? 'Following' : followBack ? 'Follow back' : 'Follow';
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={following ? `${label}, tap to unfollow` : label}
      accessibilityState={{ selected: following, disabled: !!disabled }}
      style={[
        pillStyles.pill,
        following
          ? { backgroundColor: 'transparent', borderColor: theme.text, borderWidth: 1 }
          : { backgroundColor: theme.accent, borderColor: theme.accent, borderWidth: 1 },
        disabled && (following ? { borderColor: TEXT_TERTIARY } : { backgroundColor: FILL_ELEVATED, borderColor: FILL_ELEVATED }),
      ]}
    >
      {() => (
        <Text style={[pillStyles.text, { color: disabled ? TEXT_TERTIARY : following ? theme.text : theme.onAccent }]}>
          {label}
        </Text>
      )}
    </PressableScale>
  );
}

/** Secondary/outline "Remove" button on the viewer's own Followers list. */
function RemovePill({ onPress, theme }: { onPress: () => void; theme: AppThemePreset }) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Remove follower"
      style={[pillStyles.pill, { backgroundColor: 'transparent', borderColor: theme.border, borderWidth: 1 }]}
    >
      {() => <Text style={[pillStyles.text, { color: theme.text }]}>Remove</Text>}
    </PressableScale>
  );
}

const pillStyles = StyleSheet.create({
  pill: { height: 32, paddingHorizontal: 14, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: FONT.semibold, fontSize: FS.xs },
});

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    root:   { flex: 1, backgroundColor: theme.background },
    pad:    { padding: SP.md },
    headerExtras: { gap: SP.sm, paddingBottom: SP.xs },
    tabsRow: { flexDirection: 'row' },
    search: { marginTop: 2 },
    sortRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: SP.xs,
    },
    sortLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
    sortValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    sortValue: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.text },
    row:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, minHeight: 64, paddingVertical: SP.sm },
    rowTap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: SP.sm },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTags: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginTop: 4 },
    avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.cardElevated },
    avatarFallback: {
      width: 44, height: 44, borderRadius: 22, backgroundColor: theme.accentDim,
      borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center',
    },
    avatarInitials: { fontSize: FS.sm, fontFamily: FONT.bold, color: theme.text },
    name:     { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
    username: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
    mutualTag: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginLeft: 72 },
  });
}
