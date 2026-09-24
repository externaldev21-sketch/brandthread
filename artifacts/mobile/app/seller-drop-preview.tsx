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
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, ON_DARK, ON_DARK_MUTED, RADIUS, SP } from '@/lib/theme';
import { computeCountdownParts } from '@/lib/dropCountdown';

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
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { dropId } = useLocalSearchParams<{ dropId: string }>();

  const [drop, setDrop] = useState<PreviewDrop | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let active = true;
    if (!dropId) { setLoading(false); return () => { active = false; }; }
    api.drops.get(dropId).then((data: any) => {
      if (!active) return;
      setDrop(data);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dropId, api]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const countdown = drop ? computeCountdownParts(drop.releaseAt, now) : null;
  const products = drop?.products ?? [];
  const heroUri = drop?.heroVideoUrl || drop?.heroImageUrl || products.flatMap(p => p.images ?? []).find(Boolean);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }
  if (!drop) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background, gap: 12 }]}>
        <Feather name="alert-triangle" size={28} color={theme.muted} />
        <Text style={{ color: theme.text }}>Couldn't load this drop.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 12 }}>
          <Text style={{ color: theme.accent, fontFamily: FONT.semibold }}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + SP.xl }}>
        <View style={styles.hero}>
          {heroUri ? (
            <Image source={{ uri: heroUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <LinearGradient colors={['#23202A', '#050506']} style={StyleSheet.absoluteFill} />
          )}
          <LinearGradient colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.92)']} style={StyleSheet.absoluteFill} />

          <View style={[styles.header, { paddingTop: insets.top + SP.sm }]}>
            <TouchableOpacity style={styles.roundBtn} onPress={() => router.back()}>
              <Feather name="arrow-left" size={20} color={ON_DARK} />
            </TouchableOpacity>
            <View style={styles.previewBadge}>
              <Feather name="eye" size={12} color={ON_DARK} />
              <Text style={styles.previewBadgeText}>PREVIEW</Text>
            </View>
          </View>

          <View style={styles.copy}>
            <Text style={styles.name}>{drop.name}</Text>
            {countdown?.isLive ? (
              <Text style={styles.live}>LIVE NOW</Text>
            ) : (
              <Text style={styles.countdownText}>
                {countdown ? `${countdown.days}d ${countdown.hours}h ${countdown.minutes}m ${countdown.seconds}s` : '—'}
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
                <Text style={{ color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm, padding: 8 }} numberOfLines={1}>{p.name}</Text>
              </View>
            ))}
          </View>
          {products.length === 0 && (
            <Text style={{ color: theme.muted, fontSize: FS.sm }}>No products assigned to this drop yet.</Text>
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
  previewBadgeText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: 11, letterSpacing: 1 },
  copy: { padding: 20 },
  name: { color: ON_DARK, fontFamily: FONT.extrabold, fontSize: 32, marginBottom: 8 },
  countdownText: { color: ON_DARK_MUTED, fontFamily: FONT.semibold, fontSize: FS.md, fontVariant: ['tabular-nums'] },
  live: { color: '#FF3B30', fontFamily: FONT.extrabold, fontSize: FS.md, letterSpacing: 1.2 },
  earlyAccess: { color: ON_DARK_MUTED, fontFamily: FONT.medium, fontSize: FS.xs, marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: (W - SP.md * 2 - 10) / 2, borderRadius: RADIUS.sm, overflow: 'hidden' },
  tileImage: { width: '100%', height: (W - SP.md * 2 - 10) * 0.68 },
});
