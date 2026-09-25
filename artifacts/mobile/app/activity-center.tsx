/**
 * Activity Center — one place for everything that happened to you.
 *
 * Buyers see likes, comments, mentions, follows, price drops and restocks on
 * saved items, new products from followed brands, and order updates. Sellers
 * see sales, payouts, inventory alerts and social activity. Both read the same
 * per-user notifications feed that powers push notifications
 * (GET /api/buyer/notifications), paged 30 at a time.
 *
 * Rows are grouped New / Today / This week / Earlier; repeat likes, comments
 * and follows merge into one row ("Jay and 12 others liked your post"). Unread
 * rows are marked read after they have been on screen for a moment. Swipe a row
 * left to dismiss it.
 *
 * This is deliberately separate from buyer-notifications.tsx, which remains as
 * the classic notifications list.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewToken,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useUser } from '@clerk/expo';

import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useRole } from '@/contexts/RoleContext';
import { FONT, FS, ICON, ON_DARK, RADIUS, SP } from '@/lib/theme';
import { Header, SkeletonBlock } from '@/components/layout';
import { EmptyState } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import SwipeActionRow from '@/components/SwipeActionRow';
import { useApi } from '@/lib/api';
import { captureNotificationEvent } from '@/lib/notificationEventOutbox';
import {
  ACTIVITY_FILTERS,
  ACTIVITY_PAGE_SIZE,
  activityDetail,
  activityHref,
  activityIcon,
  activityMessage,
  applyRead,
  buildActivitySections,
  createReadTracker,
  isFollowBackRow,
  relativeTime,
  type ActivityActor,
  type ActivityFilter,
  type ActivityItem,
  type ActivityRow,
  type ActivitySection,
} from '@/lib/activity';
import {
  dismissActivity,
  getActivity,
  markActivityRead,
  markAllActivityRead,
} from '@/services/activityService';
import { setSellerFollowing } from '@/services/socialService';

const EMPTY_COPY: Record<ActivityFilter, { icon: 'activity' | 'package' | 'heart'; title: string; description: string }> = {
  all: {
    icon: 'activity',
    title: 'Nothing has happened yet',
    description: 'Likes, follows, orders and drops from brands you follow will land here.',
  },
  orders: {
    icon: 'package',
    title: 'No order activity yet',
    description: 'Sales, shipping updates and payouts will show up here.',
  },
  social: {
    icon: 'heart',
    title: 'No social activity yet',
    description: 'Follow a few brands and share a post to get things moving.',
  },
};

type Styles = ReturnType<typeof makeStyles>;
type ListSection = ActivitySection<ActivityRow> & { data: ActivityRow[] };

// ─── Avatars ──────────────────────────────────────────────────────────────────

function Avatar({ actor, size, styles, ring }: {
  actor: ActivityActor;
  size: number;
  styles: Styles;
  ring?: string;
}) {
  const { theme } = useAppTheme();
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: actor.color || theme.accent,
        },
        ring ? { borderWidth: 2, borderColor: ring } : null,
      ]}
    >
      <Text
        style={[styles.avatarText, { fontSize: size >= 40 ? FS.sm : FS.xs }]}
        allowFontScaling={false}
        numberOfLines={1}
      >
        {actor.initials}
      </Text>
    </View>
  );
}

/**
 * One actor: a full-size avatar. Two or more: two overlapping avatars, with a
 * "+N" chip for anyone beyond them.
 */
