/**
 * Seller Activity — opened from the bell on the seller profile.
 *
 * Same list as the buyer Activity screen (its row, avatar stack, thumbnail,
 * follow-back pill, section header and skeleton are imported from
 * activity-center, not re-implemented), narrowed to what happens around a
 * seller's content and profile: likes, comments, replies, mentions and tags,
 * reposts and shares, saves, and new followers. Grouped Today / This week /
 * Earlier with Likes / Comments / Mentions / Reposts / Followers filter chips
 * (see lib/sellerActivity.ts). Opening the screen marks the activity read, so
 * the unread dot on the bell clears; rows keep their own dot for this visit.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, SectionList, Text, View, type ViewToken } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useUser } from '@clerk/expo';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { SP } from '@/lib/theme';
import { EmptyState, useScreenPadding } from '@/components/layout';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useScrollReset } from '@/hooks/useScrollReset';
import { useUndoToast } from '@/components/BrandthreadUI';
import { ThemedRefreshControl } from '@/components/ui';
import { Chip } from '@/components/ui/Chip';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { CenteredToast } from '@/components/social/CenteredToast';
import { ActivityRowView, SkeletonRows, makeStyles } from '@/app/activity-center';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';
import { captureNotificationEvent } from '@/lib/notificationEventOutbox';
import { haptics } from '@/lib/haptics';
import {
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_UNDO_MS,
  activityRowHref,
  applyRead,
  createDeferredDelete,
  createReadTracker,
  type ActivityItem,
  type ActivityRow,
} from '@/lib/activity';
import {
  SELLER_ACTIVITY_CHIPS,
  buildSellerActivitySections,
  isSellerActivityItem,
  matchesSellerChip,
  sellerChipEmpty,
  type SellerActivityChip,
  type SellerActivitySection,
} from '@/lib/sellerActivity';
import { dismissActivity, getActivity, markActivityRead, watchActivityRealtime } from '@/services/activityService';
import { blockUser, seeLessNotificationType, setSellerFollowing } from '@/services/socialService';
import {
  getVisiblePreviewActivity,
  isPreviewActivityEnabled,
  isPreviewActivityId,
  markPreviewActivityDismissed,
} from '@/lib/previewActivity';
import { applyPreviewFollowState } from '@/lib/previewFollowStore';

export default function SellerActivityScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const screenPadding = useScreenPadding({ withTabBarInset: true });
  const listRef = useScrollReset<SectionList<ActivityRow, SellerActivitySection>>(true, false);
  const router = useRouter();
  const api = useApi();
  const { user } = useUser();

  const [items, setItems] = useState<ActivityItem[]>([]);
  const [dotIds, setDotIds] = useState<ReadonlySet<string>>(() => new Set());
  const dotIdsRef = useRef(dotIds);
  dotIdsRef.current = dotIds;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorKind, setErrorKind] = useState<'auth' | 'offline' | 'server'>('offline');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [followOverrides, setFollowOverrides] = useState<Record<string, boolean>>({});
  const [followPending, setFollowPending] = useState<ReadonlySet<string>>(() => new Set());
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [chip, setChip] = useState<SellerActivityChip>('all');

  const requestId = useRef(0);
  const itemsRef = useRef<ActivityItem[]>([]);
  itemsRef.current = items;
  const retriedRef = useRef(false);

  const tracker = useMemo(() => createReadTracker({
    markRead: markActivityRead,
    dwellMs: 600,
    onMarked: (ids) => setItems((prev) => applyRead(prev, ids)),
  }), []);
  useEffect(() => () => tracker.dispose(), [tracker]);

  const readIds = useMemo(() => new Set(items.filter((item) => item.isRead).map((item) => item.id)), [items]);
  const readIdsRef = useRef(readIds);
  readIdsRef.current = readIds;

  // ── Delete with Undo ───────────────────────────────────────────────────────
  const { showUndo, dismissUndo } = useUndoToast();
  const deletedRowsRef = useRef(new Map<string, ActivityItem>());
  const restoreRows = useCallback((ids: string[]) => {
    const back = ids.map((id) => deletedRowsRef.current.get(id)).filter((item): item is ActivityItem => !!item);
    for (const id of ids) deletedRowsRef.current.delete(id);
    if (back.length === 0) return;
    setItems((prev) => {
      const have = new Set(prev.map((item) => item.id));
      return [...prev, ...back.filter((item) => !have.has(item.id))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }, []);
  const deferredDelete = useMemo(() => createDeferredDelete({
    delayMs: ACTIVITY_UNDO_MS,
    commit: async (ids) => {
      const results = await Promise.allSettled(ids.map(async (id) => {
        if (isPreviewActivityId(id)) { markPreviewActivityDismissed(id); return; }
        await dismissActivity(id);
      }));
      const failed = ids.filter((_, index) => results[index]!.status === 'rejected');
      for (const id of ids) if (!failed.includes(id)) deletedRowsRef.current.delete(id);
      return failed;
    },
    onFailed: (failed) => {
      restoreRows(failed);
      Alert.alert('Could not delete', 'Check your connection and try again.');
    },
  }), [restoreRows]);
  const deferredDeleteRef = useRef(deferredDelete);
  deferredDeleteRef.current = deferredDelete;
  const undoVisibleUntil = useRef(0);
  useEffect(() => () => {
    deferredDelete.flush();
    if (Date.now() < undoVisibleUntil.current) dismissUndo();
  }, [deferredDelete, dismissUndo]);
  const withoutPendingDeletes = (list: ActivityItem[]) => list.filter((item) => !deferredDeleteRef.current.isPending(item.id));

  // ── Loading ────────────────────────────────────────────────────────────────
  const addUnreadDots = useCallback((list: readonly ActivityItem[]) => {
    const fresh = list.filter((item) => !item.isRead && isSellerActivityItem(item)).map((item) => item.id);
    if (fresh.length === 0) return;
    setDotIds((prev) => {
      if (fresh.every((id) => prev.has(id))) return prev;
      return new Set([...prev, ...fresh]);
    });
  }, []);

  /** Opening the screen is what clears the bell's dot: mark what just loaded as read. */
  const markOpenedRead = useCallback((list: readonly ActivityItem[]) => {
    const unread = list.filter((item) => !item.isRead && isSellerActivityItem(item)).map((item) => item.id);
    if (unread.length > 0) tracker.markNow(unread);
  }, [tracker]);

  const loadFirstPage = useCallback(async (mode: 'initial' | 'refresh' | 'focus') => {
    const id = ++requestId.current;
    if (mode === 'initial') setStatus('loading');
    if (mode === 'refresh') setRefreshing(true);
    if (isPreviewActivityEnabled()) {
      // Dev web preview: the seeded feed exists only under &demo=1 (empty otherwise).
      const seeded = withoutPendingDeletes(applyPreviewFollowState(getVisiblePreviewActivity()));
      setItems(seeded);
      addUnreadDots(seeded);
      markOpenedRead(seeded);
      setHasMore(false);
      setNow(Date.now());
      setStatus('ready');
      setRefreshing(false);
      return;
    }
    try {
      const page = await getActivity({ limit: ACTIVITY_PAGE_SIZE, offset: 0, filter: 'social' });
      if (id !== requestId.current) return;
      retriedRef.current = false;
      const next = withoutPendingDeletes(page);
      setItems(next);
      addUnreadDots(next);
      markOpenedRead(next);
      setHasMore(page.length === ACTIVITY_PAGE_SIZE);
      setNow(Date.now());
      setStatus('ready');
    } catch (err) {
      if (id !== requestId.current) return;
      if (itemsRef.current.length > 0) { setStatus('ready'); return; }
      if (!retriedRef.current) {
        retriedRef.current = true;
        setTimeout(() => { void loadFirstPage(mode); }, 800);
        return;
      }
      setErrorKind(err instanceof ApiError
        ? (err.status === 401 || err.status === 403 ? 'auth' : err.status >= 500 ? 'server' : 'offline')
        : 'offline');
      setStatus('error');
    } finally {
      if (id === requestId.current) setRefreshing(false);
    }
  }, [addUnreadDots, markOpenedRead]);

  const loadedOnce = useRef(false);
  useFocusEffect(useCallback(() => {
    void loadFirstPage(loadedOnce.current ? 'focus' : 'initial');
    loadedOnce.current = true;
    const realtime = watchActivityRealtime(() => { void loadFirstPage('focus'); });
    return () => {
      realtime.stop();
      setDotIds(new Set());
      deferredDeleteRef.current.flush();
      if (Date.now() < undoVisibleUntil.current) { undoVisibleUntil.current = 0; dismissUndo(); }
    };
  }, [dismissUndo, loadFirstPage]));

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || status !== 'ready') return;
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const page = await getActivity({ limit: ACTIVITY_PAGE_SIZE, offset: itemsRef.current.length, filter: 'social' });
      if (id !== requestId.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        return [...prev, ...withoutPendingDeletes(page).filter((item) => !seen.has(item.id))];
      });
      addUnreadDots(page);
      markOpenedRead(page);
      setHasMore(page.length === ACTIVITY_PAGE_SIZE);
    } catch {
      // The next scroll retries.
    } finally {
      setLoadingMore(false);
    }
  }, [addUnreadDots, hasMore, loadingMore, markOpenedRead, status]);

  // ── Derived list ───────────────────────────────────────────────────────────
  const sections = useMemo(
    () => buildSellerActivitySections(items.filter((item) => matchesSellerChip(item, chip)), new Date(now)),
    [items, chip, now],
  );

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 150 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const visible: string[] = [];
    for (const token of viewableItems) {
      const row = token.item as ActivityRow | undefined;
      if (!row?.ids) continue;
      for (const id of row.ids) if (!readIdsRef.current.has(id)) visible.push(id);
    }
    tracker.setVisible(visible);
  }).current;

  // ── Row actions ────────────────────────────────────────────────────────────
  const handlePress = useCallback((row: ActivityRow) => {
    setDotIds((prev) => {
      if (!row.ids.some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of row.ids) next.delete(id);
      return next;
    });
    void captureNotificationEvent(api, user?.id, {
      notificationId: row.id,
      eventType: 'tap',
      occurredAt: new Date().toISOString(),
    }).catch(() => { /* measurement is best-effort */ });
    tracker.markNow(row.ids.filter((id) => !readIdsRef.current.has(id)));
    const href = activityRowHref(row, 'seller');
    if (href) router.push(href as never);
  }, [api, router, tracker, user?.id]);

  const handleDismiss = useCallback((row: ActivityRow) => {
    const removed = new Set(row.ids);
    for (const item of itemsRef.current) if (removed.has(item.id)) deletedRowsRef.current.set(item.id, item);
    setItems((prev) => prev.filter((item) => !removed.has(item.id)));
    const token = deferredDelete.schedule(row.ids);
    undoVisibleUntil.current = Date.now() + ACTIVITY_UNDO_MS;
    showUndo({
      message: 'Notification deleted',
      durationMs: ACTIVITY_UNDO_MS,
      tone: 'monochrome',
      testID: 'activity-undo-toast',
      bottom: screenPadding.bottom,
      undo: () => {
        undoVisibleUntil.current = 0;
        if (deferredDelete.undo(token)) restoreRows(row.ids);
      },
    });
  }, [deferredDelete, restoreRows, screenPadding.bottom, showUndo]);

  const followPendingRef = useRef(followPending);
  followPendingRef.current = followPending;
  const setFollowingPerson = useCallback(async (userId: string, next: boolean) => {
    if (followPendingRef.current.has(userId)) return;
    setFollowPending((prev) => new Set(prev).add(userId));
    setFollowOverrides((prev) => ({ ...prev, [userId]: next }));
    try {
      await setSellerFollowing(userId, next);
    } catch {
      setFollowOverrides((prev) => ({ ...prev, [userId]: !next }));
      Alert.alert(next ? 'Could not follow' : 'Could not unfollow', 'Please try again in a moment.');
    } finally {
      setFollowPending((prev) => {
        const copy = new Set(prev);
        copy.delete(userId);
        return copy;
      });
    }
  }, []);

  const handleToggleFollow = useCallback((row: ActivityRow, currentlyFollowing: boolean) => {
    const userId = row.targetId;
    if (!userId) return;
    tracker.markNow(row.ids.filter((id) => !readIdsRef.current.has(id)));
    if (!currentlyFollowing) {
      haptics.light();
      void setFollowingPerson(userId, true);
      return;
    }
    showActionSheet(undefined, undefined, [
      { text: 'Unfollow', style: 'destructive', onPress: () => { void setFollowingPerson(userId, false); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [setFollowingPerson, tracker]);

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const handleOpenMenu = useCallback((row: ActivityRow) => {
    const actor = row.actors[0];
    const buttons: { text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' }[] = [
      {
        text: 'See less',
        onPress: () => {
          setItems((prev) => prev.filter((item) => item.type !== row.type));
          void seeLessNotificationType(row.type).catch(() => { /* hidden locally either way */ });
        },
      },
    ];
    if (actor?.id) {
      buttons.push({
        text: 'Block',
        style: 'destructive',
        onPress: () => {
          haptics.warning();
          void blockUser({ userId: actor.id!, name: actor.name, handle: '', initials: actor.initials, color: actor.color ?? '#3F3F46' })
            .then(() => {
              setItems((prev) => prev.filter((item) => item.actorId !== actor.id));
              showToast('Blocked');
            })
            .catch(() => Alert.alert('Could not block', 'Please try again in a moment.'));
        },
      });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    showActionSheet(undefined, undefined, buttons);
  }, [showToast]);

  const renderItem = useCallback(({ item: row }: { item: ActivityRow }) => (
    <ActivityRowView
      row={row}
      unread={row.ids.some((id) => dotIdsRef.current.has(id))}
      now={now}
      styles={styles}
      followOverride={row.targetId ? followOverrides[row.targetId] : undefined}
      followPending={!!row.targetId && followPending.has(row.targetId)}
      onPress={handlePress}
      onDismiss={handleDismiss}
      onToggleFollow={handleToggleFollow}
      onOpenMenu={handleOpenMenu}
    />
  ), [followOverrides, followPending, handleDismiss, handleOpenMenu, handlePress, handleToggleFollow, now, styles]);

  const renderSectionHeader = useCallback(({ section }: { section: SellerActivitySection }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle} accessibilityRole="header" numberOfLines={1}>{section.title}</Text>
    </View>
  ), [styles]);

  const empty = sellerChipEmpty(chip);
  const errorMessage = errorKind === 'auth'
    ? 'Sign in again to see your activity.'
    : errorKind === 'server'
      ? "Brandthread couldn't load your activity right now. Try again shortly."
      : "Your activity couldn't load. Check your connection and try again.";

  return (
    <View style={styles.container}>
      <ScreenHeader title="Activity" divider={false} onBack={() => goBackOr(router, '/(tabs)/profile')} />
      <View style={styles.chipRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
          contentContainerStyle={styles.chipScrollContent}
        >
          {SELLER_ACTIVITY_CHIPS.map((c) => (
            <Chip
              key={c.key}
              label={c.label}
              selected={c.key === chip}
              onPress={() => setChip(c.key)}
              testID={`activity-chip-${c.key}`}
            />
          ))}
        </ScrollView>
      </View>

      {status === 'loading' ? (
        <SkeletonRows styles={styles} />
      ) : status === 'error' ? (
        <View style={styles.stateWrap}>
          <EmptyState
            icon={errorKind === 'auth' ? 'lock' : 'wifi-off'}
            variant="error"
            message={errorMessage}
            actionLabel="Try again"
            onAction={() => { void loadFirstPage('initial'); }}
          />
        </View>
      ) : (
        <SectionList
          ref={listRef}
          sections={sections}
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          extraData={dotIds}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onEndReached={() => { void loadMore(); }}
          onEndReachedThreshold={0.4}
          refreshControl={(
            <ThemedRefreshControl refreshing={refreshing} onRefresh={() => { void loadFirstPage('refresh'); }} />
          )}
          ListEmptyComponent={(
            <View style={styles.stateWrap}>
              <EmptyState
                icon={empty.icon as never}
                title={empty.title}
                message={empty.message}
                testID={`activity-empty-${chip}`}
                {...(chip === 'all' ? { illustration: 'bell' as const } : {})}
              />
            </View>
          )}
          ListFooterComponent={loadingMore ? (
            <View style={styles.footer}><ActivityIndicator color={theme.muted} /></View>
          ) : null}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: screenPadding.bottom + SP.xl },
            sections.length === 0 && styles.listContentEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          windowSize={9}
        />
      )}
      <CenteredToast message={toast} />
    </View>
  );
}
