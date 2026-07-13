import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  useColorScheme, ScrollView, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  FRIENDS, Friend, Message,
  getLastMessage, getUnread, markRead, subscribe,
} from '@/lib/chatStore';

// ─── Notification mock data ───────────────────────────────────────────────────

const NOTIF_ITEMS = [
  { id: 'n1', type: 'drop'    as const, read: false, title: 'Vault Studio drop is live', body: 'Canvas Cargo Jacket is now available — only 50 units.', time: '2h', cta: 'Shop now' },
  { id: 'n2', type: 'restock' as const, read: false, title: 'Back in stock', body: 'Archive Hoodie Vol.3 by NxGen Drops — 8 units remaining.', time: '6h', cta: 'Buy now' },
  { id: 'n3', type: 'order'   as const, read: true,  title: 'Order shipped', body: 'Your Essential Relaxed Tee from Meridian Co. is on its way.', time: '1d', cta: 'Track order' },
  { id: 'n4', type: 'drop'    as const, read: true,  title: 'Atlas Goods — new drop', body: 'City Chore Coat now available in sand and slate.', time: '1d', cta: 'Shop now' },
];

type NotifType = 'drop' | 'order' | 'restock';
const TYPE_META: Record<NotifType, { icon: keyof typeof Feather.glyphMap; color: string }> = {
  drop:    { icon: 'zap',        color: '#00C853' },
  order:   { icon: 'package',    color: '#4C9A5E' },
  restock: { icon: 'refresh-cw', color: '#B98A2E' },
};

// ─── Time helper ──────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Flat list row shell ──────────────────────────────────────────────────────
// Instagram-style inbox row: no card/border chrome, just icon + text + trailing glyph.

function InboxRow({ leading, title, titleBold, subtitle, cta, ctaColor, trailing, onPress, fg, muted }: {
  leading: React.ReactNode;
  title: string;
  titleBold?: boolean;
  subtitle: string;
  cta?: string;
  ctaColor?: string;
  trailing?: React.ReactNode;
  onPress: () => void;
  fg: string;
  muted: string;
}) {
  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.75} hitSlop={{ top: 4, bottom: 4 }}>
      {leading}
      <View style={{ flex: 1 }}>
        <Text style={[s.rowTitle, { color: fg }, titleBold && { fontFamily: 'Inter_700Bold' }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[s.rowSubtitle, { color: muted }]} numberOfLines={1}>{subtitle}</Text>
        {cta && <Text style={[s.rowCta, { color: ctaColor ?? muted }]}>{cta}</Text>}
      </View>
      {trailing}
    </TouchableOpacity>
  );
}

// ─── DM thread row ────────────────────────────────────────────────────────────

function DMRow({ friend, last, unread, isDark, onPress }: {
  friend: Friend;
  last: Message | null;
  unread: number;
  isDark: boolean;
  onPress: () => void;
}) {
  const fg     = isDark ? '#EDE7D9' : '#17140F';
  const muted  = isDark ? '#8C8577' : '#5C5548';
  const primary = isDark ? '#39FF88' : '#00C853';

  return (
    <InboxRow
      fg={fg}
      muted={muted}
      onPress={onPress}
      leading={
        <View style={[s.dmAvatar, { backgroundColor: friend.color }]}>
          <Text style={s.dmInitials}>{friend.initials}</Text>
        </View>
      }
      title={friend.name}
      titleBold={unread > 0}
      subtitle={last ? `${last.fromMe ? 'You: ' : ''}${last.text} · ${timeAgo(last.ts)}` : 'Start a conversation'}
      trailing={
        unread > 0 ? (
          <View style={[s.unreadBadge, { backgroundColor: primary }]}>
            <Text style={s.unreadText}>{unread}</Text>
          </View>
        ) : (
          <Feather name="camera" size={19} color={muted} />
        )
      }
    />
  );
}

// ─── Notification row ─────────────────────────────────────────────────────────

