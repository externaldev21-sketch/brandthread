/**
 * Restricted Accounts — manage restricted users
 */
import React, { useState, useEffect } from 'react';
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

// Restricted is stored alongside mutes/blocks in socialService
// Using local stub state — wire to backend when available
type RestrictedUser = {
  id: string; name: string; handle: string;
  avatarColor: string; avatarInitials: string; restrictedAt: string;
};

const STUB: RestrictedUser[] = [];

export default function RestrictedAccountsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [restricted, setRestricted] = useState<RestrictedUser[]>(STUB);
  const [query, setQuery] = useState('');

  const unrestrict = (user: RestrictedUser) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Unrestrict', `Unrestrict ${user.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unrestrict', onPress: () => setRestricted(r => r.filter(u => u.id !== user.id)) },
    ]);
  };

  const filtered = restricted.filter(u =>
    u.name.toLowerCase().includes(query.toLowerCase()) ||
    u.handle.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={21} color={FG} />
        </TouchableOpacity>
        <Text style={styles.title}>Restricted accounts</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.intro}>
        <Text style={styles.introText}>
          When you restrict someone, their comments on your posts are only visible to them. They won't know they've been restricted.
        </Text>
      </View>

      {restricted.length > 0 && (
        <View style={styles.search}>
          <Feather name="search" size={16} color={MUTED} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search restricted accounts"
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
            <Feather name="user-x" size={32} color={MUTED} />
            <Text style={styles.emptyTitle}>No restricted accounts</Text>
            <Text style={styles.emptySub}>Restricted accounts will appear here.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <LinearGradient
              colors={[item.avatarColor || PURPLE, '#22D3EE']}
              style={styles.avatar}
            >
              <Text style={styles.avatarText}>{item.avatarInitials}</Text>
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.handle}>{item.handle}</Text>
            </View>
            <TouchableOpacity style={styles.unrestrictBtn} onPress={() => unrestrict(item)}>
              <Text style={styles.unrestrictText}>Unrestrict</Text>
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
  unrestrictBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
  },
  unrestrictText: { color: FG, fontFamily: FONT.medium, fontSize: 13 },
  empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: SP.lg },
  emptyTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.md, marginTop: SP.md },
  emptySub: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, marginTop: SP.sm, textAlign: 'center' },
});
