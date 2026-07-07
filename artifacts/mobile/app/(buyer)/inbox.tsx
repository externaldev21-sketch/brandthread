import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  useColorScheme, SectionList, ScrollView, Alert,
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

const NOTIF_SECTIONS = [
  {
    title: 'Today',
    data: [
      { id: 'n1', type: 'drop'    as const, read: false, avatar: '#7C3AED', initials: 'VS', title: 'Vault Studio drop is live', body: 'Canvas Cargo Jacket is now available — only 50 units.', time: '2h ago', cta: 'Shop now' },
      { id: 'n2', type: 'restock' as const, read: false, avatar: '#B45309', initials: 'NX', title: 'Back in stock', body: 'Archive Hoodie Vol.3 by NxGen Drops — 8 units remaining.', time: '6h ago', cta: 'Buy now' },
    ],
  },
  {
    title: 'Yesterday',
    data: [
      { id: 'n3', type: 'order'   as const, read: true,  avatar: '#0F766E', initials: 'BT', title: 'Order shipped', body: 'Your Essential Relaxed Tee from Meridian Co. is on its way.', time: '1d ago', cta: 'Track order' },
      { id: 'n4', type: 'drop'    as const, read: true,  avatar: '#1D4ED8', initials: 'AG', title: 'Atlas Goods — new drop', body: 'City Chore Coat now available in sand and slate.', time: '1d ago', cta: 'Shop now' },
    ],
  },
];

