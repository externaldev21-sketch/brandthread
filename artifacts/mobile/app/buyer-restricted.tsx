/**
 * Restricted Accounts — manage restricted users.
 * Data persisted via socialService (bt:social:restricts:v1).
 * Restricting limits a user's comment visibility without blocking them.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { BG, CARD, BORDER, FG, MUTED, SUBTLE, ON_DARK, FONT, FS, SP, RADIUS, OVERLAY } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { getRestrictedUsers, unrestrictUser } from '@/services/socialService';
import type { RestrictRecord } from '@/services/socialTypes';

export default function RestrictedAccountsScreen() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const CYAN = theme.accentLight;
  const styles = makeStyles(theme);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [restricted, setRestricted] = useState<RestrictRecord[]>([]);
  const [query, setQuery] = useState('');
  const [confirmUser, setConfirmUser] = useState<RestrictRecord | null>(null);

  useFocusEffect(useCallback(() => {
    getRestrictedUsers().then(setRestricted);
  }, []));

  const handleUnrestrict = async (user: RestrictRecord) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await unrestrictUser(user.restrictedUserId);
    setRestricted(r => r.filter(u => u.restrictedUserId !== user.restrictedUserId));
    setConfirmUser(null);
  };

  const filtered = restricted.filter(u =>
    u.restrictedUserName.toLowerCase().includes(query.toLowerCase()) ||
    u.restrictedUserHandle.toLowerCase().includes(query.toLowerCase())
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
              colors={[item.restrictedUserColor || PURPLE, CYAN]}
              style={styles.avatar}
            >
              <Text style={styles.avatarText}>{item.restrictedUserInitials}</Text>
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.restrictedUserName}</Text>
              <Text style={styles.handle}>{item.restrictedUserHandle}</Text>
            </View>
            <TouchableOpacity
              style={styles.unrestrictBtn}
              onPress={() => { Haptics.selectionAsync(); setConfirmUser(item); }}
            >
              <Text style={styles.unrestrictText}>Unrestrict</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      {/* Confirmation modal */}
      <Modal
        visible={!!confirmUser}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmUser(null)}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setConfirmUser(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.sheet, { paddingBottom: insets.bottom + SP.md }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Unrestrict {confirmUser?.restrictedUserName}?</Text>
            <Text style={styles.sheetDesc}>
              Their future comments on your posts will be visible to everyone. They won't be notified.
            </Text>
            <View style={styles.sheetActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmUser(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmBtn}
                onPress={() => confirmUser && handleUnrestrict(confirmUser)}
              >
                <Text style={styles.confirmText}>Unrestrict</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
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
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.base },
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
  backdrop: { flex: 1, backgroundColor: OVERLAY, justifyContent: 'flex-end' },
  sheet: { backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SP.lg },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: SP.md },
  sheetTitle: { fontFamily: FONT.bold, fontSize: FS.lg, color: FG, marginBottom: SP.xs },
  sheetDesc: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, lineHeight: 20, marginBottom: SP.lg },
  sheetActions: { flexDirection: 'row', gap: SP.sm },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  cancelText: { fontFamily: FONT.medium, fontSize: FS.base, color: MUTED },
  confirmBtn: { flex: 1, paddingVertical: 14, borderRadius: RADIUS.md, backgroundColor: theme.accent, alignItems: 'center' },
  confirmText: { fontFamily: FONT.bold, fontSize: FS.base, color: theme.onAccent },
});
