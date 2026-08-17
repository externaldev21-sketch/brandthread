/**
 * Discover — curated shopping home for buyers.
 * Hero drops, For You picks, Dropping Soon, and Trending brands.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  ActivityIndicator, Animated, Platform, RefreshControl, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';
import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, ON_DARK, ON_DARK_MUTED,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, SUCCESS, RED,
  FONT, FS, SP, RADIUS
} from '@/lib/theme';

// ─── Mock data ────────────────────────────────────────────────────────────────

const HERO_DROP = {
  brand: 'Vault Studio',
  handle: '@vaultstudio',
  initials: 'VS',
  brandColor: PURPLE,
  name: 'Canvas Cargo Jacket',
  tag: 'DROPPING TODAY',
  price: '$189',
  units: 50,
  remaining: 14,
  countdown: { h: 2, m: 14, s: 37 },
};

type ForYouItem = {
  id: string;
  /** Real DB product UUID — set for API-backed items so the detail screen
   *  loads the live product with correct variant IDs for checkout. */
  productId?: string;
  brand: string; name: string; price: string;
  originalPrice: string | null; color: string; initials: string; tag: string;
};

const FOR_YOU: ForYouItem[] = [
  { id: 'y1', brand: 'NxGen Drops',  name: 'Archive Hoodie Vol.3',   price: '$135', originalPrice: null,  color: '#B45309', initials: 'NX', tag: 'Archive' },
  { id: 'y2', brand: 'Coldform',     name: 'Raw Denim Jacket',        price: '$310', originalPrice: '$380', color: '#065F46', initials: 'CF', tag: 'Archive' },
  { id: 'y3', brand: 'Atlas Goods',  name: 'Waxed Field Jacket',      price: '$260', originalPrice: null,  color: '#1D4ED8', initials: 'AG', tag: 'Limited' },
  { id: 'y4', brand: 'Softwear__',   name: 'Oversized Crewneck',      price: '$88',  originalPrice: null,  color: '#BE185D', initials: 'SW', tag: 'New' },
];

const UNFOLLOWED_BRAND_POOL: ForYouItem[] = [
  { id: 'u1',  brand: 'Fernweh Supply',  name: 'Selvedge Trucker Jacket', price: '$225', originalPrice: null,  color: '#7C3AED', initials: 'FS', tag: 'New' },
  { id: 'u2',  brand: 'Northloom',       name: 'Brushed Fleece Half-Zip', price: '$142', originalPrice: null,  color: '#0891B2', initials: 'NL', tag: 'Archive' },
  { id: 'u3',  brand: 'Palisade',        name: 'Wide-Leg Twill Trouser',  price: '$168', originalPrice: '$210', color: '#9F1239', initials: 'PL', tag: 'Sale' },
  { id: 'u4',  brand: 'Grainhouse',      name: 'Heavyweight Canvas Tote', price: '$64',  originalPrice: null,  color: '#B45309', initials: 'GH', tag: 'New' },
  { id: 'u5',  brand: 'Late Bloom Co.',  name: 'Cropped Utility Vest',    price: '$118', originalPrice: null,  color: '#BE185D', initials: 'LB', tag: 'Limited' },
  { id: 'u6',  brand: 'Static Age',      name: 'Distressed Denim Set',    price: '$196', originalPrice: null,  color: '#334155', initials: 'SA', tag: 'Archive' },
  { id: 'u7',  brand: 'Overtone',        name: 'Merino Crewneck',         price: '$105', originalPrice: null,  color: '#065F46', initials: 'OT', tag: 'New' },
  { id: 'u8',  brand: 'Rowhouse',        name: 'Waxed Chore Coat',        price: '$275', originalPrice: '$340', color: '#78350F', initials: 'RH', tag: 'Sale' },
  { id: 'u9',  brand: 'Field & Fray',    name: 'Ripstop Cargo Shorts',    price: '$92',  originalPrice: null,  color: '#166534', initials: 'FF', tag: 'Limited' },
  { id: 'u10', brand: 'Amber Route',     name: 'Suede Trucker Cap',       price: '$54',  originalPrice: null,  color: '#92400E', initials: 'AR', tag: 'New' },
  { id: 'u11', brand: 'Hollow Point',    name: 'Boiled Wool Overshirt',   price: '$210', originalPrice: null,  color: '#1E293B', initials: 'HP', tag: 'Archive' },
  { id: 'u12', brand: 'Faint Signal',    name: 'Mesh Panel Runner',       price: '$78',  originalPrice: '$98',  color: '#3730A3', initials: 'FSg', tag: 'Sale' },
];

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const DROPPING_SOON = [
  { id: 'd1', brand: 'Meridian Co.',  name: 'Essential Tee — Sage',   price: '$48',  color: '#0F766E', initials: 'MC', inHours: 0,  live: true  },
  { id: 'd2', brand: 'NxGen Drops',   name: 'Cargo Trouser S/S',      price: '$134', color: '#B45309', initials: 'NX', inHours: 4,  live: false },
  { id: 'd3', brand: 'Rawthread',     name: 'Boxy Flannel Shirt',     price: '$96',  color: '#92400E', initials: 'RT', inHours: 9,  live: false },
  { id: 'd4', brand: 'Vault Studio',  name: 'Fleece Zip Jacket',      price: '$220', color: '#8B5CF6', initials: 'VS', inHours: 23, live: false },
];