type NotifType = 'drop' | 'order' | 'restock';
const TYPE_META: Record<NotifType, { icon: keyof typeof Feather.glyphMap; color: string }> = {
  drop:    { icon: 'zap',        color: '#7C3AED' },
  order:   { icon: 'package',    color: '#22C55E' },
  restock: { icon: 'refresh-cw', color: '#F59E0B' },
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

// ─── DM thread row ────────────────────────────────────────────────────────────

function DMRow({ friend, last, unread, isDark, onPress }: {
  friend: Friend;
  last: Message | null;
  unread: number;
  isDark: boolean;
  onPress: () => void;
}) {
  const card    = isDark ? '#111118' : '#FFFFFF';
  const border  = isDark ? '#1E1E30' : '#E8E6F0';
  const fg      = isDark ? '#F0EEFF' : '#1A1035';
  const muted   = isDark ? '#6B6B8A' : '#8080A0';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';

  return (
    <TouchableOpacity
      style={[s.dmRow, { backgroundColor: card, borderColor: border }]}
      onPress={onPress}
      activeOpacity={0.78}
    >
      {/* Avatar + online dot */}
      <View style={{ position: 'relative' }}>
        <View style={[s.dmAvatar, { backgroundColor: friend.color }]}>
          <Text style={s.dmInitials}>{friend.initials}</Text>
        </View>
        {friend.online && <View style={[s.onlineDot, { borderColor: card }]} />}
      </View>

      {/* Text */}
      <View style={{ flex: 1 }}>
        <Text style={[s.dmName, { color: fg }, unread > 0 && { fontFamily: 'Inter_700Bold' }]}>
          {friend.name}
        </Text>
        <Text style={[s.dmPreview, { color: muted }, unread > 0 && { color: isDark ? '#C4B5FD' : '#5B21B6' }]} numberOfLines={1}>
          {last ? (last.fromMe ? `You: ${last.text}` : last.text) : 'Start a conversation'}
        </Text>
      </View>

      {/* Time + badge */}
      <View style={{ alignItems: 'flex-end', gap: 5 }}>
        {last && <Text style={[s.dmTime, { color: muted }]}>{timeAgo(last.ts)}</Text>}
        {unread > 0 ? (
          <View style={[s.unreadBadge, { backgroundColor: primary }]}>
            <Text style={s.unreadText}>{unread}</Text>
          </View>
        ) : (
          <Feather name="chevron-right" size={14} color={muted} />
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Notification row ─────────────────────────────────────────────────────────

function NotifRow({ item, isDark, onRead }: {
  item: typeof NOTIF_SECTIONS[0]['data'][0];
  isDark: boolean;
  onRead: (id: string) => void;
}) {
  const card   = isDark ? '#111118' : '#FFFFFF';
  const border = isDark ? '#1E1E30' : '#E8E6F0';
  const fg     = isDark ? '#F0EEFF' : '#1A1035';
  const muted  = isDark ? '#6B6B8A' : '#8080A0';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';
  const meta   = TYPE_META[item.type];

  return (
    <TouchableOpacity
      style={[s.notifRow, { backgroundColor: card, borderColor: border }, !item.read && { borderLeftWidth: 3, borderLeftColor: primary }]}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onRead(item.id); }}
      activeOpacity={0.75}
    >
      <View style={s.notifAvatarWrap}>
        <View style={[s.notifAvatar, { backgroundColor: item.avatar }]}>
          <Text style={s.notifInitials}>{item.initials}</Text>
        </View>
        <View style={[s.typeBadge, { backgroundColor: meta.color + '22' }]}>
          <Feather name={meta.icon} size={9} color={meta.color} />
        </View>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text style={[s.notifTitle, { color: fg }, !item.read && { fontFamily: 'Inter_700Bold' }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[s.notifTime, { color: muted }]}>{item.time}</Text>
        </View>
        <Text style={[s.notifBody, { color: muted }]} numberOfLines={2}>{item.body}</Text>
        {item.cta && (
          <TouchableOpacity
            style={[s.ctaBtn, { backgroundColor: primary + '18', borderColor: primary + '40' }]}
            activeOpacity={0.8}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (item.cta === 'Track order') {
                Alert.alert('Order Status', 'Your order is on its way! 📦\n\nEstimated delivery: Tomorrow, 2–5 PM', [{ text: 'OK' }]);
              } else if (item.cta === 'Shop now' || item.cta === 'Buy now') {
                Alert.alert(item.title, 'Ready to shop this drop?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: '🛍️ Go to Drop', onPress: () => { onRead(item.id); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } },
                ]);
              } else {
                onRead(item.id);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
            }}
          >
            <Text style={[s.ctaText, { color: primary }]}>{item.cta}</Text>
          </TouchableOpacity>
        )}
      </View>
      {!item.read && <View style={[s.unreadDot, { backgroundColor: primary }]} />}
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const FRIEND_ORDER = ['maya', 'kai', 'jordan', 'sofia', 'amir'];

export default function InboxScreen() {
  const insets  = useSafeAreaInsets();
  const scheme  = useColorScheme();
  const router  = useRouter();
  const isDark  = scheme !== 'light';

  const bg      = isDark ? '#08080F' : '#F9F9FC';
  const fg      = isDark ? '#F0EEFF' : '#1A1035';
  const muted   = isDark ? '#6B6B8A' : '#6D6892';
  const border  = isDark ? '#1E1E30' : '#E8E6F0';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';

  // Trigger re-renders when store changes
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const unsub = subscribe(() => forceUpdate(n => n + 1));
    return () => { unsub(); };
  }, []);

  // Notification read state
  const [notifSections, setNotifSections] = useState(NOTIF_SECTIONS);
  function markNotifRead(id: string) {
    setNotifSections(prev =>
      prev.map(sec => ({ ...sec, data: sec.data.map(n => n.id === id ? { ...n, read: true } : n) })),
    );
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
      <View style={[s.header, { paddingTop: insets.top + 16, borderBottomColor: border }]}>
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[s.headerTitle, { color: fg }]}>Inbox</Text>
            {totalUnread > 0 && (
              <View style={[s.headerBadge, { backgroundColor: primary }]}>
                <Text style={s.headerBadgeText}>{totalUnread}</Text>
              </View>
            )}
          </View>
          <Text style={[s.headerSub, { color: muted }]}>
            Messages & activity
          </Text>
        </View>
        <TouchableOpacity
          style={[s.iconBtn, { borderColor: border }]}
          activeOpacity={0.7}
          onPress={() => Alert.alert('New Message', 'Choose a friend to start a conversation', [
            { text: 'Maya Chen',    onPress: () => openChat('maya')  },
            { text: 'Kai Nakamura',onPress: () => openChat('kai')   },
            { text: 'Jordan Lee',  onPress: () => openChat('jordan') },
            { text: 'Cancel', style: 'cancel' },
          ])}
        >
          <Feather name="edit" size={17} color={muted} />
        </TouchableOpacity>
      </View>

      {/* ── Messages section ── */}
      <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={[s.sectionTitle, { color: fg }]}>Messages</Text>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => openChat('maya')}
          >
            <Text style={[s.seeAll, { color: primary }]}>See all</Text>
          </TouchableOpacity>
        </View>

        <View style={{ gap: 10 }}>
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
        </View>
      </View>

      {/* ── Activity section ── */}
      <View style={{ paddingHorizontal: 20, marginTop: 32 }}>
        <Text style={[s.sectionTitle, { color: fg }, { marginBottom: 12 }]}>Activity</Text>

        {notifSections.map(section => (
          <View key={section.title}>
            <Text style={[s.dayLabel, { color: muted }]}>{section.title}</Text>
            <View style={{ gap: 8, marginBottom: 16 }}>
              {section.data.map(item => (
                <NotifRow key={item.id} item={item} isDark={isDark} onRead={markNotifRead} />
              ))}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  headerTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.6 },
  headerSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  headerBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  headerBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  sectionTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  seeAll:       { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  dayLabel:     { fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },

  // DM row
  dmRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 16, borderWidth: 1 },
  dmAvatar:   { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  dmInitials: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },
  onlineDot:  { position: 'absolute', bottom: 2, right: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: '#22C55E', borderWidth: 2 },
  dmName:     { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginBottom: 3 },
  dmPreview:  { fontSize: 12, fontFamily: 'Inter_400Regular' },
  dmTime:     { fontSize: 11, fontFamily: 'Inter_400Regular' },
  unreadBadge:{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, minWidth: 20, alignItems: 'center' },
  unreadText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#FFF' },

  // Notif row
  notifRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 13, borderRadius: 15, borderWidth: 1 },
  notifAvatarWrap:{ position: 'relative' },
  notifAvatar:    { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  notifInitials:  { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFF' },
  typeBadge:      { position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  notifTitle:     { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  notifTime:      { fontSize: 11, fontFamily: 'Inter_400Regular' },
  notifBody:      { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  ctaBtn:         { alignSelf: 'flex-start', marginTop: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 9, borderWidth: 1 },
  ctaText:        { fontSize: 12, fontFamily: 'Inter_700Bold' },
  unreadDot:      { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
});
