/**
 * Blocked & muted — manage who you've blocked (server-enforced everywhere),
 * accounts you've muted on this device, and your muted words.
 *
 * Blocks come from GET /api/social/blocks; unblocking calls the server so the
 * change applies on every device immediately.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { getMutedUsers, unmuteUser, subscribeSocial } from '@/services/socialService';
import type { MuteRecord } from '@/services/socialTypes';
import { useApi } from '@/lib/api';
import { CachedImage } from '@/components/CachedImage';
import { EmptyState, PressableScale } from '@/components/BrandthreadUI';
import { apiErrorMessage, confirmUnblock, shortRelativeTime } from '@/lib/safety';
import type { BlockedAccount } from '@/lib/safetyTypes';

type Tab = 'blocked' | 'muted';

export default function BlockedAndMutedScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
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
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError(null);
    const [b, m, w] = await Promise.allSettled([
      api.social.blocks(),
      getMutedUsers(),
      api.safety.mutedWords(),
    ]);
    if (b.status === 'fulfilled') setBlocked(b.value);
    else setError(apiErrorMessage(b.reason, 'We couldn’t load your blocked accounts.'));
    if (m.status === 'fulfilled') setMuted(m.value);
    if (w.status === 'fulfilled') setMutedWordCount(w.value.words.length);
    setLoading(false);
    setRefreshing(false);
  }, [api]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => subscribeSocial(() => { getMutedUsers().then(setMuted).catch(() => {}); }), []);

  async function unblock(account: BlockedAccount) {
    setPendingId(account.userId);
    const done = await confirmUnblock({ userId: account.userId, name: account.name }, api.social.unblock);
    setPendingId(null);
    if (done) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBlocked((prev) => prev.filter((row) => row.userId !== account.userId));
    }
  }

  async function unmute(record: MuteRecord) {
    Haptics.selectionAsync();
    await unmuteUser(record.mutedUserId);
    setMuted((prev) => prev.filter((row) => row.id !== record.id));
  }

  const renderAvatar = (uri: string | null | undefined, initials: string) => (
    uri
      ? <CachedImage source={{ uri }} style={s.avatar} contentFit="cover" />
      : <View style={[s.avatar, s.avatarFallback]}><Text style={s.avatarText}>{initials}</Text></View>
  );

  const header = (
    <View>
      <View style={s.explainer}>
        <Feather name="shield" size={16} color={theme.text} />
        <Text style={s.explainerText}>
          {tab === 'blocked'
            ? 'Blocked accounts can’t find your profile, see your posts, comments or stories, or message you — and you won’t see theirs. They aren’t notified.'
            : 'Muting hides someone’s stories and posts on this device without telling them. They can still message you.'}
        </Text>
      </View>
      <PressableScale style={s.wordsRow} onPress={() => router.push('/muted-words' as never)} accessibilityRole="button">
        <View style={s.wordsIcon}><Feather name="type" size={16} color={theme.text} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.wordsTitle}>Muted words</Text>
          <Text style={s.wordsSub}>
            {mutedWordCount === null ? 'Hide comments and posts with words you choose'
              : mutedWordCount === 0 ? 'None yet — hide comments and posts with words you choose'
              : `${mutedWordCount} word${mutedWordCount === 1 ? '' : 's'} muted`}
          </Text>
        </View>
        <Feather name="chevron-right" size={18} color={theme.subtle} />
      </PressableScale>
      {error && tab === 'blocked' ? (
        <View style={s.errorCard}>
          <Feather name="alert-circle" size={16} color={theme.error} />
          <Text style={s.errorText}>{error}</Text>
          <PressableScale onPress={() => load(true)} accessibilityRole="button"><Text style={s.retry}>Retry</Text></PressableScale>
        </View>
      ) : null}
      <Text style={s.sectionLabel}>
        {tab === 'blocked'
          ? `${blocked.length} BLOCKED ACCOUNT${blocked.length === 1 ? '' : 'S'}`
          : `${muted.length} MUTED ACCOUNT${muted.length === 1 ? '' : 'S'}`}
      </Text>
    </View>
  );

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <PressableScale onPress={() => router.back()} style={s.headerBtn} accessibilityLabel="Back" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={ICON.lg} color={theme.text} />
        </PressableScale>
        <Text style={s.headerTitle}>Blocked & muted</Text>
        <View style={s.headerBtn} />
      </View>

      <View style={s.segment} accessibilityRole="tablist">
        {(['blocked', 'muted'] as const).map((key) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              onPress={() => { Haptics.selectionAsync(); setTab(key); }}
              style={({ pressed }) => [s.segmentItem, active && s.segmentItemActive, pressed && !active && { opacity: 0.7 }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[s.segmentText, active && s.segmentTextActive]}>
                {key === 'blocked' ? 'Blocked' : 'Muted'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={s.loading}><ActivityIndicator color={theme.text} /></View>
      ) : tab === 'blocked' ? (
        <FlatList
          data={blocked}
          keyExtractor={(item) => item.userId}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.xxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.text} />}
          renderItem={({ item, index }) => (
            <View style={[s.row, index === 0 && s.rowFirst, index === blocked.length - 1 && s.rowLast]}>
              {renderAvatar(item.avatarUrl, item.initials)}
              <View style={s.rowBody}>
                <Text style={s.rowName} numberOfLines={1}>{item.name}</Text>
                <Text style={s.rowMeta} numberOfLines={1}>
                  {[item.handle, item.accountType === 'seller' ? 'Seller' : null, `Blocked ${shortRelativeTime(item.blockedAt)}`]
                    .filter(Boolean).join(' · ')}
                </Text>
              </View>
              <PressableScale
                onPress={() => unblock(item)}
                style={s.actionBtn}
                disabled={pendingId === item.userId}
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${item.name}`}
              >
                {pendingId === item.userId
                  ? <ActivityIndicator size="small" color={theme.text} />
                  : <Text style={s.actionText}>Unblock</Text>}
              </PressableScale>
            </View>
          )}
          ListEmptyComponent={!error ? (
            <EmptyState
              icon="slash"
              title="You haven’t blocked anyone"
              description="Block someone from their profile, a comment, or a message. You can unblock them here any time."
              style={{ marginTop: SP.lg }}
            />
          ) : null}
        />
      ) : (
        <FlatList
          data={muted}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.xxl }}
          renderItem={({ item, index }) => (
            <View style={[s.row, index === 0 && s.rowFirst, index === muted.length - 1 && s.rowLast]}>
              {renderAvatar(null, item.mutedUserInitials)}
              <View style={s.rowBody}>
                <Text style={s.rowName} numberOfLines={1}>{item.mutedUserName}</Text>
                <Text style={s.rowMeta} numberOfLines={1}>{item.mutedUserHandle}</Text>
              </View>
              <PressableScale onPress={() => unmute(item)} style={s.actionBtn} accessibilityRole="button" accessibilityLabel={`Unmute ${item.mutedUserName}`}>
                <Text style={s.actionText}>Unmute</Text>
              </PressableScale>
            </View>
          )}
          ListEmptyComponent={(
            <EmptyState
              icon="volume-x"
              title="No muted accounts"
              description="Mute someone from their profile or story to quietly hide their posts and stories."
              style={{ marginTop: SP.lg }}
            />
          )}
        />
      )}
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.md },
  segment: {
    flexDirection: 'row', marginHorizontal: SP.md, marginBottom: SP.md, padding: 4,
    backgroundColor: theme.card, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: theme.border,
  },
  segmentItem: { flex: 1, height: 36, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  segmentItemActive: { backgroundColor: theme.accent },
  segmentText: { color: theme.muted, fontFamily: FONT.semibold, fontSize: FS.sm },
  segmentTextActive: { color: theme.onAccent },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  explainer: {
    flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start',
    padding: SP.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
  },
  explainerText: { flex: 1, color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19 },
  wordsRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.md, marginTop: SP.sm,
    padding: SP.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
  },
  wordsIcon: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.cardElevated, borderWidth: 1, borderColor: theme.border,
  },
  wordsTitle: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base },
  wordsSub: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs + 1, marginTop: 2 },
  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.sm, padding: SP.md,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.error + '55', backgroundColor: theme.card,
  },
  errorText: { flex: 1, color: theme.text, fontFamily: FONT.medium, fontSize: FS.sm },
  retry: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm, textDecorationLine: 'underline' },
  sectionLabel: { color: theme.subtle, fontFamily: FONT.semibold, fontSize: 11, letterSpacing: 1, marginTop: SP.lg, marginBottom: SP.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.md, paddingVertical: 12,
    backgroundColor: theme.card, borderLeftWidth: 1, borderRightWidth: 1, borderColor: theme.border,
    borderTopWidth: 1, borderTopColor: theme.borderSubtle,
  },
  rowFirst: { borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, borderTopColor: theme.border },
  rowLast: { borderBottomLeftRadius: RADIUS.lg, borderBottomRightRadius: RADIUS.lg, borderBottomWidth: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { backgroundColor: theme.cardElevated, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.sm },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base },
  rowMeta: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs + 1, marginTop: 2 },
  actionBtn: {
    minWidth: 88, height: 36, paddingHorizontal: 14, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  actionText: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm },
});
