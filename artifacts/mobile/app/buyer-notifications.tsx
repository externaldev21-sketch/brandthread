import { hapticDestructiveConfirm, hapticToggle, haptics, haptic } from '@/lib/haptics';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

import { View, Text, FlatList, Alert, StyleSheet } from 'react-native';

import { LONG_LIST_TUNING } from '@/lib/listTuning';

import { Icon } from '@/components/ui/Icon';

import { LinearGradient } from 'expo-linear-gradient';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFocusEffect, useRouter } from 'expo-router';

import { FONT, ICON } from '@/lib/theme';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { getNotifications, markNotificationRead, markNotificationUnread, deleteNotification, muteNotificationCategory, clearAllReadNotifications, subscribeSocial } from '@/services/socialService';

import type { Notification, NotificationCategory } from '@/services/socialTypes';
import { BrandedLoadingState, EmptyState, PressableScale, ThreadDivider } from '@/components/BrandthreadUI';

import { ScreenHeader } from '@/components/ScreenHeader';

import { Chip, MenuSheet } from '@/components/ui';

import { TYPE_SCALE } from '@/constants/typography';

import { SPACING } from '@/constants/spacing';

import { RADII } from '@/constants/radii';


import SwipeRow from '@/components/ui/SwipeRow';

import SwipeActionRow from '@/components/SwipeActionRow';
import { useApi } from '@/lib/api';

import { captureNotificationEvent } from '@/lib/notificationEventOutbox';

import { syncNotificationBadge } from '@/lib/notificationBadge';

import { useUser } from '@clerk/expo';
import { groupByRecency, unreadRowTint } from '@/lib/activity';

import { isBuyerDevPreview } from '@/lib/devPreview';

import { getPreviewNotifications } from '@/lib/previewInbox';

import { ErrorState } from '@/components/ui/ErrorState';

import { fmtRelativeDay } from '@/lib/format';

import { ChipRow } from '@/components/ui/ChipRow';
import { activityHref } from '@/lib/activity';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  return fmtRelativeDay(iso);
}

type GroupSection = string;

// New / Today / This week / Earlier — the same sections as the Activity
// Center (lib/activity.ts groupByRecency).
function groupByDate(notifs: Notification[]): { section: GroupSection; items: Notification[] }[] {
  return groupByRecency(notifs).map((group) => ({ section: group.title, items: group.items }));
}

function notifIcon(type: Notification['type']): string {
  switch (type) {
    case 'friend_request': return 'user-plus';
    case 'friend_accepted': return 'user-check';
    case 'post_like': return 'heart';
    case 'post_comment': return 'message-circle';
    case 'repost': return 'repeat';
    case 'mention': return 'at-sign';
    case 'story_mention': return 'at-sign';
    case 'story_reshare': return 'repeat';
    case 'story_reaction': return 'zap';
    case 'story_reply': return 'message-square';
    case 'new_follower': return 'user-plus';
    case 'order_confirmed': return 'check-circle';
    case 'order_shipped': return 'truck';
    case 'order_delivered': return 'package';
    case 'order_cancelled': return 'x-circle';
    case 'order_delay': return 'alert-triangle';
    case 'order_out_for_delivery': return 'truck';
    case 'order_preparing': return 'box';
    case 'order_auto_refunded': return 'rotate-ccw';
    case 'order_refund_warning': return 'clock';
    case 'order_exception': return 'alert-triangle';
    case 'order_returned_to_sender': return 'corner-up-left';
    case 'drop_live':
    case 'drop_early_access': return 'zap';
    case 'live_reminder':
    case 'live_started': return 'video';
    case 'product_restocked': return 'refresh-cw';
    case 'bag_restock':
    case 'size_back': return 'refresh-cw';
    case 'price_drop': return 'trending-down';
    case 'digest': return 'layers';
    case 'order_anniversary': return 'calendar';
    case 'saved_product_update': return 'bookmark';
    case 'new_friend_message': return 'message-circle';
    case 'new_order_message': return 'package';
    case 'message_request': return 'inbox';
    case 'system': return 'info';
    case 'marketing': return 'gift';
    default: return 'bell';
  }
}

