import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, ScrollView,
  Alert, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { FONT, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  getNotifications, markNotificationRead, markNotificationUnread,
  deleteNotification, muteNotificationCategory, clearAllReadNotifications,
  subscribeSocial,
} from '@/services/socialService';
import type { Notification, NotificationCategory } from '@/services/socialTypes';
import { BrandedLoadingState, EmptyState, PressableScale, ThreadDivider } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { BottomSheet, Chip, ListRow } from '@/components/ui';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { hapticDestructiveConfirm, hapticPrimaryAction, hapticToggle } from '@/lib/haptics';
import SwipeActionRow from '@/components/SwipeActionRow';
import { useApi } from '@/lib/api';
import { captureNotificationEvent } from '@/lib/notificationEventOutbox';
import { syncNotificationBadge } from '@/lib/notificationBadge';
import { useUser } from '@clerk/expo';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

type GroupSection = 'Today' | 'This Week' | 'Earlier';

function groupByDate(notifs: Notification[]): { section: GroupSection; items: Notification[] }[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;

  const today: Notification[] = [];
  const week: Notification[] = [];
  const earlier: Notification[] = [];

  for (const n of notifs) {
    const t = new Date(n.createdAt).getTime();
    if (t >= todayStart) today.push(n);
    else if (t >= weekStart) week.push(n);
    else earlier.push(n);
  }

  const result: { section: GroupSection; items: Notification[] }[] = [];
  if (today.length) result.push({ section: 'Today', items: today });
  if (week.length) result.push({ section: 'This Week', items: week });
  if (earlier.length) result.push({ section: 'Earlier', items: earlier });
  return result;
}

