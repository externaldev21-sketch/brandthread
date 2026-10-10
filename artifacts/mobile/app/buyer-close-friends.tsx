/**
 * Close Friends — manage close friends list with star toggle.
 * The list is stored on the server (GET/PUT /api/social/close-friends) so it
 * follows the account across devices and can gate close-friends stories.
 * socialService.getCloseFriendIds / saveCloseFriendIds keep a per-account local
 * cache that is the fallback when the server can't be reached.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, Pressable, Alert } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { radius } from '@/constants/radii';
import { hapticToggle, hapticSuccessAction } from '@/lib/haptics';
import { EmptyState } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListRow, StickyBottomCTA } from '@/components/ui';
import { getAcceptedFriends, getCloseFriendIds, saveCloseFriendIds } from '@/services/socialService';
import type { Friendship } from '@/services/socialTypes';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useApi } from '@/lib/api';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

export default function BuyerCloseFriends() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const s = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [closeFriends, setCloseFriends] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const loadFriends = useCallback(async () => {
    const [list, localIds, followers, following, remote] = await Promise.all([
      getAcceptedFriends(),
      getCloseFriendIds(),
      api.social.followers().catch(() => []),
      api.social.following().catch(() => []),
      api.closeFriends.get().catch(() => null),
    ]);
    // Candidates: the existing friends list plus the real people I follow / who follow me.
    const byId = new Map<string, Friendship>(list.map(f => [f.userId, f]));
    const addPerson = (p: { userId: string; name: string; handle: string }) => {
      if (byId.has(p.userId)) return;
      byId.set(p.userId, {
        id: p.userId, userId: p.userId, name: p.name, handle: p.handle,
        initials: '', color: '', status: 'accepted', mutualFriendsCount: 0, updatedAt: '',
      });
    };
    (Array.isArray(followers) ? followers : []).forEach(addPerson);
    (Array.isArray(following) ? following : []).forEach(addPerson);
    (remote?.friends ?? []).forEach(addPerson);
    setFriends(Array.from(byId.values()));
    // The server list is the source of truth when reachable; refresh the local cache from it.
    const ids = remote ? remote.friendIds : localIds;
    setCloseFriends(new Set(ids));
    if (remote) void saveCloseFriendIds(ids).catch(() => {});
  }, [api]);
  const pull = usePullToRefresh(loadFriends);

  useFocusEffect(useCallback(() => {
    void loadFriends();
  }, [loadFriends]));

  const filtered = friends.filter(f =>
    f.name.toLowerCase().includes(query.toLowerCase()) ||
    f.handle.toLowerCase().includes(query.toLowerCase())
  );

  // Key on userId (e.g. "u_maya") so isCloseFriendOf() can match correctly
  function toggle(userId: string) {
    hapticToggle();
    setCloseFriends(prev => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const all = Array.from(closeFriends);
      // Local cache first so it is never lost; 'u_…' ids are local-only placeholders the server doesn't know.
      await saveCloseFriendIds(all);
      const result = await api.closeFriends.replace(all.filter(id => !id.startsWith('u_')));
      await saveCloseFriendIds([...result.friendIds, ...all.filter(id => id.startsWith('u_'))]);
      hapticSuccessAction();
      goBackOr(router);
    } catch {
      Alert.alert("Couldn't save", 'Your Close Friends list was kept on this device but not saved to your account. Try again.');
    } finally {
      setSaving(false);
    }
  }

  function renderFriend({ item }: { item: Friendship }) {
    const isCF = closeFriends.has(item.userId);
    return (
      <ListRow
        avatar={{ name: item.name }}
        title={item.name}
        subtitle={item.handle}
        onPress={() => toggle(item.userId)}
        right={(
          <Pressable
            onPress={() => toggle(item.userId)}
            accessibilityRole="button"
            accessibilityLabel={isCF ? `Remove ${item.name} from close friends` : `Add ${item.name} to close friends`}
            accessibilityState={{ selected: isCF }}
            hitSlop={8}
          >
            <View style={[s.radio, isCF && s.radioActive]}>
              {isCF && <Icon name="star" size={14} color={theme.onAccent} />}
            </View>
          </Pressable>
        )}
      />
    );
  }

  return (
    <View style={s.page}>
      <ScreenHeader title="Close friends" />

      {/* Info banner */}
      <View style={s.banner}>
        <Icon name="star" size={16} color={colors.primary} />
        <Text style={s.bannerText}>
          Only you can see this list. People aren't notified when you add or remove them.
        </Text>
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <Icon name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[s.searchInput, WEB_INPUT_RESET]}
          value={query}
          onChangeText={setQuery}
          placeholder="Search friends"
          placeholderTextColor={colors.mutedForeground}
        />
      </View>

      {closeFriends.size > 0 && (
        <Text style={s.countBadge}>
          {closeFriends.size} {closeFriends.size === 1 ? 'person' : 'people'} selected
        </Text>
      )}

      <FlatList
        data={filtered}
        keyExtractor={f => f.id}
        renderItem={renderFriend}
        refreshControl={pull.refreshControl}
        contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingBottom: insets.bottom + 120 }}
        ListEmptyComponent={
          <EmptyState
            icon="users"
            title={friends.length === 0 ? 'No friends yet' : 'No results'}
            description={friends.length === 0
              ? 'Add friends to create a close friends list.'
              : 'Try a different search term.'}
            action={friends.length === 0
              ? { label: 'Find friends', onPress: () => router.push('/buyer-friend-requests' as never) }
              : undefined}
          />
        }
        ItemSeparatorComponent={() => <View style={s.separator} />}
      />

      {/* Save */}
      <StickyBottomCTA label="Save" onPress={() => { void handleSave(); }} loading={saving} />
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  banner: {
    flexDirection: 'row', gap: 10, padding: SPACING.md,
    backgroundColor: colors.accent, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border, alignItems: 'flex-start',
  },
  bannerText: { flex: 1, ...TYPE_SCALE.footnote, color: colors.mutedForeground, lineHeight: 17 },
  searchWrap: {
    // Overnight batch item 37: filled, no border at rest or focus — a
    // themed card+border read as the "rectangle bar" flagged across the
    // app's search fields. Fixed monochrome fill + radius 12 (exact
    // number given), same treatment as the shared SearchBar component.
    flexDirection: 'row', alignItems: 'center', gap: 10, margin: SPACING.md,
    paddingHorizontal: SPACING.md, height: 40, backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 12, borderWidth: 0,
  },
  searchInput: { flex: 1, color: colors.foreground, ...TYPE_SCALE.body },
  countBadge: { ...TYPE_SCALE.caption, color: colors.primary, paddingHorizontal: SPACING.md, marginBottom: SPACING.xxs },
  radio: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  radioActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 52 },
  empty: { alignItems: 'center', paddingVertical: SPACING.xxl, gap: SPACING.sm },
  emptyTitle: { ...TYPE_SCALE.headline, color: colors.foreground },
  emptyDesc: { ...TYPE_SCALE.footnote, color: colors.mutedForeground, textAlign: 'center', maxWidth: 240 },
  findFriendsBtn: {
    marginTop: SPACING.xs, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
  },
  findFriendsBtnText: { fontFamily: FONT.semibold, ...TYPE_SCALE.body, color: colors.foreground },
});
