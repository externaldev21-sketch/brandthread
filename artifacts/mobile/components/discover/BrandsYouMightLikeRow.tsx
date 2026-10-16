/**
 * "Brands you might like" — horizontal row at the top of Discover (For You),
 * backed by GET /api/buyer/recommended-brands. Reuses DiscoverEntityCard (same
 * card + real Follow button as the Trending Brands rail). Hidden when signed
 * out, dismissed (persisted per user), there is nothing to recommend, or the
 * buyer already follows enough brands. `&demo=1` shows sample brands offline.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi, type RecommendedBrand } from '@/lib/api';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { readDismissed, shouldShowBrandsRow, writeDismissed } from '@/lib/brandsYouMightLike';
import { SP } from '@/lib/theme';
import { SectionHeader } from '@/components/reframe';
import { X_GUTTER, X_SPACE, xColors } from '@/constants/reframe';
import { DiscoverEntityCard } from './DiscoverEntityCard';
import { useStickyState } from '@/lib/stickyState';
import { DISCOVER_KEYS } from '@/lib/discoverTabData';

const CARD_WIDTH = 160;

const DEMO_BRANDS: RecommendedBrand[] = [
  { id: 'demo-b1', sellerId: 'demo-b1', name: 'Atelier Nord', brandType: null, logoUrl: null, verified: true, followerCount: 1200, reason: 'Matches your style' },
  { id: 'demo-b2', sellerId: 'demo-b2', name: 'Field Studio', brandType: null, logoUrl: null, verified: false, followerCount: 640, reason: 'Matches your style' },
  { id: 'demo-b3', sellerId: 'demo-b3', name: 'Kiln & Co', brandType: null, logoUrl: null, verified: true, followerCount: 3100, reason: 'Popular right now' },
];

interface BrandsRowCache { brands: RecommendedBrand[]; followedBrandCount: number; dismissed: boolean }

export interface BrandsYouMightLikeState extends BrandsRowCache {
  /** True once the first load (dismissal read + fetch) has finished either way. */
  settled: boolean;
  dismiss: () => void;
}

/** Row data, sticky across remounts (lib/stickyState.ts) so the row is
 *  already in place on a revisit instead of popping in above the grid. */
export function useBrandsYouMightLike(): BrandsYouMightLikeState {
  const api = useApi();
  const { isSignedIn, userId } = useAuth();
  const demo = isPreviewDemoMode();
  const [row, setRow, hadCache] = useStickyState<BrandsRowCache>(
    DISCOVER_KEYS.recommendedBrands,
    // hidden until the stored choice is read
    { brands: [], followedBrandCount: 0, dismissed: true },
    { persist: !demo },
  );
  const [settled, setSettled] = useState(hadCache);

  useEffect(() => {
    if (demo) { setRow({ brands: DEMO_BRANDS, followedBrandCount: 0, dismissed: false }); setSettled(true); return; }
    if (!isSignedIn || !userId) { setSettled(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const wasDismissed = await readDismissed(userId);
        if (cancelled) return;
        if (wasDismissed) { setRow((prev) => ({ ...prev, dismissed: true })); return; }
        try {
          const res = await api.buyer.recommendedBrands(12);
          if (cancelled) return;
          setRow({ brands: res.brands, followedBrandCount: res.followedBrandCount ?? 0, dismissed: false });
        } catch { /* honest: no row when we can't load it */ }
      } finally {
        if (!cancelled) setSettled(true);
      }
    })();
    return () => { cancelled = true; };
  }, [api, isSignedIn, userId, demo, setRow]);

  const dismiss = useCallback(() => {
    setRow((prev) => ({ ...prev, dismissed: true }));
    if (userId) void writeDismissed(userId);
  }, [setRow, userId]);

  return { ...row, settled, dismiss };
}

export function BrandsYouMightLikeRow({ state }: { state: BrandsYouMightLikeState }) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const demo = isPreviewDemoMode();
  const { brands, followedBrandCount, dismissed } = state;

  if (!shouldShowBrandsRow({ signedIn: demo || !!isSignedIn, dismissed, brandCount: brands.length, followedBrandCount })) {
    return null;
  }

  return (
    <View style={styles.wrap} testID="brands-you-might-like">
      <SectionHeader
        title="Brands you might like"
        style={styles.headRow}
        trailing={(
          <PressableScale
            onPress={state.dismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss brands you might like"
            style={styles.dismiss}
            testID="brands-you-might-like-dismiss"
          >
            <Icon name="x" size={18} color={xColors(theme).secondary} />
          </PressableScale>
        )}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.track}>
        {brands.map((b) => (
          <View key={b.id} style={{ width: CARD_WIDTH }}>
            <DiscoverEntityCard
              id={b.sellerId}
              name={b.name}
              imageUri={b.logoUrl ?? undefined}
              verified={b.verified}
              subline={b.reason}
              fallbackIcon="shopping-bag"
              onPress={() => router.push(`/seller-profile?id=${encodeURIComponent(b.sellerId)}&src=feed` as never)}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: X_SPACE[4], paddingBottom: X_SPACE[8] },
  // The dismiss X's 44pt box is pulled 12pt into the right gutter so the
  // glyph itself sits on the 16pt edge; the box re-centres the title row.
  headRow: { paddingRight: X_GUTTER - 12, paddingTop: X_SPACE[4], paddingBottom: 0 },
  dismiss: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  track: { flexDirection: 'row', gap: X_SPACE[12], paddingHorizontal: X_GUTTER, paddingTop: 2 },
});
