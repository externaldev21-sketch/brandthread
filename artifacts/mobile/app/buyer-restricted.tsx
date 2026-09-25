/**
 * Restricted Accounts — manage restricted users.
 * Data persisted via socialService (bt:social:restricts:v1).
 * Restricting limits a user's comment visibility without blocking them.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  TextInput, Modal, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { getRestrictedUsers, unrestrictUser } from '@/services/socialService';
import type { RestrictRecord } from '@/services/socialTypes';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button, ListRow } from '@/components/ui';
import { EmptyState } from '@/components/BrandthreadUI';
import { hapticDestructiveConfirm, hapticToggle } from '@/lib/haptics';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';

export default function RestrictedAccountsScreen() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const styles = makeStyles(theme, palette);
  const insets = useSafeAreaInsets();
  const [restricted, setRestricted] = useState<RestrictRecord[]>([]);
  const [query, setQuery] = useState('');
  const [confirmUser, setConfirmUser] = useState<RestrictRecord | null>(null);

  useFocusEffect(useCallback(() => {
    getRestrictedUsers().then(setRestricted);
  }, []));

  const handleUnrestrict = async (user: RestrictRecord) => {
    hapticDestructiveConfirm();
    await unrestrictUser(user.restrictedUserId);
    setRestricted(r => r.filter(u => u.restrictedUserId !== user.restrictedUserId));
    setConfirmUser(null);
  };

  const filtered = restricted.filter(u =>
    u.restrictedUserName.toLowerCase().includes(query.toLowerCase()) ||
    u.restrictedUserHandle.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <View style={styles.page}>
      <ScreenHeader title="Restricted accounts" />

      <View style={styles.intro}>
        <Text style={styles.introText}>
          When you restrict someone, their comments on your posts are only visible to them. They won't know they've been restricted.
        </Text>
      </View>

      {restricted.length > 0 && (
        <View style={styles.search}>
          <Feather name="search" size={16} color={theme.muted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search restricted accounts"
            placeholderTextColor={theme.subtle}
          />
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingBottom: insets.bottom + 40 }}
        ListEmptyComponent={
          <EmptyState
            icon="user-x"
            title="No restricted accounts"
            description="Restricted accounts will appear here."
            style={{ marginTop: SPACING.lg }}
          />
        }
        renderItem={({ item }) => (
          <ListRow
            avatar={{ name: item.restrictedUserName }}
            title={item.restrictedUserName}
            subtitle={item.restrictedUserHandle}
            right={(
              <Button
                label="Unrestrict"
                onPress={() => { hapticToggle(); setConfirmUser(item); }}
                variant="secondary"
                size="small"
                accessibilityHint={`Unrestricts ${item.restrictedUserName}`}
              />
            )}
          />
        )}
      />

      {/* Confirmation modal */}
      <Modal
        visible={!!confirmUser}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmUser(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setConfirmUser(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + SPACING.md }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Unrestrict {confirmUser?.restrictedUserName}?</Text>
            <Text style={styles.sheetDesc}>
              Their future comments on your posts will be visible to everyone. They won't be notified.
            </Text>
            <View style={styles.sheetActions}>
              <Button label="Cancel" onPress={() => setConfirmUser(null)} variant="secondary" style={{ flex: 1 }} />
              <Button
                label="Unrestrict"
                onPress={() => confirmUser && handleUnrestrict(confirmUser)}
                variant="destructive"
                style={{ flex: 1 }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme'], palette: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.background },
  intro: { padding: SPACING.md },
  introText: { color: theme.muted, ...TYPE_SCALE.footnote, lineHeight: 19 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: SPACING.md, marginBottom: SPACING.sm,
    backgroundColor: theme.card, borderRadius: RADII.input, borderWidth: 1,
    borderColor: theme.border, paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, color: theme.text, ...TYPE_SCALE.body },
  backdrop: { flex: 1, backgroundColor: `${theme.background}CC`, justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.card, borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet, padding: SPACING.xl },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, alignSelf: 'center', marginBottom: SPACING.md },
  sheetTitle: { ...TYPE_SCALE.title2, color: theme.text, marginBottom: SPACING.xs },
  sheetDesc: { ...TYPE_SCALE.callout, color: theme.muted, lineHeight: 20, marginBottom: SPACING.lg },
  sheetActions: { flexDirection: 'row', gap: SPACING.sm },
});
