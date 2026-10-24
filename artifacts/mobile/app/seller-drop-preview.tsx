/**
 * Seller drop preview — lets a seller see roughly how their drop will look
 * to buyers, regardless of status (including 'draft', which the public
 * endpoint 404s on). Fetches via the seller-authed api.drops.get(dropId).
 *
 * This is a standalone, condensed re-implementation of the hero/countdown/
 * grid look from buyer-drop-detail.tsx rather than a shared component — a
 * full extraction into a shared `DropDetailView` was judged too large a
 * refactor for this pass given the rest of the scope. Follow-up: de-dupe
 * this against buyer-drop-detail.tsx's rendering.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Dimensions, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useApi } from '@/lib/api';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, ON_DARK, ON_DARK_MUTED, RADIUS, SP } from '@/lib/theme';
import { computeCountdownParts } from '@/lib/dropCountdown';
import { EmptyState, LoadingSkeleton } from '@/components/BrandthreadUI';
import { goBackOr } from '@/lib/navigation/goBackOr';

const { width: W } = Dimensions.get('window');
const HERO_H = Math.max(420, Math.min(540, W * 1.2));

interface PreviewProduct {
  id: string;
  name: string;
  images?: string[];
  stockRemaining?: number;
}

interface PreviewDrop {
  id: string;
  name: string;
  status: string;
  releaseAt?: string | null;
  endsAt?: string | null;
  heroImageUrl?: string | null;
  heroVideoUrl?: string | null;
  earlyAccessMinutes?: number;
  products?: PreviewProduct[];
}

export default function SellerDropPreview() {
  const api = useApi();
  const router = useRouter();
  const headerTopInset = useHeaderTopInset();
  const { theme } = useAppTheme();
  const { dropId } = useLocalSearchParams<{ dropId: string }>();

  const [drop, setDrop] = useState<PreviewDrop | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const [loadAttempt, setLoadAttempt] = useState(0);
  const retry = useCallback(() => { setLoading(true); setLoadAttempt(n => n + 1); }, []);

  useEffect(() => {
    let active = true;
    if (!dropId) { setLoading(false); return () => { active = false; }; }
    api.drops.get(dropId).then((data: any) => {
      if (!active) return;
      setDrop(data);
    }).catch(() => {
      // Falls through to the "Couldn't load this drop" state below (was an
      // unhandled rejection).
      if (active) setDrop(null);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dropId, api, loadAttempt]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const countdown = drop?.releaseAt ? computeCountdownParts(drop.releaseAt, now) : null;
  // computeCountdownParts reports "live" for any past (or missing) launch
  // time, so a closed/fulfilled drop or an undated draft needs its own line
  // instead of a misleading LIVE NOW.
  const isEnded = drop?.status === 'closed' || drop?.status === 'fulfilled';
  const products = drop?.products ?? [];
  const heroUri = drop?.heroVideoUrl || drop?.heroImageUrl || products.flatMap(p => p.images ?? []).find(Boolean);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <LoadingSkeleton height={HERO_H} style={{ borderRadius: 0 }} />
        <View style={{ padding: SP.md, gap: 10 }}>
          <LoadingSkeleton height={16} style={{ width: 100 }} />
          <View style={styles.grid}>
            {[0, 1].map(i => <LoadingSkeleton key={i} height={(W - SP.md * 2 - 10) * 0.68 + 40} style={{ width: (W - SP.md * 2 - 10) / 2 }} />)}
          </View>
        </View>
      </View>
    );
  }
  if (!drop) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background, gap: 12 }]}>
        <Feather name="alert-triangle" size={28} color={theme.muted} />
        <Text style={{ color: theme.text, fontFamily: FONT.regular, fontSize: FS.base }}>Couldn't load this drop.</Text>
        <View style={{ flexDirection: 'row', gap: SP.sm }}>
          {!!dropId && (
            <TouchableOpacity onPress={retry} style={{ padding: 12 }} accessibilityRole="button">
              <Text style={{ color: theme.accent, fontFamily: FONT.semibold, fontSize: FS.base }}>Retry</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => goBackOr(router)} style={{ padding: 12 }} accessibilityRole="button">
            <Text style={{ color: theme.accent, fontFamily: FONT.semibold, fontSize: FS.base }}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: SP.xl }}>
        <View style={styles.hero}>
          {heroUri ? (
            <Image source={{ uri: heroUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <LinearGradient colors={[theme.cardElevated, theme.background]} style={StyleSheet.absoluteFill} />
          )}
          <LinearGradient colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.92)']} style={StyleSheet.absoluteFill} />

          <View style={[styles.header, { paddingTop: headerTopInset + SP.sm }]}>
            <TouchableOpacity style={styles.roundBtn} onPress={() => goBackOr(router)} accessibilityRole="button" accessibilityLabel="Back">
              <Feather name="arrow-left" size={20} color={ON_DARK} />
            </TouchableOpacity>
            <View style={styles.previewBadge}>
              <Feather name="eye" size={12} color={ON_DARK} />
              <Text style={styles.previewBadgeText}>BUYER VIEW</Text>
            </View>
          </View>

          <View style={styles.copy}>
            <Text style={styles.name}>{drop.name}</Text>
            {isEnded ? (
              <Text style={styles.countdownText}>Drop closed</Text>
            ) : !countdown ? (
              <Text style={styles.countdownText}>No launch date set</Text>
            ) : countdown.isLive ? (
              <Text style={styles.live}>LIVE NOW</Text>
            ) : (
              <Text style={styles.countdownText}>
                {`${countdown.days}d ${countdown.hours}h ${countdown.minutes}m ${countdown.seconds}s`}
              </Text>
            )}
            {!!drop.earlyAccessMinutes && (
              <Text style={styles.earlyAccess}>Followers get {drop.earlyAccessMinutes} min early access</Text>
            )}
          </View>
        </View>

        <View style={{ padding: SP.md }}>
          <Text style={{ color: theme.muted, fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 1, marginBottom: SP.sm }}>
            {products.length} {products.length === 1 ? 'PIECE' : 'PIECES'}
          </Text>
          <View style={styles.grid}>
            {products.map(p => (
              <View key={p.id} style={[styles.tile, { backgroundColor: theme.card }]}>
                {p.images?.[0] ? (
                  <Image source={{ uri: p.images[0] }} style={styles.tileImage} resizeMode="cover" />
                ) : (
                  <View style={[styles.tileImage, { alignItems: 'center', justifyContent: 'center' }]}>
                    <Feather name="image" size={22} color={theme.muted} />
                  </View>
                )}
                <Text style={{ color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm, padding: 8 }} numberOfLines={2}>{p.name}</Text>
              </View>
            ))}
          </View>
          {products.length === 0 && (
            <EmptyState
              compact
              icon="package"
              title="No products yet"
              description="Assign products to this drop from the edit screen so buyers have something to shop."
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  hero: { height: HERO_H, justifyContent: 'flex-end' },
  header: { position: 'absolute', top: 0, left: SP.md, right: SP.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roundBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  previewBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 6 },
  previewBadgeText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 1 },
  copy: { padding: 20 },
  name: { color: ON_DARK, fontFamily: FONT.extrabold, fontSize: FS.h2, marginBottom: 8 },
  countdownText: { color: ON_DARK_MUTED, fontFamily: FONT.semibold, fontSize: FS.md, fontVariant: ['tabular-nums'] },
  live: { color: '#FF3B30', fontFamily: FONT.extrabold, fontSize: FS.md, letterSpacing: 1.2 },
  earlyAccess: { color: ON_DARK_MUTED, fontFamily: FONT.medium, fontSize: FS.meta, marginTop: SP.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: (W - SP.md * 2 - 10) / 2, borderRadius: RADIUS.sm, overflow: 'hidden' },
  tileImage: { width: '100%', height: (W - SP.md * 2 - 10) * 0.68 },
});
