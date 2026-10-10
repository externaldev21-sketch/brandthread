/**
 * Muted Accounts — manage muted users
 * Muting does not remove friendship.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  TextInput, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { getMutedUsers, unmuteUser } from '@/services/socialService';
import type { MuteRecord } from '@/services/socialTypes';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button, ListRow } from '@/components/ui';
import { EmptyState } from '@/components/BrandthreadUI';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

export default function MutedAccountsScreen() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const styles = makeStyles(theme, palette);
  const insets = useSafeAreaInsets();
  const [muted, setMuted] = useState<MuteRecord[]>([]);
  const [query, setQuery] = useState('');
  const [unmuting, setUnmuting] = useState<string | null>(null);

  const load = useCallback(() => getMutedUsers().then(setMuted), []);
  const pull = usePullToRefresh(load);

  useEffect(() => { load(); }, [load]);

  const handleUnmute = (user: MuteRecord) => {
    Alert.alert('Unmute', `Unmute ${user.mutedUserName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unmute',
        onPress: async () => {
          setUnmuting(user.id);
          await unmuteUser(user.mutedUserId);
          setUnmuting(null);
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
    <View style={styles.page}>
      <ScreenHeader title="Muted accounts" />

      <View style={styles.intro}>
        <Text style={styles.introText}>
          Muted accounts won't know they've been muted. You'll remain friends and can still message them.
        </Text>
      </View>

      {muted.length > 0 && (
        <View style={styles.search}>
          <Feather name="search" size={16} color={theme.muted} />
          <TextInput returnKeyType="search"
            style={[styles.searchInput, WEB_INPUT_RESET]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search muted accounts"
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
            icon="volume-x"
            title="No muted accounts"
            description="Muted accounts will appear here."
            style={{ marginTop: SPACING.lg }}
          />
        }
        renderItem={({ item }) => (
          <ListRow
            avatar={{ name: item.mutedUserName }}
            title={item.mutedUserName}
            subtitle={item.mutedUserHandle}
            right={(
              <Button
                label="Unmute"
                onPress={() => handleUnmute(item)}
                variant="secondary"
                size="small"
                loading={unmuting === item.id}
                accessibilityHint={`Unmutes ${item.mutedUserName}`}
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
    backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 12, borderWidth: 0,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, color: theme.text, ...TYPE_SCALE.body },
});
