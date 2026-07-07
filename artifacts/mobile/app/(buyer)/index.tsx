import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  Platform, useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SectionHeader } from '@/components/SectionHeader';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

// ─── Mock data ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { label: 'All',        emoji: '✦' },
  { label: 'Streetwear', emoji: '🔥' },
  { label: 'Luxury',     emoji: '✨' },
  { label: 'Casual',     emoji: '☁️' },
  { label: 'Athletic',   emoji: '⚡' },
  { label: 'Vintage',    emoji: '🎞️' },
];

const FEATURED_DROP = {
  brand: 'Vault Studio',
  initials: 'VS',
  color: '#7C3AED',
  product: 'Canvas Cargo Jacket',
  price: '$189',
  desc: 'Limited run of 50. Oversized canvas jacket — dropping today at 12PM.',
  tag: 'DROPPING TODAY',
  countdown: '2h 14m left',
};

const NEW_DROPS = [
  { id: 'd1', brand: 'Softwear__',   name: 'Micro-Fleece Jogger', price: '$92',  color: '#BE185D', initials: 'SW' },
  { id: 'd2', brand: 'Meridian Co.', name: 'Relaxed Tee',          price: '$48',  color: '#0F766E', initials: 'MC' },
  { id: 'd3', brand: 'Atlas Goods',  name: 'Utility Vest',          price: '$220', color: '#1D4ED8', initials: 'AG' },
  { id: 'd4', brand: 'Coldform',     name: 'Raw Denim Jacket',      price: '$310', color: '#065F46', initials: 'CF' },
];