const TRENDING = [
  { id: 't1', rank: 1, brand: 'NxGen Drops',  name: 'Archive Hoodie Vol.3',   price: '$135', color: '#B45309', initials: 'NX', hype: '🔥 Hot'    },
  { id: 't2', rank: 2, brand: 'Vault Studio',  name: 'Canvas Cargo Jacket',    price: '$189', color: '#8B5CF6', initials: 'VS', hype: '⚡ Live'   },
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
  }, [scale]);
  return (
    <View style={{ width: 10, height: 10, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, opacity: 0.35, transform: [{ scale }], position: 'absolute' }} />
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
    </View>
  );
}

// ─── Hero card ────────────────────────────────────────────────────────────────

function HeroCard() {
  const router  = useRouter();
  const time    = useCountdown(HERO_DROP.countdown);
  const [saved, setSaved] = useState(false);
  const soldPct = Math.round(((HERO_DROP.units - HERO_DROP.remaining) / HERO_DROP.units) * 100);

  const card    = CARD;
  const border  = BORDER;
  const fg      = FG;
  const muted   = MUTED;
  const divider = BORDER;

  return (
    <View style={[s.hero, { backgroundColor: card, borderColor: border }]}>
      <View style={[s.heroVisual, { backgroundColor: HERO_DROP.brandColor }]}>
        <View style={s.heroTagRow}>
          <LiveDot color={ON_DARK} />
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
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={[s.heroProductName, { color: fg }]}>{HERO_DROP.name}</Text>
          <Text style={[s.heroPrice, { color: fg }]}>{HERO_DROP.price}</Text>
        </View>

        <View style={[s.countdown, { borderColor: divider }]}>
          {[{ label: 'HRS', val: time.h }, { label: 'MIN', val: time.m }, { label: 'SEC', val: time.s }].map(({ label, val }, i) => (
            <React.Fragment key={label}>
              {i > 0 && <View style={[s.countdownDivider, { backgroundColor: divider }]} />}
              <View style={s.countdownBlock}>
                <Text style={[s.countdownNum, { color: fg }]}>{pad(val)}</Text>
                <Text style={[s.countdownLabel, { color: muted }]}>{label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>

        <View style={s.stockRow}>
          <View style={[s.stockBar, { backgroundColor: divider }]}>
            <View style={[s.stockFill, { width: `${soldPct}%` as any, backgroundColor: HERO_DROP.brandColor }]} />
          </View>
          <Text style={[s.stockText, { color: muted }]}>{HERO_DROP.remaining} left of {HERO_DROP.units}</Text>
        </View>

        <View style={s.heroActions}>
          <TouchableOpacity
            style={[s.heroShopBtn, { backgroundColor: HERO_DROP.brandColor }]}
            activeOpacity={0.85}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/buyer-product-detail?productId=prod_canvas_cargo&productName=Canvas+Cargo+Jacket' as never); }}
          >
            <Feather name="shopping-bag" size={15} color={ON_DARK} />
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

function ForYouCard({ item }: { item: ForYouItem }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const card   = CARD;
  const border = BORDER;
  const fg     = FG;
  const muted  = MUTED;

  return (
    <TouchableOpacity
      style={[fy.card, { backgroundColor: card, borderColor: border }]}
      activeOpacity={0.85}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        // Use real DB UUID when available (API-backed item), else fall back to the item's id
        const pid = encodeURIComponent(item.productId ?? item.id);
        const name = encodeURIComponent(item.name);
        router.push((`/buyer-product-detail?productId=${pid}&productName=${name}`) as never);
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
          <Feather name="bookmark" size={14} color={saved ? FG : MUTED} />
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
  visualIcon:{ width: 40, height: 40, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  tagPill:   { position: 'absolute', top: 8, left: 8, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, backgroundColor: BG },
  tagText:   { fontSize: 9, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: 0.5, textTransform: 'uppercase' },
  saveBtn:   { position: 'absolute', top: 8, right: 8, width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  body:      { padding: 11 },
  dot:       { width: 15, height: 15, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  dotText:   { fontSize: 7, fontFamily: 'Inter_700Bold', color: ON_DARK },
  brand:     { fontSize: 10, fontFamily: 'Inter_500Medium', flex: 1 },
  name:      { fontSize: 12, fontFamily: 'Inter_700Bold', lineHeight: 16 },
  price:     { fontSize: 14, fontFamily: 'Inter_700Bold' },
  original:  { fontSize: 11, fontFamily: 'Inter_400Regular', textDecorationLine: 'line-through' },
});

// ─── Dropping-soon row ────────────────────────────────────────────────────────

function DroppingRow({ item }: { item: typeof DROPPING_SOON[0] }) {
  const router = useRouter();
  const card   = CARD;
  const border = BORDER;
  const fg     = FG;
  const muted  = MUTED;

  return (
    <TouchableOpacity
      style={[dr.row, { backgroundColor: card, borderColor: border }]}
      activeOpacity={0.8}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(('/buyer-product-detail?productId=prod_ripstop_cargo&productName=' + encodeURIComponent(item.name)) as never); }}
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
            <LiveDot color={RED} />
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
  initials: { fontSize: 13, fontFamily: 'Inter_700Bold', color: ON_DARK },
  name:     { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  brand:    { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  price:    { fontSize: 13, fontFamily: 'Inter_700Bold' },
  liveRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: RED },
  eta:      { fontSize: 11, fontFamily: 'Inter_400Regular' },
});

// ─── Trending item type ───────────────────────────────────────────────────────
// Shared by both the static TRENDING fallback and the live API data.
// brandId is present for live items and used for seller-profile navigation.

type TrendingItem = {
  id: string;
  rank: number;
  brand: string;
  name: string;
  price: string;
  color: string;
  initials: string;
  hype: string;
  brandId?: string; // seller clerkId — present for live items, absent in static fallback
};

// ─── Trending row ─────────────────────────────────────────────────────────────

function TrendingRow({ item }: { item: TrendingItem }) {
  const router  = useRouter();
  const card    = CARD;
  const border  = BORDER;
  const fg      = FG;
  const muted   = MUTED;
  const primary = PURPLE;

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (item.brandId) {
      // Live item: navigate to the seller's storefront/profile
      router.push((`/seller-profile?sellerId=${encodeURIComponent(item.brandId)}`) as never);
    } else {
      // Static fallback: navigate by name (demo behaviour)
      router.push((`/buyer-product-detail?productId=${encodeURIComponent(item.id)}&productName=${encodeURIComponent(item.name)}`) as never);
    }
  }

  return (
    <TouchableOpacity
      style={[tr.row, { backgroundColor: card, borderColor: border }]}
      activeOpacity={0.8}
      onPress={handlePress}
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
  initials: { fontSize: 13, fontFamily: 'Inter_700Bold', color: ON_DARK },
  name:     { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  brand:    { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  price:    { fontSize: 13, fontFamily: 'Inter_700Bold' },
  hype:     { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: PURPLE },
});

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHead({ title, sub, action, onAction }: { title: string; sub?: string; action?: string; onAction?: () => void }) {
  const fg       = FG;
  const muted    = MUTED;
  const primary  = PURPLE;

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

export default function DiscoverScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const api     = useApi();

  const bg      = BG;
  const fg      = FG;
  const muted   = MUTED;
  const border  = BORDER;
  const primary = PURPLE;
  const topPad  = Platform.OS === 'web' ? 67 : insets.top;

  const [discoverItems, setDiscoverItems] = useState<ForYouItem[]>(() => shuffle(UNFOLLOWED_BRAND_POOL).slice(0, 4));
  const [refreshing, setRefreshing] = useState(false);
  // API-backed products replace the hardcoded FOR_YOU list when available
  const [liveForYou, setLiveForYou] = useState<ForYouItem[]>([]);
  const [forYouLoading, setForYouLoading] = useState(true);
  // Real trending data from /api/public/trending
  const [liveTrending, setLiveTrending] = useState<TrendingItem[]>([]);

  function fetchTrending() {
    api.publicTrending.get(20)
      .then((data) => {
        const items: TrendingItem[] = (data?.trending ?? []).map((t) => ({
          id:       t.id,
          rank:     t.rank,
          brand:    t.brand,
          brandId:  t.brandId,   // seller clerkId — used for correct navigation
          name:     t.caption ? t.caption.slice(0, 60) : 'Trending Post',
          price:    `${t.likesCount} ♥`,
          color:    PURPLE,
          initials: (t.brand ?? 'B').slice(0, 2).toUpperCase(),
          hype:     t.hype ?? '✨ Fresh',
        }));
        if (items.length > 0) setLiveTrending(items);
      })
      .catch(() => {/* fallback to hardcoded TRENDING */});
  }

  useEffect(() => { fetchTrending(); }, []);

  useEffect(() => {
    api.publicProducts.list({ limit: 8 })
      .then((rows) => {
        const items: ForYouItem[] = rows.map((row: any, i: number) => {
          const firstVariant = (row.variants ?? [])[0];
          const priceDollars = firstVariant ? (firstVariant.priceCents / 100).toFixed(0) : '0';
          return {
            id:            `live_${i}`,
            productId:     row.id,   // real DB UUID — used for navigation + checkout
            brand:         row.sellerDisplayName ?? 'Seller',
            name:          row.name,
            price:         `$${priceDollars}`,
            originalPrice: null,
            color:         PURPLE,
            initials:      (row.name ?? 'P')[0].toUpperCase(),
            tag:           (row.tags as string[] | undefined)?.[0] ?? 'New',
          };
        });
        if (items.length > 0) setLiveForYou(items);
        setForYouLoading(false);
      })
      .catch(() => { /* silent — fall back to static FOR_YOU */ setForYouLoading(false); });
  }, []);

  const forYouItems = liveForYou.length > 0 ? liveForYou : FOR_YOU;

  function handleRefresh() {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Reshuffle discover pool immediately; re-fetch live trending in parallel.
    setDiscoverItems(shuffle(UNFOLLOWED_BRAND_POOL).slice(0, 4));
    fetchTrending();
    setTimeout(() => setRefreshing(false), 500);
  }

  return (
    <ScrollView
      style={[s.container, { backgroundColor: bg }]}
      contentContainerStyle={{ paddingBottom: 110 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primary} colors={[primary]} />
      }
    >
      {/* ─ Header ─ */}
      <View style={[s.header, { paddingTop: topPad + 16, paddingHorizontal: 20 }]}>
        <View>
          <Text style={[s.greeting, { color: muted }]}>Good morning ✦</Text>
          <Text style={[s.pageTitle, { color: fg }]}>Discover</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            style={[s.headerBtn, { backgroundColor: CARD, borderColor: border }]}
            activeOpacity={0.75}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(buyer)/search' as never); }}
          >
            <Feather name="search" size={18} color={muted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.headerBtn, { backgroundColor: CARD, borderColor: border }]}
            activeOpacity={0.75}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(buyer)/inbox' as never); }}
          >
            <Feather name="bell" size={18} color={muted} />
            <View style={[s.notifDot, { backgroundColor: RED }]} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ─ Hero drop ─ */}
      <View style={{ paddingHorizontal: 20, marginBottom: 28 }}>
        <HeroCard />
      </View>

      {/* ─ For You ─ */}
      <View style={{ paddingHorizontal: 20, marginBottom: 4 }}>
        <SectionHead
          title="For You"
          sub="Based on your Archive Fashion taste"
          action="See all"
          onAction={() => router.push('/(buyer)/' as never)}
        />
      </View>
      {forYouLoading ? (
        <View style={{ paddingHorizontal: 20, height: 180, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={PURPLE} size="small" />
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 4 }}
          style={{ marginBottom: 32 }}
        >
          {forYouItems.map(item => <ForYouCard key={item.id} item={item} />)}
        </ScrollView>
      )}

      {/* ─ Discover — brands you don't follow, reshuffled on pull-to-refresh ─ */}
      <View style={{ paddingHorizontal: 20, marginBottom: 4 }}>
        <SectionHead
          title="Discover new brands"
          sub="Not following yet · pull to refresh"
          action="See all"
          onAction={() => router.push('/(buyer)/' as never)}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 4 }}
        style={{ marginBottom: 32 }}
      >
        {discoverItems.map(item => <ForYouCard key={item.id} item={item} />)}
      </ScrollView>

      {/* ─ Dropping Soon ─ */}
      <View style={{ paddingHorizontal: 20, marginBottom: 4 }}>
        <SectionHead
          title="Dropping Soon"
          sub="From brands you follow"
          action="All drops"
          onAction={() => router.push('/(buyer)/' as never)}
        />
      </View>
      <View style={{ paddingHorizontal: 20, gap: 10, marginBottom: 32 }}>
        {DROPPING_SOON.map(item => <DroppingRow key={item.id} item={item} />)}
      </View>

      {/* ─ Trending Near You ─ */}
      <View style={{ paddingHorizontal: 20, marginBottom: 4 }}>
        <SectionHead
          title="Trending Near You"
          sub={liveTrending.length > 0 ? 'Real-time engagement across the platform' : 'Most saved this week'}
        />
      </View>
      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        {(liveTrending.length > 0 ? liveTrending : TRENDING).map(item => (
          <TrendingRow key={item.id} item={item} />
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  greeting:  { fontSize: 12, fontFamily: 'Inter_500Medium', letterSpacing: 0.3 },
  pageTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.6 },
  headerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  notifDot:  { position: 'absolute', top: 9, right: 9, width: 7, height: 7, borderRadius: 4 },

  hero: { borderRadius: 6, overflow: 'hidden', borderWidth: 1 },
  heroVisual: { padding: 18, minHeight: 150, justifyContent: 'space-between' },

  heroBrandRow:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroBrandAvatar:   { width: 34, height: 34, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  heroBrandInitials: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  heroBrandName:     { fontSize: 14, fontFamily: 'Inter_700Bold', color: ON_DARK },
  heroBrandHandle:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: ON_DARK_MUTED, marginTop: 1 },
  heroTagRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  heroTag:           { fontSize: 10, fontFamily: 'Inter_700Bold', color: ON_DARK, letterSpacing: 0.8, textTransform: 'uppercase' },

  heroProductName: { flex: 1, fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.3, lineHeight: 25, marginRight: 12 },
  heroPrice:       { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },

  countdown:        { flexDirection: 'row', alignItems: 'center', gap: 0, marginBottom: 14, borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 10 },
  countdownBlock:   { flex: 1, alignItems: 'center' },
  countdownNum:     { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  countdownLabel:   { fontSize: 9, fontFamily: 'Inter_600SemiBold', letterSpacing: 1, marginTop: 2 },
  countdownDivider: { width: 1, height: 24 },

  stockRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  stockBar:  { flex: 1, height: 3, borderRadius: 0, overflow: 'hidden' },
  stockFill: { height: 3 },
  stockText: { fontSize: 11, fontFamily: 'Inter_500Medium' },

  heroActions:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroShopBtn:  { flex: 1, borderRadius: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 },
  heroShopText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: ON_DARK },
  heroSaveBtn:  { width: 46, height: 46, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
