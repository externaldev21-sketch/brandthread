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
import { useUser } from '@clerk/expo';
import { LinearGradient } from 'expo-linear-gradient';

import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useRole } from '@/contexts/RoleContext';
import { FONT, FS, GRAD_DARK_FADE, ICON, RADIUS, SP } from '@/lib/theme';
import { EmptyState, PageHeader, SkeletonBlock, useScreenPadding } from '@/components/layout';
import { useScrollReset } from '@/hooks/useScrollReset';
import { CachedImage } from '@/components/CachedImage';
import { PressableScale, useUndoToast } from '@/components/BrandthreadUI';
import { useBuyerTabBarTopInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { FollowPill } from '@/components/search/PersonRow';
import { ThemedRefreshControl } from '@/components/ui';
import { showActionSheet } from '@/components/ui/ActionSheet';
import SwipeableActions from '@/components/SwipeableActions';
import { RemoveFollowerSheet } from '@/components/social/RemoveFollowerSheet';
import { CenteredToast } from '@/components/social/CenteredToast';
import { Glass } from '@/components/ui/Glass';
import { LiveRowEnter } from '@/components/motion/LiveRowEnter';
import { findActivityArrivals } from '@/lib/activity';
import {
  deliverPreviewLiveArrival, hasPendingPreviewLiveArrival, PREVIEW_LIVE_ARRIVAL_DELAY_MS,
} from '@/lib/previewActivity';
import { ThreadCashBillIcon, THREAD_CASH_GREEN_MID } from '@/components/thread-cash/ThreadCashBill';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';
import { captureNotificationEvent } from '@/lib/notificationEventOutbox';
import { hapticPrimaryAction, hapticSuccessAction, hapticDestructiveConfirm } from '@/lib/haptics';
import {
  isPreviewActivityEnabled, getVisiblePreviewActivity, getPreviewSuggestedPeople, previewActorAvatarUri,
  isPreviewActivityId, markPreviewActivityDismissed,
} from '@/lib/previewActivity';
import { applyPreviewFollowState, getPreviewFollowing } from '@/lib/previewFollowStore';
import { Chip } from '@/components/ui/Chip';
import {
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_CHIPS,
  activityCategory,
  activityChipEmpty,
  matchesActivityChip,
  type ActivityChip,
  activityDetail,
  activityRowHref,
  activityIcon,
  followControlState,
  activityKind,
  activityMessage,
  applyRead,
  buildActivitySections,
  createReadTracker,
  createDeferredDelete,
  ACTIVITY_UNDO_MS,
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
import { setSellerFollowing, removeFollower, seeLessNotificationType, blockUser } from '@/services/socialService';

/** Within this many points of the top, live arrivals come straight in (item 84). */
const LIVE_TOP_SLOP = 48;
const AVATAR_SIZE = 40;

type Styles = ReturnType<typeof makeStyles>;
// Instagram's own Activity taxonomy (Highlights pinned, then Today /
// Yesterday / Last 7 days / Last 30 days) — see docs/activity-flows.md §1
// for why this is derived here rather than in lib/activity.ts's own
// (already-tested) New/Today/This week/This month/Earlier bucket keys.
type DisplaySectionKey = 'highlights' | 'today' | 'yesterday' | 'last_7_days' | 'last_30_days';
type ListSection = { key: DisplaySectionKey; title: string; items: ActivityRow[]; data: ActivityRow[] };
const DISPLAY_TITLES: Record<DisplaySectionKey, string> = {
  highlights: 'Highlights', today: 'Today', yesterday: 'Yesterday',
  last_7_days: 'Last 7 days', last_30_days: 'Last 30 days',
};

// ─── Filter chips ───────────────────────────────────────────────────────────
// A horizontally scrolling row of pill chips below the header — Threads'
// Activity tab (All / Replies / Mentions… over one feed:
// https://mobbin.com/screens/cb296e3d-df9e-4c48-a030-0f08248197d5,
// filtered: https://mobbin.com/screens/f19ed0eb-9ad1-4579-aa5f-dd9779fce52c).
// The chip set and what each one matches live in lib/activity.ts
// (ACTIVITY_CHIPS / matchesActivityChip). Selection is component state only.

/** One shared design-system Chip with a stable per-chip handler. */
const ActivityFilterChip = React.memo(function ActivityFilterChip({ chip, label, selected, onSelect }: {
  chip: ActivityChip;
  label: string;
  selected: boolean;
  onSelect: (key: ActivityChip) => void;
}) {
  const handlePress = useCallback(() => onSelect(chip), [chip, onSelect]);
  return <Chip label={label} selected={selected} onPress={handlePress} testID={`activity-chip-${chip}`} />;
});

function ActivityFilterChips({ selected, onSelect, styles }: {
  selected: ActivityChip;
  onSelect: (key: ActivityChip) => void;
  styles: Styles;
}) {
  return (
    // A plain View wrapper with an explicit height, not just the ScrollView's
    // own style — a horizontal ScrollView with no non-zero cross-axis height
    // of its own can collapse to nothing in this screen's flex column,
    // letting the SectionList below render through/over it.
    <View style={styles.chipRow}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        contentContainerStyle={styles.chipScrollContent}
      >
        {ACTIVITY_CHIPS.map((chip) => (
          <ActivityFilterChip
            key={chip.key}
            chip={chip.key}
            label={chip.label}
            selected={chip.key === selected}
            onSelect={onSelect}
          />
        ))}
      </ScrollView>
      {/* Hints that the row scrolls further — same right-edge fade pattern
          used on the seller Orders filter pills — instead of the last chip
          just cutting off with no visual cue. */}
      <LinearGradient
        pointerEvents="none"
        colors={GRAD_DARK_FADE}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 0 }}
        style={styles.chipFade}
      />
    </View>
  );
}

