/**
 * Close Friends — manage close friends list
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { BG, CARD, BORDER, FG, MUTED, SUBTLE, PURPLE, FONT, FS, SP, RADIUS } from '@/lib/theme';
import { getAcceptedFriends } from '@/services/socialService';
import type { Friendship } from '@/services/socialTypes';

export default function CloseFriendsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  useEffect(() => {
    getAcceptedFriends().then(setFriends);
  }, []);

  const toggle = (id: string) => {
    Haptics.selectionAsync();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filtered = friends.filter(f =>
    f.name.toLowerCase().includes(query.toLowerCase()) ||
    f.handle.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={21} color={FG} />
        </TouchableOpacity>
        <Text style={styles.title}>Close Friends</Text>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      </View>

      {/* Intro */}
      <View style={styles.intro}>
        <View style={styles.starBadge}>
          <Feather name="star" size={18} color={PURPLE} />
        </View>
        <Text style={styles.introText}>
          Only people you add can see your Close Friends stories and posts.
        </Text>
      </View>

      {/* Count */}
      <Text style={styles.countLabel}>{selected.size} selected</Text>

      {/* Search */}
      <View style={styles.search}>
        <Feather name="search" size={16} color={MUTED} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search friends"
          placeholderTextColor={SUBTLE}
        />
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="users" size={32} color={MUTED} />
            <Text style={styles.emptyTitle}>{friends.length === 0 ? 'No friends yet' : 'No results'}</Text>
            <Text style={styles.emptySub}>
              {friends.length === 0
                ? 'Add friends to build your Close Friends list.'
                : 'Try a different name or handle.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const isSelected = selected.has(item.id);
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => toggle(item.id)}
              activeOpacity={0.7}
            >
              <LinearGradient
                colors={[item.color || PURPLE, '#22D3EE']}
                style={styles.avatar}
              >
                <Text style={styles.avatarText}>{item.initials || item.name[0]}</Text>
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.handle}>{item.handle}</Text>
              </View>
              <View style={[styles.check, isSelected && styles.checkActive]}>
                {isSelected && <Feather name="check" size={14} color="#fff" />}
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG },
  header: {
    height: 58, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: SP.md,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  doneText: { color: PURPLE, fontFamily: FONT.semibold, fontSize: FS.base },
  intro: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    margin: SP.md, backgroundColor: CARD, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: BORDER, padding: 14,
  },
  starBadge: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: `${PURPLE}20`, alignItems: 'center', justifyContent: 'center',
  },
  introText: { color: MUTED, fontFamily: FONT.regular, fontSize: 13, flex: 1, lineHeight: 18 },
  countLabel: {
    color: MUTED, fontFamily: FONT.semibold, fontSize: FS.sm,
    paddingHorizontal: SP.md, marginBottom: 8,
  },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: SP.md, marginBottom: SP.sm,
    backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, color: FG, fontFamily: FONT.regular, fontSize: FS.base },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: SP.md, paddingVertical: 10,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontFamily: FONT.bold, fontSize: FS.base },
  name: { color: FG, fontFamily: FONT.medium, fontSize: FS.base },
  handle: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm },
  check: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  checkActive: { backgroundColor: PURPLE, borderColor: PURPLE },
  empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: SP.lg },
  emptyTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.md, marginTop: SP.md },
  emptySub: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, marginTop: SP.sm, textAlign: 'center' },
});
