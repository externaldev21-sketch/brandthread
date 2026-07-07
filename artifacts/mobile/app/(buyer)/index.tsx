import React, { useState, useRef, useEffect } from 'react';
import {
  Animated, Dimensions, Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View, useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

const { width: W } = Dimensions.get('window');

// ─── Mock data ────────────────────────────────────────────────────────────────

const BRAND_STORIES = [
  { id: 's1', name: 'Vault',     initials: 'VS', color: '#7C3AED', hasNew: true  },
  { id: 's2', name: 'NxGen',     initials: 'NX', color: '#B45309', hasNew: true  },
  { id: 's3', name: 'Softwear',  initials: 'SW', color: '#BE185D', hasNew: true  },
  { id: 's4', name: 'Meridian',  initials: 'MC', color: '#0F766E', hasNew: false },
  { id: 's5', name: 'Atlas',     initials: 'AG', color: '#1D4ED8', hasNew: true  },
  { id: 's6', name: 'Coldform',  initials: 'CF', color: '#065F46', hasNew: false },
  { id: 's7', name: 'Rawthread', initials: 'RT', color: '#92400E', hasNew: false },
];

const HERO_DROP = {
  brand: 'Vault Studio',
  handle: '@vaultstudio',
  initials: 'VS',
  brandColor: '#7C3AED',
  name: 'Canvas Cargo Jacket',
  tag: 'DROPPING TODAY',
  price: '$189',
  units: 50,
  remaining: 14,
  countdown: { h: 2, m: 14, s: 37 },
  gradient: ['#1A0A40', '#2D1060', '#0D0520'] as [string, string, string],
  accentGradient: ['#9F7AEA', '#7C3AED'] as [string, string],
};

const FOR_YOU = [
  { id: 'y1', brand: 'NxGen Drops',  name: 'Archive Hoodie Vol.3',   price: '$135', originalPrice: null,  color: '#B45309', initials: 'NX', tag: 'Archive' },
  { id: 'y2', brand: 'Coldform',     name: 'Raw Denim Jacket',        price: '$310', originalPrice: '$380', color: '#065F46', initials: 'CF', tag: 'Archive' },
  { id: 'y3', brand: 'Atlas Goods',  name: 'Waxed Field Jacket',      price: '$260', originalPrice: null,  color: '#1D4ED8', initials: 'AG', tag: 'Limited' },
  { id: 'y4', brand: 'Softwear__',   name: 'Oversized Crewneck',      price: '$88',  originalPrice: null,  color: '#BE185D', initials: 'SW', tag: 'New' },
];

const DROPPING_SOON = [
  { id: 'd1', brand: 'Meridian Co.',  name: 'Essential Tee — Sage',   price: '$48',  color: '#0F766E', initials: 'MC', inHours: 0,  live: true  },
  { id: 'd2', brand: 'NxGen Drops',   name: 'Cargo Trouser S/S',      price: '$134', color: '#B45309', initials: 'NX', inHours: 4,  live: false },
  { id: 'd3', brand: 'Rawthread',     name: 'Boxy Flannel Shirt',     price: '$96',  color: '#92400E', initials: 'RT', inHours: 9,  live: false },
  { id: 'd4', brand: 'Vault Studio',  name: 'Fleece Zip Jacket',      price: '$220', color: '#7C3AED', initials: 'VS', inHours: 23, live: false },
];

const TRENDING = [
  { id: 't1', rank: 1, brand: 'NxGen Drops',  name: 'Archive Hoodie Vol.3',   price: '$135', color: '#B45309', initials: 'NX', hype: '🔥 Hot'    },
  { id: 't2', rank: 2, brand: 'Vault Studio',  name: 'Canvas Cargo Jacket',    price: '$189', color: '#7C3AED', initials: 'VS', hype: '⚡ Live'   },
  { id: 't3', rank: 3, brand: 'Atlas Goods',   name: 'Utility Vest — Slate',   price: '$220', color: '#1D4ED8', initials: 'AG', hype: '⏳ Limited' },
  { id: 't4', rank: 4, brand: 'Coldform',      name: 'Raw Denim Jacket',       price: '$310', color: '#065F46', initials: 'CF', hype: '💎 Grail'  },
];

// ─── Countdown hook ───────────────────────────────────────────────────────────

function useCountdown(initial: { h: number; m: number; s: number }) {
  const [time, setTime] = useState(initial);
  useEffect(() => {
    const id = setInterval(() => {
      setTime(prev => {
        let { h, m, s } = prev;
        s--;
        if (s < 0) { s = 59; m--; }
        if (m < 0) { m = 59; h--; }
        if (h < 0) return { h: 0, m: 0, s: 0 };
        return { h, m, s };
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function pad(n: number) { return String(n).padStart(2, '0'); }

// ─── Live pulse dot ───────────────────────────────────────────────────────────

function LiveDot({ color }: { color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.6, duration: 700, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1,   duration: 700, useNativeDriver: true }),
      ]),
    ).start();
  }, []);
  return (
    <View style={{ width: 10, height: 10, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, opacity: 0.35, transform: [{ scale }], position: 'absolute' }} />
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
    </View>
  );
}

// ─── Hero card ────────────────────────────────────────────────────────────────

function HeroCard({ isDark }: { isDark: boolean }) {
  const time = useCountdown(HERO_DROP.countdown);
  const [saved, setSaved] = useState(false);
  const soldPct = Math.round(((HERO_DROP.units - HERO_DROP.remaining) / HERO_DROP.units) * 100);

  return (
    <LinearGradient
      colors={HERO_DROP.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={s.hero}
    >
      {/* Glow orbs */}
      <View style={[s.orb, s.orb1]} />
      <View style={[s.orb, s.orb2]} />

      {/* Brand row */}
      <View style={s.heroTopRow}>
        <View style={s.heroBrandRow}>
          <View style={[s.heroBrandAvatar, { backgroundColor: HERO_DROP.brandColor }]}>
            <Text style={s.heroBrandInitials}>{HERO_DROP.initials}</Text>
          </View>
          <View>
            <Text style={s.heroBrandName}>{HERO_DROP.brand}</Text>
            <Text style={s.heroBrandHandle}>{HERO_DROP.handle}</Text>
          </View>
        </View>
        <View style={s.heroTagRow}>
          <LiveDot color="#EF4444" />
          <Text style={s.heroTag}>{HERO_DROP.tag}</Text>
        </View>
      </View>

      {/* Product name */}
      <Text style={s.heroProductName}>{HERO_DROP.name}</Text>

      {/* Countdown */}
      <View style={s.countdown}>
        {[
          { label: 'HRS', val: time.h },
          { label: 'MIN', val: time.m },
          { label: 'SEC', val: time.s },
        ].map(({ label, val }, i) => (
          <React.Fragment key={label}>
            {i > 0 && <Text style={s.countdownColon}>:</Text>}
            <View style={s.countdownBlock}>
              <Text style={s.countdownNum}>{pad(val)}</Text>
              <Text style={s.countdownLabel}>{label}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>

      {/* Stock bar */}
      <View style={s.stockRow}>
        <View style={s.stockBar}>
          <View style={[s.stockFill, { width: `${soldPct}%` as any, backgroundColor: HERO_DROP.brandColor }]} />
        </View>
        <Text style={s.stockText}>{HERO_DROP.remaining} left of {HERO_DROP.units}</Text>
      </View>

      {/* Actions */}
      <View style={s.heroActions}>
        <TouchableOpacity
          style={s.heroShopBtn}
          activeOpacity={0.85}
          onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
        >
          <LinearGradient colors={HERO_DROP.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.heroShopGrad}>
            <Feather name="shopping-bag" size={15} color="#FFF" />
            <Text style={s.heroShopText}>Shop Drop — {HERO_DROP.price}</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.heroSaveBtn}
          activeOpacity={0.8}
          onPress={() => { setSaved(v => !v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Feather name="bookmark" size={18} color={saved ? '#9F7AEA' : '#FFFFFF80'} />
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

// ─── For-You card ─────────────────────────────────────────────────────────────

function ForYouCard({ item, isDark }: { item: typeof FOR_YOU[0]; isDark: boolean }) {
  const [saved, setSaved] = useState(false);
  const card   = isDark ? '#111118' : '#FFFFFF';
  const border = isDark ? '#1E1E30' : '#E8E6F0';
  const fg     = isDark ? '#F0EEFF' : '#1A1035';
  const muted  = isDark ? '#6B6B8A' : '#8080A0';

  return (
    <View style={[fy.card, { backgroundColor: card, borderColor: border }]}>
      <LinearGradient colors={[item.color + 'DD', item.color + '44']} style={fy.visual}>
        <View style={[fy.visualIcon, { backgroundColor: '#FFFFFF20' }]}>
          <Feather name="shopping-bag" size={22} color="#FFF" />
        </View>
        {item.tag && (
          <View style={[fy.tagPill, { backgroundColor: '#00000050' }]}>
            <Text style={fy.tagText}>{item.tag}</Text>
          </View>
        )}
        <TouchableOpacity
          style={fy.saveBtn}
          onPress={() => { setSaved(v => !v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          activeOpacity={0.8}
        >
          <Feather name="bookmark" size={14} color={saved ? '#9F7AEA' : '#FFFFFF'} />
        </TouchableOpacity>
      </LinearGradient>
      <View style={fy.body}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 }}>
          <View style={[fy.dot, { backgroundColor: item.color }]}>
            <Text style={fy.dotText}>{item.initials[0]}</Text>
          </View>
          <Text style={[fy.brand, { color: muted }]} numberOfLines={1}>{item.brand}</Text>
        </View>
        <Text style={[fy.name, { color: fg }]} numberOfLines={2}>{item.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <Text style={[fy.price, { color: item.color }]}>{item.price}</Text>
          {item.originalPrice && (
            <Text style={[fy.original, { color: muted }]}>{item.originalPrice}</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const fy = StyleSheet.create({
  card:      { width: 160, borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  visual:    { height: 140, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  visualIcon:{ width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  tagPill:   { position: 'absolute', top: 9, left: 9, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  tagText:   { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#FFFFFF', letterSpacing: 0.5, textTransform: 'uppercase' },
  saveBtn:   { position: 'absolute', top: 9, right: 9, width: 28, height: 28, borderRadius: 14, backgroundColor: '#00000040', alignItems: 'center', justifyContent: 'center' },
  body:      { padding: 11 },
  dot:       { width: 15, height: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dotText:   { fontSize: 7, fontFamily: 'Inter_700Bold', color: '#FFF' },
  brand:     { fontSize: 10, fontFamily: 'Inter_500Medium', flex: 1 },
  name:      { fontSize: 12, fontFamily: 'Inter_700Bold', lineHeight: 16 },
  price:     { fontSize: 14, fontFamily: 'Inter_700Bold' },
  original:  { fontSize: 11, fontFamily: 'Inter_400Regular', textDecorationLine: 'line-through' },
});

// ─── Dropping-soon row ────────────────────────────────────────────────────────

function DroppingRow({ item, isDark }: { item: typeof DROPPING_SOON[0]; isDark: boolean }) {
  const card   = isDark ? '#111118' : '#FFFFFF';
  const border = isDark ? '#1E1E30' : '#E8E6F0';
  const fg     = isDark ? '#F0EEFF' : '#1A1035';
  const muted  = isDark ? '#6B6B8A' : '#8080A0';

  return (
    <TouchableOpacity
      style={[dr.row, { backgroundColor: card, borderColor: border }]}
      activeOpacity={0.8}
      onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
    >
      <View style={[dr.avatar, { backgroundColor: item.color }]}>
        <Text style={dr.initials}>{item.initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[dr.name, { color: fg }]}>{item.name}</Text>
        <Text style={[dr.brand, { color: muted }]}>{item.brand}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={[dr.price, { color: fg }]}>{item.price}</Text>
        {item.live ? (
          <View style={dr.liveRow}>
            <LiveDot color="#EF4444" />
            <Text style={dr.liveText}>Live now</Text>
          </View>
        ) : (
          <Text style={[dr.eta, { color: muted }]}>in {item.inHours}h</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const dr = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 15, borderWidth: 1 },
  avatar:   { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFF' },
  name:     { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  brand:    { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  price:    { fontSize: 13, fontFamily: 'Inter_700Bold' },
  liveRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#EF4444' },
  eta:      { fontSize: 11, fontFamily: 'Inter_400Regular' },
});

// ─── Trending row ─────────────────────────────────────────────────────────────

function TrendingRow({ item, isDark }: { item: typeof TRENDING[0]; isDark: boolean }) {
  const card   = isDark ? '#111118' : '#FFFFFF';
  const border = isDark ? '#1E1E30' : '#E8E6F0';
  const fg     = isDark ? '#F0EEFF' : '#1A1035';
  const muted  = isDark ? '#6B6B8A' : '#8080A0';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';

  return (
    <TouchableOpacity
      style={[tr.row, { backgroundColor: card, borderColor: border }]}
      activeOpacity={0.8}
      onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
    >
      <Text style={[tr.rank, { color: primary }]}>#{item.rank}</Text>
      <View style={[tr.avatar, { backgroundColor: item.color }]}>
        <Text style={tr.initials}>{item.initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[tr.name, { color: fg }]}>{item.name}</Text>
        <Text style={[tr.brand, { color: muted }]}>{item.brand}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={[tr.price, { color: item.color }]}>{item.price}</Text>
        <Text style={tr.hype}>{item.hype}</Text>
      </View>
    </TouchableOpacity>
  );
}

const tr = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 15, borderWidth: 1 },
  rank:     { fontSize: 14, fontFamily: 'Inter_700Bold', width: 28 },
  avatar:   { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFF' },
  name:     { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  brand:    { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  price:    { fontSize: 13, fontFamily: 'Inter_700Bold' },
  hype:     { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#9F7AEA' },
});

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHead({ title, sub, action }: { title: string; sub?: string; action?: string }) {
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';
  const fg     = isDark ? '#F0EEFF' : '#1A1035';
  const muted  = isDark ? '#6B6B8A' : '#8080A0';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 }}>
      <View>
        <Text style={{ fontSize: 18, fontFamily: 'Inter_700Bold', color: fg, letterSpacing: -0.3 }}>{title}</Text>
        {sub && <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: muted, marginTop: 2 }}>{sub}</Text>}
      </View>
      {action && (
        <TouchableOpacity activeOpacity={0.7} onPress={() => Haptics.selectionAsync()}>
          <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: primary }}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function InspoScreen() {
  const scheme  = useColorScheme();
  const insets  = useSafeAreaInsets();
  const isDark  = scheme !== 'light';

  const bg      = isDark ? '#08080F' : '#F4F3FA';
  const fg      = isDark ? '#F0EEFF' : '#1A1035';
  const muted   = isDark ? '#6B6B8A' : '#8080A0';
  const border  = isDark ? '#1A1A28' : '#E8E6F0';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';
  const topPad  = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <ScrollView
      style={[s.container, { backgroundColor: bg }]}
      contentContainerStyle={{ paddingBottom: 110 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ─ Header ─ */}
      <View style={[s.header, { paddingTop: topPad + 16, paddingHorizontal: 20 }]}>
        <View>
          <Text style={[s.greeting, { color: muted }]}>Good morning ✦</Text>
          <Text style={[s.pageTitle, { color: fg }]}>Inspo</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            style={[s.headerBtn, { backgroundColor: isDark ? '#111118' : '#FFFFFF', borderColor: border }]}
            activeOpacity={0.75}
          >
            <Feather name="search" size={18} color={muted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.headerBtn, { backgroundColor: isDark ? '#111118' : '#FFFFFF', borderColor: border }]}
            activeOpacity={0.75}
          >
            <Feather name="bell" size={18} color={muted} />
            <View style={[s.notifDot, { backgroundColor: '#EF4444' }]} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ─ Brand story bubbles ─ */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 14, paddingVertical: 16 }}
      >
        {BRAND_STORIES.map(brand => (
          <TouchableOpacity
            key={brand.id}
            style={s.storyItem}
            activeOpacity={0.8}
            onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
          >
            {brand.hasNew ? (
              <LinearGradient
                colors={['#F0ABFC', '#C026D3', '#7C3AED']}
                style={s.storyRing}
              >
                <View style={[s.storyRingInner, { backgroundColor: bg }]}>
                  <View style={[s.storyAvatar, { backgroundColor: brand.color }]}>
                    <Text style={s.storyInitials}>{brand.initials}</Text>
                  </View>
                </View>
              </LinearGradient>
            ) : (
              <View style={[s.storyRingViewed, { borderColor: border }]}>
                <View style={[s.storyAvatar, { backgroundColor: brand.color }]}>
                  <Text style={s.storyInitials}>{brand.initials}</Text>
                </View>
              </View>
            )}
            <Text style={[s.storyLabel, { color: muted }]} numberOfLines={1}>{brand.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ─ Hero drop ─ */}
      <View style={{ paddingHorizontal: 20, marginBottom: 28 }}>
        <HeroCard isDark={isDark} />
      </View>

      {/* ─ For You ─ */}
      <View style={{ paddingHorizontal: 20, marginBottom: 4 }}>
        <SectionHead
          title="For You"
          sub="Based on your Archive Fashion taste"
          action="See all"
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 4 }}
        style={{ marginBottom: 32 }}
      >
        {FOR_YOU.map(item => (
          <ForYouCard key={item.id} item={item} isDark={isDark} />
        ))}
      </ScrollView>

      {/* ─ Dropping Soon ─ */}
      <View style={{ paddingHorizontal: 20, marginBottom: 4 }}>
        <SectionHead
          title="Dropping Soon"
          sub="From brands you follow"
          action="All drops"
        />
      </View>
      <View style={{ paddingHorizontal: 20, gap: 10, marginBottom: 32 }}>
        {DROPPING_SOON.map(item => (
          <DroppingRow key={item.id} item={item} isDark={isDark} />
        ))}
      </View>

      {/* ─ Trending ─ */}
      <View style={{ paddingHorizontal: 20, marginBottom: 4 }}>
        <SectionHead title="Trending" sub="Most saved this week" />
      </View>
      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        {TRENDING.map(item => (
          <TrendingRow key={item.id} item={item} isDark={isDark} />
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Hero styles ──────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  greeting:  { fontSize: 12, fontFamily: 'Inter_500Medium', letterSpacing: 0.3 },
  pageTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.6 },
  headerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  notifDot:  { position: 'absolute', top: 9, right: 9, width: 7, height: 7, borderRadius: 4 },

  storyItem:       { alignItems: 'center', gap: 5, width: 60 },
  storyRing:       { width: 60, height: 60, borderRadius: 30, padding: 2.5, alignItems: 'center', justifyContent: 'center' },
  storyRingViewed: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  storyRingInner:  { width: 53, height: 53, borderRadius: 27, padding: 2, alignItems: 'center', justifyContent: 'center' },
  storyAvatar:     { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  storyInitials:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  storyLabel:      { fontSize: 10, fontFamily: 'Inter_500Medium', textAlign: 'center', width: 60 },

  hero: {
    borderRadius: 24,
    padding: 22,
    overflow: 'hidden',
    minHeight: 260,
  },
  orb:  { position: 'absolute', borderRadius: 999, opacity: 0.18 },
  orb1: { width: 220, height: 220, backgroundColor: '#7C3AED', top: -80, right: -60 },
  orb2: { width: 160, height: 160, backgroundColor: '#C026D3', bottom: -60, left: -40 },

  heroTopRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  heroBrandRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroBrandAvatar: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  heroBrandInitials: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#FFF' },
  heroBrandName:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  heroBrandHandle: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#FFFFFF70', marginTop: 1 },
  heroTagRow:      { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FF000025', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: '#FF000040' },
  heroTag:         { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#FF6B6B', letterSpacing: 0.5 },

  heroProductName: { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#FFFFFF', letterSpacing: -0.5, lineHeight: 32, marginBottom: 16 },

  countdown:      { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 14 },
  countdownBlock: { alignItems: 'center', backgroundColor: '#FFFFFF18', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  countdownNum:   { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#FFFFFF', letterSpacing: -0.5 },
  countdownLabel: { fontSize: 8, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF70', letterSpacing: 1, marginTop: 1 },
  countdownColon: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#FFFFFF50', marginBottom: 10 },

  stockRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  stockBar:  { flex: 1, height: 4, borderRadius: 2, backgroundColor: '#FFFFFF20', overflow: 'hidden' },
  stockFill: { height: 4, borderRadius: 2 },
  stockText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: '#FFFFFF80' },

  heroActions:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroShopBtn:  { flex: 1, borderRadius: 14, overflow: 'hidden' },
  heroShopGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 },
  heroShopText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  heroSaveBtn:  { width: 46, height: 46, borderRadius: 14, backgroundColor: '#FFFFFF15', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF20' },
});
