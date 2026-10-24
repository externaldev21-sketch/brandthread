/**
 * Restricted Accounts — manage restricted users.
 * Data persisted via socialService (bt:social:restricts:v1).
 * Restricting limits a user's comment visibility without blocking them.
 */
import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TextInput } from 'react-native';

import { Icon } from '@/components/ui/Icon';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFocusEffect } from 'expo-router';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { useColors } from '@/hooks/useColors';

import { getRestrictedUsers, unrestrictUser } from '@/services/socialService';

import type { RestrictRecord } from '@/services/socialTypes';
import { ScreenHeader } from '@/components/ScreenHeader';

import { showActionSheet } from '@/components/ui/ActionSheet';

import { Button, ListRow } from '@/components/ui';

import { EmptyState } from '@/components/BrandthreadUI';

import { haptic } from '@/lib/haptics';

import { TYPE_SCALE } from '@/constants/typography';

import { SPACING } from '@/constants/spacing';
import { RADIUS } from '@/lib/theme';

import { WEB_INPUT_RESET } from '@/lib/inputReset';

import { usePullToRefresh } from '@/hooks/usePullToRefresh';

export default function RestrictedAccountsScreen() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const styles = makeStyles(theme, palette);
  const insets = useSafeAreaInsets();
  const [restricted, setRestricted] = useState<RestrictRecord[]>([]);
  const [query, setQuery] = useState('');

  const loadRestricted = useCallback(() => getRestrictedUsers().then(setRestricted), []);
  const pull = usePullToRefresh(loadRestricted);

  useFocusEffect(useCallback(() => {
    void loadRestricted();
  }, [loadRestricted]));

  const handleUnrestrict = async (user: RestrictRecord) => {
    await unrestrictUser(user.restrictedUserId);
    setRestricted(r => r.filter(u => u.restrictedUserId !== user.restrictedUserId));
  };

  // iOS action sheet confirm (same title, message and buttons as before).
  const confirmUnrestrict = (user: RestrictRecord) => {
    showActionSheet(
      `Unrestrict ${user.restrictedUserName}?`,
      "Their future comments on your posts will be visible to everyone. They won't be notified.",
      [
        { text: 'Unrestrict', style: 'destructive', onPress: () => { void handleUnrestrict(user); } },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
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
          <Icon name="search" size={16} color={theme.muted} />
          <TextInput returnKeyType="search"
            style={[styles.searchInput, WEB_INPUT_RESET]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search restricted accounts"
            placeholderTextColor={theme.subtle}
          />
        </View>
      )}

      <FlatList
        data={filtered}
        refreshControl={pull.refreshControl}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingBottom: insets.bottom + 40 }}
        ListEmptyComponent={
          <EmptyState
            icon="user-x"
            title="No restricted accounts"
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
                onPress={() => { haptic('sheet'); confirmUnrestrict(item); }}
                variant="secondary"
                size="small"
                accessibilityHint={`Unrestricts ${item.restrictedUserName}`}
              />
            )}
          />
        )}
      />
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme'], palette: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.background },
  intro: { padding: SPACING.md },
  introText: { color: theme.muted, ...TYPE_SCALE.footnote, lineHeight: 19 },
  search: {
    // Overnight batch item 37: filled, no border at rest or focus.
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: SPACING.md, marginBottom: SPACING.sm,
    backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: RADIUS.md, borderWidth: 0,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, color: theme.text, ...TYPE_SCALE.body },
});
