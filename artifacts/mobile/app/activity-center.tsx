/**
 * Activity — Threads-style: a pill filter row (All/Follows/Likes/Comments/
 * Thread Cash/Orders) over a single plain-background feed.
 *
 * Buyers see follows/follow-backs, likes on posts/videos/stories/highlights,
 * comments, replies, mentions, reposts, Thread Cash received, order updates
 * and, at the bottom, real "Suggested for you" people to follow. Sellers see
 * the same feed plus sales/payouts/inventory alerts. Both read the same
 * per-user notifications feed that powers push notifications (GET
 * /api/buyer/notifications), paged 30 at a time — see lib/activityEvents.ts
 * (api-server) for what writes to it. The "All" chip excludes order/payout
 * items (shopping noise doesn't belong next to likes/follows); the "Orders"
 * chip shows them as ordinary rows in the same list, no separate summary card.
 *
 * Rows are grouped Today / This week / Earlier (the underlying recency model
 * has a fifth bucket, unread-regardless-of-age "New", folded into Today
 * here); repeat likes, comments, reposts and follows merge into one row
 * ("Jay and 12 others liked your post") with stacked avatars. Unread rows
 * are marked read after they have been on screen for a moment. Swipe a row
 * left to dismiss it. There is no websocket/SSE layer in this codebase, so
 * `watchActivityRealtime` short-polls the tiny /unread-count endpoint while
 * this screen is focused and refetches the first page when something
 * changed — close enough to feel live (~1-2s) without new server infra.
 *
 * This is deliberately separate from buyer-notifications.tsx, which remains as
 * the classic notifications list.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
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
  relativeTime,
  type ActivityActor,
  type ActivityItem,
  type ActivityRow,
  type ActivitySection,
  type ActivitySectionKey,
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
/** Width of the in-flow unread-dot gutter that precedes every row's avatar. */
const ROW_GUTTER_WIDTH = 12;
const EMPTY_MESSAGE = "Activity will show up here. Likes, follows, comments and drops from brands you follow will land here.";

type Styles = ReturnType<typeof makeStyles>;
type ListSection = ActivitySection<ActivityRow> & { data: ActivityRow[] };

// ─── Filter chips ───────────────────────────────────────────────────────────
// A horizontally scrolling row of pill chips below the header, mirroring
// Threads' Activity tab. Selection is component state only (not persisted).

type ActivityChipKey = 'all' | 'follows' | 'likes' | 'comments' | 'thread_cash' | 'orders';

const ACTIVITY_CHIPS: { key: ActivityChipKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'follows', label: 'Follows' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'thread_cash', label: 'Thread Cash' },
  { key: 'orders', label: 'Orders' },
];

const FOLLOW_ROW_TYPES = new Set(['new_follower']);
const LIKE_ROW_TYPES = new Set(['post_like', 'story_like']);
const COMMENT_ROW_TYPES = new Set(['post_comment', 'comment_reply', 'mention']);
const THREAD_CASH_ROW_TYPES = new Set(['thread_cash_received']);

/** Which social item types belong to a given chip; `null` = no type filter (All). */
function chipTypeFilter(chip: ActivityChipKey): ReadonlySet<string> | null {
  switch (chip) {
    case 'follows': return FOLLOW_ROW_TYPES;
    case 'likes': return LIKE_ROW_TYPES;
    case 'comments': return COMMENT_ROW_TYPES;
    case 'thread_cash': return THREAD_CASH_ROW_TYPES;
    default: return null;
  }
}

