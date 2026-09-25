/**
 * Brandthread — Following / Drops
 * Shows brands the buyer follows, with their latest drops and real countdown timers.
 * Loads real active drops from /api/public/drops.
 * Never shows mock/invented brands — shows real empty state when there are no drops.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useApi } from '@/lib/api';
import { PressableScale } from '@/components/BrandthreadUI';
import { SkeletonBlock, SkeletonLine } from '@/components/ui';
import { hapticPrimaryAction } from '@/lib/haptics';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { TYPE_SCALE, TABULAR_NUMS } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';

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

// Per-seller identity color, generated the same way as elsewhere in the app
// (e.g. buyer-friend-requests.tsx). This is data-driven brand identity, not UI
// chrome, so it is intentionally kept outside the theme token system.
const SELLER_COLORS = ['#0EA5E9', '#0F766E', '#B45309', '#BE185D', '#1D4ED8', '#059669', '#DC2626', '#0891B2'];
function colorForId(id: string) { return SELLER_COLORS[id.charCodeAt(0) % SELLER_COLORS.length]; }

function DropCard({ drop, onPress }: { drop: DropItem; onPress: () => void }) {
  const palette = useColors();
  const { d, h, m, s, live } = useCountdown(drop.releaseAt);
  const hasCountdown = !!drop.releaseAt && !live;
  const color = drop.sellerColor;

  return (
    <PressableScale onPress={onPress} style={[c.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
      {/* Visual area — seller-color gradient with a dark scrim so white text stays legible */}
      <LinearGradient
        colors={[color + 'CC', color + '44', palette.background + 'FF']} // theme-exempt: gradient scrim over a seller-color visual, not UI chrome
        style={c.visual}
      >
        <View style={c.visualContent}>
          <Text style={[TYPE_SCALE.title2, c.dropName]} numberOfLines={1}>{drop.name}</Text>
          <View style={[c.typePill, { backgroundColor: color + '30', borderColor: color + '60' }]}>
            <Text style={[TYPE_SCALE.caption, c.typeText, { color }]}>{drop.tag}</Text>
          </View>
        </View>

        {/* Countdown or Live badge */}
        {hasCountdown ? (
          <View style={c.countdownBar}>
            {[
              { v: d, u: 'd' }, { v: h, u: 'h' }, { v: m, u: 'm' }, { v: s, u: 's' },
            ].map(({ v, u }) => (
              <View key={u} style={c.countdownUnit}>
                <Text style={[TYPE_SCALE.headline, TABULAR_NUMS, c.countdownNum]}>{String(v).padStart(2, '0')}</Text>
                <Text style={[TYPE_SCALE.caption, c.countdownLabel]}>{u}</Text>
              </View>
            ))}
          </View>
        ) : live ? (
          <View style={[c.liveBadge, { backgroundColor: `${palette.success}CC` }]}>
            <View style={c.liveDot} />
            <Text style={[TYPE_SCALE.caption, c.liveText]}>Live now</Text>
          </View>
        ) : null}
      </LinearGradient>

      {/* Info area */}
      <View style={c.info}>
        <View style={c.sellerRow}>
          <View style={[c.sellerDot, { backgroundColor: color }]}>
            <Text style={[TYPE_SCALE.caption, c.sellerInitials]}>{drop.sellerInitials}</Text>
          </View>
          <Text style={[TYPE_SCALE.callout, c.sellerName, { color: palette.foreground }]} numberOfLines={1}>{drop.sellerName}</Text>
          {drop.estimatedShipDate && (
            <Text style={[TYPE_SCALE.footnote, { color: palette.mutedForeground }]} numberOfLines={1}>
              Ships {new Date(drop.estimatedShipDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </Text>
          )}
        </View>
        <Text style={[TYPE_SCALE.callout, c.desc, { color: palette.mutedForeground }]} numberOfLines={2}>{drop.desc}</Text>
        <PressableScale
          style={[c.shopBtn, { backgroundColor: color }]}
          onPress={() => { hapticPrimaryAction(); onPress(); }}
        >
          <Feather name="shopping-bag" size={14} color="#FFF" />
          <Text style={[TYPE_SCALE.callout, c.shopBtnText]}>{live ? 'Shop drop' : 'View drop'}</Text>
        </PressableScale>
      </View>
    </PressableScale>
  );
}

