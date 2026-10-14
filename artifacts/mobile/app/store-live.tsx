/**
 * "Your store is live" — shown once, right after a seller's first product
 * goes active (app/add-product.tsx decides via lib/storeLive.ts).
 *
 * Copied from Unfold's "Your Bio Site is live!" sheet: a small preview of the
 * page, the link in a field with a copy button, and one share action. The
 * preview gets a single silver shimmer pass when the screen opens (skipped
 * under Reduce Motion) — no confetti, no sound, one success haptic on open.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { hapticSuccess } from '@/lib/haptics';
import { buildStoreUrl } from '@/lib/shareLinks';
import { shareLinkWithFallback } from '@/lib/shareProfile';
import { goBackOr } from '@/lib/navigation/goBackOr';

type Profile = { username: string | null; brandName: string | null; displayName: string | null; profileImageUrl: string | null; logoUrl: string | null };
type ProductRow = { id: string; name: string; status?: string; images?: string[]; media?: Array<{ uri?: string }> };

const PREVIEW_W = 220;
// Inside the 1pt border and 12pt padding, two tiles and a 4pt gap.
const TILE_W = (PREVIEW_W - 2 - 24 - 4) / 2;

export default function StoreLiveScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topInset = useHeaderTopInset();
  const reduceMotion = useReduceMotion();
  const { productId } = useLocalSearchParams<{ productId?: string }>();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      api.seller.getProfile().then((p) => { if (alive) setProfile(p); }),
      (api.products.list() as Promise<ProductRow[]>)
        .then((rows) => { if (alive) setProducts((rows ?? []).filter((r) => r.status === 'active')); }),
    ]).then(() => { if (alive) setLoaded(true); });
    hapticSuccess();
    return () => { alive = false; };
  }, [api]);

  const handle = profile?.username ?? null;
  const brand = profile?.brandName || profile?.displayName || '';
  const storeUrl = buildStoreUrl(handle);
  const avatar = profile?.logoUrl || profile?.profileImageUrl || null;
  // The just-published product first, then the rest of what's live.
  const tiles = useMemo(() => {
    const sorted = [...products].sort((a, b) => (a.id === productId ? -1 : b.id === productId ? 1 : 0));
    return sorted.slice(0, 4);
  }, [products, productId]);

  // ── One silver shimmer pass over the preview, once it has its content ─────
  const sweep = useRef(new Animated.Value(0)).current;
  const [shimmerDone, setShimmerDone] = useState(false);
  useEffect(() => {
    if (!loaded) return;
    if (reduceMotion) { setShimmerDone(true); return; }
    const anim = Animated.timing(sweep, {
      toValue: 1, duration: 1100, delay: 350, easing: Easing.inOut(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    anim.start(() => setShimmerDone(true));
    return () => anim.stop();
  }, [loaded, reduceMotion, sweep]);
  const sweepX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-PREVIEW_W, PREVIEW_W * 1.6] });

  async function copy() {
    if (!storeUrl) return;
    await Clipboard.setStringAsync(storeUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function share() {
    if (!storeUrl) return;
    try {
      await shareLinkWithFallback({
        url: storeUrl,
        message: brand ? `Shop ${brand} on Brandthread` : 'Shop my store on Brandthread',
        platformOS: Platform.OS,
        nativeShare: (content) => Share.share(content),
        webNavigator: typeof navigator !== 'undefined' ? (navigator as any) : null,
      });
    } catch {
      // dismissed
    }
  }

  const close = () => goBackOr(router, '/(tabs)/' as never);

  return (
    <View style={s.root} testID="store-live-screen">
      <View style={[s.topBar, { paddingTop: topInset + 8 }]}>
        <Feather
          name="x" size={24} color={theme.text}
          onPress={close}
          accessibilityRole="button" accessibilityLabel="Close"
          suppressHighlighting
        />
      </View>
      <ScrollView contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <Text style={s.title} accessibilityRole="header">Your store is live</Text>

        {/* Store preview */}
        <View style={s.preview} testID="store-live-preview">
          <View style={s.previewHead}>
            <View style={s.avatar}>
              {avatar
                ? <Image source={{ uri: avatar }} style={StyleSheet.absoluteFill} contentFit="cover" />
                : <Text style={s.avatarInitial}>{(brand || handle || '').slice(0, 1).toUpperCase()}</Text>}
            </View>
            <Text style={s.previewBrand} numberOfLines={1}>{brand}</Text>
            {handle ? <Text style={s.previewHandle} numberOfLines={1}>@{handle}</Text> : null}
          </View>
          <View style={s.grid}>
            {Array.from({ length: 4 }).map((_, i) => {
              const p = tiles[i];
              const uri = p?.images?.find((u) => typeof u === 'string' && u.length > 0) ?? p?.media?.find((m) => !!m?.uri)?.uri;
              return (
                <View key={p?.id ?? `empty-${i}`} style={s.tile}>
                  {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                </View>
              );
            })}
          </View>
          {!shimmerDone && (
            <Animated.View pointerEvents="none" style={[s.shimmer, { transform: [{ translateX: sweepX }, { skewX: '-18deg' }] }]} />
          )}
        </View>

        {/* Link */}
        {storeUrl ? (
          <View style={s.linkField}>
            <Text style={s.linkText} numberOfLines={1} selectable>{storeUrl.replace(/^https?:\/\//, '')}</Text>
            <Feather
              name={copied ? 'check' : 'copy'} size={20} color={theme.text}
              onPress={copy} accessibilityRole="button" accessibilityLabel={copied ? 'Copied' : 'Copy store link'}
              suppressHighlighting testID="store-live-copy"
            />
          </View>
        ) : null}

        <View style={s.actions}>
          <Pressable
            style={({ pressed }) => [s.primaryBtn, !storeUrl && { opacity: 0.3 }, pressed && { opacity: 0.85 }]}
            onPress={share}
            disabled={!storeUrl}
            accessibilityRole="button"
            testID="store-live-share"
          >
            <Text style={s.primaryText}>Share store</Text>
          </Pressable>
          <Pressable style={s.secondaryBtn} onPress={close} accessibilityRole="button" testID="store-live-done">
            <Text style={s.secondaryText}>Done</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  topBar: { paddingHorizontal: 16, paddingBottom: 8 },
  body: { paddingHorizontal: 24, alignItems: 'center' },
  title: { fontSize: 28, fontWeight: '700', color: theme.text, letterSpacing: -0.6, marginTop: 8, marginBottom: 24, textAlign: 'center' },
  preview: {
    width: PREVIEW_W, borderRadius: 22, overflow: 'hidden', paddingBottom: 12,
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
  },
  previewHead: { alignItems: 'center', paddingTop: 20, paddingBottom: 14, paddingHorizontal: 12 },
  avatar: {
    width: 52, height: 52, borderRadius: 26, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border,
  },
  avatarInitial: { color: theme.text, fontSize: 20, fontWeight: '600' },
  previewBrand: { marginTop: 8, fontSize: 15, fontWeight: '700', color: theme.text, maxWidth: '100%' },
  previewHandle: { marginTop: 1, fontSize: 12, color: theme.muted, maxWidth: '100%' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 12 },
  tile: { width: TILE_W, height: TILE_W * 1.25, borderRadius: 6, overflow: 'hidden', backgroundColor: theme.surface },
  shimmer: {
    position: 'absolute', top: -40, bottom: -40, left: 0, width: 36,
    backgroundColor: '#D9D9DE', opacity: 0.16,
  },
  linkField: {
    alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: 28, paddingHorizontal: 16, height: 52, borderRadius: 14,
    backgroundColor: theme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
  },
  linkText: { flex: 1, fontSize: 15, color: theme.text },
  actions: { alignSelf: 'stretch', gap: 12, marginTop: 20 },
  primaryBtn: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.text },
  primaryText: { color: theme.background, fontSize: 16, fontWeight: '600' },
  secondaryBtn: { height: 48, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: theme.text, fontSize: 16, fontWeight: '600' },
});
