import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  useColorScheme, SectionList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

// ─── Mock data ────────────────────────────────────────────────────────────────

const INBOX_DATA = [
  {
    title: 'Today',
    data: [
      {
        id: 'n1',
        type: 'drop'     as const,
        read: false,
        avatar: '#7C3AED',
        initials: 'VS',
        title: 'Vault Studio drop is live',
        body: 'Canvas Cargo Jacket is now available — only 50 units.',
        time: '2h ago',
        cta: 'Shop now',
      },
      {
        id: 'n2',
        type: 'friend'   as const,
        read: false,
        avatar: '#BE185D',
        initials: 'MC',
        title: 'Maya Chen liked your post',
        body: 'She also saved the NxGen hoodie to her wishlist.',
        time: '4h ago',
        cta: null,
      },
      {
        id: 'n3',
        type: 'restock'  as const,
        read: false,
        avatar: '#B45309',
        initials: 'NX',
        title: 'Back in stock',
        body: 'Archive Hoodie Vol.3 by NxGen Drops — 8 units remaining.',
        time: '6h ago',
        cta: 'Buy now',
      },
    ],
  },
  {
    title: 'Yesterday',
    data: [
      {
        id: 'n4',
        type: 'order'    as const,
        read: true,
        avatar: '#0F766E',
        initials: 'BT',
        title: 'Order shipped',
        body: 'Your Essential Relaxed Tee from Meridian Co. is on its way.',
        time: '1d ago',
        cta: 'Track order',
      },
      {
        id: 'n5',
        type: 'friend'   as const,
        read: true,
        avatar: '#B45309',
        initials: 'SR',
        title: 'Sofia shared her wishlist',
        body: 'Check out what she\'s eyeing this season.',
        time: '1d ago',
        cta: 'View list',
      },
      {
        id: 'n6',
        type: 'drop'     as const,
        read: true,
        avatar: '#1D4ED8',
        initials: 'AG',
        title: 'Atlas Goods — new drop',
        body: 'City Chore Coat now available in sand and slate.',
        time: '1d ago',
        cta: 'Shop now',
      },
    ],
  },
  {
    title: 'Earlier',
    data: [
      {
        id: 'n7',
        type: 'order'    as const,
        read: true,
        avatar: '#0F766E',
        initials: 'BT',
        title: 'Order delivered',
        body: 'Canvas Cargo Jacket has been delivered. Leave a review?',
        time: '3d ago',
        cta: 'Review',
      },
      {
        id: 'n8',
        type: 'restock'  as const,
        read: true,
        avatar: '#065F46',
        initials: 'CF',
        title: 'Notify me — update',
        body: 'Raw Denim Jacket by Coldform is restocking next week.',
        time: '4d ago',
        cta: null,
      },
    ],
  },
];

type NotifType = 'drop' | 'friend' | 'restock' | 'order';

const TYPE_META: Record<NotifType, { icon: keyof typeof Feather.glyphMap; color: string; label: string }> = {
  drop:    { icon: 'zap',          color: '#7C3AED', label: 'Drop'    },
  friend:  { icon: 'users',        color: '#EC4899', label: 'Friend'  },
  restock: { icon: 'refresh-cw',   color: '#F59E0B', label: 'Restock' },
  order:   { icon: 'package',      color: '#22C55E', label: 'Order'   },
};

// ─── Inbox item ───────────────────────────────────────────────────────────────