function notifIconColor(
  cat: NotificationCategory,
  theme: { accent: string; accentLight: string; success: string; warning: string; muted: string },
): string {
  switch (cat) {
    case 'social': return theme.accent;
    case 'orders': return theme.accentLight;
    case 'messages': return theme.accent;
    case 'seller_updates': return theme.success;
    case 'products': return theme.warning;
    case 'marketing': return theme.warning;
    case 'system': return theme.muted;
    default: return theme.muted;
  }
}

function categoryLabel(cat: NotificationCategory): string {
  switch (cat) {
    case 'social': return 'Social';
    case 'orders': return 'Orders';
    case 'messages': return 'Messages';
    case 'seller_updates': return 'Seller updates';
    case 'products': return 'Products';
    case 'marketing': return 'Offers';
    case 'system': return 'System';
    default: return 'These';
  }
}

function notifNavigation(notif: Notification, router: ReturnType<typeof useRouter>): void {
  // Server notifications can target shared manufacturer orders. Resolve these
  // first so list taps agree with native push/deep-link routing.
  if (notif.targetId && notif.targetType === 'sample_order') {
    router.push(('/sample-detail?id=' + encodeURIComponent(notif.targetId)) as any);
    return;
  }
  if (notif.targetId && notif.targetType === 'bulk_order') {
    router.push(('/production-detail?id=' + encodeURIComponent(notif.targetId)) as any);
    return;
  }
  if (notif.targetId && notif.targetType === 'manufacturer_thread') {
    router.push(('/manufacturer-messages?threadId=' + encodeURIComponent(notif.targetId)) as any);
    return;
  }
  if (notif.targetId && notif.targetType === 'buyer_order') {
    router.push(('/buyer-order-detail?id=' + encodeURIComponent(notif.targetId) + (notif.type === 'review_request' ? '&review=1' : '')) as any);
    return;
  }
  switch (notif.type) {
    case 'friend_request':
    case 'follow_request':
      router.push('/buyer-friend-requests' as any);
      break;
    case 'order_confirmed':
    case 'order_processing':
    case 'order_production':
    case 'order_shipped':
    case 'order_delivered':
    case 'order_cancelled':
    case 'order_delay':
    case 'order_out_for_delivery':
    case 'order_preparing':
    case 'order_auto_refunded':
    case 'order_refund_warning':
    case 'order_exception':
    case 'order_returned_to_sender':
    case 'return_update':
    case 'refund_update':
    case 'dispute_update':
      // navigate (not push): these are the buyer's tab roots — push always
      // adds a new stack entry even when the tab is already mounted with its
      // own history, which both duplicates it and breaks that tab's back
      // behavior. navigate reuses the existing tab instance and its stack.
      router.navigate('/(buyer)/orders' as any);
      break;
    case 'live_started':
      router.push((notif.targetId ? `/live?streamId=${encodeURIComponent(notif.targetId)}` : '/live') as any);
      break;
    case 'live_reminder':
      router.push('/live' as any);
      break;
    case 'bag_restock':
    case 'size_back':
      if (notif.targetId) {
        router.push(`/buyer-product-detail?productId=${encodeURIComponent(notif.targetId)}` as any);
        break;
      }
      router.navigate('/(buyer)/discover' as any);
      break;
    case 'drop_early_access':
      // A seller gave this buyer early access (Customers > Superfans): open the drop.
      router.push((notif.targetId ? `/buyer-drop-detail?id=${encodeURIComponent(notif.targetId)}` : '/(buyer)/discover') as any);
      break;
    case 'drop_live':
    case 'product_restocked':
    case 'price_drop':
    case 'saved_product_update':
      router.navigate('/(buyer)/discover' as any);
      break;
    case 'digest':
    case 'order_anniversary': {
      // Same destination as the push: Home's Following tab, or the brand's profile.
      const href = activityHref(notif);
      if (href) router.push(href as any);
      else router.navigate('/(buyer)/inbox' as any);
      break;
    }
    case 'new_friend_message':
    case 'new_order_message':
    case 'new_seller_reply':
      if (notif.targetId) {
        router.push(('/buyer-conversation?id=' + notif.targetId) as any);
      } else {
        router.navigate('/(buyer)/inbox' as any);
      }
      break;
    case 'story_reaction':
    case 'story_reply':
      if (notif.targetId) {
        router.push(
          ('/buyer-story-viewer?storyId=' + notif.targetId + '&allStoryIds=' + notif.targetId) as any,
        );
      } else {
        router.navigate('/(buyer)/friends' as any);
      }
      break;
    default:
      router.navigate('/(buyer)/inbox' as any);
      break;
  }
}

