/**
 * Muted Accounts — manage muted users
 * Muting does not remove friendship.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { BG, CARD, BORDER, FG, MUTED, SUBTLE, PURPLE, FONT, FS, SP, RADIUS } from '@/lib/theme';
import { getMutedUsers, unmuteUser } from '@/services/socialService';
import type { MuteRecord } from '@/services/socialTypes';

export default function MutedAccountsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [muted, setMuted] = useState<MuteRecord[]>([]);
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    getMutedUsers().then(setMuted);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUnmute = (user: MuteRecord) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Unmute', `Unmute ${user.mutedUserName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unmute',
        onPress: async () => {
          await unmuteUser(user.mutedUserId);
          load();
        },
      },
    ]);
  };

  const filtered = muted.filter(u =>
    u.mutedUserName.toLowerCase().includes(query.toLowerCase()) ||
    u.mutedUserHandle.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={21} color={FG} />
        </TouchableOpacity>
        <Text style={styles.title}>Muted accounts</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.intro}>
        <Text style={styles.introText}>
          Muted accounts won't know they've been muted. You'll remain friends and can still message them.
        </Text>
      </View>

      {muted.length > 0 && (
        <View style={styles.search}>
          <Feather name="search" size={16} color={MUTED} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search muted accounts"
            placeholderTextColor={SUBTLE}
          />
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="volume-x" size={32} color={MUTED} />
            <Text style={styles.emptyTitle}>No muted accounts</Text>
            <Text style={styles.emptySub}>Muted accounts will appear here.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <LinearGradient
              colors={[item.mutedUserColor || PURPLE, '#22D3EE']}
              style={styles.avatar}
            >
              <Text style={styles.avatarText}>{item.mutedUserInitials || item.mutedUserName[0]}</Text>
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.mutedUserName}</Text>
              <Text style={styles.handle}>{item.mutedUserHandle}</Text>
            </View>
            <TouchableOpacity style={styles.unmuteBtn} onPress={() => handleUnmute(item)}>
              <Text style={styles.unmuteText}>Unmute</Text>
            </TouchableOpacity>
          </View>
        )}
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
  intro: { padding: SP.md },
  introText: { color: MUTED, fontFamily: FONT.regular, fontSize: 13, lineHeight: 19 },
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
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontFamily: FONT.bold, fontSize: FS.base },
  name: { color: FG, fontFamily: FONT.medium, fontSize: FS.base },
  handle: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm },
  unmuteBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
  },
  unmuteText: { color: FG, fontFamily: FONT.medium, fontSize: 13 },
  empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: SP.lg },
  emptyTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.md, marginTop: SP.md },
  emptySub: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, marginTop: SP.sm, textAlign: 'center' },
});
