/**
 * Close Friends — manage close friends list with star toggle.
 * Selection is persisted via socialService.getCloseFriendIds / saveCloseFriendIds,
 * which scope the key by the current Clerk user ID so accounts never share the list.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { getAcceptedFriends, getCloseFriendIds, saveCloseFriendIds } from '@/services/socialService';
import type { Friendship } from '@/services/socialTypes';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListRow, StickyBottomCTA } from '@/components/ui';
import { hapticSuccess, hapticToggle } from '@/lib/haptics';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';

export default function BuyerCloseFriends() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const s = makeStyles(theme, palette);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [closeFriends, setCloseFriends] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => {
    Promise.all([getAcceptedFriends(), getCloseFriendIds()]).then(([list, ids]) => {
      setFriends(list);
      setCloseFriends(new Set(ids));
    });
  }, []));

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
    setSaving(true);
    hapticSuccess();
    await saveCloseFriendIds(Array.from(closeFriends));
    setSaving(false);
    router.back();
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
              {isCF && <Feather name="star" size={14} color={theme.onAccent} />}
            </View>
          </Pressable>
        )}
      />
    );
  }

  return (
    <View style={s.page}>
      <ScreenHeader title="Close Friends" />

      {/* Info banner */}
      <View style={s.banner}>
        <Feather name="star" size={16} color={theme.accent} />
        <Text style={s.bannerText}>
          Manage your close friends list. People on this list get priority in notifications and future close-friends features. They won't be notified when you add or remove them.
        </Text>
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <Feather name="search" size={16} color={palette.mutedForeground} />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search friends"
          placeholderTextColor={palette.mutedForeground}
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
        contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingBottom: insets.bottom + 120 }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Feather name="users" size={32} color={palette.mutedForeground} />
            <Text style={s.emptyTitle}>{friends.length === 0 ? 'No friends yet' : 'No results'}</Text>
            <Text style={s.emptyDesc}>
              {friends.length === 0
                ? 'Add friends to create a Close Friends list.'
                : 'Try a different search term.'}
            </Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={s.separator} />}
      />

      {/* Save */}
      <StickyBottomCTA label="Save" onPress={() => { void handleSave(); }} loading={saving} />
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme'], palette: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  banner: { flexDirection: 'row', gap: 10, padding: SPACING.md, backgroundColor: theme.accentDim, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border, alignItems: 'flex-start' },
  bannerText: { flex: 1, ...TYPE_SCALE.footnote, color: palette.mutedForeground, lineHeight: 17 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: SPACING.md, paddingHorizontal: SPACING.md, height: 40, backgroundColor: theme.card, borderRadius: RADII.input, borderWidth: 1, borderColor: theme.border },
  searchInput: { flex: 1, color: theme.text, ...TYPE_SCALE.body },
  countBadge: { ...TYPE_SCALE.caption, color: theme.accent, paddingHorizontal: SPACING.md, marginBottom: SPACING.xs },
  radio: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  radioActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginLeft: 52 },
  empty: { alignItems: 'center', paddingVertical: SPACING.xxl, gap: SPACING.sm },
  emptyTitle: { ...TYPE_SCALE.headline, color: theme.text },
  emptyDesc: { ...TYPE_SCALE.callout, color: theme.muted, textAlign: 'center', maxWidth: 240 },
});
