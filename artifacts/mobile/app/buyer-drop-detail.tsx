/**
 * Brandthread — Buyer Drop Detail
 * Shows a drop's products, countdown timer (if releaseAt is future), and seller info.
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Image, Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM, BORDER_ACTIVE,
  SUCCESS, SUCCESS_DIM, RED,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';

const { width: W } = Dimensions.get('window');

// ─── Countdown hook ───────────────────────────────────────────────────────────

interface CountdownParts {
  days: number; hours: number; minutes: number; seconds: number;
  isLive: boolean; isPast: boolean;
}

function useCountdown(releaseAt?: string | null): CountdownParts {
  function compute(): CountdownParts {
    if (!releaseAt) return { days: 0, hours: 0, minutes: 0, seconds: 0, isLive: true, isPast: true };
    const diff = new Date(releaseAt).getTime() - Date.now();
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, isLive: true, isPast: diff < -3600000 };
    const total = Math.floor(diff / 1000);
    return {
      days:    Math.floor(total / 86400),
      hours:   Math.floor((total % 86400) / 3600),
      minutes: Math.floor((total % 3600) / 60),
      seconds: total % 60,
      isLive:  false,
      isPast:  false,
    };
  }

  const [parts, setParts] = useState<CountdownParts>(compute);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setParts(compute());
    if (releaseAt) {
      intervalRef.current = setInterval(() => setParts(compute()), 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [releaseAt]);

  return parts;
}

// ─── Countdown display ────────────────────────────────────────────────────────

function CountdownBlock({ releaseAt, dropType }: { releaseAt?: string | null; dropType?: string }) {
  const { days, hours, minutes, seconds, isLive, isPast } = useCountdown(releaseAt);

  if (!releaseAt) return null;

  if (isLive && !isPast) {
    return (
      <View style={[cd.container, { backgroundColor: `${SUCCESS}18`, borderColor: `${SUCCESS}40` }]}>
        <View style={[cd.liveDot, { backgroundColor: SUCCESS }]} />
        <Text style={[cd.liveText, { color: SUCCESS }]}>Live Now — Shop available</Text>
      </View>
    );
  }

  if (isPast) {
    return (
      <View style={[cd.container, { backgroundColor: `${MUTED}15`, borderColor: BORDER }]}>
        <Text style={[cd.liveText, { color: MUTED }]}>Drop ended</Text>
      </View>
    );
  }

  const label = dropType === 'pre-made' ? 'Ships in' : 'Pre-order closes in';

  return (
    <View style={cd.container}>
      <Text style={cd.label}>{label}</Text>
      <View style={cd.timerRow}>
        {[{ v: days, u: 'days' }, { v: hours, u: 'hrs' }, { v: minutes, u: 'min' }, { v: seconds, u: 'sec' }].map(({ v, u }) => (
          <View key={u} style={cd.unit}>
            <View style={cd.unitBox}>
              <Text style={cd.unitNum}>{String(v).padStart(2, '0')}</Text>
            </View>
            <Text style={cd.unitLabel}>{u}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const cd = StyleSheet.create({
  container: {
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: `${PURPLE}40`,
    backgroundColor: PURPLE_DIM, padding: 16, marginHorizontal: 20, marginBottom: 16,
  },
  label: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, textAlign: 'center', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 },
  timerRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  unit: { alignItems: 'center', gap: 4, minWidth: 54 },
  unitBox: { backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 10, paddingVertical: 8, minWidth: 54, alignItems: 'center' },
  unitNum: { fontSize: 24, fontFamily: FONT.bold, color: PURPLE, letterSpacing: 1 },
  unitLabel: { fontSize: 10, fontFamily: FONT.regular, color: MUTED, textTransform: 'uppercase' },
  liveDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  liveText: { fontSize: FS.sm, fontFamily: FONT.semibold, textAlign: 'center' },
});

// ─── Product card ─────────────────────────────────────────────────────────────

interface DropProduct {
  id: string;
  name: string;
  description?: string;
  category?: string;
  images?: string[];
  isPreOrder?: boolean;
}

function ProductCard({ product, onPress }: { product: DropProduct; onPress: () => void }) {
  const img = product.images?.[0];
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.82} style={pc.card}>
      <View style={pc.imgBox}>
        {img ? (
          <Image source={{ uri: img }} style={pc.img} resizeMode="cover" />
        ) : (
          <View style={[pc.img, pc.imgPlaceholder]}>
            <Feather name="image" size={28} color={SUBTLE} />
          </View>
        )}
        {product.isPreOrder && (
          <View style={pc.badge}>
            <Text style={pc.badgeText}>Pre-order</Text>
          </View>
        )}
      </View>
      <Text style={pc.name} numberOfLines={2}>{product.name}</Text>
      {product.category && <Text style={pc.cat} numberOfLines={1}>{product.category}</Text>}
    </TouchableOpacity>
  );
}

const pc = StyleSheet.create({
  card: { width: (W - 20 * 2 - 12) / 2, backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  imgBox: { position: 'relative' },
  img: { width: '100%', height: (W - 20 * 2 - 12) / 2, backgroundColor: '#1a1a2a' },
  imgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 8, left: 8, backgroundColor: `${PURPLE}E0`, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 10, fontFamily: FONT.semibold, color: '#fff' },
  name: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 2 },
  cat: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, paddingHorizontal: 10, paddingBottom: 10 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

interface DropDetail {
  id: string;
  name: string;
  type: 'pre-order' | 'pre-made';
  status: string;
  releaseAt?: string | null;
  estimatedShipDate?: string | null;
  orderCount?: number;
  mfgProgress?: number;
  createdAt: string;
  seller?: { displayName?: string; brandName?: string; verified?: boolean } | null;
  products?: DropProduct[];
}

export default function BuyerDropDetail() {
  const { dropId, dropName } = useLocalSearchParams<{ dropId: string; dropName?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [drop, setDrop] = useState<DropDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dropId) { setError('No drop ID provided.'); setLoading(false); return; }
    api.publicDrops.get(dropId)
      .then((data: any) => setDrop(data))
      .catch(() => setError('Could not load this drop. It may no longer be active.'))
      .finally(() => setLoading(false));
  }, [dropId]);

  const sellerName = drop?.seller?.brandName ?? drop?.seller?.displayName ?? 'Seller';
  const products = drop?.products ?? [];

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={22} color={FG} />
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>{drop?.name ?? dropName ?? 'Drop'}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={PURPLE} /></View>
      ) : error ? (
        <View style={s.center}>
          <Feather name="alert-circle" size={30} color={MUTED} style={{ marginBottom: 12 }} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : drop ? (
        <ScrollView
          contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Seller + type row */}
          <View style={s.metaRow}>
            <View style={[s.avatar, { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE }]}>
              <Text style={s.avatarText}>{sellerName.slice(0, 2).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.sellerName}>{sellerName}</Text>
              <Text style={s.dropType}>{drop.type === 'pre-order' ? 'Pre-order drop' : 'Pre-made drop'}</Text>
            </View>
            {drop.seller?.verified && (
              <View style={s.verifiedBadge}>
                <Feather name="check" size={11} color={SUCCESS} />
                <Text style={s.verifiedText}>Verified</Text>
              </View>
            )}
          </View>

          {/* Stats row */}
          <View style={s.statsRow}>
            {drop.orderCount != null && (
              <View style={s.stat}>
                <Text style={s.statValue}>{drop.orderCount}</Text>
                <Text style={s.statLabel}>orders</Text>
              </View>
            )}
            {drop.mfgProgress != null && drop.mfgProgress > 0 && (
              <View style={s.stat}>
                <Text style={s.statValue}>{drop.mfgProgress}%</Text>
                <Text style={s.statLabel}>production</Text>
              </View>
            )}
            {products.length > 0 && (
              <View style={s.stat}>
                <Text style={s.statValue}>{products.length}</Text>
                <Text style={s.statLabel}>{products.length === 1 ? 'item' : 'items'}</Text>
              </View>
            )}
            {drop.estimatedShipDate && (
              <View style={s.stat}>
                <Text style={s.statValue} numberOfLines={1}>
                  {new Date(drop.estimatedShipDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </Text>
                <Text style={s.statLabel}>est. ship</Text>
              </View>
            )}
          </View>

          {/* Countdown timer */}
          <CountdownBlock releaseAt={drop.releaseAt} dropType={drop.type} />

          {/* Products section */}
          {products.length > 0 ? (
            <>
              <Text style={s.sectionTitle}>Items in this drop</Text>
              <View style={s.grid}>
                {products.map(p => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push((`/buyer-product-detail?productId=${p.id}&productName=${encodeURIComponent(p.name)}`) as never);
                    }}
                  />
                ))}
              </View>
            </>
          ) : (
            <View style={s.emptyProducts}>
              <Feather name="package" size={30} color={MUTED} style={{ marginBottom: 10 }} />
              <Text style={s.emptyText}>Products for this drop haven't been listed yet.</Text>
              <Text style={s.emptySubtext}>Check back closer to the release date.</Text>
            </View>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  header: {
    height: 56, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: SP.md,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title:   { flex: 1, fontSize: FS.base, fontFamily: FONT.semibold, color: FG, textAlign: 'center' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  errorText: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 20 },

  body: { paddingTop: SP.md },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, marginBottom: 14 },
  avatar:  { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: FS.sm, fontFamily: FONT.bold, color: PURPLE },
  sellerName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  dropType:   { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: SUCCESS_DIM, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 4 },
  verifiedText:  { fontSize: FS.xs, fontFamily: FONT.semibold, color: SUCCESS },

  statsRow: { flexDirection: 'row', justifyContent: 'center', gap: 0, marginBottom: 16, paddingHorizontal: 20 },
  stat:     { flex: 1, alignItems: 'center', paddingVertical: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, marginHorizontal: 3, borderRadius: RADIUS.sm },
  statValue: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  statLabel: { fontSize: 10, fontFamily: FONT.regular, color: MUTED, textTransform: 'uppercase', marginTop: 2 },

  sectionTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, paddingHorizontal: 20, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 12 },

  emptyProducts: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 40 },
  emptyText:    { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, textAlign: 'center', marginBottom: 6 },
  emptySubtext: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', lineHeight: 18 },
});