// ─── Category Pill Config ─────────────────────────────────────────────────────

type PillItem = { label: string; value: NotificationCategory | undefined };
const PILLS: PillItem[] = [
  { label: 'All', value: undefined },
  { label: 'Social', value: 'social' },
  { label: 'Orders', value: 'orders' },
  { label: 'Messages', value: 'messages' },
  { label: 'Products', value: 'products' },
  { label: 'System', value: 'system' },
  { label: 'Marketing', value: 'marketing' },
];

// ─── Flat List Item Types ─────────────────────────────────────────────────────

type ListItem =
  | { type: 'header'; title: GroupSection }
  | { type: 'item'; notif: Notification };

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function BuyerNotifications() {
  const { theme } = useAppTheme();
  const styles = makeStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { user } = useUser();

  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<NotificationCategory | undefined>(undefined);
  const [filterEdges, setFilterEdges] = useState({ left: false, right: false });
  const filterViewport = useRef(0);
  const filterContent = useRef(0);
  const filterOffset = useRef(0);
  const updateFilterEdges = useCallback(() => {
    const left = filterOffset.current > 2;
    const right = filterContent.current - filterViewport.current - filterOffset.current > 2;
    setFilterEdges(previous =>
      previous.left === left && previous.right === right ? previous : { left, right },
    );
  }, []);
  const [notifLoading, setNotifLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [optionsFor, setOptionsFor] = useState<Notification | null>(null);
  const [notifFailed, setNotifFailed] = useState(false);

  // Only the very first load shows the full-screen loader. Focus refocuses and
  // realtime socket events after that refresh the list silently so the loader
  // doesn't flash over content that's already on screen.
  const hasLoadedOnce = useRef(false);

  const loadNotifs = useCallback(async () => {
    if (!hasLoadedOnce.current) setNotifLoading(true);
    // The signed-out dev preview has no account to fetch for — show its
    // seeded list (demo) or nothing (fresh) instead of calling the
    // protected endpoint and waiting on it.
    if (isBuyerDevPreview()) {
      setNotifs(getPreviewNotifications());
      setLoadError(false);
      hasLoadedOnce.current = true;
      setNotifLoading(false);
      return;
    }
    try {
      const data = await getNotifications();
      setNotifs(data);
      setLoadError(false);
      setNotifFailed(false);
      void syncNotificationBadge();
    } catch (_) {
      // Only a failed first load is an error state; a failed silent refresh
      // keeps whatever is already on screen.
      if (!hasLoadedOnce.current) setLoadError(true);
      setNotifFailed(true);
    } finally {
      hasLoadedOnce.current = true;
      setNotifLoading(false);
    }
  }, []);

  const pull = usePullToRefresh(loadNotifs);

  useFocusEffect(useCallback(() => { loadNotifs(); }, [loadNotifs]));

  useEffect(() => {
    const unsub = subscribeSocial(() => loadNotifs());
    return unsub;
  }, [loadNotifs]);

  const filtered = selectedCategory
    ? notifs.filter(n => n.category === selectedCategory && !n.isMuted)
    : notifs.filter(n => !n.isMuted);

  const unreadCount = filtered.filter(n => !n.isRead).length;
  const hasRead = filtered.some(n => n.isRead);

  const grouped = groupByDate(filtered);

  const listData: ListItem[] = [];
  for (const group of grouped) {
    listData.push({ type: 'header', title: group.section });
    for (const notif of group.items) {
      listData.push({ type: 'item', notif });
    }
  }

  const handleTap = async (notif: Notification) => {
    void captureNotificationEvent(api, user?.id, {
      notificationId: notif.id,
      eventType: 'tap',
      occurredAt: new Date().toISOString(),
    }).catch(() => {
      // In-app navigation must remain available if analytics capture fails.
    });
    if (!isBuyerDevPreview()) await markNotificationRead(notif.id);
    setNotifs(prev => prev.map(n => n.id === notif.id ? { ...n, isRead: true } : n));
    notifNavigation(notif, router);
  };

  const handleLongPress = (notif: Notification) => {
    haptic('longPress');
    setOptionsFor(notif);
  };

  const closeOptions = () => setOptionsFor(null);
  // Keep the last notification's rows on screen while the sheet slides away.
  const lastOptionsRef = useRef<Notification | null>(null);
  if (optionsFor) lastOptionsRef.current = optionsFor;
  const optionsShown = optionsFor ?? lastOptionsRef.current;

  const handleToggleReadOption = async () => {
    const notif = optionsFor;
    if (!notif) return;
    closeOptions();
    if (notif.isRead) {
      if (!isBuyerDevPreview()) await markNotificationUnread(notif.id);
      setNotifs(prev => prev.map(n => n.id === notif.id ? { ...n, isRead: false } : n));
    } else {
      if (!isBuyerDevPreview()) await markNotificationRead(notif.id);
      setNotifs(prev => prev.map(n => n.id === notif.id ? { ...n, isRead: true } : n));
    }
  };

  const handleDeleteOption = async () => {
// The menu row already fires a haptic on tap; the sheet closes and the row is
    // removed immediately so no second haptic is needed here.
    // The sheet closes and the row is removed immediately.
    const notif = optionsFor;
    if (!notif) return;
    closeOptions();
    if (!isBuyerDevPreview()) await deleteNotification(notif.id);
    setNotifs(prev => prev.filter(n => n.id !== notif.id));
  };

  const handleMuteOption = async () => {
    const notif = optionsFor;
    if (!notif) return;
    closeOptions();
    if (isBuyerDevPreview()) {
      setNotifs(prev => prev.map(n => n.category === notif.category ? { ...n, isMuted: true } : n));
      return;
    }
    await muteNotificationCategory(notif.category);
    await loadNotifs();
  };

  const handleClearRead = () => {
    Alert.alert('Clear read notifications', 'This will remove all read notifications.', [
      {
        text: 'Clear read',
        style: 'destructive',
        onPress: async () => {
          
          if (isBuyerDevPreview()) {
            setNotifs(prev => prev.filter(n => !n.isRead));
            return;
          }
          await clearAllReadNotifications();
          await loadNotifs();
        },
      },
      { text: 'Keep', style: 'cancel' },
    ]);
  };

  const toggleRead = async (notif: Notification) => {
    
    if (isBuyerDevPreview()) {
      // Signed-out preview: local-only, never the protected endpoints.
    } else if (notif.isRead) {
      await markNotificationUnread(notif.id);
    } else {
      await markNotificationRead(notif.id);
    }
    setNotifs(prev => prev.map(item =>
      item.id === notif.id ? { ...item, isRead: !notif.isRead } : item
    ));
  };

  const renderItem = ({ item, index }: { item: ListItem; index: number }) => {
    if (item.type === 'header') {
      return (
        <>
          {index > 0 && <ThreadDivider style={{ marginHorizontal: SPACING.md, marginBottom: SPACING.sm }} />}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionHeaderText, { color: theme.text }]}>{item.title}</Text>
          </View>
        </>
      );
    }

    const { notif } = item;
    const iconName = notifIcon(notif.type);
    const iconColor = notifIconColor(notif.category, theme);

    return (
      // Apple Mail: read / unread on the left (full swipe right toggles),
      // clear on the right (full swipe left removes it).
      <SwipeRow
        rowId={notif.id}
        leading={[{
          key: 'read',
          label: notif.isRead ? 'Unread' : 'Read',
          icon: notif.isRead ? 'mail' : 'check',
          onPress: () => toggleRead(notif),
          accessibilityLabel: `Mark notification ${notif.isRead ? 'unread' : 'read'}`,
        }]}
        trailing={[{
          key: 'clear',
          label: 'Clear',
          icon: 'trash-2',
          tone: 'destructive',
          onPress: async () => {
            setNotifs(prev => prev.filter(n => n.id !== notif.id));
            try { await deleteNotification(notif.id); } catch { await loadNotifs(); }
          },
          accessibilityLabel: 'Clear notification',
        }]}
      >
        <PressableScale
          style={[
            styles.notifRow,
            { backgroundColor: theme.background, borderBottomColor: theme.border },
            // Unread: a faint #FFFFFF08 lift, never bold or an accent bar.
            !notif.isRead && { backgroundColor: unreadRowTint(theme.background) },
          ]}
          onPress={() => handleTap(notif)}
          onLongPress={() => handleLongPress(notif)}
          accessibilityRole="button"
          accessibilityLabel={`${notif.isRead ? '' : 'Unread. '}${notif.title}. ${notif.body}`}
          accessibilityHint="Double tap to open. Long press for more options."
        >
          {/* Left Icon */}
          {notif.actorInitials ? (
            <View style={[styles.avatarCircle, { backgroundColor: notif.actorColor || theme.accent }]}>
              <Text style={[styles.avatarText, { color: theme.onAccent }]}>{notif.actorInitials}</Text>
            </View>
          ) : (
            <View style={[styles.iconCircle, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}>
              <Icon name={iconName as any} size={ICON.md} color={iconColor} />
            </View>
          )}

          {/* Center */}
          <View style={styles.notifCenter}>
            <Text
              style={[
                styles.notifTitle,
                { color: theme.text, fontFamily: FONT.medium },
              ]}
              numberOfLines={2}
            >
              {notif.title}
            </Text>
            <Text style={[styles.notifBody, { color: theme.muted }]} numberOfLines={2}>{notif.body}</Text>
            <View style={styles.notifMeta}>
              <Text style={[styles.notifTime, { color: theme.subtle }]}>{timeAgo(notif.createdAt)}</Text>
              {notif.cta ? (
                <Text style={[styles.notifCta, { color: theme.accent }]}>{' · '}{notif.cta}</Text>
              ) : null}
            </View>
          </View>

          {/* Right */}
          {notif.cta ? (
            <Icon name="chevron-right" size={ICON.sm} color={theme.subtle} />
          ) : null}
        </PressableScale>
      </SwipeRow>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* HEADER */}
      <ScreenHeader
        title="Notifications"
        actions={hasRead ? [{ icon: 'trash-2', onPress: handleClearRead, accessibilityLabel: 'Clear read notifications' }] : undefined}
      />

      {/* CATEGORY PILLS */}
      <View style={styles.pillsRow}>
        <ChipRow
          bounces={false}
          overScrollMode="never"
          directionalLockEnabled
          scrollEventThrottle={16}
          accessibilityLabel="Notification filters, swipe left or right for more categories"
          style={styles.pillsScroll}
          contentContainerStyle={styles.pillsContent}
          onLayout={event => {
            filterViewport.current = event.nativeEvent.layout.width;
            updateFilterEdges();
          }}
          onContentSizeChange={width => {
            filterContent.current = width;
            updateFilterEdges();
          }}
          onScroll={event => {
            filterOffset.current = event.nativeEvent.contentOffset.x;
            updateFilterEdges();
          }}
          selectedIndex={PILLS.findIndex(pill => pill.value === selectedCategory)} hapticOnSelect={false}
        >
          {PILLS.map(pill => {
            const active = selectedCategory === pill.value;
            return (
              <Chip
                key={pill.label}
                label={pill.label}
                selected={active}
                onPress={() => setSelectedCategory(pill.value)}
              />
            );
          })}
        </ChipRow>
        {filterEdges.left && (
          <View pointerEvents="none" style={[styles.pillsEdge, styles.pillsEdgeLeft]}>
            <LinearGradient
              colors={[theme.background, `${theme.background}00`]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <Icon name="chevron-left" size={14} color={theme.muted} />
          </View>
        )}
        {filterEdges.right && (
          <View pointerEvents="none" style={[styles.pillsEdge, styles.pillsEdgeRight]}>
            <LinearGradient
              colors={[`${theme.background}00`, theme.background]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <Icon name="chevron-right" size={14} color={theme.muted} />
          </View>
        )}
      </View>

      {/* UNREAD COUNT */}
      {unreadCount > 0 && (
        <View style={styles.unreadBar}>
          <Text style={[styles.unreadBarText, { color: theme.accent }]}>{unreadCount} unread</Text>
        </View>
      )}

      {/* LIST */}
      {notifLoading ? (
        <BrandedLoadingState message="Loading notifications…" style={{ flex: 1 }} />
      ) : loadError && notifs.length === 0 ? (
        <ErrorState
          message="Couldn't load your notifications."
          onRetry={() => { hasLoadedOnce.current = false; void loadNotifs(); }}
          style={{ flex: 1 }}
        />
      ) : listData.length === 0 ? (
        <EmptyState
          icon="bell"
          title="No notifications yet"
          description="When someone likes your style, a drop goes live, or an order moves, you’ll hear it here."
          style={{ flex: 1 }}
        />
      ) : (
        <FlatList
          {...LONG_LIST_TUNING}
          data={listData}
          keyExtractor={(item) =>
            item.type === 'header' ? `header-${item.title}` : item.notif.id
          }
          renderItem={renderItem}
          refreshControl={pull.refreshControl}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.xl }}
        />
      )}

      {/* LONG-PRESS OPTIONS SHEET */}
      <MenuSheet
        visible={!!optionsFor}
        onClose={closeOptions}
        accessibilityLabel="Notification options"
        testID="notification-options-sheet"
        sections={optionsShown ? [
          [
            {
              key: 'read', icon: optionsShown.isRead ? 'mail' : 'check',
              label: optionsShown.isRead ? 'Mark unread' : 'Mark read',
              onPress: () => { void handleToggleReadOption(); },
            },
            {
              key: 'mute', icon: 'bell-off',
              label: `Mute ${categoryLabel(optionsShown.category)} alerts`,
              onPress: () => { void handleMuteOption(); },
            },
          ],
          [{ key: 'delete', icon: 'trash-2', label: 'Delete', destructive: true, onPress: () => { void handleDeleteOption(); } }],
        ] : []}
      />
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  container: {
    flex: 1,
  },
  pillsRow: {
    position: 'relative',
  },
  pillsScroll: {
    flexGrow: 0,
    // flexShrink defaults to 1, so a sibling flex:1 element (the loading
    // state / empty state below) was compressing this horizontal ScrollView
    // and clipping the pills vertically. minHeight guarantees room for the
    // pill row even before it has measured its own content.
    flexShrink: 0,
    minHeight: 44,
  },
  pillsContent: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
    alignItems: 'center',
  },
  pillsEdge: {
    position: 'absolute',
    top: SPACING.sm,
    bottom: SPACING.sm,
    width: 28,
    justifyContent: 'center',
  },
  pillsEdgeLeft: {
    left: 0,
    alignItems: 'flex-start',
    paddingLeft: 2,
  },
  pillsEdgeRight: {
    right: 0,
    alignItems: 'flex-end',
    paddingRight: 2,
  },
  unreadBar: {
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.xxs,
  },
  unreadBarText: {
    ...TYPE_SCALE.footnote,
    fontFamily: FONT.medium,
  },
  sectionHeader: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    marginTop: SPACING.sm,
  },
  // Instagram's section titles: sentence case, semibold, page text colour.
  sectionHeaderText: {
    fontSize: 17,
    lineHeight: 22,
    fontFamily: FONT.semibold,
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: RADII.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    ...TYPE_SCALE.footnote,
    fontFamily: FONT.bold,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: RADII.pill,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  notifCenter: {
    flex: 1,
    marginHorizontal: SPACING.md,
  },
  notifTitle: {
    ...TYPE_SCALE.callout,
    marginBottom: 2,
  },
  notifBody: {
    ...TYPE_SCALE.footnote,
  },
  notifMeta: {
    flexDirection: 'row',
    marginTop: SPACING.xxs,
    alignItems: 'center',
  },
  notifTime: {
    ...TYPE_SCALE.caption,
  },
  notifCta: {
    ...TYPE_SCALE.caption,
    fontFamily: FONT.medium,
  },
  sheetContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
  },
});