function ActivityAvatarStack({ row, styles, ring }: { row: ActivityRow; styles: Styles; ring: string }) {
  const [first, second] = row.actors;
  if (!first) return null;
  if (!second) {
    return (
      <View style={styles.leading}>
        <Avatar actor={first} size={44} styles={styles} />
      </View>
    );
  }
  const hidden = row.actorCount - 2;
  return (
    <View style={styles.leading} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.stackBack}>
        <Avatar actor={second} size={30} styles={styles} />
      </View>
      <View style={styles.stackFront}>
        <Avatar actor={first} size={32} styles={styles} ring={ring} />
      </View>
      {hidden > 0 && (
        <View style={[styles.moreChip, { borderColor: ring }]}>
          <Text style={styles.moreChipText} allowFontScaling={false}>
            +{hidden > 99 ? '99' : hidden}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

const ActivityRowView = React.memo(function ActivityRowView({
  row,
  unread,
  now,
  styles,
  followState,
  onPress,
  onDismiss,
  onFollowBack,
}: {
  row: ActivityRow;
  unread: boolean;
  now: number;
  styles: Styles;
  followState: 'idle' | 'pending' | 'done';
  onPress: (row: ActivityRow) => void;
  onDismiss: (row: ActivityRow) => void;
  onFollowBack: (row: ActivityRow) => void;
}) {
  const { theme } = useAppTheme();
  const parts = activityMessage(row);
  const detail = activityDetail(row);
  const followBack = isFollowBackRow(row);
  const rowBackground = unread ? theme.card : theme.background;
  const sentence = parts.map((p) => p.text).join('');

  return (
    <SwipeActionRow
      label="Dismiss"
      icon="trash-2"
      color={theme.error}
      onAction={() => onDismiss(row)}
      accessibilityLabel="Dismiss activity"
    >
      <TouchableOpacity
        style={[styles.row, { backgroundColor: rowBackground }]}
        activeOpacity={0.75}
        onPress={() => onPress(row)}
        accessibilityRole="button"
        accessibilityLabel={`${unread ? 'Unread. ' : ''}${sentence}. ${relativeTime(row.createdAt, now)}`}
      >
        {row.actors.length > 0 ? (
          <ActivityAvatarStack row={row} styles={styles} ring={rowBackground} />
        ) : (
          <View style={styles.leading}>
            <View style={styles.iconCircle}>
              <Feather name={activityIcon(row) as any} size={ICON.md} color={theme.accentLight} />
            </View>
          </View>
        )}

        <View style={styles.center}>
          <Text style={styles.message} numberOfLines={3}>
            {parts.map((part, index) => (
              <Text key={index} style={part.bold ? styles.messageBold : undefined}>{part.text}</Text>
            ))}
            <Text style={styles.time}>{'  '}{relativeTime(row.createdAt, now, { compact: true })}</Text>
          </Text>
          {detail ? <Text style={styles.detail} numberOfLines={2}>{detail}</Text> : null}
        </View>

        {followBack ? (
          <TouchableOpacity
            style={[
              styles.followBtn,
              followState === 'done'
                ? { backgroundColor: 'transparent', borderColor: theme.border }
                : { backgroundColor: theme.accent, borderColor: theme.accent },
            ]}
            disabled={followState !== 'idle'}
            onPress={() => onFollowBack(row)}
            accessibilityRole="button"
            accessibilityLabel={followState === 'done' ? 'Following' : `Follow back ${row.actors[0]?.name ?? ''}`}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            {followState === 'pending' ? (
              <ActivityIndicator size="small" color={theme.onAccent} />
            ) : (
              <Text
                style={[styles.followText, { color: followState === 'done' ? theme.text : theme.onAccent }]}
                numberOfLines={1}
              >
                {followState === 'done' ? 'Following' : 'Follow back'}
              </Text>
            )}
          </TouchableOpacity>
        ) : row.targetImageUrl ? (
          <CachedImage
            source={{ uri: row.targetImageUrl }}
            style={styles.thumb}
            recyclingKey={row.key}
            accessibilityIgnoresInvertColors
          />
        ) : row.actors.length > 0 ? (
          <View style={styles.thumbFallback}>
            <Feather name={activityIcon(row) as any} size={ICON.sm} color={theme.muted} />
          </View>
        ) : null}

        {unread && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    </SwipeActionRow>
  );
});

function SkeletonRows({ styles }: { styles: Styles }) {
  return (
    <View style={styles.skeletonWrap} accessibilityLabel="Loading activity">
      <SkeletonBlock width={72} height={12} style={{ marginBottom: SP.md }} />
      {Array.from({ length: 7 }).map((_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <SkeletonBlock width={44} height={44} radius={22} />
          <View style={{ flex: 1, gap: SP.xs + 2 }}>
            <SkeletonBlock width={index % 2 ? '72%' : '86%'} height={13} />
            <SkeletonBlock width={index % 3 ? '38%' : '52%'} height={11} />
          </View>
          <SkeletonBlock width={44} height={44} radius={RADIUS.xs} />
        </View>
      ))}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ActivityCenterScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { role } = useRole();
  const api = useApi();
  const { user } = useUser();

  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [items, setItems] = useState<ActivityItem[]>([]);
  // Ids that were unread when the page loaded. They stay in "New" for this
  // visit even after being marked read, so rows don't jump while you look at
  // them; the next refresh moves them to their dated section.
  const [sessionNew, setSessionNew] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [followStates, setFollowStates] = useState<Record<string, 'pending' | 'done'>>({});
  const [now, setNow] = useState(() => Date.now());

  const requestId = useRef(0);
  const itemsRef = useRef<ActivityItem[]>([]);
  itemsRef.current = items;

  const tracker = useMemo(() => createReadTracker({
    markRead: markActivityRead,
    dwellMs: 600,
    onMarked: (ids) => setItems((prev) => applyRead(prev, ids)),
  }), []);
  useEffect(() => () => tracker.dispose(), [tracker]);

  const loadFirstPage = useCallback(async (mode: 'initial' | 'refresh' | 'focus') => {
    const id = ++requestId.current;
    if (mode === 'initial') setStatus('loading');
    if (mode === 'refresh') setRefreshing(true);
    try {
      const page = await getActivity({ limit: ACTIVITY_PAGE_SIZE, offset: 0, filter });
      if (id !== requestId.current) return;
      setItems(page);
      setSessionNew(new Set(page.filter((item) => !item.isRead).map((item) => item.id)));
      setHasMore(page.length === ACTIVITY_PAGE_SIZE);
      setNow(Date.now());
      setStatus('ready');
    } catch {
      if (id !== requestId.current) return;
      // Keep what's on screen if a background refresh fails.
      setStatus((current) => (current === 'ready' && itemsRef.current.length > 0 ? 'ready' : 'error'));
    } finally {
      if (id === requestId.current) setRefreshing(false);
    }
  }, [filter]);

  // Runs on focus, and again whenever the filter (and so loadFirstPage)
  // changes while the screen is focused.
  const loadedOnce = useRef(false);
  useFocusEffect(useCallback(() => {
    void loadFirstPage(loadedOnce.current ? 'focus' : 'initial');
    loadedOnce.current = true;
  }, [loadFirstPage]));

  const changeFilter = useCallback((next: ActivityFilter) => {
    if (next === filter) return;
    Haptics.selectionAsync().catch(() => {});
    setItems([]);
    setHasMore(true);
    setStatus('loading');
    loadedOnce.current = false;
    setFilter(next);
  }, [filter]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || status !== 'ready') return;
    const id = requestId.current;
    setLoadingMore(true);
    try {
      // Dismissed rows are gone server-side, so the loaded count is the offset.
      const page = await getActivity({ limit: ACTIVITY_PAGE_SIZE, offset: itemsRef.current.length, filter });
      if (id !== requestId.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        return [...prev, ...page.filter((item) => !seen.has(item.id))];
      });
      setHasMore(page.length === ACTIVITY_PAGE_SIZE);
    } catch {
      // Leave hasMore set; scrolling again retries.
    } finally {
      setLoadingMore(false);
    }
  }, [filter, hasMore, loadingMore, status]);

  const readIds = useMemo(() => new Set(items.filter((item) => item.isRead).map((item) => item.id)), [items]);

  const sections: ListSection[] = useMemo(() => buildActivitySections(
    items.map((item) => (sessionNew.has(item.id) ? { ...item, isRead: false } : item)),
    new Date(now),
  ).map((section) => ({ ...section, data: section.items })), [items, sessionNew, now]);

  const hasUnread = items.some((item) => !item.isRead);

  // ── Mark as read on view ───────────────────────────────────────────────────
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 150 }).current;
  const readIdsRef = useRef(readIds);
  readIdsRef.current = readIds;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const visible: string[] = [];
    for (const token of viewableItems) {
      const row = token.item as ActivityRow | undefined;
      if (!row?.ids) continue;
      for (const id of row.ids) if (!readIdsRef.current.has(id)) visible.push(id);
    }
    tracker.setVisible(visible);
  }).current;

  // ── Actions ────────────────────────────────────────────────────────────────
  const handlePress = useCallback((row: ActivityRow) => {
    void captureNotificationEvent(api, user?.id, {
      notificationId: row.id,
      eventType: 'tap',
      occurredAt: new Date().toISOString(),
    }).catch(() => {
      // Navigation must not depend on analytics.
    });
    tracker.markNow(row.ids.filter((id) => !readIdsRef.current.has(id)));
    const href = activityHref(row, role);
    if (href) router.push(href as never);
  }, [api, role, router, tracker, user?.id]);

  const handleDismiss = useCallback(async (row: ActivityRow) => {
    const removed = new Set(row.ids);
    const snapshot = itemsRef.current;
    setItems((prev) => prev.filter((item) => !removed.has(item.id)));
    const results = await Promise.allSettled(row.ids.map((id) => dismissActivity(id)));
    const failed = row.ids.filter((_, index) => results[index].status === 'rejected');
    if (failed.length > 0) {
      const failedSet = new Set(failed);
      setItems((prev) => {
        const restored = snapshot.filter((item) => failedSet.has(item.id));
        const merged = [...prev, ...restored];
        return merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
      Alert.alert('Could not dismiss', 'Check your connection and try again.');
    }
  }, []);

  const handleFollowBack = useCallback(async (row: ActivityRow) => {
    const userId = row.targetId;
    if (!userId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setFollowStates((prev) => ({ ...prev, [row.key]: 'pending' }));
    tracker.markNow(row.ids.filter((id) => !readIdsRef.current.has(id)));
    try {
      await setSellerFollowing(userId, true);
      setFollowStates((prev) => ({ ...prev, [row.key]: 'done' }));
    } catch {
      setFollowStates((prev) => {
        const next = { ...prev };
        delete next[row.key];
        return next;
      });
      Alert.alert('Could not follow', 'Please try again in a moment.');
    }
  }, [tracker]);

  const handleMarkAll = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const previous = itemsRef.current;
    setItems((prev) => applyRead(prev, prev.map((item) => item.id)));
    try {
      await markAllActivityRead();
    } catch {
      setItems(previous);
    }
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  const renderItem = useCallback(({ item: row }: { item: ActivityRow }) => (
    <ActivityRowView
      row={row}
      unread={row.ids.some((id) => !readIds.has(id))}
      now={now}
      styles={styles}
      followState={followStates[row.key] ?? 'idle'}
      onPress={handlePress}
      onDismiss={handleDismiss}
      onFollowBack={handleFollowBack}
    />
  ), [followStates, handleDismiss, handleFollowBack, handlePress, now, readIds, styles]);

  const renderSectionHeader = useCallback(({ section }: { section: ListSection }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{section.title}</Text>
    </View>
  ), [styles]);

  const empty = EMPTY_COPY[filter];

  return (
    <View style={styles.container}>
      <Header
        title="Activity"
        actions={hasUnread ? [{
          icon: 'check-circle',
          onPress: () => { void handleMarkAll(); },
          accessibilityLabel: 'Mark all activity as read',
        }] : []}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipRow}
        accessibilityRole="tablist"
      >
        {ACTIVITY_FILTERS.map((chip) => {
          const active = chip.key === filter;
          return (
            <TouchableOpacity
              key={chip.key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => changeFilter(chip.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              hitSlop={{ top: 6, bottom: 6 }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{chip.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {status === 'loading' ? (
        <SkeletonRows styles={styles} />
      ) : status === 'error' ? (
        <View style={styles.stateWrap}>
          <EmptyState
            icon="wifi-off"
            title="Your activity couldn't load"
            description="Check your connection and try again."
            action={{ label: 'Try again', onPress: () => { void loadFirstPage('initial'); } }}
          />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onEndReached={() => { void loadMore(); }}
          onEndReachedThreshold={0.4}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { void loadFirstPage('refresh'); }}
              tintColor={theme.muted}
              colors={[theme.accent]}
            />
          )}
          ListEmptyComponent={(
            <View style={styles.stateWrap}>
              <EmptyState icon={empty.icon} title={empty.title} description={empty.description} />
            </View>
          )}
          ListFooterComponent={loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator color={theme.muted} />
            </View>
          ) : null}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + SP.xl },
            sections.length === 0 && styles.listContentEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          windowSize={9}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },

  // Filter chips: intentionally quiet so the title stays the focal point.
  chipScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  chipRow: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    gap: SP.xs,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: SP.sm + 4,
    paddingVertical: SP.xs + 2,
    borderRadius: RADIUS.pill,
  },
  chipActive: {
    backgroundColor: theme.card,
  },
  chipText: {
    color: theme.subtle,
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },
  chipTextActive: {
    color: theme.text,
  },

  listContent: {
    paddingTop: SP.xs,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  sectionHeader: {
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    paddingBottom: SP.sm,
  },
  sectionTitle: {
    color: theme.text,
    fontFamily: FONT.bold,
    fontSize: FS.base,
    letterSpacing: -0.2,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm + 4,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm + 2,
    minHeight: 68,
  },
  leading: {
    width: 44,
    height: 44,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: ON_DARK,
    fontFamily: FONT.bold,
    letterSpacing: 0.2,
  },
  stackBack: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  stackFront: {
    position: 'absolute',
    right: -2,
    bottom: -2,
  },
  moreChip: {
    position: 'absolute',
    left: -4,
    bottom: -3,
    minWidth: 22,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 1.5,
    backgroundColor: theme.cardElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreChipText: {
    color: theme.text,
    fontFamily: FONT.semibold,
    fontSize: 10,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  center: {
    flex: 1,
    gap: 2,
  },
  message: {
    color: theme.text,
    fontFamily: FONT.regular,
    fontSize: FS.sm + 1,
    lineHeight: 19,
  },
  messageBold: {
    fontFamily: FONT.semibold,
  },
  time: {
    color: theme.subtle,
    fontFamily: FONT.regular,
    fontSize: FS.sm,
  },
  detail: {
    color: theme.muted,
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    lineHeight: 18,
  },

  thumb: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.xs,
    backgroundColor: theme.cardElevated,
  },
  thumbFallback: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.xs,
    backgroundColor: theme.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followBtn: {
    minWidth: 96,
    height: 32,
    paddingHorizontal: SP.sm + 4,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followText: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
  },
  unreadDot: {
    position: 'absolute',
    left: 6,
    top: '50%',
    marginTop: -3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.accent,
  },

  skeletonWrap: {
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm + 4,
    paddingVertical: SP.sm + 2,
  },
  stateWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: SP.xxl,
  },
  footer: {
    paddingVertical: SP.lg,
  },
});
