/**
 * Activity — one place for everything that happened to you.
 *
 * Buyers see follows/follow-backs, likes on posts/videos/stories/highlights,
 * comments, replies, mentions, reposts, Thread Cash received, order updates
 * (collapsed into one "Orders" row) and, at the bottom, real "Suggested for
 * you" people to follow. Sellers see the same feed plus sales/payouts/
 * inventory alerts. Both read the same per-user notifications feed that
 * powers push notifications (GET /api/buyer/notifications), paged 30 at a
 * time — see lib/activityEvents.ts (api-server) for what writes to it.
 *
 * Rows are grouped New / Today / This week / This month / Earlier; repeat
 * likes, comments, reposts and follows merge into one row ("Jay and 12
 * others liked your post"). Unread rows are marked read after they have been
 * on screen for a moment. Swipe a row left to dismiss it. There is no
 * websocket/SSE layer in this codebase, so `watchActivityRealtime` short-
 * polls the tiny /unread-count endpoint while this screen is focused and
 * refetches the first page when something changed — close enough to feel
 * live (~1-2s) without new server infra.
 *
 * This is deliberately separate from buyer-notifications.tsx, which remains as
 * the classic notifications list.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SectionList,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@clerk/expo';

import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useRole } from '@/contexts/RoleContext';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { EmptyState, SkeletonBlock } from '@/components/layout';
import { TabPageHeader } from '@/components/layout/TabPageHeader';
import { CachedImage } from '@/components/CachedImage';
import { PressableScale } from '@/components/BrandthreadUI';
import { ThemedRefreshControl } from '@/components/ui';
import SwipeActionRow from '@/components/SwipeActionRow';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';
import { captureNotificationEvent } from '@/lib/notificationEventOutbox';
import { hapticPrimaryAction, hapticSuccessAction } from '@/lib/haptics';
import { isPreviewActivityEnabled, getPreviewActivity, getPreviewSuggestedPeople } from '@/lib/previewActivity';
import {
  ACTIVITY_PAGE_SIZE,
  activityDetail,
  activityHref,
  activityIcon,
  activityKind,
  activityMessage,
  applyRead,
  buildActivitySections,
  createReadTracker,
  isFollowBackRow,
  newFollowersSummary,
  relativeTime,
  type ActivityActor,
  type ActivityItem,
  type ActivityRow,
  type ActivitySection,
  type NewFollowersSummary,
} from '@/lib/activity';
import {
  dismissActivity,
  dismissSuggestedPerson,
  getActivity,
  getSuggestedPeople,
  markActivityRead,
  markAllActivityRead,
  watchActivityRealtime,
  type SuggestedPerson,
} from '@/services/activityService';
import { setSellerFollowing } from '@/services/socialService';
import { ThreadCashCoin } from '@/components/thread-cash/ThreadCashBill';

const EMPTY_ICON = 'activity' as const;
const EMPTY_MESSAGE = "Activity will show up here. Likes, follows, comments and drops from brands you follow will land here.";

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
        style={[styles.avatarText, { color: theme.onAccent, fontSize: size >= 40 ? FS.sm : FS.xs }]}
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
      <PressableScale
        style={[styles.row, { backgroundColor: rowBackground }]}
        onPress={() => onPress(row)}
        accessibilityRole="button"
        accessibilityLabel={`${unread ? 'Unread. ' : ''}${sentence}. ${relativeTime(row.createdAt, now)}`}
      >
        {row.actors.length > 0 ? (
          <ActivityAvatarStack row={row} styles={styles} ring={rowBackground} />
        ) : (
          <View style={styles.leading}>
            <View style={styles.iconCircle}>
              {row.type === 'thread_cash_received' ? (
                <ThreadCashCoin size={ICON.md} />
              ) : (
                <Feather name={activityIcon(row) as any} size={ICON.md} color={theme.accentLight} />
              )}
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
          <PressableScale
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
          </PressableScale>
        ) : row.targetImageUrl ? (
          <CachedImage
            source={{ uri: row.targetImageUrl }}
            style={styles.thumb}
            recyclingKey={row.key}
            accessibilityIgnoresInvertColors
          />
        ) : row.actors.length > 0 ? (
          <View style={styles.thumbFallback}>
            {row.type === 'thread_cash_received' ? (
              <ThreadCashCoin size={ICON.sm} />
            ) : (
              <Feather name={activityIcon(row) as any} size={ICON.sm} color={theme.muted} />
            )}
          </View>
        ) : null}

        {unread && <View style={styles.unreadDot} />}
      </PressableScale>
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

// ─── New followers summary ─────────────────────────────────────────────────
// A compact row (stacked avatars, "N new followers") above the dated
// sections — tapping it opens the full followers list. Mirrors Beli's
// "started following you" row and BeReal's requests row at the top.

function NewFollowersRow({ summary, styles, onPress }: {
  summary: NewFollowersSummary;
  styles: Styles;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const label = summary.count === 1 ? summary.actors[0]?.name ?? 'Someone' : `${summary.count} new followers`;
  return (
    <PressableScale style={styles.summaryRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={`New followers: ${label}`}>
      <View style={styles.summaryStack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {summary.actors.slice(0, 3).map((actor, index) => (
          <View key={actor.id ?? actor.name} style={[styles.summaryAvatarWrap, { left: index * 14, zIndex: 3 - index }]}>
            <Avatar actor={actor} size={32} styles={styles} ring={theme.background} />
          </View>
        ))}
      </View>
      <View style={styles.center}>
        <Text style={styles.message}>
          <Text style={styles.messageBold}>New followers</Text>
          {'  '}
          <Text style={styles.detail}>{label}</Text>
        </Text>
      </View>
      <Feather name="chevron-right" size={ICON.sm} color={theme.muted} />
      {summary.hasUnread && <View style={styles.unreadDot} />}
    </PressableScale>
  );
}

// ─── Orders summary ─────────────────────────────────────────────────────────
// Order/payout updates never appear individually in the social feed — one
// row links out to Orders, keeping shopping noise out of the Activity tab.

function OrdersRow({ count, hasUnread, styles, onPress }: {
  count: number;
  hasUnread: boolean;
  styles: Styles;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <PressableScale style={styles.summaryRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Orders, ${count} update${count === 1 ? '' : 's'}`}>
      <View style={[styles.leading, styles.iconCircle]}>
        <Feather name="package" size={ICON.md} color={theme.accentLight} />
      </View>
      <View style={styles.center}>
        <Text style={styles.message}>
          <Text style={styles.messageBold}>Orders</Text>
          {'  '}
          <Text style={styles.detail}>{count} update{count === 1 ? '' : 's'}</Text>
        </Text>
      </View>
      <Feather name="chevron-right" size={ICON.sm} color={theme.muted} />
      {hasUnread && <View style={styles.unreadDot} />}
    </PressableScale>
  );
}

// ─── Suggested for you ─────────────────────────────────────────────────────

function SuggestedRow({ person, followState, styles, onFollow, onDismiss }: {
  person: SuggestedPerson;
  followState: 'idle' | 'pending' | 'done';
  styles: Styles;
  onFollow: (person: SuggestedPerson) => void;
  onDismiss: (person: SuggestedPerson) => void;
}) {
  const { theme } = useAppTheme();
  const actor: ActivityActor = { id: person.userId, name: person.name, initials: person.initials, color: person.color };
  return (
    <View style={styles.suggestedRow}>
      <Avatar actor={actor} size={44} styles={styles} />
      <View style={styles.center}>
        <Text style={styles.message} numberOfLines={1}>{person.name}</Text>
        <Text style={styles.detail} numberOfLines={1}>{person.reason}</Text>
      </View>
      <PressableScale
        style={[
          styles.followBtn,
          followState === 'done'
            ? { backgroundColor: 'transparent', borderColor: theme.border }
            : { backgroundColor: theme.accent, borderColor: theme.accent },
        ]}
        disabled={followState !== 'idle'}
        onPress={() => onFollow(person)}
        accessibilityRole="button"
        accessibilityLabel={followState === 'done' ? 'Following' : `Follow ${person.name}`}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        {followState === 'pending' ? (
          <ActivityIndicator size="small" color={theme.onAccent} />
        ) : (
          <Text style={[styles.followText, { color: followState === 'done' ? theme.text : theme.onAccent }]} numberOfLines={1}>
            {followState === 'done' ? 'Following' : 'Follow'}
          </Text>
        )}
      </PressableScale>
      {followState !== 'done' && (
        <PressableScale
          style={styles.dismissBtn}
          onPress={() => onDismiss(person)}
          accessibilityRole="button"
          accessibilityLabel={`Not interested in ${person.name}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="x" size={ICON.sm} color={theme.muted} />
        </PressableScale>
      )}
    </View>
  );
}

function SuggestedForYouSection({ people, followStates, styles, onFollow, onDismiss }: {
  people: SuggestedPerson[];
  followStates: Record<string, 'pending' | 'done'>;
  styles: Styles;
  onFollow: (person: SuggestedPerson) => void;
  onDismiss: (person: SuggestedPerson) => void;
}) {
  if (people.length === 0) return null;
  return (
    <View style={styles.suggestedSection}>
      <Text style={styles.sectionTitle} accessibilityRole="header">Suggested for you</Text>
      {people.map((person) => (
        <SuggestedRow
          key={person.userId}
          person={person}
          followState={followStates[person.userId] ?? 'idle'}
          styles={styles}
          onFollow={onFollow}
          onDismiss={onDismiss}
        />
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

  const [items, setItems] = useState<ActivityItem[]>([]);
  // Ids that were unread when the page loaded. They stay in "New" for this
  // visit even after being marked read, so rows don't jump while you look at
  // them; the next refresh moves them to their dated section.
  const [sessionNew, setSessionNew] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorKind, setErrorKind] = useState<'auth' | 'offline' | 'server'>('offline');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [followStates, setFollowStates] = useState<Record<string, 'pending' | 'done'>>({});
  const [now, setNow] = useState(() => Date.now());
  const [suggested, setSuggested] = useState<SuggestedPerson[]>([]);
  const [suggestedFollowState, setSuggestedFollowState] = useState<Record<string, 'pending' | 'done'>>({});

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

  const loadSuggested = useCallback(async () => {
    try {
      const people = await getSuggestedPeople();
      if (people.length > 0 || !isPreviewActivityEnabled()) { setSuggested(people); return; }
      setSuggested(getPreviewSuggestedPeople());
    } catch {
      setSuggested(isPreviewActivityEnabled() ? getPreviewSuggestedPeople() : []);
    }
  }, []);

  const loadFirstPage = useCallback(async (mode: 'initial' | 'refresh' | 'focus') => {
    const id = ++requestId.current;
    if (mode === 'initial') setStatus('loading');
    if (mode === 'refresh') setRefreshing(true);
    try {
      const page = await getActivity({ limit: ACTIVITY_PAGE_SIZE, offset: 0 });
      if (id !== requestId.current) return;
      retriedRef.current = false;
      // The dev-web preview has no live backend to seed a real feed from —
      // show the same rich seeded world every other preview screen uses
      // instead of an empty "Activity will show up here".
      const resolved = page.length === 0 && isPreviewActivityEnabled() ? getPreviewActivity() : page;
      setItems(resolved);
      setSessionNew(new Set(resolved.filter((item) => !item.isRead).map((item) => item.id)));
      setHasMore(page.length === ACTIVITY_PAGE_SIZE);
      setNow(Date.now());
      setStatus('ready');
    } catch (err) {
      if (id !== requestId.current) return;
      if (isPreviewActivityEnabled()) {
        // Never show a false error in the dev-web preview — there is no
        // backend to reach at all, so a fetch failure here is expected.
        retriedRef.current = false;
        const seeded = getPreviewActivity();
        setItems(seeded);
        setSessionNew(new Set(seeded.filter((item) => !item.isRead).map((item) => item.id)));
        setHasMore(false);
        setNow(Date.now());
        setStatus('ready');
        return;
      }
      // Keep what's on screen if a background refresh fails.
      if (itemsRef.current.length > 0) { setStatus('ready'); return; }
      if (!retriedRef.current) {
        retriedRef.current = true;
        setTimeout(() => { void loadFirstPage(mode); }, 800);
        return;
      }
      const kind = err instanceof ApiError
        ? (err.status === 401 || err.status === 403 ? 'auth' : err.status >= 500 ? 'server' : 'offline')
        : 'offline';
      setErrorKind(kind);
      setStatus('error');
    } finally {
      if (id === requestId.current) setRefreshing(false);
    }
  }, []);

  // Runs on focus, and periodically while focused (no websocket/SSE layer —
  // see watchActivityRealtime's own comment).
  const loadedOnce = useRef(false);
  useFocusEffect(useCallback(() => {
    void loadFirstPage(loadedOnce.current ? 'focus' : 'initial');
    void loadSuggested();
    loadedOnce.current = true;

    const lastKnown = { current: '' };
    const realtime = watchActivityRealtime(() => {
      // Something changed server-side (a new event, or a read/dismiss from
      // another device) — quietly refresh the first page in place.
      void loadFirstPage('focus');
    });
    return () => realtime.stop();
  }, [loadFirstPage, loadSuggested]));

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || status !== 'ready') return;
    const id = requestId.current;
    setLoadingMore(true);
    try {
      // Dismissed rows are gone server-side, so the loaded count is the offset.
      const page = await getActivity({ limit: ACTIVITY_PAGE_SIZE, offset: itemsRef.current.length });
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
  }, [hasMore, loadingMore, status]);

  const readIds = useMemo(() => new Set(items.filter((item) => item.isRead).map((item) => item.id)), [items]);

  // Order updates are collapsed into a single "Orders" summary row instead of
  // appearing individually — keeps shopping noise out of the social feed.
  const orderItems = useMemo(() => items.filter((item) => activityKind(item) === 'orders'), [items]);
  const socialItems = useMemo(() => items.filter((item) => activityKind(item) !== 'orders'), [items]);
  const orderSummary = useMemo(() => (orderItems.length === 0 ? null : {
    count: orderItems.length,
    hasUnread: orderItems.some((item) => !item.isRead),
  }), [orderItems]);

  const followSummary: NewFollowersSummary | null = useMemo(
    () => newFollowersSummary(items.map((item) => (sessionNew.has(item.id) ? { ...item, isRead: false } : item))),
    [items, sessionNew],
  );

  const sections: ListSection[] = useMemo(() => buildActivitySections(
    socialItems.map((item) => (sessionNew.has(item.id) ? { ...item, isRead: false } : item)),
    new Date(now),
  ).map((section) => ({ ...section, data: section.items })), [socialItems, sessionNew, now]);

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
    hapticPrimaryAction();
    setFollowStates((prev) => ({ ...prev, [row.key]: 'pending' }));
    tracker.markNow(row.ids.filter((id) => !readIdsRef.current.has(id)));
    try {
      await setSellerFollowing(userId, true);
      hapticSuccessAction();
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
    hapticPrimaryAction();
    const previous = itemsRef.current;
    setItems((prev) => applyRead(prev, prev.map((item) => item.id)));
    try {
      await markAllActivityRead();
    } catch {
      setItems(previous);
    }
  }, []);

  const handleOrdersPress = useCallback(() => {
    const ids = orderItems.filter((item) => !item.isRead).map((item) => item.id);
    if (ids.length > 0) tracker.markNow(ids);
    router.push((role === 'seller' ? '/(tabs)/orders' : '/(buyer)/orders') as never);
  }, [orderItems, role, router, tracker]);

  const handleNewFollowersPress = useCallback(() => {
    const ids = items.filter((item) => item.type === 'new_follower' && !item.isRead).map((item) => item.id);
    if (ids.length > 0) tracker.markNow(ids);
    router.push('/connections?type=followers' as never);
  }, [items, router, tracker]);

  const handleSuggestedFollow = useCallback(async (person: SuggestedPerson) => {
    hapticPrimaryAction();
    setSuggestedFollowState((prev) => ({ ...prev, [person.userId]: 'pending' }));
    try {
      await setSellerFollowing(person.userId, true);
      hapticSuccessAction();
      setSuggestedFollowState((prev) => ({ ...prev, [person.userId]: 'done' }));
    } catch {
      setSuggestedFollowState((prev) => {
        const next = { ...prev };
        delete next[person.userId];
        return next;
      });
      Alert.alert('Could not follow', 'Please try again in a moment.');
    }
  }, []);

  const handleSuggestedDismiss = useCallback(async (person: SuggestedPerson) => {
    setSuggested((prev) => prev.filter((row) => row.userId !== person.userId));
    try {
      await dismissSuggestedPerson(person.userId);
    } catch {
      // Not worth restoring a dismissed suggestion over a transient failure.
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

  const errorMessage = errorKind === 'auth'
    ? "Sign in again to see your activity."
    : errorKind === 'server'
      ? "Brandthread couldn't load your activity right now. Try again shortly."
      : "Your activity couldn't load. Check your connection and try again.";

  const listHeader = (
    <>
      {followSummary && (
        <NewFollowersRow summary={followSummary} styles={styles} onPress={handleNewFollowersPress} />
      )}
      {orderSummary && (
        <OrdersRow count={orderSummary.count} hasUnread={orderSummary.hasUnread} styles={styles} onPress={handleOrdersPress} />
      )}
    </>
  );

  const listFooter = (
    <>
      {loadingMore && (
        <View style={styles.footer}>
          <ActivityIndicator color={theme.muted} />
        </View>
      )}
      <SuggestedForYouSection
        people={suggested}
        followStates={suggestedFollowState}
        styles={styles}
        onFollow={(p) => { void handleSuggestedFollow(p); }}
        onDismiss={(p) => { void handleSuggestedDismiss(p); }}
      />
    </>
  );

  return (
    <View style={styles.container}>
      <TabPageHeader
        title="Activity"
        actions={hasUnread ? [{
          name: 'check-circle',
          onPress: () => { void handleMarkAll(); },
          accessibilityLabel: 'Mark all activity as read',
        }] : []}
      />

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
            <ThemedRefreshControl
              refreshing={refreshing}
              onRefresh={() => { void loadFirstPage('refresh'); }}
            />
          )}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={(
            <View style={styles.stateWrap}>
              <EmptyState icon={EMPTY_ICON} message={EMPTY_MESSAGE} />
            </View>
          )}
          ListFooterComponent={listFooter}
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

  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm + 4,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm + 4,
    minHeight: 60,
  },
  summaryStack: {
    width: 58,
    height: 32,
  },
  summaryAvatarWrap: {
    position: 'absolute',
    top: 0,
  },

  suggestedSection: {
    marginTop: SP.md,
    paddingTop: SP.sm,
  },
  suggestedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm + 4,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm + 2,
    minHeight: 68,
  },
  dismissBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
