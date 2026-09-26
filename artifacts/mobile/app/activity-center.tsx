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
import { useUser } from '@clerk/expo';

import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useRole } from '@/contexts/RoleContext';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { EmptyState, SkeletonBlock } from '@/components/layout';
import { TabPageHeader } from '@/components/layout/TabPageHeader';
import { CachedImage } from '@/components/CachedImage';
import { PressableScale } from '@/components/BrandthreadUI';
import { Button, ThemedRefreshControl } from '@/components/ui';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
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
import { ThreadCashBill } from '@/components/thread-cash/ThreadCashBill';

const EMPTY_ICON = 'activity' as const;
const EMPTY_MESSAGE = "Activity will show up here. Likes, follows, comments and drops from brands you follow will land here.";

type Styles = ReturnType<typeof makeStyles>;
type ListSection = ActivitySection<ActivityRow> & { data: ActivityRow[] };

// ─── Avatars ──────────────────────────────────────────────────────────────────

/**
 * A real profile photo when one exists; otherwise a plain monochrome
 * initials circle (never the old per-actor hashed rainbow color — that read
 * as off-brand/noisy next to real photos).
 */
function Avatar({ actor, size, styles, ring }: {
  actor: ActivityActor;
  size: number;
  styles: Styles;
  ring?: string;
}) {
  const { theme } = useAppTheme();
  const ringStyle = ring ? { borderWidth: 2, borderColor: ring } : null;
  const dimensions = { width: size, height: size, borderRadius: size / 2 };

  if (actor.avatarUrl) {
    return (
      <View style={[dimensions, ringStyle, styles.avatarPhotoWrap]}>
        <CachedImage source={{ uri: actor.avatarUrl }} style={dimensions} accessibilityIgnoresInvertColors />
      </View>
    );
  }

  return (
    <View style={[styles.avatar, dimensions, { backgroundColor: theme.cardElevated }, ringStyle]}>
      <Text
        style={[styles.avatarText, { color: theme.muted, fontSize: size >= 40 ? FS.sm : FS.xs }]}
        allowFontScaling={false}
        numberOfLines={1}
      >
        {actor.initials}
      </Text>
    </View>
  );
}

/**
 * One actor: a full-size avatar. Two or more: a clean diagonal 2-avatar
 * stack (back top-left, front bottom-right, a ring around the front avatar
 * in the row's own background so the two read as separate circles instead
 * of a jumbled overlap), with a "+N" pill for anyone beyond them. Shared by
 * feed rows and the "New followers" summary row.
 */
