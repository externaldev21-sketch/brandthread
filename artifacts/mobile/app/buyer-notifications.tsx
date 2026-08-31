import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, ScrollView, TouchableOpacity,
  Alert, StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useRouter } from 'expo-router';
import {
  BG, CARD, CARD_ELEVATED, BORDER,
  FG, MUTED, SUBTLE, SUCCESS, ORANGE, BLUE, RED, ON_DARK,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  getNotifications, markNotificationRead, markNotificationUnread,
  deleteNotification, muteNotificationCategory, clearAllReadNotifications,
  subscribeSocial,
} from '@/services/socialService';
import type { Notification, NotificationCategory } from '@/services/socialTypes';
import { BrandedLoadingState, EmptyState, ThreadDivider } from '@/components/BrandthreadUI';
import SwipeActionRow from '@/components/SwipeActionRow';
import { useApi } from '@/lib/api';
import { captureNotificationEvent } from '@/lib/notificationEventOutbox';
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

function notifIconColor(cat: NotificationCategory, accent: string, accentLight: string): string {
  switch (cat) {
    case 'social': return accent;
    case 'orders': return accentLight;
    case 'messages': return BLUE;
    case 'seller_updates': return SUCCESS;
    case 'products': return ORANGE;
    case 'marketing': return ORANGE;
    case 'system': return MUTED;
    default: return MUTED;
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
  const PURPLE = theme.accent;
  const PURPLE_DIM = theme.accentDim;
  const CYAN = theme.accentLight;
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { user } = useUser();

  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<NotificationCategory | undefined>(undefined);
  const [notifLoading, setNotifLoading] = useState(true);

  const loadNotifs = useCallback(async () => {
    setNotifLoading(true);
    try {
      const data = await getNotifications();
      setNotifs(data);
    } catch (_) {
    } finally {
      setNotifLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadNotifs(); }, [loadNotifs]));

  useEffect(() => {
    const unsub = subscribeSocial(() => loadNotifs());
    return unsub;
  }, []);

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
    await markNotificationRead(notif.id);
    setNotifs(prev => prev.map(n => n.id === notif.id ? { ...n, isRead: true } : n));
    notifNavigation(notif, router);
  };

  const handleLongPress = (notif: Notification) => {
    Alert.alert('Options', '', [
      {
        text: notif.isRead ? 'Mark unread' : 'Mark read',
        onPress: async () => {
          if (notif.isRead) {
            await markNotificationUnread(notif.id);
            setNotifs(prev => prev.map(n => n.id === notif.id ? { ...n, isRead: false } : n));
          } else {
            await markNotificationRead(notif.id);
            setNotifs(prev => prev.map(n => n.id === notif.id ? { ...n, isRead: true } : n));
          }
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteNotification(notif.id);
          setNotifs(prev => prev.filter(n => n.id !== notif.id));
        },
      },
      {
        text: `Mute ${notif.category} notifications`,
        onPress: async () => {
          await muteNotificationCategory(notif.category);
          await loadNotifs();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleClearRead = () => {
    Alert.alert('Clear read notifications', 'This will remove all read notifications.', [
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearAllReadNotifications();
          await loadNotifs();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const toggleRead = async (notif: Notification) => {
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
          {index > 0 && <ThreadDivider style={{ marginHorizontal: SP.md, marginBottom: SP.sm }} />}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{item.title.toUpperCase()}</Text>
          </View>
        </>
      );
    }

    const { notif } = item;
    const iconName = notifIcon(notif.type);
    const iconColor = notifIconColor(notif.category, theme.accent, theme.accentLight);

    return (
      <SwipeActionRow
        label={notif.isRead ? 'Unread' : 'Read'}
        icon={notif.isRead ? 'mail' : 'check'}
        color={notif.isRead ? BLUE : SUCCESS}
        onAction={() => toggleRead(notif)}
        accessibilityLabel={`Mark notification ${notif.isRead ? 'unread' : 'read'}`}
      >
        <TouchableOpacity
          style={[
            styles.notifRow,
            !notif.isRead && { backgroundColor: theme.accentDim },
          ]}
          onPress={() => handleTap(notif)}
          onLongPress={() => handleLongPress(notif)}
          activeOpacity={0.75}
        >
        {/* Left Icon */}
        {notif.actorInitials ? (
          <View style={[styles.avatarCircle, { backgroundColor: notif.actorColor || PURPLE }]}>
            <Text style={styles.avatarText}>{notif.actorInitials}</Text>
          </View>
        ) : (
          <View style={[styles.iconCircle, { backgroundColor: CARD_ELEVATED }]}>
            <Feather name={iconName as any} size={ICON.md} color={iconColor} />
          </View>
        )}

        {/* Center */}
        <View style={styles.notifCenter}>
          <Text
            style={[
              styles.notifTitle,
              { fontFamily: notif.isRead ? FONT.medium : FONT.semibold },
            ]}
            numberOfLines={2}
          >
            {notif.title}
          </Text>
          <Text style={styles.notifBody} numberOfLines={2}>{notif.body}</Text>
          <View style={styles.notifMeta}>
            <Text style={styles.notifTime}>{timeAgo(notif.createdAt)}</Text>
            {notif.cta ? (
              <Text style={styles.notifCta}>{' · '}{notif.cta}</Text>
            ) : null}
          </View>
        </View>

        {/* Right */}
        {!notif.isRead ? (
          <View style={styles.unreadDot} />
        ) : notif.cta ? (
          <Feather name="chevron-right" size={ICON.sm} color={SUBTLE} />
        ) : null}
        </TouchableOpacity>
      </SwipeActionRow>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={ICON.lg} color={FG} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        {hasRead && (
          <TouchableOpacity onPress={handleClearRead}>
            <Text style={styles.clearReadText}>Clear read</Text>
          </TouchableOpacity>
        )}
      </View>

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
            <TouchableOpacity
              key={pill.label}
              style={[
                styles.pill,
                active
                  ? { backgroundColor: PURPLE_DIM, borderColor: theme.accent }
                  : { backgroundColor: CARD, borderColor: BORDER },
              ]}
              onPress={() => setSelectedCategory(pill.value)}
            >
              <Text
                style={[
                  styles.pillText,
                  { color: active ? PURPLE : MUTED },
                ]}
              >
                {pill.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* UNREAD COUNT */}
      {unreadCount > 0 && (
        <View style={styles.unreadBar}>
          <Text style={styles.unreadBarText}>{unreadCount} unread</Text>
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
          keyExtractor={(item, idx) =>
            item.type === 'header' ? `header-${item.title}` : item.notif.id
          }
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + SP.xl }}
        />
      )}
    </View>
  );
}

const makeStyles = (theme: { accent: string; accentDim: string }) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  backBtn: {
    marginRight: SP.md,
  },
  headerTitle: {
    flex: 1,
    color: FG,
    fontFamily: FONT.bold,
    fontSize: FS.md,
  },
  clearReadText: {
    color: MUTED,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
  },
  pillsScroll: {
    flexGrow: 0,
  },
  pillsContent: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    gap: SP.sm,
  },
  pill: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
    borderWidth: 1,
    marginRight: SP.sm,
  },
  pillText: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
  },
  unreadBar: {
    paddingHorizontal: SP.md,
    marginBottom: SP.xs,
  },
  unreadBarText: {
    color: theme.accent,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
  },
  sectionHeader: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
    marginTop: SP.sm,
  },
  sectionHeaderText: {
    color: MUTED,
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: BG,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: ON_DARK,
    fontFamily: FONT.bold,
    fontSize: FS.sm,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  notifCenter: {
    flex: 1,
    marginHorizontal: SP.md,
  },
  notifTitle: {
    color: FG,
    fontSize: FS.sm,
    marginBottom: 2,
  },
  notifBody: {
    color: MUTED,
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    lineHeight: 16,
  },
  notifMeta: {
    flexDirection: 'row',
    marginTop: SP.xs,
    alignItems: 'center',
  },
  notifTime: {
    color: SUBTLE,
    fontSize: FS.xs,
    fontFamily: FONT.regular,
  },
  notifCta: {
    color: theme.accent,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.accent,
    marginTop: SP.xs,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SP.xl,
  },
  emptyTitle: {
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    marginTop: SP.md,
  },
  emptyBody: {
    color: MUTED,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    textAlign: 'center',
    marginTop: SP.sm,
  },
});