const c = StyleSheet.create({
  card: { borderRadius: RADII.card, borderWidth: 1, overflow: 'hidden', marginBottom: SPACING.md },
  visual: { height: 170, padding: SPACING.md, justifyContent: 'space-between' },
  visualContent: { gap: SPACING.xs },
  dropName: { color: '#FFFFFF' }, // theme-exempt: white text over a seller-color gradient scrim, not UI chrome
  typePill: { alignSelf: 'flex-start', borderRadius: RADII.pill, borderWidth: 1, paddingHorizontal: SPACING.xs + 2, paddingVertical: 4 },
  typeText: {},
  countdownBar: { flexDirection: 'row', gap: SPACING.xs, alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: RADII.chip, paddingHorizontal: SPACING.xs + 2, paddingVertical: 6 }, // theme-exempt: dark scrim over media
  countdownUnit: { alignItems: 'center', minWidth: 28 },
  countdownNum: { color: '#FFFFFF' }, // theme-exempt: white text over scrim
  countdownLabel: { color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' }, // theme-exempt: white text over scrim
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADII.pill, paddingHorizontal: SPACING.xs + 2, paddingVertical: 6, alignSelf: 'flex-start' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' },
  liveText: { color: '#FFFFFF' }, // theme-exempt: white text on the success scrim badge
  info: { paddingHorizontal: 14, paddingVertical: SPACING.sm, gap: SPACING.xs },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  sellerDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sellerInitials: { color: '#FFFFFF' }, // theme-exempt: initials on a per-seller identity color
  sellerName: { flex: 1 },
  desc: { lineHeight: 18 },
  shopBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: RADII.chip, paddingHorizontal: SPACING.md - 2, paddingVertical: SPACING.xs },
  shopBtnText: { color: '#FFFFFF' }, // theme-exempt: label on a per-seller identity color button
});

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function DropCardSkeleton() {
  return (
    <View style={c.card}>
      <SkeletonBlock width="100%" height={170} radius={0} />
      <View style={c.info}>
        <View style={c.sellerRow}>
          <SkeletonBlock width={24} height={24} radius={12} />
          <SkeletonLine width="40%" height={14} />
        </View>
        <SkeletonLine width="90%" height={12} />
        <SkeletonBlock width={100} height={28} radius={RADII.chip} />
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function FollowingScreen() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const insets = useSafeAreaInsets();
  const barInset = useBuyerTabBarInset();
  const router = useRouter();
  const api = useApi();

  const [drops, setDrops] = useState<DropItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDrops = useCallback(() => {
    setLoading(true);
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
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => { loadDrops(); }, [loadDrops]);

  const liveCount = drops.filter(d => !d.releaseAt || new Date(d.releaseAt).getTime() <= Date.now()).length;
  const upcomingCount = drops.filter(d => d.releaseAt && new Date(d.releaseAt).getTime() > Date.now()).length;
  const subtitle = loading ? 'Loading drops…'
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
    <View style={[s.container, { backgroundColor: palette.background }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + SPACING.md, borderBottomColor: palette.border }]}>
        <View>
          <Text style={[TYPE_SCALE.title1, s.headerTitle, { color: palette.foreground }]}>Following</Text>
          <Text style={[TYPE_SCALE.footnote, s.headerSub, { color: palette.mutedForeground }]}>{subtitle}</Text>
        </View>
      </View>

      {/* Brand avatars row — only shown when real drops exist */}
      {avatarBrands.length > 0 && (
        <View style={[s.avatarsRow, { borderBottomColor: palette.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.avatarsScroll}>
            {avatarBrands.map(brand => (
              <PressableScale
                key={brand.id}
                style={s.avatarItem}
                onPress={() => {
                  hapticPrimaryAction();
                  const drop = drops.find(d => d.id === brand.id);
                  if (drop) {
                    router.push((`/buyer-drop-detail?dropId=${drop.id}&dropName=${encodeURIComponent(drop.name)}`) as never);
                  }
                }}
              >
                <LinearGradient colors={[...theme.primaryGradient]} style={s.avatarRing}>
                  <View style={[s.avatarRingInner, { backgroundColor: palette.background }]}>
                    <View style={[s.avatarCircle, { backgroundColor: brand.color }]}>
                      <Text style={[TYPE_SCALE.footnote, s.avatarInitials]}>{brand.initials}</Text>
                    </View>
                  </View>
                </LinearGradient>
                <Text style={[TYPE_SCALE.caption, s.avatarLabel, { color: palette.mutedForeground }]} numberOfLines={1}>
                  {(brand.handle ?? '').replace('@', '').slice(0, 8)}
                </Text>
              </PressableScale>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Drop cards / loading / empty */}
      {loading ? (
        <View style={s.loadingWrap} accessibilityLabel="Loading drops">
          <DropCardSkeleton />
          <DropCardSkeleton />
        </View>
      ) : drops.length === 0 ? (
        <View style={s.centeredWrap}>
          <Feather name="heart" size={36} color={palette.mutedForeground} style={{ marginBottom: SPACING.sm }} />
          <Text style={[TYPE_SCALE.headline, s.emptyTitle, { color: palette.foreground }]}>No drops yet</Text>
          <Text style={[TYPE_SCALE.body, s.emptyBody, { color: palette.mutedForeground }]}>
            Follow sellers to see their latest drops here.{'\n'}New drops from sellers you follow will appear when they go live.
          </Text>
        </View>
      ) : (
        <FlatList
          data={drops}
          keyExtractor={d => d.id}
          contentContainerStyle={{ padding: SPACING.md, paddingBottom: Math.max(120, barInset + SPACING.md) }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <DropCard
              drop={item}
              onPress={() => {
                hapticPrimaryAction();
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
    paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm + 2, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { letterSpacing: -0.6 },
  headerSub:   { marginTop: 2 },

  avatarsRow:    { borderBottomWidth: StyleSheet.hairlineWidth },
  avatarsScroll: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: SPACING.md - 2 },
  avatarItem:    { alignItems: 'center', gap: 5, width: 60 },
  avatarRing:    { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  avatarRingInner: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  avatarCircle:  { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: '#FFFFFF' }, // theme-exempt: initials on a per-seller identity color
  avatarLabel:   { textAlign: 'center' },

  loadingWrap:  { flex: 1, padding: SPACING.md, gap: SPACING.md },
  centeredWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xxl },

  // Empty state
  emptyTitle: { marginBottom: SPACING.xs, textAlign: 'center' },
  emptyBody:  { textAlign: 'center', lineHeight: 20 },
});