function InboxItem({
  item, isDark, onRead,
}: {
  item: typeof INBOX_DATA[0]['data'][0];
  isDark: boolean;
  onRead: (id: string) => void;
}) {
  const card   = isDark ? '#111118' : '#FFFFFF';
  const border = isDark ? '#1E1E30' : '#E8E6F0';
  const fg     = isDark ? '#F0EEFF' : '#1A1035';
  const muted  = isDark ? '#6B6B8A' : '#6D6892';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';
  const meta   = TYPE_META[item.type];

  return (
    <TouchableOpacity
      style={[
        s.item,
        { backgroundColor: card, borderColor: border },
        !item.read && { borderLeftWidth: 3, borderLeftColor: primary },
      ]}
      activeOpacity={0.75}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onRead(item.id); }}
    >
      {/* Avatar + type badge */}
      <View style={s.avatarWrap}>
        <View style={[s.avatar, { backgroundColor: item.avatar }]}>
          <Text style={s.avatarText}>{item.initials}</Text>
        </View>
        <View style={[s.typeBadge, { backgroundColor: meta.color + '22' }]}>
          <Feather name={meta.icon} size={10} color={meta.color} />
        </View>
      </View>

      {/* Content */}
      <View style={s.content}>
        <View style={s.contentTop}>
          <Text
            style={[s.title, { color: fg }, !item.read && { fontFamily: 'Inter_700Bold' }]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text style={[s.time, { color: muted }]}>{item.time}</Text>
        </View>
        <Text style={[s.body, { color: muted }]} numberOfLines={2}>
          {item.body}
        </Text>
        {item.cta && (
          <TouchableOpacity
            style={[s.ctaBtn, { backgroundColor: primary + '18', borderColor: primary + '40' }]}
            activeOpacity={0.8}
          >
            <Text style={[s.ctaText, { color: primary }]}>{item.cta}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Unread dot */}
      {!item.read && (
        <View style={[s.unreadDot, { backgroundColor: primary }]} />
      )}
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';

  const [sections, setSections] = useState(INBOX_DATA);

  const bg      = isDark ? '#08080F' : '#F9F9FC';
  const fg      = isDark ? '#F0EEFF' : '#1A1035';
  const muted   = isDark ? '#6B6B8A' : '#6D6892';
  const border  = isDark ? '#1E1E30' : '#E8E6F0';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';

  const unreadCount = sections.flatMap(s => s.data).filter(n => !n.read).length;

  function markRead(id: string) {
    setSections(prev =>
      prev.map(section => ({
        ...section,
        data: section.data.map(item =>
          item.id === id ? { ...item, read: true } : item,
        ),
      })),
    );
  }

  function markAllRead() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSections(prev =>
      prev.map(section => ({
        ...section,
        data: section.data.map(item => ({ ...item, read: true })),
      })),
    );
  }

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 16, borderBottomColor: border }]}>
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[s.headerTitle, { color: fg }]}>Inbox</Text>
            {unreadCount > 0 && (
              <View style={[s.unreadBadge, { backgroundColor: primary }]}>
                <Text style={s.unreadBadgeText}>{unreadCount}</Text>
              </View>
            )}
          </View>
          <Text style={[s.headerSub, { color: muted }]}>
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </Text>
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={markAllRead} activeOpacity={0.7}>
            <Text style={[s.markAllText, { color: primary }]}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter pills */}
      <View style={[s.filterRow, { borderBottomColor: border }]}>
        {(['All', 'Drops', 'Orders', 'Friends'] as const).map((f, i) => (
          <TouchableOpacity
            key={f}
            style={[
              s.filterPill,
              i === 0
                ? { backgroundColor: primary, borderColor: primary }
                : { backgroundColor: 'transparent', borderColor: border },
            ]}
            activeOpacity={0.75}
            onPress={() => Haptics.selectionAsync()}
          >
            <Text style={[s.filterText, { color: i === 0 ? '#FFFFFF' : muted }]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: 16, paddingBottom: 120, gap: 8 }}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={[s.sectionLabel, { color: muted }]}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <View style={{ marginBottom: 8 }}>
            <InboxItem item={item} isDark={isDark} onRead={markRead} />
          </View>
        )}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1,
  },
  headerTitle:   { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.6 },
  headerSub:     { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  unreadBadge:   { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  unreadBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  markAllText:   { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  filterRow:   {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
  },
  filterPill:  { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  filterText:  { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  sectionLabel:{ fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 8, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.8 },

  item: {
    borderRadius: 16, borderWidth: 1, padding: 14,
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
  },
  avatarWrap:  { position: 'relative' },
  avatar:      { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  typeBadge:   {
    position: 'absolute', bottom: -2, right: -2,
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  content:     { flex: 1, gap: 3 },
  contentTop:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title:       { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  time:        { fontSize: 11, fontFamily: 'Inter_400Regular' },
  body:        { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  ctaBtn:      { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1 },
  ctaText:     { fontSize: 12, fontFamily: 'Inter_700Bold' },
  unreadDot:   { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
});
