/**
 * Community — find and join topic group chats.
 * Your groups on top, an invite-link field, official Brandthread communities,
 * then popular user-created groups. All reads/writes go through
 * useCommunityClient (live / demo / readonly), never the API directly.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState, PressableScale, SearchBar } from '@/components/BrandthreadUI';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { CommunityAvatar } from '@/components/community/CommunityAvatar';
import { CommunityRow } from '@/components/community/CommunityRow';
import { SignInPrompt } from '@/components/community/SignInPrompt';
import { VerifiedMark } from '@/components/community/VerifiedMark';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useCommunityClient } from '@/lib/communities/useCommunityClient';
import { formatMemberCount, type Community } from '@/lib/communities/types';
import { describeCommunityError } from '@/lib/communities/errors';
import { parseInviteCode } from '@/lib/communities/inviteLink';
import { hapticLight, hapticSuccess } from '@/lib/haptics';
import { useColors } from '@/hooks/useColors';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { COMP, FONT, FS, RADIUS, SP } from '@/lib/theme';

type ListRowItem =
  | { key: string; type: 'header'; title: string }
  | { key: string; type: 'community'; community: Community };

const MINE_COLLAPSED = 4;

export default function CommunityScreen() {
  const colors = useColors();
  const router = useRouter();
  const client = useCommunityClient();
  const barInset = useBuyerTabBarInset();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<Community[]>([]);
  const [mine, setMine] = useState<Community[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState(false);
  const [showAllMine, setShowAllMine] = useState(false);

  // id → joined, applied on top of server data so Join feels instant and survives a list refresh.
  const [joinedOverride, setJoinedOverride] = useState<Record<string, boolean>>({});
  const [joining, setJoining] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [preview, setPreview] = useState<Community | null>(null);

  const [inviteText, setInviteText] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);

  const generation = useRef(0);
  const searching = debounced.length > 0;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    const gen = ++generation.current;
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError(null);
    setMoreError(false);
    try {
      const [page, joinedRows] = await Promise.all([
        client.list(debounced ? { q: debounced } : undefined),
        client.mine().catch(() => [] as Community[]),
      ]);
      if (gen !== generation.current) return;
      setItems(page.communities);
      setNextOffset(page.nextOffset);
      setMine(joinedRows);
    } catch (e) {
      if (gen !== generation.current) return;
      setError(describeCommunityError(e, "Couldn't load groups. Check your connection and try again.").message);
    } finally {
      if (gen === generation.current) { setLoading(false); setRefreshing(false); }
    }
  }, [client, debounced]);

  useEffect(() => { void load(); }, [load]);
  // Demo mode: joins made elsewhere (e.g. the chat) show up immediately.
  useEffect(() => client.onLocalChange(() => { void load('refresh'); }), [client, load]);

  const loadMore = useCallback(async () => {
    if (nextOffset === null || loadingMore || loading) return;
    const gen = generation.current;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await client.list({ ...(debounced ? { q: debounced } : {}), offset: nextOffset });
      if (gen !== generation.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...page.communities.filter((c) => !seen.has(c.id))];
      });
      setNextOffset(page.nextOffset);
    } catch {
      if (gen === generation.current) setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [client, debounced, loading, loadingMore, nextOffset]);

  const isJoined = useCallback(
    (c: Community) => joinedOverride[c.id] ?? c.joined,
    [joinedOverride],
  );

  const openChat = useCallback((id: string) => {
    hapticLight();
    Keyboard.dismiss();
    router.push(`/community-chat?id=${encodeURIComponent(id)}` as never);
  }, [router]);

  /** Optimistic join; rolls back with a calm inline message on failure. Resolves true on success. */
  const join = useCallback(async (c: Community): Promise<boolean> => {
    if (joining[c.id]) return false;
    hapticLight();
    setRowErrors((prev) => { const { [c.id]: _drop, ...rest } = prev; return rest; });
    setNeedsSignIn(false);
    setJoinedOverride((prev) => ({ ...prev, [c.id]: true }));
    setJoining((prev) => ({ ...prev, [c.id]: true }));
    try {
      const joined = await client.join(c.id);
      hapticSuccess();
      setMine((prev) => (prev.some((m) => m.id === c.id) ? prev : [{ ...c, ...joined, joined: true }, ...prev]));
      return true;
    } catch (e) {
      setJoinedOverride((prev) => ({ ...prev, [c.id]: false }));
      const info = describeCommunityError(e);
      if (info.authRequired) setNeedsSignIn(true);
      else setRowErrors((prev) => ({ ...prev, [c.id]: info.message }));
      return false;
    } finally {
      setJoining((prev) => ({ ...prev, [c.id]: false }));
    }
  }, [client, joining]);

  const submitInvite = () => {
    const code = parseInviteCode(inviteText);
    if (!code) {
      setInviteError("That doesn't look like an invite link. Paste the full link or the code.");
      return;
    }
    setInviteError(null);
    Keyboard.dismiss();
    setInviteText('');
    router.push(`/community-join?code=${encodeURIComponent(code)}` as never);
  };

  const rows = useMemo<ListRowItem[]>(() => {
    if (searching) return items.map((c) => ({ key: c.id, type: 'community' as const, community: c }));
    const official = items.filter((c) => c.kind === 'official');
    const popular = items.filter((c) => c.kind !== 'official');
    const out: ListRowItem[] = [];
    if (official.length) {
      out.push({ key: 'h-official', type: 'header', title: 'Official communities' });
      official.forEach((c) => out.push({ key: c.id, type: 'community', community: c }));
    }
    if (popular.length) {
      out.push({ key: 'h-popular', type: 'header', title: 'Popular groups' });
      popular.forEach((c) => out.push({ key: c.id, type: 'community', community: c }));
    }
    return out;
  }, [items, searching]);

  const joinedMine = useMemo(() => mine.filter((c) => joinedOverride[c.id] !== false), [mine, joinedOverride]);
  const visibleMine = showAllMine ? joinedMine : joinedMine.slice(0, MINE_COLLAPSED);

  const header = (
    <View>
      {needsSignIn ? <View style={styles.block}><SignInPrompt /></View> : null}

      {!searching && joinedMine.length > 0 ? (
        <View style={styles.block}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Your groups</Text>
          {visibleMine.map((c) => (
            <PressableScale
              key={c.id}
              onPress={() => openChat(c.id)}
              style={styles.mineRow}
              accessibilityRole="button"
              accessibilityLabel={`Open ${c.name}`}
            >
              <CommunityAvatar community={c} size={40} />
              <View style={styles.mineCopy}>
                <View style={styles.nameRow}>
                  <Text style={[styles.mineName, { color: colors.foreground }]} numberOfLines={1}>{c.name}</Text>
                  {c.verified ? <VerifiedMark size={13} /> : null}
                </View>
                <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>{formatMemberCount(c.memberCount)}</Text>
              </View>
              {c.unreadCount > 0 && !c.muted ? <View style={[styles.unreadDot, { backgroundColor: colors.foreground }]} /> : null}
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </PressableScale>
          ))}
          {joinedMine.length > MINE_COLLAPSED ? (
            <PressableScale onPress={() => setShowAllMine((v) => !v)} style={styles.linkBtn} accessibilityRole="button">
              <Text style={[styles.linkText, { color: colors.mutedForeground }]}>
                {showAllMine ? 'Show fewer' : `See all ${joinedMine.length}`}
              </Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}

      {!searching ? (
        <View style={styles.block}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Have an invite link?</Text>
          <View style={styles.inviteRow}>
            <View style={[styles.inviteField, { backgroundColor: colors.card }]}>
              <Feather name="link" size={16} color={colors.mutedForeground} />
              <TextInput
                value={inviteText}
                onChangeText={(t) => { setInviteText(t); if (inviteError) setInviteError(null); }}
                placeholder="Paste link or code"
                placeholderTextColor={colors.subtle}
                style={[styles.inviteInput, { color: colors.foreground }, WEB_INPUT_RESET]}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={submitInvite}
                accessibilityLabel="Invite link or code"
              />
            </View>
            <Button label="Open" size="small" variant="secondary" disabled={!inviteText.trim()} onPress={submitInvite} />
          </View>
          {inviteError ? <Text style={[styles.inlineNote, { color: colors.mutedForeground }]}>{inviteError}</Text> : null}
        </View>
      ) : null}

      {!searching ? (
        <PressableScale
          onPress={() => { hapticLight(); router.push('/community-create' as never); }}
          style={[styles.createRow, { backgroundColor: colors.card, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Create a group"
        >
          <View style={[styles.createIcon, { backgroundColor: colors.secondary }]}>
            <Feather name="plus" size={20} color={colors.foreground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.mineName, { color: colors.foreground }]}>Create a group</Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>Start a chat around something you love</Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </PressableScale>
      ) : null}
    </View>
  );

  const renderItem = ({ item }: { item: ListRowItem }) => {
    if (item.type === 'header') {
      return <Text style={[styles.sectionTitle, styles.listHeader, { color: colors.foreground }]}>{item.title}</Text>;
    }
    const c = item.community;
    const joined = isJoined(c);
    return (
      <CommunityRow
        community={c}
        joined={joined}
        joining={!!joining[c.id]}
        error={rowErrors[c.id]}
        onPress={() => (joined ? openChat(c.id) : setPreview(c))}
        onJoin={() => { void join(c); }}
      />
    );
  };

  const body = () => {
    if (loading && !refreshing) {
      return (
        <View style={styles.pad}>
          {header}
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.skelRow}>
              <SkeletonBlock width={52} height={52} radius={15} />
              <View style={{ flex: 1, gap: 8 }}>
                <SkeletonBlock width="55%" height={13} />
                <SkeletonBlock width="85%" height={11} />
              </View>
            </View>
          ))}
        </View>
      );
    }
    if (error && items.length === 0) {
      return (
        <View style={styles.pad}>
          {header}
          <ErrorState message={error} onRetry={() => { void load(); }} />
        </View>
      );
    }
    return (
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            icon="users"
            title={searching ? 'No groups found' : 'No groups yet'}
            description={searching ? 'Try a different search, or start the group yourself.' : 'Be the first to start one.'}
            action={{ label: 'Create a group', onPress: () => router.push('/community-create' as never) }}
            compact
          />
        }
        ListFooterComponent={
          loadingMore ? <ActivityIndicator color={colors.mutedForeground} style={styles.footer} />
            : moreError ? (
              <PressableScale onPress={() => { void loadMore(); }} style={styles.linkBtn} accessibilityRole="button">
                <Text style={[styles.linkText, { color: colors.mutedForeground }]}>Couldn't load more. Tap to retry.</Text>
              </PressableScale>
            ) : null
        }
        onEndReached={() => { void loadMore(); }}
        onEndReachedThreshold={0.6}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.pad, { paddingBottom: barInset + SP.lg }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void load('refresh'); }} tintColor={colors.mutedForeground} />}
      />
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Community" />
      <View style={styles.searchWrap}>
        <SearchBar value={query} onChange={setQuery} placeholder="Search groups" />
      </View>
      {body()}

      <BottomSheet visible={!!preview} onClose={() => setPreview(null)}>
        {preview ? (
          <PreviewSheetBody
            community={preview}
            joined={isJoined(preview)}
            joining={!!joining[preview.id]}
            error={rowErrors[preview.id]}
            needsSignIn={needsSignIn}
            onJoin={async () => {
              const ok = await join(preview);
              if (ok) { const id = preview.id; setPreview(null); openChat(id); }
            }}
            onOpen={() => { const id = preview.id; setPreview(null); openChat(id); }}
          />
        ) : null}
      </BottomSheet>
    </View>
  );
}