// ─── Activity type badge ────────────────────────────────────────────────────
// Small badge over the bottom-right of a row's avatar showing what kind of
// activity it is (mirrors the unread/online dot pattern used on inbox rows).

function ActivityTypeBadge({ row, styles }: { row: ActivityRow; styles: Styles }) {
  const { theme } = useAppTheme();
  // Thread Cash keeps its green — the one deliberate exception to Activity's
  // otherwise-monochrome rule (owner decision: LIVE red, end-call red, and
  // Thread Cash green are the only allowed accents). Every other badge below
  // stays monochrome.
  if (row.type === 'thread_cash_received') {
    return (
      <View style={styles.typeBadge}>
        <ThreadCashBillIcon size={14} />
      </View>
    );
  }
  let icon: string | null = null;
  let color = theme.accentLight;
  const category = activityCategory(row);
  if (category === 'follows') icon = 'user-plus';
  else if (category === 'likes') icon = 'heart';
  else if (category === 'comments') icon = 'message-circle';
  if (!icon) return null;
  return (
    <View style={styles.typeBadge}>
      <Feather name={icon as any} size={10} color={color} />
    </View>
  );
}

// ─── Avatars ──────────────────────────────────────────────────────────────────

function Avatar({ actor, size, styles }: {
  actor: ActivityActor;
  size: number;
  styles: Styles;
}) {
  const { theme } = useAppTheme();
  // Real avatar data first. Falls back to a preview-only photo from the
  // same asset pool the rest of the buyer preview uses (no-op for a real
  // account), then to a flat color-and-initials placeholder.
  const imageUri = actor.avatarUrl || previewActorAvatarUri(actor.id, actor.name);
  if (imageUri) {
    return (
      <CachedImage
        source={{ uri: imageUri }}
        style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: actor.color || theme.accent },
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
 * One actor: a single avatar with the small type badge. Exactly two actors
 * ("Jay and Mina liked your post"): Threads-style stacked double avatars,
 * still with the badge on the front (most recent) one. Three or more
 * ("Jay and 12 others…"): back to a single avatar — the "and N others" part
 * already lives in the row's text (`activityMessage`), so a deeper stack or
 * a "+N" chip would just repeat it in the chrome.
 */
function ActivityAvatarStack({ row, styles }: { row: ActivityRow; styles: Styles }) {
  const [first, second] = row.actors;
  if (!first) return null;
  if (row.actorCount === 2 && second) {
    return (
      <View style={styles.leading}>
        <View style={styles.stackBack}>
          <Avatar actor={second} size={AVATAR_SIZE * 0.7} styles={styles} />
        </View>
        <View style={styles.stackFront}>
          <Avatar actor={first} size={AVATAR_SIZE * 0.75} styles={styles} />
          <ActivityTypeBadge row={row} styles={styles} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.leading}>
      <Avatar actor={first} size={AVATAR_SIZE} styles={styles} />
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
  followOverride,
  followPending,
  onPress,
  onDismiss,
  onToggleFollow,
  onOpenMenu,
}: {
  row: ActivityRow;
  unread: boolean;
  now: number;
  styles: Styles;
  /** This session's follow/unfollow of the row's person, over the feed's state. */
  followOverride: boolean | undefined;
  followPending: boolean;
  onPress: (row: ActivityRow) => void;
  onDismiss: (row: ActivityRow) => void;
  onToggleFollow: (row: ActivityRow, currentlyFollowing: boolean) => void;
  onOpenMenu: (row: ActivityRow) => void;
}) {
  const { theme } = useAppTheme();
  const parts = activityMessage(row);
  const detail = activityDetail(row);
  // A follow row for a single person always shows a real Follow back /
  // Following pill instead of a generic icon (Instagram iOS Activity:
  // "bear.2123374 started following you. 6h [Follow back]",
  // https://mobbin.com/screens/1f627db9-fb0f-4870-b58d-35bec67239c7). Its
  // state is the server's live follow state (`isFollowingActor`), then this
  // session's own taps on top.
  const followControl = followControlState(row);
  const following = followControl ? (followOverride ?? followControl.following) : false;
  const showFollowControl = !!followControl;
  const handleFollowPress = useCallback(
    () => onToggleFollow(row, following),
    [following, onToggleFollow, row],
  );
  const sentence = parts.map((p) => p.text).join('');
  // "$5.00 · tap to view" → "+$5.00": the amount is the whole point of a
  // Thread Cash row, so it gets its own bold line (monochrome, theme text) instead of reading
  // like an ordinary detail caption.
  const cashAmount = row.type === 'thread_cash_received' ? row.body?.match(/\$[\d,.]+/)?.[0] : null;

  // Long-press opens the same "..." menu the swipe reveal does — Instagram
  // has no long-press affordance of its own on this row, but this app's
  // rows have historically supported long-press-for-options, and there's no
  // reason to drop that just because swipe now also reaches the menu.
  const longPress = () => onOpenMenu(row);

  // Trailing thumbnail (post/story image) vs the Follow control are mutually
  // exclusive, but both must render through the SAME sibling slot at the
  // `row` level — never nested inside `tapArea` — so every row's trailing
  // item lands on the identical right edge regardless of which one it is.
  const trailingThumb = showFollowControl || row.type === 'thread_cash_received'
    ? null
    : row.targetImageUrl ? (
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
    ) : null;

  // Swipe left reveals "..." (open the menu) then a red trash icon (delete
  // this notification) — Mobbin: "Instagram iOS Removing a follower" flow,
  // screen 1 (https://mobbin.com/screens/c404cbe7-e8c0-4b09-904c-62ba9d1b0a71).
  // Monochrome swap: Instagram's own row background for "...", theme.error
  // (not Instagram's red-on-red, but the same destructive semantic) for trash.
  const swipeActions = useMemo(() => [
    {
      key: 'more',
      icon: 'more-horizontal' as const,
      color: theme.cardElevated,
      iconColor: theme.text,
      accessibilityLabel: 'More options',
      onPress: () => onOpenMenu(row),
    },
    {
      key: 'delete',
      icon: 'trash-2' as const,
      color: theme.error,
      iconColor: '#FFFFFF',
      accessibilityLabel: 'Delete this notification',
      onPress: () => onDismiss(row),
    },
  ], [onDismiss, onOpenMenu, row, theme.cardElevated, theme.error, theme.text]);

  return (
    <SwipeableActions actions={swipeActions}>
    <View style={styles.row}>
      {/*
        The Follow back / Following control is a real interactive element,
        so it must be a sibling of the row's own tap target rather than
        nested inside it — two interactive `accessibilityRole="button"`
        elements one inside the other render as invalid nested <button>
        HTML on web (PR #118, re-applied here on top of this row's Threads
        redesign). Long-press for Dismiss lives on the tap target, not a
        swipe action — see the removed `SwipeActionRow` note above.
        Plain `Pressable`, not `PressableScale`: PressableScale only forwards
        an object/array `style` prop to its *inner* Animated.View, not the
        outer Pressable it renders — so `tapArea`'s `flex: 1` never reached
        the actual flex child of `row`, and text/thumbnails overflowed the
        screen edge instead of sharing the row's width. Plain Pressable has
        no such split, so the flex sizing below now applies for real.
      */}
      <Pressable
        style={({ pressed }) => [styles.tapArea, pressed && styles.tapAreaPressed]}
        onPress={() => onPress(row)}
        onLongPress={longPress}
        testID={`activity-row-${row.key}`}
        accessibilityRole="button"
        accessibilityLabel={`${unread ? 'Unread. ' : ''}${sentence}. ${relativeTime(row.createdAt, now)}`}
      >
        {row.actors.length > 0 ? (
          <ActivityAvatarStack row={row} styles={styles} />
        ) : (
          <View style={styles.leading}>
            <View style={styles.iconCircle}>
              {/* Thread Cash included — activityIcon gives it a monochrome
                  dollar-sign, not the green bill artwork. */}
              <Feather name={activityIcon(row) as any} size={ICON.md} color={theme.accentLight} />
            </View>
          </View>
        )}

        <View style={styles.center}>
          <Text style={styles.message} numberOfLines={2}>
            {parts.map((part, index) => (
              <Text key={index} style={part.bold ? styles.messageBold : styles.messageMuted}>{part.text}</Text>
            ))}
            <Text style={styles.time}>{'  '}{relativeTime(row.createdAt, now, { compact: true })}</Text>
          </Text>
          {cashAmount ? (
            <Text style={[styles.detail, styles.cashAmount]}>{`+${cashAmount}`}</Text>
          ) : detail ? (
            <Text style={styles.detail} numberOfLines={2}>{detail}</Text>
          ) : null}
        </View>
      </Pressable>

      {showFollowControl ? (
        // The shared Follow pill (components/search/PersonRow) — same one the
        // grouped "New followers" list uses — as a sibling of `tapArea`, so
        // tapping it never also opens the profile.
        <FollowPill
          following={following}
          followBack={!following}
          loading={followPending}
          onPress={handleFollowPress}
          accessibilityLabel={following
            ? `Following ${row.actors[0]?.name ?? ''}, tap to unfollow`
            : `Follow back ${row.actors[0]?.name ?? ''}`}
          testID={`activity-follow-${row.targetId}`}
        />
      ) : trailingThumb}
    </View>
    </SwipeableActions>
  );
});

function SkeletonRows({ styles }: { styles: Styles }) {
  return (
    <View style={styles.skeletonWrap} accessibilityLabel="Loading activity">
      <SkeletonBlock width={72} height={12} style={{ marginBottom: SP.md }} />
      {Array.from({ length: 7 }).map((_, index) => (
        <View key={index} style={styles.skeletonRow}>
          {/* Matches the real row's 40pt avatar / 44pt 8-radius thumbnail
              exactly, so there's no size jump when the real content lands. */}
          <SkeletonBlock width={AVATAR_SIZE} height={AVATAR_SIZE} radius={AVATAR_SIZE / 2} />
          <View style={{ flex: 1, gap: SP.xs + 2 }}>
            <SkeletonBlock width={index % 2 ? '72%' : '86%'} height={13} />
            <SkeletonBlock width={index % 3 ? '38%' : '52%'} height={11} />
          </View>
          <SkeletonBlock width={44} height={44} radius={8} />
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
        style={[styles.followBtn, followState === 'done' ? styles.followBtnFollowing : styles.followBtnNotFollowing]}
        disabled={followState !== 'idle'}
        onPress={() => onFollow(person)}
        accessibilityRole="button"
        accessibilityLabel={followState === 'done' ? 'Following' : `Follow ${person.name}`}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        {followState === 'pending' ? (
          <ActivityIndicator size="small" color="#000000" />
        ) : (
          <Text style={[styles.followText, followState === 'done' ? styles.followTextFollowing : styles.followTextNotFollowing]} numberOfLines={1}>
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
      <Text style={[styles.sectionTitle, styles.suggestedTitle]} accessibilityRole="header" numberOfLines={1} ellipsizeMode="tail">Suggested for you</Text>
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
  // The floating tab bar (and its shared frosted-glass zone — see
  // BuyerTabBar) is rendered above this screen even though it's a pushed
  // stack route, not a buyer-tab route itself — confirmed live: the last row
  // was sitting under it.
  // withTabBarInset: false — the list itself only reserves a small clearance
  // (not the full tab-bar height) so its rows scroll IN UNDER the glass
  // zone, like iOS, and are visible (softly, through blur) right up to the
  // bar instead of stopping in an empty reserved gap above it.
  const screenPadding = useScreenPadding({ withTabBarInset: false });
  const listRef = useScrollReset<SectionList<ActivityRow, ListSection>>();
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
  // Follow pill state on single-person follow rows, keyed by the person (not
  // the row), so every row for the same person agrees.
  const [followOverrides, setFollowOverrides] = useState<Record<string, boolean>>({});
  const [followPending, setFollowPending] = useState<ReadonlySet<string>>(() => new Set());
  const [removeFollowerTarget, setRemoveFollowerTarget] = useState<ActivityRow | null>(null);
  const [removingFollower, setRemovingFollower] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [suggested, setSuggested] = useState<SuggestedPerson[]>([]);
  const [suggestedFollowState, setSuggestedFollowState] = useState<Record<string, 'pending' | 'done'>>({});
  // Chip filter — component state only, not persisted across app restarts.
  const [chip, setChip] = useState<ActivityChip>('all');

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

  // ── Live arrivals (item 84) ────────────────────────────────────────────────
  // Rows that arrive while Activity is open (the ~1.5s realtime poll below,
  // or a pull-to-refresh) slide in at the top instead of just appearing.
  // Scrolled down the list, they're held back behind a "New activity" pill
  // (LinkedIn's "See notifications you missed") so nothing shifts under the
  // viewer's finger; the pill (or scrolling back up) brings them in.
  const [entering, setEntering] = useState<ReadonlySet<string>>(() => new Set());
  const [heldCount, setHeldCount] = useState(0);
  const heldRef = useRef<ActivityItem[] | null>(null);
  const scrollYRef = useRef(0);
  const showPage = useCallback((next: ActivityItem[], arrivals: readonly string[]) => {
    heldRef.current = null;
    setHeldCount(0);
    if (arrivals.length > 0) setEntering((prev) => new Set([...prev, ...arrivals]));
    setItems(next);
    setSessionNew(new Set(next.filter((item) => !item.isRead).map((item) => item.id)));
  }, []);
  /** Puts a freshly loaded first page on screen, animating whatever is new in it. */
  const applyPage = useCallback((next: ActivityItem[], mode: 'initial' | 'refresh' | 'focus') => {
    const arrivals = mode === 'initial' ? [] : findActivityArrivals(itemsRef.current, next);
    if (arrivals.length > 0 && scrollYRef.current > LIVE_TOP_SLOP) {
      heldRef.current = next;
      setHeldCount(arrivals.length);
      return;
    }
    showPage(next, arrivals);
  }, [showPage]);
  const revealHeld = useCallback(() => {
    const next = heldRef.current;
    if (!next) return;
    showPage(next, findActivityArrivals(itemsRef.current, next));
  }, [showPage]);
  const handleEntered = useCallback((row: ActivityRow) => {
    setEntering((prev) => {
      if (!row.ids.some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of row.ids) next.delete(id);
      return next;
    });
  }, []);
  // An arrival filtered out by the current chip never renders to clear
  // itself; don't let it animate later when the chip changes.
  useEffect(() => {
    if (entering.size === 0) return;
    const timer = setTimeout(() => setEntering(new Set()), 2000);
    return () => clearTimeout(timer);
  }, [entering]);

  // ── Swipe → trash, with Undo (item 83) ─────────────────────────────────────
  // The row leaves at once; the real DELETE waits out the Undo window (the
  // server delete is permanent, so Undo means "never sent"). Rows are kept
  // here so Undo — or a failed delete — can put them back in place.
  const { showUndo, dismissUndo } = useUndoToast();
  // Sit the toast just above the floating tab bar (both roles), not over it.
  const undoBottom = useBuyerTabBarTopInset() + SP.sm;
  const deletedRowsRef = useRef(new Map<string, ActivityItem>());
  const restoreRows = useCallback((ids: string[]) => {
    const back = ids.map((id) => deletedRowsRef.current.get(id)).filter((item): item is ActivityItem => !!item);
    for (const id of ids) deletedRowsRef.current.delete(id);
    if (back.length === 0) return;
    setItems((prev) => {
      const have = new Set(prev.map((item) => item.id));
      const merged = [...prev, ...back.filter((item) => !have.has(item.id))];
      return merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }, []);
  const deferredDelete = useMemo(() => createDeferredDelete({
    delayMs: ACTIVITY_UNDO_MS,
    commit: async (ids) => {
      const results = await Promise.allSettled(ids.map(async (id) => {
        // Seeded preview rows have no server copy — remember the delete locally.
        if (isPreviewActivityId(id)) { markPreviewActivityDismissed(id); return; }
        await dismissActivity(id);
      }));
      const failed = ids.filter((_, index) => results[index].status === 'rejected');
      for (const id of ids) if (!failed.includes(id)) deletedRowsRef.current.delete(id);
      return failed;
    },
    onFailed: (failed) => {
      restoreRows(failed);
      Alert.alert('Could not delete', 'Check your connection and try again.');
    },
  }), [restoreRows]);
  // Leaving Activity sends a waiting delete now rather than dropping it.
  const undoVisibleUntil = useRef(0);
  useEffect(() => () => {
    deferredDelete.flush();
    if (Date.now() < undoVisibleUntil.current) dismissUndo();
  }, [deferredDelete, dismissUndo]);
  const deferredDeleteRef = useRef(deferredDelete);
  deferredDeleteRef.current = deferredDelete;
  // …and so does leaving it without unmounting (the buyer's Activity is a
  // tab, and opening a row pushes on top): send the delete, drop the toast.
  useFocusEffect(useCallback(() => () => {
    deferredDeleteRef.current.flush();
    if (Date.now() < undoVisibleUntil.current) { undoVisibleUntil.current = 0; dismissUndo(); }
  }, [dismissUndo]));
  /** Drops rows whose delete is waiting or in flight, so a refresh can't bring them back. */
  const withoutPendingDeletes = (list: ActivityItem[]) => list.filter((item) => !deferredDeleteRef.current.isPending(item.id));

  // Seeded suggestions, with anyone already followed this preview session
  // (lib/previewFollowStore) shown as "Following" instead of "Follow" again.
  const showPreviewSuggestions = useCallback(() => {
    const people = getPreviewSuggestedPeople();
    setSuggested(people);
    setSuggestedFollowState((prev) => {
      const next = { ...prev };
      for (const person of people) {
        if (getPreviewFollowing(person.userId)) next[person.userId] = 'done';
      }
      return next;
    });
  }, []);

  const loadSuggested = useCallback(async () => {
    try {
      const people = await getSuggestedPeople();
      if (people.length > 0 || !isPreviewActivityEnabled()) { setSuggested(people); return; }
      showPreviewSuggestions();
    } catch {
      if (isPreviewActivityEnabled()) showPreviewSuggestions();
      else setSuggested([]);
    }
  }, [showPreviewSuggestions]);

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
      const resolved = withoutPendingDeletes(page.length === 0 && isPreviewActivityEnabled() ? applyPreviewFollowState(getVisiblePreviewActivity()) : page);
      applyPage(resolved, mode);
      setHasMore(page.length === ACTIVITY_PAGE_SIZE);
      setNow(Date.now());
      setStatus('ready');
    } catch (err) {
      if (id !== requestId.current) return;
      if (isPreviewActivityEnabled()) {
        // Never show a false error in the dev-web preview — there is no
        // backend to reach at all, so a fetch failure here is expected.
        retriedRef.current = false;
        const seeded = withoutPendingDeletes(applyPreviewFollowState(getVisiblePreviewActivity()));
        applyPage(seeded, mode);
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
  }, [applyPage]);

  // Preview only: the one simulated live event (lib/previewActivity), a few
  // seconds after Activity is first on screen — so the slide-in can be seen
  // in a preview that has no backend to send anything. It arrives through the
  // same first-page refresh a real event takes.
  useFocusEffect(useCallback(() => {
    if (status !== 'ready' || !hasPendingPreviewLiveArrival()) return;
    const timer = setTimeout(() => {
      if (deliverPreviewLiveArrival()) void loadFirstPage('focus');
    }, PREVIEW_LIVE_ARRIVAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loadFirstPage, status]));

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
        return [...prev, ...withoutPendingDeletes(page).filter((item) => !seen.has(item.id))];
      });
      setHasMore(page.length === ACTIVITY_PAGE_SIZE);
    } catch {
      // Leave hasMore set; scrolling again retries.
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, status]);

  const readIds = useMemo(() => new Set(items.filter((item) => item.isRead).map((item) => item.id)), [items]);

  // Client-side filtering of the already-loaded page — pagination
  // (loadMore/hasMore) keeps working against the unfiltered `items`, this
  // only narrows what's displayed. Order/payout updates stay out of "All"
  // (shopping noise doesn't belong next to likes/follows); the "Orders" chip
  // shows them as ordinary rows in the same list — see matchesActivityChip.
  const filteredItems = useMemo(
    () => items.filter((item) => matchesActivityChip(item, chip)),
    [items, chip],
  );
  const chipEmpty = activityChipEmpty(chip, role);
  const emptyActionHref = chipEmpty.action?.href;
  const handleEmptyAction = useCallback(() => {
    if (emptyActionHref) router.push(emptyActionHref as never);
  }, [emptyActionHref, router]);
  const emptyStateProps = {
    icon: chipEmpty.icon as any,
    title: chipEmpty.title,
    message: chipEmpty.message,
    actionLabel: chipEmpty.action?.label,
    onAction: chipEmpty.action ? handleEmptyAction : undefined,
    testID: `activity-empty-${chip}`,
  };

  const sections: ListSection[] = useMemo(() => {
    const raw = buildActivitySections(
      filteredItems.map((item) => (sessionNew.has(item.id) ? { ...item, isRead: false } : item)),
      new Date(now),
    );

    // Highlights: unread, single-actor, still-actionable follow-back rows —
    // pinned above everything else (Mobbin's Activity tab reference), pulled
    // out of whatever recency bucket they'd otherwise land in so they don't
    // also render a second time down in Today.
    const highlightIds = new Set<string>();
    const highlights: ActivityRow[] = [];
    for (const section of raw) {
      for (const row of section.items) {
        if (isFollowBackRow(row) && !highlights.some((h) => h.key === row.key)) {
          highlights.push(row);
          highlightIds.add(row.key);
        }
      }
    }

    // Today / Yesterday / Last 7 days / Last 30 days: New+Today fold into
    // Today; the "this week" bucket (1-6 days old) splits by calendar day
    // into Yesterday vs the rest of Last 7 days; This month + Earlier both
    // fold into Last 30 days (see docs/activity-flows.md §1).
    const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const yesterdayStart = dayStart(new Date(now - 24 * 60 * 60 * 1000));
    const todayStart = dayStart(new Date(now));

    const buckets: Record<Exclude<DisplaySectionKey, 'highlights'>, ActivityRow[]> = {
      today: [], yesterday: [], last_7_days: [], last_30_days: [],
    };
    for (const section of raw) {
      for (const row of section.items) {
        if (highlightIds.has(row.key)) continue;
        if (section.key === 'new' || section.key === 'today') {
          buckets.today.push(row);
        } else if (section.key === 'this_week') {
          const createdDay = dayStart(new Date(row.createdAt));
          if (createdDay >= yesterdayStart && createdDay < todayStart) buckets.yesterday.push(row);
          else buckets.last_7_days.push(row);
        } else {
          buckets.last_30_days.push(row);
        }
      }
    }

    const result: ListSection[] = [];
    if (highlights.length > 0) result.push({ key: 'highlights', title: DISPLAY_TITLES.highlights, items: highlights, data: highlights });
    (['today', 'yesterday', 'last_7_days', 'last_30_days'] as const).forEach((key) => {
      if (buckets[key].length > 0) result.push({ key, title: DISPLAY_TITLES[key], items: buckets[key], data: buckets[key] });
    });
    return result;
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
    // A merged row ("Jay and 12 others liked your post") opens the list of
    // those people — Instagram's "View likes" pattern, see app/activity-people.tsx.
    // Merged comment rows open the comments themselves (activityRowHref).
    const href = activityRowHref(row, role);
    if (href) router.push(href as never);
  }, [api, role, router, tracker, user?.id]);

  // Trash: the row goes now, "Notification deleted · Undo" shows, and the
  // server delete is sent when the Undo window closes (Mobbin: LinkedIn
  // https://mobbin.com/screens/25b887e8-1c04-4f3e-b83d-ab614dc4f83a,
  // OpenPhone https://mobbin.com/screens/969deed2-c091-402c-b4e1-d8ad3e5296f8).
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
      bottom: undoBottom,
      undo: () => {
        undoVisibleUntil.current = 0;
        if (deferredDelete.undo(token)) restoreRows(row.ids);
      },
    });
  }, [deferredDelete, restoreRows, showUndo, undoBottom]);

  // Follow back / unfollow from a follow row's inline pill — the same
  // POST/DELETE /api/social/follow every other Follow pill uses. Optimistic,
  // one request per person at a time, rolled back on failure.
  const followPendingRef = useRef(followPending);
  followPendingRef.current = followPending;
  const setFollowingPerson = useCallback(async (userId: string, next: boolean) => {
    if (followPendingRef.current.has(userId)) return;
    setFollowPending((prev) => new Set(prev).add(userId));
    setFollowOverrides((prev) => ({ ...prev, [userId]: next }));
    try {
      await setSellerFollowing(userId, next);
      if (next) hapticSuccessAction();
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
      hapticPrimaryAction();
      void setFollowingPerson(userId, true);
      return;
    }
    // "Following" → Instagram's two-option unfollow confirm, same as the
    // Following list (app/connections.tsx).
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

  // "See less" — mutes this row's notification type going forward (server-
  // persisted, see POST /api/social/see-less) and hides everything of that
  // type already on screen so the effect is visible immediately.
  const handleSeeLess = useCallback(async (row: ActivityRow) => {
    setItems((prev) => prev.filter((item) => item.type !== row.type));
    try {
      await seeLessNotificationType(row.type);
    } catch {
      // The row stays hidden locally even if the persisted preference failed
      // to save — not worth restoring noise the person just asked to lose.
    }
  }, []);

  // "Block" from the Activity "..." menu — reuses the same server endpoint
  // profile-level blocking uses. After blocking, that actor's activity must
  // also stop showing here (the server now filters it too, see
  // notifications-feed.ts), so every row from them is dropped immediately.
  const handleBlockFromMenu = useCallback(async (row: ActivityRow) => {
    const actor = row.actors[0];
    if (!actor?.id) return;
    hapticDestructiveConfirm();
    try {
      await blockUser({ userId: actor.id, name: actor.name, handle: '', initials: actor.initials, color: actor.color ?? '#3F3F46' });
      setItems((prev) => prev.filter((item) => item.actorId !== actor.id));
      showToast('Blocked');
    } catch {
      Alert.alert('Could not block', 'Please try again in a moment.');
    }
  }, [showToast]);

  // Instagram's "..." menu: See less always, Remove follower only on a
  // single-actor new-follower row, Block always (Mobbin: "Instagram iOS
  // Removing a follower" flow, screen 2 —
  // https://mobbin.com/screens/6b700e40-644a-4340-a924-613392e33b04).
  const handleOpenMenu = useCallback((row: ActivityRow) => {
    const actor = row.actors[0];
    const canRemoveFollower = row.type === 'new_follower' && row.actorCount === 1 && !!actor?.id;
    const buttons: { text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' }[] = [
      { text: 'See less', onPress: () => { void handleSeeLess(row); } },
    ];
    if (canRemoveFollower) {
      buttons.push({ text: 'Remove follower', style: 'destructive', onPress: () => setRemoveFollowerTarget(row) });
    }
    if (actor?.id) {
      buttons.push({ text: 'Block', style: 'destructive', onPress: () => { void handleBlockFromMenu(row); } });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    showActionSheet(undefined, undefined, buttons);
  }, [handleBlockFromMenu, handleSeeLess]);

  // Remove-follower confirm sheet's destructive "Remove" — Mobbin screens
  // 3/4 (confirm sheet) and 5 (the "Removed" toast + row state update):
  // https://mobbin.com/screens/11397cf3-a65b-41d1-9e13-9518ed5cc830
  // https://mobbin.com/screens/674b1826-5513-4f83-ad23-89b4454e2129
  const handleConfirmRemoveFollower = useCallback(async () => {
    const row = removeFollowerTarget;
    const actor = row?.actors[0];
    if (!row || !actor?.id) return;
    hapticDestructiveConfirm();
    setRemovingFollower(true);
    try {
      await removeFollower(actor.id);
      setItems((prev) => prev.filter((item) => item.actorId !== actor.id));
      setRemoveFollowerTarget(null);
      showToast('Removed');
    } catch {
      Alert.alert('Could not remove follower', 'Please try again in a moment.');
    } finally {
      setRemovingFollower(false);
    }
  }, [removeFollowerTarget, showToast]);

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
    <LiveRowEnter
      animate={row.ids.some((id) => entering.has(id))}
      onEntered={() => handleEntered(row)}
      testID={`activity-live-enter-${row.key}`}
    >
      <ActivityRowView
        row={row}
        unread={row.ids.some((id) => !readIds.has(id))}
        now={now}
        styles={styles}
        followOverride={row.targetId ? followOverrides[row.targetId] : undefined}
        followPending={!!row.targetId && followPending.has(row.targetId)}
        onPress={handlePress}
        onDismiss={handleDismiss}
        onToggleFollow={handleToggleFollow}
        onOpenMenu={handleOpenMenu}
      />
    </LiveRowEnter>
  ), [entering, followOverrides, followPending, handleDismiss, handleEntered, handleToggleFollow, handleOpenMenu, handlePress, now, readIds, styles]);

  // Scroll position, for holding live arrivals while the viewer is down the
  // list — and bringing them in once they're back at the top.
  const handleScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = event.nativeEvent.contentOffset.y;
    scrollYRef.current = y;
    if (y <= LIVE_TOP_SLOP && heldRef.current) revealHeld();
  }, [revealHeld]);

  // Where the list starts (below the header + chips) — the pill sits just there.
  const [listTop, setListTop] = useState(0);
  const handleHeaderLayout = useCallback((event: { nativeEvent: { layout: { y: number; height: number } } }) => {
    const { y, height } = event.nativeEvent.layout;
    setListTop(y + height);
  }, []);
  const livePillTop = listTop + SP.sm;

  const handleShowNewActivity = useCallback(() => {
    const node = listRef.current as any;
    const responder = node?.getScrollResponder?.();
    if (responder?.scrollTo) responder.scrollTo({ x: 0, y: 0, animated: true });
    else node?.scrollToLocation?.({ sectionIndex: 0, itemIndex: 0, viewOffset: 0, animated: true });
    scrollYRef.current = 0;
    revealHeld();
  }, [listRef, revealHeld]);

  const renderSectionHeader = useCallback(({ section }: { section: ListSection }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle} accessibilityRole="header" numberOfLines={1}>{section.title}</Text>
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
      {/* Unstyled wrapper, only to measure where the list starts (the
          "New activity" pill sits just below the header — item 84). */}
      <View onLayout={handleHeaderLayout}>
        <PageHeader
          title="Activity"
          showBack={false}
          largeTitle
          actions={hasUnread ? [{
            icon: 'check-circle',
            onPress: () => { void handleMarkAll(); },
            accessibilityLabel: 'Mark all activity as read',
          }] : []}
          belowTitle={<ActivityFilterChips selected={chip} onSelect={setChip} styles={styles} />}
        />
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
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onEndReached={() => { void loadMore(); }}
          onEndReachedThreshold={0.4}
          onScroll={handleScroll}
          scrollEventThrottle={32}
          refreshControl={(
            <ThemedRefreshControl
              refreshing={refreshing}
              onRefresh={() => { void loadFirstPage('refresh'); }}
            />
          )}
          ListEmptyComponent={(
            <View style={styles.stateWrap}>
              {/* A filter with nothing in it says so specifically, per role,
                  with one next step where there's a real one (item 85). */}
              {chip === 'all' ? (
                <EmptyState {...emptyStateProps} illustration="bell" />
              ) : (
                <EmptyState {...emptyStateProps} />
              )}
            </View>
          )}
          ListFooterComponent={listFooter}
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

      {/* Live arrivals held while scrolled down the list (item 84). Sits just
          under the header, over the list; Glass is only the pill's backdrop,
          so the pill itself is the one pressable. */}
      {heldCount > 0 && status === 'ready' ? (
        <View pointerEvents="box-none" style={[styles.livePillWrap, { top: livePillTop }]}>
          <PressableScale
            style={styles.livePill}
            onPress={handleShowNewActivity}
            accessibilityRole="button"
            accessibilityLabel={heldCount === 1 ? 'Show 1 new activity' : `Show ${heldCount} new activities`}
            testID="activity-new-pill"
            noMinHeight
          >
            <Glass variant="regular" tint="dark" radius={RADIUS.pill} style={StyleSheet.absoluteFill} />
            <Feather name="arrow-up" size={ICON.sm} color={theme.text} />
            <Text style={styles.livePillText}>New activity</Text>
          </PressableScale>
        </View>
      ) : null}

      {/* The frosted glass over the live list behind the floating tab bar —
          replacing the old opaque-black `GRAD_DARK_FADE` scrim, which read as
          a solid black bar swallowing the last row ("Vale Studio reposted
          your post" fading into black) instead of a soft, legible-through
          blur like iOS — is now rendered once, centrally, by BuyerTabBar
          itself rather than wired in per screen here. */}

      <RemoveFollowerSheet
        person={removeFollowerTarget ? {
          id: removeFollowerTarget.actors[0]?.id ?? '',
          name: removeFollowerTarget.actors[0]?.name ?? '',
          initials: removeFollowerTarget.actors[0]?.initials ?? '?',
          avatarUrl: removeFollowerTarget.actors[0]?.avatarUrl || previewActorAvatarUri(removeFollowerTarget.actors[0]?.id ?? '', removeFollowerTarget.actors[0]?.name ?? ''),
          color: removeFollowerTarget.actors[0]?.color,
        } : null}
        busy={removingFollower}
        onCancel={() => setRemoveFollowerTarget(null)}
        onConfirm={() => { void handleConfirmRemoveFollower(); }}
      />
      <CenteredToast message={toast} />
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
  // Rendered inside PageHeader's `belowTitle` slot, which applies the
  // screen's horizontal gutter to a non-scrolling wrapper — that insets the
  // ScrollView's own bounding box, but doesn't reliably reach all the way to
  // where its *scrollable content* starts on every platform. The standard
  // edge-to-edge-scroller fix: cancel belowTitle's gutter with a matching
  // negative margin so this ScrollView's box spans the full screen width
  // (so "All" can still scroll fully off the left edge once you've scrolled
  // right, and the last chip isn't artificially clipped early), then apply
  // the real 16pt inset via the content container itself, which a
  // ScrollView always honors for where its content begins.
  chipRow: {
    height: 36 + SP.sm,
    marginHorizontal: -SP.md,
    position: 'relative',
  },
  chipScrollContent: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    gap: SP.sm,
    alignItems: 'center',
  },
  // 16pt trailing inset (matches `chipScrollContent`'s own paddingHorizontal)
  // so the fade sits fully inside the last chip's own padding, not overlapping it.
  chipFade: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: SP.sm,
    width: SP.md,
  },
  sectionHeader: {
    paddingHorizontal: SP.md,
    paddingTop: 20,
    paddingBottom: SP.sm,
  },
  sectionTitle: {
    color: theme.text,
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    letterSpacing: -0.2,
  },

  // "New activity" pill (item 84): centred, floating just under the header.
  livePillWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    paddingHorizontal: SP.md,
    height: 36,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  livePillText: {
    color: theme.text,
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
  },

  // Avatar starts flush at the row's own 16pt padding — the same gutter as
  // the title and the filter chips. No leading gutter column of any kind.
  // `overflow: hidden` here is a last-resort backstop — with `tapArea` and
  // `center` both correctly set to shrink (see their own comments), nothing
  // should ever need clipping, but a row is never allowed to force the
  // screen to scroll horizontally no matter what a future change does here.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm + 4,
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    minHeight: 68,
    width: '100%',
    overflow: 'hidden',
    // Opaque — a transparent row let SwipeableActions' revealed "..."/trash
    // buttons (always rendered behind it, just off-screen at rest) show
    // through at the trailing edge on web, where CSS paints a `position:
    // absolute` sibling above a plain static one regardless of DOM order.
    backgroundColor: theme.background,
  },
  // The Follow back / Following control (or the trailing thumbnail — see
  // `trailingThumb` at the call site) renders as a sibling of this
  // Pressable, not nested inside it, so `tapArea` just needs to take the
  // remaining row width. `minWidth: 0` is required, not optional: a flex
  // item's default minimum size is its *content's own unwrapped width*, not
  // 0 — without this, `center`'s text below refused to shrink past its full
  // one-line width and pushed the avatar/thumbnail/button off the right
  // edge of the screen instead of wrapping.
  tapArea: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm + 4,
  },
  // A plain `Pressable` (not `PressableScale`, deliberately — see the note
  // above) has no built-in press feedback; this restores a subtle dim.
  tapAreaPressed: {
    opacity: 0.6,
  },
  leading: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  },
  // Threads-style stacked pair for a 2-actor row (see ActivityAvatarStack).
  stackBack: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  stackFront: {
    position: 'absolute',
    right: 0,
    bottom: 0,
  },
  // 16pt with a 2pt border colored to match the row background so it reads
  // as a clean cutout of the avatar, not a hard-edged sticker — and never
  // clipped: it's a sibling of the avatar inside `leading`/`stackFront`,
  // neither of which sets `overflow: hidden`.
  typeBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.cardElevated,
    borderWidth: 2,
    borderColor: theme.background,
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
  iconCircle: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: theme.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  center: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  message: {
    color: theme.text,
    fontFamily: FONT.regular,
    fontSize: FS.base,
    lineHeight: 20,
  },
  messageBold: {
    fontFamily: FONT.semibold,
    color: theme.text,
  },
  // The non-actor-name part of the sentence ("liked your post") reads as
  // gray, regular weight — only the actor's name is bold white.
  messageMuted: {
    color: theme.muted,
  },
  time: {
    color: theme.muted,
    fontFamily: FONT.regular,
    fontSize: FS.sm,
  },
  detail: {
    color: theme.muted,
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    lineHeight: 18,
  },
  // Thread Cash "+$5.00": bold, and green — the owner's one deliberate
  // exception to Activity's monochrome rule (allowed accents: LIVE red,
  // end-call red, and Thread Cash green). Every other detail line stays
  // theme-text monochrome.
  cashAmount: {
    color: THREAD_CASH_GREEN_MID,
    fontFamily: FONT.bold,
  },

  // Same right edge for every row whether the trailing item is this
  // thumbnail or the Follow pill below — both render through the one
  // sibling slot at the `row` level (see `trailingThumb` at the call site).
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: theme.cardElevated,
  },
  thumbFallback: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: theme.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Matches the shared FollowPill (components/search/PersonRow.tsx): fixed
  // white-fill/black-text pill, dark-outlined "Following" state — a neutral
  // follow affordance regardless of the active theme, same as everywhere
  // else this pill appears.
  followBtn: {
    minWidth: 88,
    height: 32,
    paddingHorizontal: SP.md,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followBtnNotFollowing: {
    backgroundColor: '#FFFFFF',
  },
  followBtnFollowing: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  followText: {
    fontFamily: FONT.semibold,
    fontSize: 14,
  },
  followTextNotFollowing: {
    color: '#000000',
  },
  followTextFollowing: {
    color: '#FFFFFF',
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
  // The title reuses the shared `sectionTitle` style (no horizontal padding
  // of its own) but sits in a section whose *rows* set their own
  // paddingHorizontal independently — so the title needs an explicit gutter
  // or it renders flush against the screen edge. (PR #118 fix, re-applied
  // on top of PR #123/#130's Threads-style rebuild of this section.)
  suggestedTitle: {
    paddingHorizontal: SP.md,
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

  bottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