function ActivityFilterChips({ selected, onSelect, styles }: {
  selected: ActivityChipKey;
  onSelect: (key: ActivityChipKey) => void;
  styles: Styles;
}) {
  const { theme } = useAppTheme();
  return (
    // A plain View wrapper with an explicit height, not just the ScrollView's
    // own style — a horizontal ScrollView with no non-zero cross-axis height
    // of its own can collapse to nothing in this screen's flex column,
    // letting the SectionList below render through/over it. Plain `Pressable`
    // (not `PressableScale`) here too, so there's no ambiguity about which
    // element in the tree actually carries the chip's visible style.
    <View style={styles.chipRow}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipScrollContent}
      >
        {ACTIVITY_CHIPS.map((chip) => {
          const isSelected = chip.key === selected;
          return (
            <Pressable
              key={chip.key}
              style={[
                styles.chip,
                isSelected
                  ? { backgroundColor: theme.cardElevated, borderColor: theme.border }
                  : { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.15)' },
              ]}
              onPress={() => onSelect(chip.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={chip.label}
            >
              <Text style={[styles.chipText, { color: isSelected ? theme.text : theme.muted }]} numberOfLines={1}>
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Activity type badge ────────────────────────────────────────────────────
// Small badge over the bottom-right of a row's avatar showing what kind of
// activity it is (mirrors the unread/online dot pattern used on inbox rows).

function ActivityTypeBadge({ row, styles }: { row: ActivityRow; styles: Styles }) {
  const { theme } = useAppTheme();
  if (row.type === 'thread_cash_received') {
    return (
      <View style={styles.typeBadgeBill}>
        <ThreadCashBill width={20} />
      </View>
    );
  }
  let icon: string | null = null;
  let color = theme.accentLight;
  if (FOLLOW_ROW_TYPES.has(row.type)) icon = 'user-plus';
  else if (LIKE_ROW_TYPES.has(row.type)) { icon = 'heart'; color = theme.error; }
  else if (COMMENT_ROW_TYPES.has(row.type)) icon = 'message-circle';
  if (!icon) return null;
  return (
    <View style={styles.typeBadge}>
      <Feather name={icon as any} size={10} color={color} />
    </View>
  );
}

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
        <ActivityTypeBadge row={row} styles={styles} />
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
      <ActivityTypeBadge row={row} styles={styles} />
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
  const sentence = parts.map((p) => p.text).join('');
  // "$5.00 · tap to view" → "+$5.00": the amount is the whole point of a
  // Thread Cash row, so it gets its own bold green line instead of reading
  // like an ordinary detail caption.
  const cashAmount = row.type === 'thread_cash_received' ? row.body?.match(/\$[\d,.]+/)?.[0] : null;

  return (
    <SwipeActionRow
      label="Dismiss"
      icon="trash-2"
      color={theme.error}
      onAction={() => onDismiss(row)}
      accessibilityLabel="Dismiss activity"
    >
      <PressableScale
        style={styles.row}
        onPress={() => onPress(row)}
        accessibilityRole="button"
        accessibilityLabel={`${unread ? 'Unread. ' : ''}${sentence}. ${relativeTime(row.createdAt, now)}`}
      >
        {/* In-flow gutter, not an absolutely-positioned dot — RN positions
            absolute children against the parent's border box, ignoring its
            padding, which is what put the old dot outside the row's padding
            (and outside the avatar) entirely. Always rendered so row
            alignment never shifts between read/unread. */}
        <View style={styles.unreadGutter}>
          {unread && <View style={styles.unreadDotSmall} />}
        </View>

        {row.actors.length > 0 ? (
          <ActivityAvatarStack row={row} styles={styles} ring={theme.background} />
        ) : (
          <View style={styles.leading}>
            <View style={styles.iconCircle}>
              {row.type === 'thread_cash_received' ? (
                <ThreadCashBill width={32} />
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
          {cashAmount ? (
            <Text style={[styles.detail, { color: theme.success, fontFamily: FONT.bold }]}>{`+${cashAmount}`}</Text>
          ) : detail ? (
            <Text style={styles.detail} numberOfLines={2}>{detail}</Text>
          ) : null}
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
              <ThreadCashBill width={28} />
            ) : (
              <Feather name={activityIcon(row) as any} size={ICON.sm} color={theme.muted} />
            )}
          </View>
        ) : null}
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
  // Chip filter — component state only, not persisted across app restarts.
  const [chip, setChip] = useState<ActivityChipKey>('all');

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

  // Order/payout updates stay out of the default "All" feed (shopping noise
  // doesn't belong next to likes/follows), but the "Orders" chip shows them
  // as ordinary rows in the same list — no separate summary card.
  const orderItems = useMemo(() => items.filter((item) => activityKind(item) === 'orders'), [items]);
  const socialItems = useMemo(() => items.filter((item) => activityKind(item) !== 'orders'), [items]);

  // Client-side filtering of the already-loaded page — pagination
  // (loadMore/hasMore) keeps working against the unfiltered `items`, this
  // only narrows what's displayed.
  const filteredItems = useMemo(() => {
    if (chip === 'orders') return orderItems;
    const typeFilter = chipTypeFilter(chip);
    if (!typeFilter) return socialItems;
    return socialItems.filter((item) => typeFilter.has(item.type));
  }, [socialItems, orderItems, chip]);

  const sections: ListSection[] = useMemo(() => {
    const raw = buildActivitySections(
      filteredItems.map((item) => (sessionNew.has(item.id) ? { ...item, isRead: false } : item)),
      new Date(now),
    );
    // Threads only has Today / This week / Earlier — fold the age-agnostic
    // "New" (unread) bucket into Today, and "This month" into Earlier,
    // rather than the underlying 5-bucket recency model's own labels.
    const merged = new Map<'today' | 'this_week' | 'earlier', ActivityRow[]>();
    const titles: Record<'today' | 'this_week' | 'earlier', string> = {
      today: 'Today', this_week: 'This week', earlier: 'Earlier',
    };
    const targetOf: Record<ActivitySectionKey, 'today' | 'this_week' | 'earlier'> = {
      new: 'today', today: 'today', this_week: 'this_week', this_month: 'earlier', earlier: 'earlier',
    };
    for (const section of raw) {
      const target = targetOf[section.key];
      merged.set(target, [...(merged.get(target) ?? []), ...section.items]);
    }
    return (['today', 'this_week', 'earlier'] as const)
      .filter((key) => (merged.get(key)?.length ?? 0) > 0)
      .map((key) => ({ key, title: titles[key], items: merged.get(key)!, data: merged.get(key)! }));
  }, [filteredItems, sessionNew, now]);

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

      <ActivityFilterChips selected={chip} onSelect={setChip} styles={styles} />

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
          ItemSeparatorComponent={() => <View style={styles.separator} />}
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
  // Explicit height on the wrapper (not just the ScrollView's own style) so
  // this row always reserves real vertical space in the screen's flex
  // column, however the horizontal ScrollView itself sizes on a given
  // platform — nothing below it can ever render through/over the chips.
  chipRow: {
    height: 36 + SP.sm * 2,
  },
  chipScrollContent: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    gap: SP.sm,
    alignItems: 'center',
  },
  chip: {
    height: 36,
    paddingHorizontal: SP.md,
    borderRadius: RADIUS.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
  },
  sectionHeader: {
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    paddingBottom: SP.sm,
  },
  sectionTitle: {
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
    paddingVertical: SP.md,
    minHeight: 68,
  },
  // In-flow unread indicator, rendered before the avatar column — see the
  // comment at its call site for why this replaced an absolutely-positioned
  // dot (RN ignores parent padding for absolute children, so that dot landed
  // outside both the row's padding and the avatar).
  unreadGutter: {
    width: ROW_GUTTER_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.accent,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.borderSubtle,
    marginLeft: ROW_GUTTER_WIDTH + (SP.sm + 4) + 44 + (SP.sm + 4),
  },
  leading: {
    width: 44,
    height: 44,
  },
  typeBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeBadgeBill: {
    position: 'absolute',
    right: -6,
    bottom: -4,
    paddingHorizontal: 2,
    paddingVertical: 2,
    borderRadius: RADIUS.xs,
    backgroundColor: theme.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
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
    height: 36,
    paddingHorizontal: SP.sm + 4,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followText: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
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
