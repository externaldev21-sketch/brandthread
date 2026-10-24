/**
 * Blocked & muted — manage who you've blocked (server-enforced everywhere),
 * accounts you've muted (server-backed, see socialService.getMutedUsers), and your muted words.
 *
 * Blocks come from GET /api/social/blocks; unblocking calls the server so the
 * change applies on every device immediately.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Platform } from 'react-native';
import { showActionSheet } from '@/components/ui/ActionSheet';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';

import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';

import { useColors } from '@/hooks/useColors';

import { getMutedUsers, unmuteUser, subscribeSocial } from '@/services/socialService';

import type { MuteRecord } from '@/services/socialTypes';
import { useApi } from '@/lib/api';

import { EmptyState, PressableScale } from '@/components/BrandthreadUI';

import { apiErrorMessage, confirmUnblock, shortRelativeTime } from '@/lib/safety';

import type { BlockedAccount } from '@/lib/safetyTypes';
import { ScreenHeader } from '@/components/ScreenHeader';

import { Button, ListRow, SegmentedControl, ThemedRefreshControl } from '@/components/ui';

import { haptics } from '@/lib/haptics';
import { showAlert, confirmAlert } from '@/lib/actionSheet';
import { friendlyError } from '@/lib/friendlyError';

import { TYPE_SCALE } from '@/constants/typography';

import { SPACING } from '@/constants/spacing';

import { RADII } from '@/constants/radii';

import { FONT } from '@/lib/theme';

type Tab = 'blocked' | 'muted';

export default function BlockedAndMutedScreen() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const s = useMemo(() => makeStyles(theme, palette), [theme, palette]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const params = useLocalSearchParams<{ tab?: string }>();

  const [tab, setTab] = useState<Tab>(params.tab === 'muted' ? 'muted' : 'blocked');
  const [blocked, setBlocked] = useState<BlockedAccount[]>([]);
  const [muted, setMuted] = useState<MuteRecord[]>([]);
  const [mutedWordCount, setMutedWordCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Muted list load failure — shown on the Muted tab instead of an empty state.
  const [mutedError, setMutedError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError(null);
    setMutedError(null);
    const [b, m, w] = await Promise.allSettled([
      api.social.blocks(),
      getMutedUsers(),
      api.safety.mutedWords(),
    ]);
    if (b.status === 'fulfilled') setBlocked(b.value);
    else setError(apiErrorMessage(b.reason, 'We couldn’t load your blocked accounts.'));
    if (m.status === 'fulfilled') setMuted(m.value);
    else setMutedError(friendlyError(m.reason, 'We couldn’t load your muted accounts.'));
    if (w.status === 'fulfilled') setMutedWordCount(w.value.words.length);
    setLoading(false);
    setRefreshing(false);
  }, [api]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => subscribeSocial(() => { getMutedUsers().then((rows) => { setMuted(rows); setMutedError(null); }).catch(() => {}); }), []);

  async function unblock(account: BlockedAccount) {
    setPendingId(account.userId);
    // react-native-web's Alert.alert renders nothing; web gets the themed sheet.
    const done = await confirmUnblock(
      { userId: account.userId, name: account.name },
      api.social.unblock,
      Platform.OS === 'web' ? showActionSheet : undefined,
    );
    setPendingId(null);
    if (done) {
      setBlocked((prev) => prev.filter((row) => row.userId !== account.userId));
    }
  }

  // Same confirm as Muted accounts before unmuting.
  async function unmute(record: MuteRecord) {
    if (pendingId) return;
    haptics.select();
    const ok = await confirmAlert({
      title: 'Unmute',
      message: `Unmute ${record.mutedUserName}?`,
      confirmLabel: 'Unmute',
      cancelLabel: 'Keep muted',
    });
    if (!ok) return;
    setPendingId(record.id);
    try {
      await unmuteUser(record.mutedUserId);
      setMuted((prev) => prev.filter((row) => row.id !== record.id));
    } catch (err) {
      // The row stays, so the person can retry.
      showAlert('Couldn’t unmute', friendlyError(err, 'Try again.'));
    } finally {
      setPendingId(null);
    }
  }

  const header = (
    <View>
      <View style={s.explainer}>
        <Icon name="shield" size={16} color={theme.text} />
        <Text style={s.explainerText}>
          {tab === 'blocked'
            ? 'Blocked accounts can’t find your profile, see your posts, comments or stories, or message you — and you won’t see theirs. They aren’t notified.'
            : 'Muting hides someone’s stories, posts and comments from you without telling them. They can still message you.'}
        </Text>
      </View>
      <PressableScale style={s.wordsRow} onPress={() => router.push('/muted-words' as never)} accessibilityRole="button">
        <View style={s.wordsIcon}><Icon name="type" size={16} color={theme.text} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.wordsTitle}>Muted words</Text>
          <Text style={s.wordsSub}>
            {mutedWordCount === null ? 'Hide comments and posts with words you choose'
              : mutedWordCount === 0 ? 'None yet — hide comments and posts with words you choose'
              : `${mutedWordCount} word${mutedWordCount === 1 ? '' : 's'} muted`}
          </Text>
        </View>
        <Icon name="chevron-right" size={18} color={theme.subtle} />
      </PressableScale>
      {error && tab === 'blocked' ? (
        <View style={s.errorCard}>
          <Icon name="alert-circle" size={16} color={theme.error} />
          <Text style={s.errorText}>{error}</Text>
          <PressableScale onPress={() => load(true)} accessibilityRole="button"><Text style={s.retry}>Retry</Text></PressableScale>
        </View>
      ) : null}
      {/* No count under the error — it would assert "0" for a list that
          never loaded (audit QA-0247). Error XOR count/empty state. */}
      {mutedError && tab === 'muted' ? (
        <View style={s.errorCard}>
          <Icon name="alert-circle" size={16} color={theme.error} />
          <Text style={s.errorText}>{mutedError}</Text>
          <PressableScale onPress={() => load(true)} accessibilityRole="button"><Text style={s.retry}>Retry</Text></PressableScale>
        </View>
      ) : null}
      {(error && tab === 'blocked') || (mutedError && tab === 'muted') ? null : (
      <Text style={s.sectionLabel}>
        {tab === 'blocked'
          ? `${blocked.length} BLOCKED ACCOUNT${blocked.length === 1 ? '' : 'S'}`
          : `${muted.length} MUTED ACCOUNT${muted.length === 1 ? '' : 'S'}`}
      </Text>
      )}
    </View>
  );

  return (
    <View style={s.root}>
      <ScreenHeader title="Blocked & muted" />

      <SegmentedControl
        options={[{ id: 'blocked', label: 'Blocked' }, { id: 'muted', label: 'Muted' }]}
        selectedId={tab}
        onChange={(id) => setTab(id as Tab)}
        testID="blocked-muted-tabs"
        style={{ marginHorizontal: SPACING.md }}
      />

      {loading ? (
        <View style={s.loading}><ActivityIndicator color={theme.text} /></View>
      ) : tab === 'blocked' ? (
        <FlatList
          data={blocked}
          keyExtractor={(item) => item.userId}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingBottom: insets.bottom + SPACING.xxl }}
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
          renderItem={({ item }) => (
            <ListRow
              avatar={{ uri: item.avatarUrl, name: item.name }}
              title={item.name}
              subtitle={`${[item.handle, item.accountType === 'seller' ? 'Seller' : null].filter(Boolean).join(', ')}\nBlocked ${shortRelativeTime(item.blockedAt)}`}
              subtitleNumberOfLines={2}
              right={(
                <Button
                  label="Unblock"
                  onPress={() => unblock(item)}
                  variant="secondary"
                  size="small"
                  loading={pendingId === item.userId}
                  disabled={pendingId !== null && pendingId !== item.userId}
                  accessibilityHint={`Unblocks ${item.name}`}
                />
              )}
            />
          )}
          ListEmptyComponent={!error ? (
            <EmptyState
              icon="slash"
              title="You haven’t blocked anyone"
              description="Block someone from their profile, a comment, or a message. You can unblock them here any time."
              style={{ marginTop: SPACING.lg }}
            />
          ) : null}
        />
      ) : (
        <FlatList
          data={muted}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingBottom: insets.bottom + SPACING.xxl }}
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
          renderItem={({ item }) => (
            <ListRow
              avatar={{ name: item.mutedUserName }}
              title={item.mutedUserName}
              subtitle={item.mutedUserHandle}
              right={(
                <Button
                  label="Unmute"
                  onPress={() => unmute(item)}
                  variant="secondary"
                  size="small"
                  loading={pendingId === item.id}
                  disabled={pendingId !== null && pendingId !== item.id}
                  accessibilityHint={`Unmutes ${item.mutedUserName}`}
                />
              )}
            />
          )}
          ListEmptyComponent={!mutedError ? (
            <EmptyState
              icon="volume-x"
              title="No muted accounts"
              description="Mute someone from their profile or story to quietly hide their posts and stories."
              style={{ marginTop: SPACING.lg }}
            />
          ) : null}
        />
      )}
    </View>
  );
}