const TRENDING = [
  { id: 't1', rank: 1, brand: 'NxGen Drops',  desc: 'Archive Hoodie Vol. 3 — 8 left',       color: '#B45309', initials: 'NX', price: '$135' },
  { id: 't2', rank: 2, brand: 'Vault Studio',  desc: 'Canvas Cargo Jacket — dropping today', color: '#7C3AED', initials: 'VS', price: '$189' },
  { id: 't3', rank: 3, brand: 'Atlas Goods',   desc: 'Utility Vest — Slate — limited',       color: '#1D4ED8', initials: 'AG', price: '$220' },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const scheme  = useColorScheme();
  const insets  = useSafeAreaInsets();
  const isDark  = scheme !== 'light';

  const [activeCategory, setActiveCategory] = useState('All');
  const [savedDrops, setSavedDrops]         = useState<string[]>([]);

  const bg      = isDark ? '#08080F' : '#F9F9FC';
  const card    = isDark ? '#111118' : '#FFFFFF';
  const border  = isDark ? '#1E1E30' : '#E8E6F0';
  const fg      = isDark ? '#F0EEFF' : '#1A1035';
  const muted   = isDark ? '#6B6B8A' : '#6D6892';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';
  const topPad  = Platform.OS === 'web' ? 67 : insets.top;

  function toggleSave(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSavedDrops(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id],
    );
  }

  return (
    <ScrollView
      style={[s.container, { backgroundColor: bg }]}
      contentContainerStyle={{ paddingTop: topPad + 20, paddingBottom: 100 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[s.header, { paddingHorizontal: 20 }]}>
        <View>
          <Text style={[s.greeting, { color: muted }]}>Good morning 👋</Text>
          <Text style={[s.title, { color: fg }]}>Discover</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity style={[s.headerBtn, { backgroundColor: card, borderColor: border }]} activeOpacity={0.7}>
            <Feather name="search" size={18} color={muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[s.headerBtn, { backgroundColor: card, borderColor: border }]} activeOpacity={0.7}>
            <Feather name="bell" size={18} color={muted} />
            <View style={[s.notifDot, { backgroundColor: '#EF4444' }]} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Category pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 4 }}
        style={{ marginBottom: 20 }}
      >
        {CATEGORIES.map(cat => {
          const active = activeCategory === cat.label;
          return (
            <TouchableOpacity
              key={cat.label}
              onPress={() => { setActiveCategory(cat.label); Haptics.selectionAsync(); }}
              style={[s.catPill, { backgroundColor: active ? primary : card, borderColor: active ? primary : border }]}
              activeOpacity={0.8}
            >
              <Text style={s.catEmoji}>{cat.emoji}</Text>
              <Text style={[s.catLabel, { color: active ? '#FFFFFF' : fg }]}>{cat.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Featured drop hero */}
      <View style={{ paddingHorizontal: 20, marginBottom: 28 }}>
        <LinearGradient
          colors={isDark ? ['#2A1060', '#130828'] : ['#EDE9FE', '#C4B5FD']}
          style={[s.featuredCard, { borderColor: isDark ? '#9F7AEA22' : '#DDD6FE' }]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          {isDark && <View style={s.glowOrb} />}

          <View style={s.featuredTop}>
            <View style={s.featuredBrandRow}>
              <View style={[s.featuredAvatar, { backgroundColor: FEATURED_DROP.color }]}>
                <Text style={s.featuredAvatarText}>{FEATURED_DROP.initials}</Text>
              </View>
              <Text style={[s.featuredBrand, { color: isDark ? '#E0D4FF' : '#5B21B6' }]}>
                {FEATURED_DROP.brand}
              </Text>
            </View>
            <View style={[s.tagPill, { backgroundColor: FEATURED_DROP.color + '30', borderColor: FEATURED_DROP.color + '60' }]}>
              <View style={[s.tagDot, { backgroundColor: FEATURED_DROP.color }]} />
              <Text style={[s.tagText, { color: isDark ? '#E0D4FF' : FEATURED_DROP.color }]}>
                {FEATURED_DROP.tag}
              </Text>
            </View>
          </View>

          <Text style={[s.featuredName, { color: isDark ? '#FFFFFF' : '#1A1035' }]}>
            {FEATURED_DROP.product}
          </Text>
          <Text style={[s.featuredDesc, { color: isDark ? '#C4B5FD80' : '#7C3AED99' }]}>
            {FEATURED_DROP.desc}
          </Text>

          <View style={s.featuredBottom}>
            <View>
              <Text style={[s.featuredPrice, { color: isDark ? '#FFFFFF' : '#1A1035' }]}>
                {FEATURED_DROP.price}
              </Text>
              <Text style={[s.featuredCountdown, { color: isDark ? '#C4B5FD' : '#7C3AED' }]}>
                ⏱ {FEATURED_DROP.countdown}
              </Text>
            </View>
            <TouchableOpacity
              style={[s.shopBtn, { backgroundColor: primary }]}
              activeOpacity={0.85}
              onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
            >
              <Feather name="shopping-bag" size={14} color="#FFF" />
              <Text style={s.shopBtnText}>Shop Drop</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>

      {/* New Drops */}
      <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
        <SectionHeader title="New Drops" action="See all" />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 4 }}
        style={{ marginBottom: 28 }}
      >
        {NEW_DROPS.map(drop => {
          const isSaved = savedDrops.includes(drop.id);
          return (
            <View key={drop.id} style={[s.dropCard, { backgroundColor: card, borderColor: border }]}>
              <LinearGradient
                colors={[drop.color + 'CC', drop.color + '44']}
                style={s.dropVisual}
              >
                <View style={[s.dropIcon, { backgroundColor: '#FFFFFF25' }]}>
                  <Feather name="shopping-bag" size={20} color="#FFF" />
                </View>
              </LinearGradient>
              <View style={s.dropBody}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                  <View style={[s.brandDot, { backgroundColor: drop.color }]}>
                    <Text style={s.brandDotText}>{drop.initials[0]}</Text>
                  </View>
                  <Text style={[s.dropBrand, { color: muted }]} numberOfLines={1}>{drop.brand}</Text>
                </View>
                <Text style={[s.dropName, { color: fg }]} numberOfLines={2}>{drop.name}</Text>
                <Text style={[s.dropPrice, { color: drop.color }]}>{drop.price}</Text>
              </View>
              <TouchableOpacity onPress={() => toggleSave(drop.id)} style={s.saveBtn} activeOpacity={0.7}>
                <Feather name="bookmark" size={16} color={isSaved ? primary : muted} />
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      {/* Trending */}
      <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
        <SectionHeader title="Trending Now" />
      </View>
      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        {TRENDING.map(t => (
          <TouchableOpacity
            key={t.id}
            style={[s.trendRow, { backgroundColor: card, borderColor: border }]}
            activeOpacity={0.8}
            onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
          >
            <Text style={[s.trendRank, { color: primary }]}>#{t.rank}</Text>
            <View style={[s.trendAvatar, { backgroundColor: t.color }]}>
              <Text style={s.trendAvatarText}>{t.initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.trendBrand, { color: fg }]}>{t.brand}</Text>
              <Text style={[s.trendDesc, { color: muted }]} numberOfLines={1}>{t.desc}</Text>
            </View>
            <Text style={[s.trendPrice, { color: t.color }]}>{t.price}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:  { flex: 1 },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  greeting:   { fontSize: 13, fontFamily: 'Inter_400Regular' },
  title:      { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.6 },
  headerBtn:  { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  notifDot:   { position: 'absolute', top: 9, right: 9, width: 7, height: 7, borderRadius: 4 },

  catPill:    { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  catEmoji:   { fontSize: 13 },
  catLabel:   { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  featuredCard:    { borderRadius: 22, padding: 22, borderWidth: 1, overflow: 'hidden' },
  glowOrb:         { position: 'absolute', top: -40, right: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: '#7C3AED', opacity: 0.12 },
  featuredTop:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  featuredBrandRow:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  featuredAvatar:  { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  featuredAvatarText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#FFF' },
  featuredBrand:   { fontSize: 14, fontFamily: 'Inter_700Bold' },
  tagPill:         { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  tagDot:          { width: 6, height: 6, borderRadius: 3 },
  tagText:         { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  featuredName:    { fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: -0.4, marginBottom: 6 },
  featuredDesc:    { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19, marginBottom: 18 },
  featuredBottom:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  featuredPrice:   { fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  featuredCountdown: { fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 2 },
  shopBtn:         { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 20 },
  shopBtnText:     { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFF' },

  dropCard:   { width: 150, borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  dropVisual: { height: 120, alignItems: 'center', justifyContent: 'center' },
  dropIcon:   { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dropBody:   { padding: 10, paddingBottom: 4 },
  brandDot:   { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  brandDotText: { fontSize: 7, fontFamily: 'Inter_700Bold', color: '#FFF' },
  dropBrand:  { fontSize: 10, fontFamily: 'Inter_500Medium', flex: 1 },
  dropName:   { fontSize: 12, fontFamily: 'Inter_700Bold', lineHeight: 16, marginBottom: 3 },
  dropPrice:  { fontSize: 14, fontFamily: 'Inter_700Bold' },
  saveBtn:    { padding: 10, alignItems: 'center' },

  trendRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1 },
  trendRank:      { fontSize: 13, fontFamily: 'Inter_700Bold', width: 28 },
  trendAvatar:    { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  trendAvatarText:{ fontSize: 12, fontFamily: 'Inter_700Bold', color: '#FFF' },
  trendBrand:     { fontSize: 14, fontFamily: 'Inter_700Bold' },
  trendDesc:      { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  trendPrice:     { fontSize: 14, fontFamily: 'Inter_700Bold' },
});