function PreviewSheetBody({ community, joined, joining, error, needsSignIn, onJoin, onOpen }: {
  community: Community; joined: boolean; joining: boolean; error?: string; needsSignIn: boolean; onJoin: () => void; onOpen: () => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.sheet}>
      <CommunityAvatar community={community} size={64} />
      <View style={styles.nameRow}>
        <Text style={[styles.sheetName, { color: colors.foreground }]}>{community.name}</Text>
        {community.verified ? <VerifiedMark size={16} /> : null}
      </View>
      <Text style={[styles.meta, { color: colors.mutedForeground }]}>{formatMemberCount(community.memberCount)}</Text>
      {community.description ? (
        <Text style={[styles.sheetDesc, { color: colors.mutedForeground }]}>{community.description}</Text>
      ) : null}
      {error ? <Text style={[styles.inlineNote, { color: colors.mutedForeground }]}>{error}</Text> : null}
      {needsSignIn ? <SignInPrompt /> : null}
      <Button
        label={joined && !joining ? 'Open chat' : 'Join group'}
        onPress={joined && !joining ? onOpen : onJoin}
        loading={joining}
        fullWidth
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { paddingHorizontal: SP.md, paddingTop: SP.xs },
  searchWrap: { paddingHorizontal: SP.md, paddingTop: SP.md },
  block: { marginTop: SP.md },
  sectionTitle: { fontFamily: FONT.bold, fontSize: FS.md, letterSpacing: -0.2, marginBottom: SP.xs },
  listHeader: { marginTop: SP.lg },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { fontFamily: FONT.regular, fontSize: FS.meta },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md - 4, minHeight: COMP.minTouchTarget + 8, paddingVertical: 4 },
  mineCopy: { flex: 1 },
  mineName: { flexShrink: 1, fontFamily: FONT.semibold, fontSize: FS.base },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  linkBtn: { minHeight: COMP.minTouchTarget, justifyContent: 'center' },
  linkText: { fontFamily: FONT.medium, fontSize: FS.sm },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  inviteField: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SP.sm, height: COMP.minTouchTarget, paddingHorizontal: SP.md, borderRadius: RADIUS.md },
  inviteInput: { flex: 1, fontFamily: FONT.regular, fontSize: FS.base },
  inlineNote: { fontFamily: FONT.regular, fontSize: FS.meta, lineHeight: 17, marginTop: SP.sm },
  createRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.md - 4, marginTop: SP.md, padding: SP.md - 4,
    borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, minHeight: 64,
  },
  createIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  skelRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md - 4, paddingVertical: SP.sm + 2 },
  footer: { paddingVertical: SP.md },
  sheet: { alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.md },
  sheetName: { fontFamily: FONT.bold, fontSize: FS.lg, letterSpacing: -0.2 },
  sheetDesc: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 21, textAlign: 'center', marginBottom: SP.xs },
});