function notifIcon(type: Notification['type']): string {
  switch (type) {
    case 'friend_request': return 'user-plus';
    case 'friend_accepted': return 'user-check';
    case 'post_like': return 'heart';
    case 'post_comment': return 'message-circle';
    case 'repost': return 'repeat';
    case 'mention': return 'at-sign';
    case 'story_reaction': return 'zap';
    case 'story_reply': return 'message-square';
    case 'new_follower': return 'user-plus';
    case 'order_confirmed': return 'check-circle';
    case 'order_shipped': return 'truck';
    case 'order_delivered': return 'package';
    case 'order_cancelled': return 'x-circle';
    case 'order_delay': return 'alert-triangle';
    case 'order_out_for_delivery': return 'truck';
    case 'order_exception': return 'alert-triangle';
    case 'order_returned_to_sender': return 'corner-up-left';
    case 'drop_live': return 'zap';
    case 'product_restocked': return 'refresh-cw';
    case 'price_drop': return 'trending-down';
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
    router.push(('/buyer-order-detail?id=' + encodeURIComponent(notif.targetId)) as any);
    return;
  }
  switch (notif.type) {
    case 'friend_request':
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
    case 'order_exception':
    case 'order_returned_to_sender':
    case 'return_update':
    case 'refund_update':
    case 'dispute_update':
      router.push('/(buyer)/orders' as any);
      break;
    case 'drop_live':
    case 'product_restocked':
    case 'price_drop':
    case 'saved_product_update':
      router.push('/(buyer)/discover' as any);
      break;
    case 'new_friend_message':
    case 'new_order_message':
    case 'new_seller_reply':
      if (notif.targetId) {
        router.push(('/buyer-conversation?id=' + notif.targetId) as any);
      } else {
        router.push('/(buyer)/inbox' as any);
      }
      break;
    case 'story_reaction':
    case 'story_reply':
      if (notif.targetId) {
        router.push(
          ('/buyer-story-viewer?storyId=' + notif.targetId + '&allStoryIds=' + notif.targetId) as any,
        );
      } else {
        router.push('/(buyer)/friends' as any);
      }
      break;
    default:
      router.push('/(buyer)/inbox' as any);
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
  const [notifLoading, setNotifLoading] = useState(true);
  const [optionsFor, setOptionsFor] = useState<Notification | null>(null);

  // Only the very first load shows the full-screen loader. Focus refocuses and
  // realtime socket events after that refresh the list silently so the loader
  // doesn't flash over content that's already on screen.
  const hasLoadedOnce = useRef(false);

  const loadNotifs = useCallback(async () => {
    if (!hasLoadedOnce.current) setNotifLoading(true);
    try {
      const data = await getNotifications();
      setNotifs(data);
      void syncNotificationBadge(data);
    } catch (_) {
    } finally {
      hasLoadedOnce.current = true;
      setNotifLoading(false);
    }
  }, []);

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
    hapticPrimaryAction();
    void captureNotificationEvent(api, user?.id, {
      notificationId: notif.id,
      eventType: 'tap',
      occurredAt: new Date().toISOString(),
    }).catch(() => {
      // In-app navigation must remain available if analytics capture fails.
    });
    await markNotificationRead(notif.id);
    setNotifs(prev => prev.map(n => n.id === notif.id ? { ...n, isRead: true } : n));
    notifNavigation(notif, router);
  };

  const handleLongPress = (notif: Notification) => {
    hapticToggle();
    setOptionsFor(notif);
  };

  const closeOptions = () => setOptionsFor(null);

  const handleToggleReadOption = async () => {
    const notif = optionsFor;
    if (!notif) return;
    closeOptions();
    if (notif.isRead) {
      await markNotificationUnread(notif.id);
      setNotifs(prev => prev.map(n => n.id === notif.id ? { ...n, isRead: false } : n));
    } else {
      await markNotificationRead(notif.id);
      setNotifs(prev => prev.map(n => n.id === notif.id ? { ...n, isRead: true } : n));
    }
  };

  const handleDeleteOption = async () => {
    // ListRow already fires a haptic on tap; the sheet closes and the row is
    // removed immediately so no second haptic is needed here.
    const notif = optionsFor;
    if (!notif) return;
    closeOptions();
    await deleteNotification(notif.id);
    setNotifs(prev => prev.filter(n => n.id !== notif.id));
  };

  const handleMuteOption = async () => {
    const notif = optionsFor;
    if (!notif) return;
    closeOptions();
    await muteNotificationCategory(notif.category);
    await loadNotifs();
  };

  const handleClearRead = () => {
    Alert.alert('Clear read notifications', 'This will remove all read notifications.', [
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          hapticDestructiveConfirm();
          await clearAllReadNotifications();
          await loadNotifs();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const toggleRead = async (notif: Notification) => {
    hapticToggle();
    if (notif.isRead) {
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
            <Text style={[styles.sectionHeaderText, { color: theme.muted }]}>{item.title.toUpperCase()}</Text>
          </View>
        </>
      );
    }

    const { notif } = item;
    const iconName = notifIcon(notif.type);
    const iconColor = notifIconColor(notif.category, theme);

    return (
      <SwipeActionRow
        label={notif.isRead ? 'Unread' : 'Read'}
        icon={notif.isRead ? 'mail' : 'check'}
        color={notif.isRead ? theme.accent : theme.success}
        onAction={() => toggleRead(notif)}
        accessibilityLabel={`Mark notification ${notif.isRead ? 'unread' : 'read'}`}
      >
        <PressableScale
          style={[
            styles.notifRow,
            { backgroundColor: theme.background, borderBottomColor: theme.border },
            !notif.isRead && {
              backgroundColor: theme.card,
              borderLeftWidth: 2,
              borderLeftColor: theme.accent,
            },
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
              <Feather name={iconName as any} size={ICON.md} color={iconColor} />
            </View>
          )}

          {/* Center */}
          <View style={styles.notifCenter}>
            <Text
              style={[
                styles.notifTitle,
                { color: theme.text, fontFamily: notif.isRead ? FONT.medium : FONT.semibold },
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
          {!notif.isRead ? (
            <View style={[styles.unreadDot, { backgroundColor: theme.accent }]} />
          ) : notif.cta ? (
            <Feather name="chevron-right" size={ICON.sm} color={theme.subtle} />
          ) : null}
        </PressableScale>
      </SwipeActionRow>
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
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.pillsScroll}
        contentContainerStyle={styles.pillsContent}
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
      </ScrollView>

      {/* UNREAD COUNT */}
      {unreadCount > 0 && (
        <View style={styles.unreadBar}>
          <Text style={[styles.unreadBarText, { color: theme.accent }]}>{unreadCount} unread</Text>
        </View>
      )}

      {/* LIST */}
      {notifLoading && (
        <BrandedLoadingState
          message="Loading notifications…"
          style={{ position: 'absolute', top: 80, left: 0, right: 0, bottom: 0, zIndex: 5 }}
        />
      )}
      {!notifLoading && listData.length === 0 ? (
        <EmptyState
          icon="bell"
          title="Quiet looks good on you."
          description="When someone likes your style, a drop goes live, or an order moves, you’ll hear it here."
          style={{ flex: 1 }}
        />
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) =>
            item.type === 'header' ? `header-${item.title}` : item.notif.id
          }
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.xl }}
        />
      )}

      {/* LONG-PRESS OPTIONS SHEET */}
      <BottomSheet visible={!!optionsFor} onClose={closeOptions}>
        {optionsFor && (
          <View style={styles.sheetContent}>
            <ListRow
              icon={optionsFor.isRead ? 'mail' : 'check'}
              title={optionsFor.isRead ? 'Mark unread' : 'Mark read'}
              onPress={handleToggleReadOption}
            />
            <ListRow
              icon="bell-off"
              title={`Mute ${categoryLabel(optionsFor.category)} alerts`}
              onPress={handleMuteOption}
            />
            <ListRow
              icon="trash-2"
              title="Delete"
              destructive
              onPress={handleDeleteOption}
            />
          </View>
        )}
      </BottomSheet>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  container: {
    flex: 1,
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
  sectionHeaderText: {
    ...TYPE_SCALE.caption,
    fontFamily: FONT.semibold,
    textTransform: 'uppercase',
    letterSpacing: 1,
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
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: SPACING.xxs,
  },
  sheetContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
  },
});