function AvatarPair({ actors, hidden, styles, ring }: {
  actors: ActivityActor[];
  hidden: number;
  styles: Styles;
  ring: string;
}) {
  const [first, second] = actors;
  if (!first) return null;
  if (!second) {
    return (
      <View style={styles.leading}>
        <Avatar actor={first} size={44} styles={styles} />
      </View>
    );
  }
  return (
    <View style={styles.stackWrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.stackBack}>
        <Avatar actor={second} size={36} styles={styles} />
      </View>
      <View style={styles.stackFront}>
        <Avatar actor={first} size={36} styles={styles} ring={ring} />
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

function ActivityAvatarStack({ row, styles, ring }: { row: ActivityRow; styles: Styles; ring: string }) {
  return <AvatarPair actors={row.actors} hidden={row.actorCount - 2} styles={styles} ring={ring} />;
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
  // A follow row for a single person always shows a real Follow back /
  // Following state instead of a generic icon — even once it's mutual (cta
  // cleared), "Following" reads better than a bare person icon.
  const isSingleFollowRow = row.type === 'new_follower' && row.actorCount === 1 && !!row.targetId;
  const alreadyFollowing = isSingleFollowRow && !followBack;
  // The coin mark already carries the "$" glyph, so the trailing label is
  // just the number (no redundant second "$").
  const cashAmount = row.type === 'thread_cash_received' ? row.body?.match(/^\$([\d,.]+)/)?.[1] : null;
  const sentence = parts.map((p) => p.text).join('');

  return (
    <SwipeActionRow
      label="Dismiss"
      icon="trash-2"
      color={theme.error}
      onAction={() => onDismiss(row)}
      accessibilityLabel="Dismiss activity"
    >
      <View style={styles.row}>
        {/*
          The Follow back / Following button is a real interactive control
          (components/ui/Button), so it must be a sibling of the row's own
          tap target rather than nested inside it — two interactive
          `accessibilityRole="button"` elements one inside the other render
          as invalid nested <button> HTML on web.

          PressableScale only forwards a plain style object to its INNER
          Animated.View, never to the outer Pressable/<button> itself (see
          its own implementation) — so the shrink-to-fit-the-row constraint
          has to live on a wrapping plain View instead, or the unconstrained
          <button> renders at its content width and overflows the screen.
        */}
        <View style={styles.tapAreaWrap}>
        <PressableScale
          style={styles.tapArea}
          onPress={() => onPress(row)}
          accessibilityRole="button"
          accessibilityLabel={`${unread ? 'Unread. ' : ''}${sentence}. ${relativeTime(row.createdAt, now)}`}
        >
          {row.actors.length > 0 ? (
            <ActivityAvatarStack row={row} styles={styles} ring={theme.background} />
          ) : (
            <View style={styles.leading}>
              <View style={styles.iconCircle}>
                {row.type === 'thread_cash_received' ? (
                  <ThreadCashBill width={ICON.md} />
                ) : (
                  <Feather name={activityIcon(row) as any} size={ICON.md} color={theme.accentLight} />
                )}
              </View>
            </View>
          )}

          <View style={styles.center}>
            <Text style={styles.message} numberOfLines={3}>
              {parts.map((part, index) => (
                <Text key={index} style={part.bold || unread ? styles.messageBold : undefined}>{part.text}</Text>
              ))}
              <Text style={styles.time}>
                {'  '}
                {unread && <Text style={{ color: theme.accent }}>{'• '}</Text>}
                {relativeTime(row.createdAt, now, { compact: true })}
              </Text>
            </Text>
            {detail ? <Text style={styles.detail} numberOfLines={2}>{detail}</Text> : null}
          </View>

          {/* Follows never show a generic icon box — a single follower gets
              the real Follow back / Following button (rendered as a sibling
              below); a merged multi-follower row shows nothing trailing. */}
          {row.type === 'new_follower' ? null : row.type === 'thread_cash_received' ? (
            <View style={styles.cashTrailing}>
              <ThreadCashBill width={18} />
              {cashAmount ? <Text style={styles.cashAmount} numberOfLines={1}>{cashAmount}</Text> : null}
            </View>
          ) : row.targetImageUrl ? (
            <View style={styles.thumbClip}>
              <CachedImage
                source={{ uri: row.targetImageUrl }}
                style={styles.thumb}
                recyclingKey={row.key}
                accessibilityIgnoresInvertColors
              />
            </View>
          ) : row.actors.length > 0 ? (
            <View style={styles.thumbFallback}>
              <Feather name={activityIcon(row) as any} size={ICON.sm} color={theme.muted} />
            </View>
          ) : null}
        </PressableScale>
        </View>

        {isSingleFollowRow && (
          <Button
            label={alreadyFollowing || followState === 'done' ? 'Following' : 'Follow back'}
            variant={alreadyFollowing || followState === 'done' ? 'secondary' : 'primary'}
            size="compact"
            loading={followState === 'pending'}
            disabled={alreadyFollowing || followState !== 'idle'}
            onPress={() => onFollowBack(row)}
            accessibilityLabel={alreadyFollowing || followState === 'done' ? 'Following' : `Follow back ${row.actors[0]?.name ?? ''}`}
          />
        )}
      </View>
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
      <AvatarPair actors={summary.actors} hidden={Math.max(0, summary.count - 2)} styles={styles} ring={theme.background} />
      <View style={styles.center}>
        <Text style={styles.message}>
          <Text style={styles.messageBold}>New followers</Text>
          {'  '}
          <Text style={styles.detail}>{label}</Text>
          {summary.hasUnread && <Text style={{ color: theme.accent }}>{'  •'}</Text>}
        </Text>
      </View>
      <Feather name="chevron-right" size={ICON.sm} color={theme.muted} />
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
          {hasUnread && <Text style={{ color: theme.accent }}>{'  •'}</Text>}
        </Text>
      </View>
      <Feather name="chevron-right" size={ICON.sm} color={theme.muted} />
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
  const actor: ActivityActor = { id: person.userId, name: person.name, initials: person.initials, color: person.color, avatarUrl: person.avatarUrl ?? undefined };
  return (
    <View style={styles.suggestedRow}>
      <Avatar actor={actor} size={44} styles={styles} />
      <View style={styles.center}>
        <Text style={styles.message} numberOfLines={1}>{person.name}</Text>
        <Text style={styles.detail} numberOfLines={1}>{person.reason}</Text>
      </View>
      <Button
        label={followState === 'done' ? 'Following' : 'Follow'}
        variant={followState === 'done' ? 'secondary' : 'primary'}
        size="compact"
        loading={followState === 'pending'}
        disabled={followState !== 'idle'}
        onPress={() => onFollow(person)}
        accessibilityLabel={followState === 'done' ? 'Following' : `Follow ${person.name}`}
      />
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

function SuggestedForYouSection({ people, followStates, styles, onFollow, onDismiss, onSeeAll }: {
  people: SuggestedPerson[];
  followStates: Record<string, 'pending' | 'done'>;
  styles: Styles;
  onFollow: (person: SuggestedPerson) => void;
  onDismiss: (person: SuggestedPerson) => void;
  onSeeAll: () => void;
}) {
  const { theme } = useAppTheme();
  if (people.length === 0) return null;
  return (
    <View style={styles.suggestedSection}>
      <View style={styles.suggestedHeaderRow}>
        <Text style={[styles.sectionTitle, styles.suggestedTitle]} accessibilityRole="header" numberOfLines={1} ellipsizeMode="tail">Suggested for you</Text>
        <PressableScale onPress={onSeeAll} accessibilityRole="button" accessibilityLabel="See all suggested people" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.detail, { color: theme.accent }]} numberOfLines={1}>See all</Text>
        </PressableScale>
      </View>
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
  const tabBarInset = useBuyerTabBarInset();
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
      <Text style={styles.sectionTitle} accessibilityRole="header" numberOfLines={1} ellipsizeMode="tail">{section.title}</Text>
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
        onSeeAll={() => router.push('/buyer-friend-requests?tab=suggested' as never)}
      />
    </>
  );

  return (
    <View style={styles.container}>
      <TabPageHeader
        title="Activity"
        actions={hasUnread ? [{
          name: 'check',
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
            { paddingBottom: tabBarInset + SP.md },
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
    paddingTop: SP.lg - 4,
    paddingBottom: SP.sm,
  },
  sectionTitle: {
    flex: 1,
    color: theme.text,
    fontFamily: FONT.bold,
    fontSize: FS.md,
    letterSpacing: -0.2,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm + 4,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm + 2,
    minHeight: 64,
    backgroundColor: theme.background,
  },
  // The shrink-to-fit-the-row constraint lives here, not on `tapArea` — see
  // the comment at its call site (PressableScale forwards a plain style
  // object only to its inner Animated.View, never to the outer <button>).
  tapAreaWrap: {
    flex: 1,
    flexBasis: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  tapArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm + 4,
  },
  leading: {
    width: 44,
    height: 44,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPhotoWrap: {
    overflow: 'hidden',
  },
  avatarText: {
    fontFamily: FONT.bold,
    letterSpacing: 0.2,
  },
  // A back+front diagonal pair: back top-left, front bottom-right, sized to
  // fit both plus the front avatar's ring without clipping.
  stackWrap: {
    width: 50,
    height: 50,
  },
  stackBack: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  stackFront: {
    position: 'absolute',
    left: 14,
    top: 14,
  },
  moreChip: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderWidth: 2,
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
    alignItems: 'center',
    justifyContent: 'center',
  },

  center: {
    flex: 1,
    flexBasis: 0,
    flexShrink: 1,
    minWidth: 0,
    overflow: 'hidden',
    gap: 2,
  },
  message: {
    color: theme.text,
    fontFamily: FONT.regular,
    fontSize: FS.sm + 1,
    lineHeight: 19,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '100%',
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

  thumbClip: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.xs,
    overflow: 'hidden',
  },
  thumb: {
    width: 44,
    height: 44,
  },
  thumbFallback: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.xs,
    backgroundColor: theme.cardElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
  },
  cashAmount: {
    color: theme.text,
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
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
    minHeight: 64,
  },

  suggestedSection: {
    marginTop: SP.md,
    paddingTop: SP.sm,
  },
  // This section's own row (below) sets its own paddingHorizontal, so the
  // header row needs its own gutter here rather than reusing the shared
  // `sectionHeader` wrapper — without it the title sat flush against the
  // screen edges (no left/right gutter) and could clip.
  suggestedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingTop: SP.lg - 4,
    paddingBottom: SP.sm,
  },
  suggestedTitle: {
    flex: 1,
  },
  suggestedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm + 4,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm + 2,
    minHeight: 64,
  },
  dismissBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
