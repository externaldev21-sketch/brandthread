import React, { useState, useRef, useEffect } from 'react';
import {
  Animated, Dimensions, Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View, useColorScheme, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const { width: W } = Dimensions.get('window');

// ─── Mock data ────────────────────────────────────────────────────────────────


const HERO_DROP = {
  brand: 'Vault Studio',
  handle: '@vaultstudio',
  initials: 'VS',
  brandColor: '#00C853',
  name: 'Canvas Cargo Jacket',
  tag: 'DROPPING TODAY',
  price: '$189',
  units: 50,
  remaining: 14,
  countdown: { h: 2, m: 14, s: 37 },
  gradient: ['#14110D', '#241708', '#0D0520'] as [string, string, string],
  accentGradient: ['#39FF88', '#00C853'] as [string, string],
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
  { id: 'd4', brand: 'Vault Studio',  name: 'Fleece Zip Jacket',      price: '$220', color: '#00C853', initials: 'VS', inHours: 23, live: false },
];

const TRENDING = [
  { id: 't1', rank: 1, brand: 'NxGen Drops',  name: 'Archive Hoodie Vol.3',   price: '$135', color: '#B45309', initials: 'NX', hype: '🔥 Hot'    },
  { id: 't2', rank: 2, brand: 'Vault Studio',  name: 'Canvas Cargo Jacket',    price: '$189', color: '#00C853', initials: 'VS', hype: '⚡ Live'   },
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

  const card    = isDark ? '#1B1917' : '#FFFFFF';
  const border  = isDark ? '#33302A' : '#E3DCC9';
  const fg      = isDark ? '#EDE7D9' : '#17140F';
  const muted   = isDark ? '#8C8577' : '#8080A0';
  const divider = isDark ? '#33302A' : '#EDE8DC';

  return (
    <View style={[s.hero, { backgroundColor: card, borderColor: border }]}>
      {/* Visual block — flat brand colour, no gradient/glow */}
      <View style={[s.heroVisual, { backgroundColor: HERO_DROP.brandColor }]}>
        <View style={s.heroTagRow}>
          <LiveDot color="#FFFFFF" />
          <Text style={s.heroTag}>{HERO_DROP.tag}</Text>
        </View>
        <View style={s.heroBrandRow}>
          <View style={s.heroBrandAvatar}>
            <Text style={[s.heroBrandInitials, { color: HERO_DROP.brandColor }]}>{HERO_DROP.initials}</Text>
          </View>
          <View>
            <Text style={s.heroBrandName}>{HERO_DROP.brand}</Text>
            <Text style={s.heroBrandHandle}>{HERO_DROP.handle}</Text>
          </View>
        </View>
      </View>

      <View style={{ padding: 18 }}>
        {/* Product name + price */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={[s.heroProductName, { color: fg }]}>{HERO_DROP.name}</Text>
          <Text style={[s.heroPrice, { color: fg }]}>{HERO_DROP.price}</Text>
        </View>

        {/* Countdown */}
        <View style={[s.countdown, { borderColor: divider }]}>
          {[
            { label: 'HRS', val: time.h },
            { label: 'MIN', val: time.m },
            { label: 'SEC', val: time.s },
          ].map(({ label, val }, i) => (
            <React.Fragment key={label}>
              {i > 0 && <View style={[s.countdownDivider, { backgroundColor: divider }]} />}
              <View style={s.countdownBlock}>
                <Text style={[s.countdownNum, { color: fg }]}>{pad(val)}</Text>
                <Text style={[s.countdownLabel, { color: muted }]}>{label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* Stock bar */}
        <View style={s.stockRow}>
          <View style={[s.stockBar, { backgroundColor: divider }]}>
            <View style={[s.stockFill, { width: `${soldPct}%` as any, backgroundColor: HERO_DROP.brandColor }]} />
          </View>
          <Text style={[s.stockText, { color: muted }]}>{HERO_DROP.remaining} left of {HERO_DROP.units}</Text>
        </View>

        {/* Actions */}
        <View style={s.heroActions}>
          <TouchableOpacity
            style={[s.heroShopBtn, { backgroundColor: HERO_DROP.brandColor }]}
            activeOpacity={0.85}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              Alert.alert(
                HERO_DROP.brand,
                `${HERO_DROP.name} · ${HERO_DROP.price}\n${HERO_DROP.remaining} left of ${HERO_DROP.units} — act fast!`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: '🔔 Notify Me',  onPress: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) },
                  { text: '🛍️ Shop Now',   onPress: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) },
                ],
              );
            }}
          >
            <Feather name="shopping-bag" size={15} color="#FFF" />
            <Text style={s.heroShopText}>Shop Drop — {HERO_DROP.price}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.heroSaveBtn, { borderColor: border }]}
            activeOpacity={0.8}
            onPress={() => { setSaved(v => !v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            <Feather name="bookmark" size={18} color={saved ? HERO_DROP.brandColor : muted} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── For-You card ─────────────────────────────────────────────────────────────

function ForYouCard({ item, isDark }: { item: typeof FOR_YOU[0]; isDark: boolean }) {
  const [saved, setSaved] = useState(false);
  const card   = isDark ? '#1B1917' : '#FFFFFF';
  const border = isDark ? '#33302A' : '#E3DCC9';
  const fg     = isDark ? '#EDE7D9' : '#17140F';
  const muted  = isDark ? '#8C8577' : '#8080A0';

  return (
    <TouchableOpacity
      style={[fy.card, { backgroundColor: card, borderColor: border }]}
      activeOpacity={0.85}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert(
          item.brand,
          `${item.name} · ${item.price}${item.originalPrice ? `\nWas ${item.originalPrice}` : ''}`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: '🔖 Save',      onPress: () => { setSaved(v => !v); } },
            { text: '🛍️ Shop Now', onPress: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) },
          ],
        );
      }}
    >
      <View style={[fy.visual, { backgroundColor: item.color }]}>
        <View style={fy.visualIcon}>
          <Feather name="shopping-bag" size={20} color={item.color} />
        </View>
        {item.tag && (
          <View style={fy.tagPill}>
            <Text style={fy.tagText}>{item.tag}</Text>
          </View>
        )}
        <TouchableOpacity
          style={fy.saveBtn}
          onPress={() => { setSaved(v => !v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          activeOpacity={0.8}
        >
          <Feather name="bookmark" size={14} color={saved ? '#FFFFFF' : '#FFFFFFB0'} />
        </TouchableOpacity>
      </View>
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
    </TouchableOpacity>
  );
}

const fy = StyleSheet.create({
  card:      { width: 158, borderRadius: 6, borderWidth: 1, overflow: 'hidden' },
  visual:    { height: 130, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  visualIcon:{ width: 40, height: 40, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  tagPill:   { position: 'absolute', top: 8, left: 8, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, backgroundColor: '#FFFFFF' },
  tagText:   { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#17140F', letterSpacing: 0.5, textTransform: 'uppercase' },
  saveBtn:   { position: 'absolute', top: 8, right: 8, width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  body:      { padding: 11 },
  dot:       { width: 15, height: 15, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  dotText:   { fontSize: 7, fontFamily: 'Inter_700Bold', color: '#FFF' },
  brand:     { fontSize: 10, fontFamily: 'Inter_500Medium', flex: 1 },
  name:      { fontSize: 12, fontFamily: 'Inter_700Bold', lineHeight: 16 },
  price:     { fontSize: 14, fontFamily: 'Inter_700Bold' },
  original:  { fontSize: 11, fontFamily: 'Inter_400Regular', textDecorationLine: 'line-through' },
});

// ─── Dropping-soon row ────────────────────────────────────────────────────────

function DroppingRow({ item, isDark }: { item: typeof DROPPING_SOON[0]; isDark: boolean }) {
  const card   = isDark ? '#1B1917' : '#FFFFFF';
  const border = isDark ? '#33302A' : '#E3DCC9';
  const fg     = isDark ? '#EDE7D9' : '#17140F';
  const muted  = isDark ? '#8C8577' : '#8080A0';

  return (
    <TouchableOpacity
      style={[dr.row, { backgroundColor: card, borderColor: border }]}
      activeOpacity={0.8}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Alert.alert(
          item.brand,
          `${item.name} · ${item.price}${item.live ? '\n🔴 Live now!' : `\nDrops in ${item.inHours}h`}`,
          [
            { text: 'Cancel', style: 'cancel' },
            item.live
              ? { text: '🛍️ Shop Now',  onPress: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) }
              : { text: '🔔 Notify Me', onPress: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) },
          ],
        );
      }}
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
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 6, borderWidth: 1 },
  avatar:   { width: 40, height: 40, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
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
  const card   = isDark ? '#1B1917' : '#FFFFFF';
  const border = isDark ? '#33302A' : '#E3DCC9';
  const fg     = isDark ? '#EDE7D9' : '#17140F';
  const muted  = isDark ? '#8C8577' : '#8080A0';
  const primary = isDark ? '#39FF88' : '#00C853';

  return (
    <TouchableOpacity
      style={[tr.row, { backgroundColor: card, borderColor: border }]}
      activeOpacity={0.8}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Alert.alert(
          item.brand,
          `${item.name} · ${item.price}\n${item.hype}`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: '🔖 Save',      onPress: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) },
            { text: '🛍️ Shop Now', onPress: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) },
          ],
        );
      }}
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
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 6, borderWidth: 1 },
  rank:     { fontSize: 14, fontFamily: 'Inter_700Bold', width: 28 },
  avatar:   { width: 40, height: 40, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFF' },
  name:     { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  brand:    { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  price:    { fontSize: 13, fontFamily: 'Inter_700Bold' },
  hype:     { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#39FF88' },
});

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHead({ title, sub, action, onAction }: { title: string; sub?: string; action?: string; onAction?: () => void }) {
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';
  const fg     = isDark ? '#EDE7D9' : '#17140F';
  const muted  = isDark ? '#8C8577' : '#8080A0';
  const primary = isDark ? '#39FF88' : '#00C853';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 }}>
      <View>
        <Text style={{ fontSize: 18, fontFamily: 'Inter_700Bold', color: fg, letterSpacing: -0.3 }}>{title}</Text>
        {sub && <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: muted, marginTop: 2 }}>{sub}</Text>}
      </View>
      {action && (
        <TouchableOpacity activeOpacity={0.7} onPress={() => { Haptics.selectionAsync(); onAction?.(); }}>
          <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: primary }}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const scheme  = useColorScheme();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const isDark  = scheme !== 'light';

  const bg      = isDark ? '#121110' : '#F4F3FA';
  const fg      = isDark ? '#EDE7D9' : '#17140F';
  const muted   = isDark ? '#8C8577' : '#8080A0';
  const border  = isDark ? '#1A1A28' : '#E3DCC9';
  const primary = isDark ? '#39FF88' : '#00C853';
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
          <Text style={[s.pageTitle, { color: fg }]}>Home</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            style={[s.headerBtn, { backgroundColor: isDark ? '#1B1917' : '#FFFFFF', borderColor: border }]}
            activeOpacity={0.75}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              Alert.alert('Search', 'Search for brands and drops coming soon 🔍', [{ text: 'OK' }]);
            }}
          >
            <Feather name="search" size={18} color={muted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.headerBtn, { backgroundColor: isDark ? '#1B1917' : '#FFFFFF', borderColor: border }]}
            activeOpacity={0.75}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(buyer)/inbox' as never); }}
          >
            <Feather name="bell" size={18} color={muted} />
            <View style={[s.notifDot, { backgroundColor: '#EF4444' }]} />
          </TouchableOpacity>
        </View>
      </View>

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
          onAction={() => router.push('/(buyer)/feed' as never)}
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
          onAction={() => router.push('/(buyer)/feed' as never)}
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


  hero: {
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
  },
  heroVisual: {
    padding: 18,
    minHeight: 150,
    justifyContent: 'space-between',
  },

  heroBrandRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroBrandAvatar: { width: 34, height: 34, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  heroBrandInitials: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  heroBrandName:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  heroBrandHandle: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#FFFFFFB0', marginTop: 1 },
  heroTagRow:      { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  heroTag:         { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#FFFFFF', letterSpacing: 0.8, textTransform: 'uppercase' },

  heroProductName: { flex: 1, fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.3, lineHeight: 25, marginRight: 12 },
  heroPrice:       { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },

  countdown:      { flexDirection: 'row', alignItems: 'center', gap: 0, marginBottom: 14, borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 10 },
  countdownBlock: { flex: 1, alignItems: 'center' },
  countdownNum:   { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  countdownLabel: { fontSize: 9, fontFamily: 'Inter_600SemiBold', letterSpacing: 1, marginTop: 2 },
  countdownDivider: { width: 1, height: 24 },

  stockRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  stockBar:  { flex: 1, height: 3, borderRadius: 0, overflow: 'hidden' },
  stockFill: { height: 3 },
  stockText: { fontSize: 11, fontFamily: 'Inter_500Medium' },

  heroActions:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroShopBtn:  { flex: 1, borderRadius: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 },
  heroShopText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  heroSaveBtn:  { width: 46, height: 46, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
