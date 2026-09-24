/**
 * Close Friends — manage close friends list with star toggle.
 * Selection is persisted via socialService.getCloseFriendIds / saveCloseFriendIds,
 * which scope the key by the current Clerk user ID so accounts never share the list.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, ON_DARK,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { getAcceptedFriends, getCloseFriendIds, saveCloseFriendIds } from '@/services/socialService';
import type { Friendship } from '@/services/socialTypes';
import { Header } from '@/components/layout';

export default function BuyerCloseFriends() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const GRAD_PRIMARY = theme.primaryGradient;
  const s = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [closeFriends, setCloseFriends] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

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
    Haptics.selectionAsync();
    setCloseFriends(prev => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  }

  async function handleSave() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await saveCloseFriendIds(Array.from(closeFriends));
    router.back();
  }

  function renderFriend({ item }: { item: Friendship }) {
    const isCF = closeFriends.has(item.userId);
    return (
      <TouchableOpacity style={s.row} onPress={() => toggle(item.userId)} activeOpacity={0.7}>
        <View style={[s.avatar, { backgroundColor: item.color }]}>
          <Text style={s.avatarText}>{item.initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{item.name}</Text>
          <Text style={s.handle}>{item.handle}</Text>
        </View>
        <View style={[s.radio, isCF && s.radioActive]}>
           {isCF && <Feather name="star" size={14} color={theme.onAccent} />}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={s.page}>
      <Header title="Close Friends" />

      {/* Info banner */}
      <View style={s.banner}>
        <Feather name="star" size={16} color={PURPLE} />
        <Text style={s.bannerText}>
          Manage your close friends list. People on this list get priority in notifications and future close-friends features. They won't be notified when you add or remove them.
        </Text>
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <Feather name="search" size={16} color={MUTED} />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search friends"
          placeholderTextColor={SUBTLE}
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
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Feather name="users" size={32} color={MUTED} />
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
      <View style={[s.saveBar, { paddingBottom: insets.bottom + SP.md }]}>
        <TouchableOpacity onPress={handleSave} activeOpacity={0.85} style={{ flex: 1 }}>
          <LinearGradient colors={GRAD_PRIMARY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.saveBtn}>
            <Text style={[s.saveBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Save</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  banner: { flexDirection: 'row', gap: 10, padding: SP.md, backgroundColor: theme.accentDim, borderBottomWidth: 1, borderBottomColor: BORDER, alignItems: 'flex-start' },
  bannerText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, lineHeight: 17 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: SP.md, paddingHorizontal: SP.md, height: 40, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER },
  searchInput: { flex: 1, color: FG, fontFamily: FONT.regular, fontSize: FS.base },
  countBadge: { fontFamily: FONT.medium, fontSize: FS.xs, color: theme.accent, paddingHorizontal: SP.md, marginBottom: SP.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: 12, gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: ON_DARK },
  name: { fontFamily: FONT.semibold, fontSize: FS.base, color: FG },
  handle: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, marginTop: 2 },
  radio: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  radioActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  separator: { height: 1, backgroundColor: BORDER, marginLeft: 68 },
  empty: { alignItems: 'center', paddingVertical: SP.xxl, gap: SP.sm },
  emptyTitle: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG },
  emptyDesc: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center', maxWidth: 240 },
  saveBar: { paddingHorizontal: SP.md, paddingTop: SP.sm, borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: BG },
  saveBtn: { height: 50, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
   saveBtnText: { fontFamily: FONT.bold, fontSize: FS.base },
});