const makeStyles = (theme: AppThemePreset, palette: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  tabs: { marginHorizontal: SPACING.md },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  explainer: {
    flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start',
    padding: SPACING.md, marginTop: SPACING.md, borderRadius: RADII.card, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
  },
  explainerText: { flex: 1, color: theme.muted, ...TYPE_SCALE.callout },
  wordsRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginTop: SPACING.sm,
    padding: SPACING.md, borderRadius: RADII.card, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
  },
  wordsIcon: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.cardElevated, borderWidth: 1, borderColor: theme.border,
  },
  wordsTitle: { color: theme.text, ...TYPE_SCALE.body, fontFamily: FONT.semibold },
  wordsSub: { color: theme.muted, ...TYPE_SCALE.footnote, marginTop: 2 },
  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.sm, padding: SPACING.md,
    borderRadius: RADII.card, borderWidth: 1, borderColor: theme.error + '55', backgroundColor: theme.card,
  },
  errorText: { flex: 1, color: theme.text, ...TYPE_SCALE.callout, fontFamily: FONT.medium },
  retry: { color: theme.text, ...TYPE_SCALE.callout, fontFamily: FONT.semibold, textDecorationLine: 'underline' },
  sectionLabel: { color: theme.subtle, ...TYPE_SCALE.caption, marginTop: SPACING.lg, marginBottom: SPACING.sm },
});
