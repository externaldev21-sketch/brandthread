/**
 * Brandthread — Following / Drops
 * Shows brands the buyer follows, with their latest drops and real countdown timers.
 * Loads real active drops from /api/public/drops.
 * Never shows mock/invented brands — shows real empty state or retryable error instead.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  FlatList, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useApi } from '@/lib/api';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM,
  SUCCESS, RED, RED_DIM,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DropItem {
  id: string;
  name: string;
  type: 'pre-order' | 'pre-made';
  status: string;
  releaseAt?: string | null;
  estimatedShipDate?: string | null;
  orderCount?: number;
  mfgProgress?: number;
  createdAt: string;
  seller?: { displayName?: string; brandName?: string } | null;
  // Derived for display
  sellerName: string;
  sellerInitials: string;
  sellerColor: string;
  tag: string;
  tagColor: string;
  desc: string;
}

// ─── Countdown hook ───────────────────────────────────────────────────────────

interface CountdownParts { d: number; h: number; m: number; s: number; live: boolean }

function useCountdown(releaseAt?: string | null): CountdownParts {
  function compute(): CountdownParts {
    if (!releaseAt) return { d: 0, h: 0, m: 0, s: 0, live: true };
    const diff = new Date(releaseAt).getTime() - Date.now();
    if (diff <= 0) return { d: 0, h: 0, m: 0, s: 0, live: true };
    const t = Math.floor(diff / 1000);
    return { d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60, live: false };
  }
  const [parts, setParts] = useState<CountdownParts>(compute);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    setParts(compute());
    if (releaseAt) { ref.current = setInterval(() => setParts(compute()), 1000); }
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [releaseAt]);
  return parts;
}

// ─── Drop card ────────────────────────────────────────────────────────────────

const SELLER_COLORS = ['#8B5CF6','#0F766E','#B45309','#BE185D','#1D4ED8','#059669','#DC2626','#7C3AED'];
function colorForId(id: string) { return SELLER_COLORS[id.charCodeAt(0) % SELLER_COLORS.length]; }

function DropCard({ drop, onPress }: { drop: DropItem; onPress: () => void }) {
  const { d, h, m, s, live } = useCountdown(drop.releaseAt);
  const hasCountdown = !!drop.releaseAt && !live;
  const color = drop.sellerColor;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[c.card, { borderColor: BORDER }]}>
      {/* Visual area */}
      <LinearGradient colors={[color + 'CC', color + '44', BG + 'FF']} style={c.visual}>
        <View style={c.visualContent}>
          <Text style={c.dropName}>{drop.name}</Text>
          <View style={[c.typePill, { backgroundColor: color + '30', borderColor: color + '60' }]}>
            <Text style={[c.typeText, { color }]}>{drop.tag}</Text>
          </View>
        </View>

        {/* Countdown or Live badge */}
        {hasCountdown ? (
          <View style={c.countdownBar}>
            {[
              { v: d, u: 'd' }, { v: h, u: 'h' }, { v: m, u: 'm' }, { v: s, u: 's' },
            ].map(({ v, u }) => (
              <View key={u} style={c.countdownUnit}>
                <Text style={c.countdownNum}>{String(v).padStart(2, '0')}</Text>
                <Text style={c.countdownLabel}>{u}</Text>
              </View>
            ))}
          </View>
        ) : live ? (
          <View style={c.liveBadge}>
            <View style={c.liveDot} />
            <Text style={c.liveText}>Live Now</Text>
          </View>
        ) : null}
      </LinearGradient>

      {/* Info area */}
      <View style={c.info}>
        <View style={c.sellerRow}>
          <View style={[c.sellerDot, { backgroundColor: color }]}>
            <Text style={c.sellerInitials}>{drop.sellerInitials}</Text>
          </View>
          <Text style={c.sellerName} numberOfLines={1}>{drop.sellerName}</Text>
          {drop.estimatedShipDate && (
            <Text style={c.shipDate}>
              Ships {new Date(drop.estimatedShipDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </Text>
          )}
        </View>
        <Text style={c.desc} numberOfLines={2}>{drop.desc}</Text>
        <TouchableOpacity
          style={[c.shopBtn, { backgroundColor: color }]}
          activeOpacity={0.85}
          onPress={onPress}
        >
          <Feather name="shopping-bag" size={14} color="#FFF" />
          <Text style={c.shopBtnText}>{live ? 'Shop Drop' : 'View Drop'}</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const c = StyleSheet.create({
  card: { backgroundColor: CARD, borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden', marginBottom: 16 },
  visual: { height: 170, padding: 16, justifyContent: 'space-between' },
  visualContent: { gap: 8 },
  dropName: { fontSize: 20, fontFamily: FONT.bold, color: '#FFFFFF', lineHeight: 26 },
  typePill: { alignSelf: 'flex-start', borderRadius: RADIUS.pill, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  typeText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  countdownBar: { flexDirection: 'row', gap: 8, alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 6 },
  countdownUnit: { alignItems: 'center', minWidth: 28 },
  countdownNum: { fontSize: 16, fontFamily: FONT.bold, color: '#FFFFFF', lineHeight: 20 },
  countdownLabel: { fontSize: 9, fontFamily: FONT.regular, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${SUCCESS}CC`, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' },
  liveText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: '#FFFFFF' },
  info: { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sellerDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sellerInitials: { fontSize: 9, fontFamily: FONT.bold, color: '#FFFFFF' },
  sellerName: { flex: 1, fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  shipDate: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  desc: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 18 },
  shopBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: RADIUS.sm, paddingHorizontal: 14, paddingVertical: 8 },
  shopBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: '#FFFFFF' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function FollowingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();

  const [drops, setDrops] = useState<DropItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDrops = useCallback(() => {
    setLoading(true);
    setError(null);
    api.publicDrops.list()
      .then((raw: any) => {
        const list: any[] = Array.isArray(raw) ? raw : raw?.drops ?? [];
        const mapped: DropItem[] = list.map((d: any) => {
          const sellerName = d.seller?.brandName ?? d.seller?.displayName ?? 'Seller';
          const sellerInitials = sellerName.slice(0, 2).toUpperCase();
          const sellerColor = colorForId(d.id);
          const now = Date.now();
          const releaseMs = d.releaseAt ? new Date(d.releaseAt).getTime() : null;
          const tag = !releaseMs ? 'Live'
            : releaseMs > now ? 'Upcoming'
            : 'Live';
          return {
            ...d,
            sellerName,
            sellerInitials,
            sellerColor,
            tag,
            tagColor: sellerColor,
            desc: d.type === 'pre-order'
              ? `Pre-order — limited run. Ships ${d.estimatedShipDate ? new Date(d.estimatedShipDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'soon'}.`
              : `${d.orderCount ?? 0} orders placed so far.`,
          };
        });
        setDrops(mapped);
        setError(null);
      })
      .catch(() => {
        setError('Could not load drops. Check your connection and try again.');
      })
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => { loadDrops(); }, [loadDrops]);

  const liveCount = drops.filter(d => !d.releaseAt || new Date(d.releaseAt).getTime() <= Date.now()).length;
  const upcomingCount = drops.filter(d => d.releaseAt && new Date(d.releaseAt).getTime() > Date.now()).length;
  const subtitle = loading ? 'Loading drops…'
    : error ? 'Failed to load'
    : drops.length === 0 ? 'No drops yet'
    : upcomingCount > 0 ? `${upcomingCount} upcoming, ${liveCount} live`
    : `${liveCount} active drop${liveCount === 1 ? '' : 's'}`;

  // Avatar rows: from real drops only
  const avatarBrands = drops.map(d => ({
    id: d.id,
    initials: d.sellerInitials,
    color: d.sellerColor,
    handle: d.sellerName,
  }));

  return (
    <View style={[s.container, { backgroundColor: BG }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 16, borderBottomColor: BORDER }]}>
        <View>
          <Text style={[s.headerTitle, { color: FG }]}>Following</Text>
          <Text style={[s.headerSub, { color: MUTED }]}>{subtitle}</Text>
        </View>
        <TouchableOpacity style={[s.headerBtn, { borderColor: BORDER }]} activeOpacity={0.7}>
          <Feather name="user-plus" size={18} color={MUTED} />
        </TouchableOpacity>
      </View>

      {/* Brand avatars row — only shown when real drops exist */}
      {avatarBrands.length > 0 && (
        <View style={[s.avatarsRow, { borderBottomColor: BORDER }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.avatarsScroll}>
            {avatarBrands.map(brand => (
              <TouchableOpacity key={brand.id} style={s.avatarItem} activeOpacity={0.8}
                onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}>
                <LinearGradient colors={[PURPLE, '#6D28D9', PURPLE]} style={s.avatarRing}>
                  <View style={[s.avatarRingInner, { backgroundColor: BG }]}>
                    <View style={[s.avatarCircle, { backgroundColor: brand.color }]}>
                      <Text style={s.avatarInitials}>{brand.initials}</Text>
                    </View>
                  </View>
                </LinearGradient>
                <Text style={[s.avatarLabel, { color: MUTED }]} numberOfLines={1}>
                  {(brand.handle ?? '').replace('@', '').slice(0, 8)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Drop cards / loading / empty / error */}
      {loading ? (
        <View style={s.loadingWrap}><ActivityIndicator color={PURPLE} /></View>
      ) : error ? (
        <View style={s.centeredWrap}>
          <View style={s.errorBox}>
            <Feather name="wifi-off" size={32} color={RED} style={{ marginBottom: 12 }} />
            <Text style={s.errorTitle}>Couldn't load drops</Text>
            <Text style={s.errorBody}>{error}</Text>
            <TouchableOpacity
              style={s.retryBtn}
              activeOpacity={0.8}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                loadDrops();
              }}
            >
              <Feather name="refresh-cw" size={14} color={PURPLE} style={{ marginRight: 6 }} />
              <Text style={s.retryBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : drops.length === 0 ? (
        <View style={s.centeredWrap}>
          <Feather name="heart" size={36} color={MUTED} style={{ marginBottom: 12 }} />
          <Text style={s.emptyTitle}>No drops yet</Text>
          <Text style={s.emptyBody}>
            Follow sellers to see their latest drops here.{'\n'}New drops from sellers you follow will appear when they go live.
          </Text>
        </View>
      ) : (
        <FlatList
          data={drops}
          keyExtractor={d => d.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <DropCard
              drop={item}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push((`/buyer-drop-detail?dropId=${item.id}&dropName=${encodeURIComponent(item.name)}`) as never);
              }}
            />
          )}
        />
      )}
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
  headerTitle: { fontSize: 28, fontFamily: FONT.bold, letterSpacing: -0.6 },
  headerSub:   { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  headerBtn:   { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, borderWidth: 1 },

  avatarsRow:    { borderBottomWidth: 1 },
  avatarsScroll: { paddingHorizontal: 16, paddingVertical: 12, gap: 14 },
  avatarItem:    { alignItems: 'center', gap: 5, width: 60 },
  avatarRing:    { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  avatarRingInner: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  avatarCircle:  { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 13, fontFamily: FONT.bold, color: '#FFFFFF' },
  avatarLabel:   { fontSize: 10, fontFamily: FONT.regular, textAlign: 'center' },

  loadingWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centeredWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  // Error state
  errorBox: {
    alignItems: 'center', backgroundColor: RED_DIM, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: RED + '44', padding: SP.lg, width: '100%',
  },
  errorTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: FG, marginBottom: 6 },
  errorBody:  { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 18 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', marginTop: SP.md,
    backgroundColor: PURPLE_DIM, borderRadius: RADIUS.sm, borderWidth: 1,
    borderColor: PURPLE + '44', paddingHorizontal: SP.md, paddingVertical: SP.sm,
  },
  retryBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE },

  // Empty state
  emptyTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: FG, marginBottom: 8, textAlign: 'center' },
  emptyBody:  { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 20 },
});