function NotifRow({ item, isDark, onRead }: {
  item: typeof NOTIF_ITEMS[number];
  isDark: boolean;
  onRead: (id: string) => void;
}) {
  const fg      = isDark ? '#EDE7D9' : '#17140F';
  const muted   = isDark ? '#8C8577' : '#5C5548';
  const primary = isDark ? '#39FF88' : '#00C853';
  const meta    = TYPE_META[item.type];
  const badgeCountVisible = !item.read && (item.type === 'drop' || item.type === 'restock');
  const badgeDotVisible   = !item.read && !badgeCountVisible;

  return (
    <InboxRow
      fg={fg}
      muted={muted}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onRead(item.id);
        if (item.cta === 'Track order') {
          router.push('/(buyer)/orders' as never);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }}
      leading={
        <View style={[s.notifAvatar, { backgroundColor: meta.color }]}>
          <Feather name={meta.icon} size={18} color="#FFF" />
        </View>
      }
      title={item.title}
      titleBold={!item.read}
      subtitle={`${item.body} · ${item.time}`}
      cta={item.cta}
      ctaColor={primary}
      trailing={
        badgeCountVisible ? (
          <View style={[s.unreadBadge, { backgroundColor: primary }]}>
            <Text style={s.unreadText}>1</Text>
          </View>
        ) : badgeDotVisible ? (
          <View style={[s.unreadDot, { backgroundColor: primary }]} />
        ) : undefined
      }
    />
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const FRIEND_ORDER = ['maya', 'kai', 'jordan', 'sofia', 'amir'];

export default function InboxScreen() {
  const insets  = useSafeAreaInsets();
  const scheme  = useColorScheme();
  const router  = useRouter();
  const isDark  = scheme !== 'light';

  const bg      = isDark ? '#121110' : '#F5F1E7';
  const fg      = isDark ? '#EDE7D9' : '#17140F';
  const muted   = isDark ? '#8C8577' : '#5C5548';
  const border  = isDark ? '#33302A' : '#E3DCC9';
  const primary = isDark ? '#39FF88' : '#00C853';
  const chipBg  = isDark ? '#1B1917' : '#FFFFFF';

  // Trigger re-renders when store changes
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const unsub = subscribe(() => forceUpdate(n => n + 1));
    return () => { unsub(); };
  }, []);

  // Notification read state
  const [notifItems, setNotifItems] = useState(NOTIF_ITEMS);
  function markNotifRead(id: string) {
    setNotifItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }

  const totalUnread = FRIEND_ORDER.reduce((acc, id) => acc + getUnread(id), 0);

  function openChat(friendId: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    markRead(friendId);
    router.push(`/chat/${friendId}`);
  }

  return (
    <ScrollView
      style={[s.container, { backgroundColor: bg }]}
      contentContainerStyle={{ paddingBottom: 110 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity
          style={s.headerIconBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => openChat('maya')}
        >
          <Feather name="users" size={22} color={fg} />
        </TouchableOpacity>

        <TouchableOpacity
          style={s.headerTitleRow}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8 }}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Text style={[s.headerTitle, { color: fg }]}>Inbox</Text>
          <View style={[s.headerChevronPill, { backgroundColor: chipBg }]}>
            {totalUnread > 0 && <View style={[s.headerDot, { backgroundColor: primary }]} />}
            <Feather name="chevron-down" size={13} color={muted} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.headerIconBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => router.push('/(buyer)/search' as never)}
        >
          <Feather name="search" size={21} color={fg} />
        </TouchableOpacity>
      </View>

      {/* ── Stories row ── */}
      <View style={{ marginTop: 6 }}>
        <TouchableOpacity
          style={[s.thoughtsChip, { backgroundColor: chipBg, borderColor: border }]}
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8 }}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/story-creator' as never); }}
        >
          <Text style={[s.thoughtsText, { color: muted }]}>Thoughts?</Text>
        </TouchableOpacity>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 16, paddingTop: 10, paddingBottom: 4 }}
        >
          <TouchableOpacity
            style={s.storyItem}
            activeOpacity={0.8}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/story-picker' as never); }}
          >
            <View style={[s.createRing, { backgroundColor: border }]}>
              <Feather name="user" size={24} color={muted} />
              <View style={[s.createBadge, { backgroundColor: primary, borderColor: bg }]}>
                <Feather name="plus" size={11} color="#FFF" />
              </View>
            </View>
            <Text style={[s.storyLabel, { color: fg }]}>Create</Text>
          </TouchableOpacity>

          {FRIEND_ORDER.map(id => {
            const friend = FRIENDS[id];
            return (
              <TouchableOpacity
                key={id}
                style={s.storyItem}
                activeOpacity={0.8}
                onPress={() => openChat(id)}
              >
                <View style={[s.storyRing, { borderColor: friend.color }]}>
                  <View style={[s.storyAvatar, { backgroundColor: friend.color }]}>
                    <Text style={s.storyInitials}>{friend.initials}</Text>
                  </View>
                </View>
                <Text style={[s.storyLabel, { color: fg }]} numberOfLines={1}>{friend.handle.replace('@', '')}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Unified flat feed ── */}
      <View style={{ marginTop: 14 }}>
        <InboxRow
          fg={fg}
          muted={muted}
          onPress={() => router.push('/(buyer)/profile' as never)}
          leading={
            <View style={[s.notifAvatar, { backgroundColor: '#1D4ED8' }]}>
              <Feather name="users" size={18} color="#FFF" />
            </View>
          }
          title="New followers"
          subtitle="CARD PLUG started following you."
        />
        <InboxRow
          fg={fg}
          muted={muted}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          leading={
            <View style={[s.notifAvatar, { backgroundColor: '#DB2777' }]}>
              <Feather name="heart" size={18} color="#FFF" />
            </View>
          }
          title="Activity"
          subtitle="co.luvsnayy liked photos you reposted."
        />

        {FRIEND_ORDER.map(id => (
          <DMRow
            key={id}
            friend={FRIENDS[id]}
            last={getLastMessage(id)}
            unread={getUnread(id)}
            isDark={isDark}
            onPress={() => openChat(id)}
          />
        ))}

        {notifItems.map(item => (
          <NotifRow key={item.id} item={item} isDark={isDark} onRead={markNotifRead} />
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 10 },
  headerIconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  headerChevronPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 5, paddingVertical: 3 },
  headerDot: { width: 6, height: 6, borderRadius: 3 },

  // Stories row
  thoughtsChip: { alignSelf: 'flex-start', marginLeft: 20, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  thoughtsText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  storyItem: { alignItems: 'center', gap: 6, width: 62 },
  createRing: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  createBadge: { position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  storyRing: { width: 58, height: 58, borderRadius: 29, borderWidth: 2, alignItems: 'center', justifyContent: 'center', padding: 2 },
  storyAvatar: { flex: 1, width: '100%', borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  storyInitials: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFF' },
  storyLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', width: 62, textAlign: 'center' },

  // Flat row shell
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  rowTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  rowSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  rowCta: { fontSize: 12, fontFamily: 'Inter_700Bold', marginTop: 3 },

  // DM row
  dmAvatar:   { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  dmInitials: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },
  unreadBadge:{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, minWidth: 20, alignItems: 'center' },
  unreadText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#FFF' },

  // Notif row
  notifAvatar:    { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  unreadDot:      { width: 8, height: 8, borderRadius: 4 },
});
