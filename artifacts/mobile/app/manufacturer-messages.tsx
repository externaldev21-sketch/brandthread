import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

// ─── Tokens ───────────────────────────────────────────────────────────────────
const BG     = '#0A0B0A';
const CARD   = '#131713';
const BORDER = '#1E221E';
const FG     = '#EAF2ED';
const MUTED  = '#5C6B5E';
const GREEN  = '#39FF88';

// ─── Mock manufacturer conversations ─────────────────────────────────────────
const CONVOS = [
  {
    id: 'manufacturer-ace',
    name: 'Ace Apparel Co.',
    location: 'Pakistan',
    initials: 'ACE',
    gradient: ['#1A2C1A', '#0F1F0F'] as [string, string],
    online: true,
    lastMsg: 'We have received your tech pack. Sample will be ready in 5 days.',
    time: '2m ago',
    unread: 2,
    tag: 'Sampling',
    tagColor: '#F97316',
  },
  {
    id: 'manufacturer-m2',
    name: 'Stitch Labs',
    location: 'Portugal',
    initials: 'SL',
    gradient: ['#1A1F2C', '#0F1520'] as [string, string],
    online: true,
    lastMsg: 'Can you confirm the pantone colors for the spring collection?',
    time: '1h ago',
    unread: 0,
    tag: 'In Production',
    tagColor: GREEN,
  },
  {
    id: 'manufacturer-m3',
    name: 'Elite Garments',
    location: 'Turkey',
    initials: 'EG',
    gradient: ['#2C1A1A', '#200F0F'] as [string, string],
    online: true,
    lastMsg: 'Production update: 60% completed. On track for delivery.',
    time: '3h ago',
    unread: 0,
    tag: 'In Production',
    tagColor: GREEN,
  },
  {
    id: 'manufacturer-m4',
    name: 'Apex Garment Co.',
    location: 'Guangzhou, CN',
    initials: 'AG',
    gradient: ['#1E2A1E', '#121A12'] as [string, string],
    online: false,
    lastMsg: 'Please send the revised tech pack when ready.',
    time: 'Yesterday',
    unread: 0,
    tag: 'Pending',
    tagColor: '#FBBF24',
  },
  {
    id: 'manufacturer-m5',
    name: 'Milano Couture',
    location: 'Milan, IT',
    initials: 'MC',
    gradient: ['#2A1A2C', '#1A0F20'] as [string, string],
    online: false,
    lastMsg: 'We can accommodate your MOQ of 150 units. Quote attached.',
    time: '2 days ago',
    unread: 0,
    tag: 'Quote',
    tagColor: '#0EA5E9',
  },
];

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ManufacturerMessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === 'web' ? 20 : insets.top;

  function openChat(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/chat/${id}` as never);
  }

  const totalUnread = CONVOS.reduce((n, c) => n + c.unread, 0);

  return (
    <View style={[s.root, { paddingTop: topPad }]}>

      {/* ── Nav ── */}
      <View style={s.nav}>
        <TouchableOpacity style={s.navIcon} onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Text style={s.navTitle}>Manufacturer Messages</Text>
          {totalUnread > 0 && (
            <Text style={s.navSub}>{totalUnread} unread</Text>
          )}
        </View>
        <TouchableOpacity
          style={s.navIcon}
          onPress={() => router.push('/manufacturer-onboard' as never)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="user-plus" size={19} color={FG} />
        </TouchableOpacity>
      </View>

      {/* ── List ── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {CONVOS.map((c, i) => (
          <TouchableOpacity
            key={c.id}
            style={[s.row, i > 0 && { borderTopWidth: 1, borderTopColor: BORDER }]}
            onPress={() => openChat(c.id)}
            activeOpacity={0.8}
          >
            {/* Avatar */}
            <View style={s.avatarWrap}>
              <LinearGradient colors={c.gradient} style={s.avatar}>
                <Text style={s.initials}>{c.initials}</Text>
              </LinearGradient>
              {c.online && <View style={s.onlineDot} />}
            </View>

            {/* Content */}
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Text style={[s.name, c.unread > 0 && { color: FG }]}>{c.name}</Text>
                <View style={[s.tagPill, { backgroundColor: c.tagColor + '22', borderColor: c.tagColor + '44' }]}>
                  <Text style={[s.tagText, { color: c.tagColor }]}>{c.tag}</Text>
                </View>
              </View>
              <Text style={s.location}>{c.location}</Text>
              <Text
                style={[s.preview, c.unread > 0 && s.previewBold]}
                numberOfLines={2}
              >
                {c.lastMsg}
              </Text>
            </View>

            {/* Right side */}
            <View style={{ alignItems: 'flex-end', gap: 6, marginTop: 2 }}>
              <Text style={s.time}>{c.time}</Text>
              {c.unread > 0 ? (
                <View style={s.badge}>
                  <Text style={s.badgeText}>{c.unread}</Text>
                </View>
              ) : (
                <Feather name="chevron-right" size={14} color={MUTED} />
              )}
            </View>
          </TouchableOpacity>
        ))}

        {/* ── Add manufacturer CTA ── */}
        <TouchableOpacity
          style={s.addCta}
          onPress={() => router.push('/manufacturer-onboard' as never)}
          activeOpacity={0.85}
        >
          <View style={s.addCtaIcon}>
            <Feather name="user-plus" size={18} color={GREEN} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.addCtaTitle}>Add a Manufacturer</Text>
            <Text style={s.addCtaSub}>Send an invite link to start a conversation</Text>
          </View>
          <Feather name="chevron-right" size={16} color={MUTED} />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  nav:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: BORDER },
  navIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  navTitle:{ fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  navSub:  { fontSize: 10, fontFamily: 'Inter_500Medium', color: GREEN },

  row:       { flexDirection: 'row', alignItems: 'flex-start', gap: 13, paddingHorizontal: 16, paddingVertical: 16 },
  avatarWrap:{ position: 'relative' },
  avatar:    { width: 48, height: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  initials:  { fontSize: 13, fontFamily: 'Inter_700Bold', color: GREEN },
  onlineDot: { position: 'absolute', bottom: 1, right: 1, width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN, borderWidth: 2, borderColor: BG },

  name:        { fontSize: 14, fontFamily: 'Inter_700Bold', color: FG },
  location:    { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  tagPill:     { borderRadius: 6, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  tagText:     { fontSize: 9, fontFamily: 'Inter_600SemiBold' },
  preview:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 17 },
  previewBold: { fontFamily: 'Inter_600SemiBold', color: FG + 'CC' },

  time:      { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  badge:     { width: 20, height: 20, borderRadius: 10, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#000' },

  addCta:      { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 14, marginTop: 10, backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 16 },
  addCtaIcon:  { width: 40, height: 40, borderRadius: 10, backgroundColor: '#0C2418', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: GREEN + '40' },
  addCtaTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: FG },
  addCtaSub:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },
});
