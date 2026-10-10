/**
 * "Brands you might like" — horizontal row at the top of Discover (For You),
 * backed by GET /api/buyer/recommended-brands. Reuses DiscoverEntityCard (same
 * card + real Follow button as the Trending Brands rail). Hidden when signed
 * out, dismissed (persisted per user), there is nothing to recommend, or the
 * buyer already follows enough brands. `&demo=1` shows sample brands offline.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi, type RecommendedBrand } from '@/lib/api';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { readDismissed, shouldShowBrandsRow, writeDismissed } from '@/lib/brandsYouMightLike';
import { SP } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { DiscoverEntityCard } from './DiscoverEntityCard';

const CARD_WIDTH = 160;

const DEMO_BRANDS: RecommendedBrand[] = [
  { id: 'demo-b1', sellerId: 'demo-b1', name: 'Atelier Nord', brandType: null, logoUrl: null, verified: true, followerCount: 1200, reason: 'Matches your style' },
  { id: 'demo-b2', sellerId: 'demo-b2', name: 'Field Studio', brandType: null, logoUrl: null, verified: false, followerCount: 640, reason: 'Matches your style' },
  { id: 'demo-b3', sellerId: 'demo-b3', name: 'Kiln & Co', brandType: null, logoUrl: null, verified: true, followerCount: 3100, reason: 'Popular right now' },
];

export function BrandsYouMightLikeRow() {
  const { theme } = useAppTheme();
  const api = useApi();
  const router = useRouter();
  const { isSignedIn, userId } = useAuth();
  const demo = isPreviewDemoMode();
  const [brands, setBrands] = useState<RecommendedBrand[]>([]);
  const [followedBrandCount, setFollowedBrandCount] = useState(0);
  const [dismissed, setDismissed] = useState(true); // hidden until the stored choice is read

  useEffect(() => {
    if (demo) { setBrands(DEMO_BRANDS); setDismissed(false); return; }
    if (!isSignedIn || !userId) return;
    let cancelled = false;
    (async () => {
      const wasDismissed = await readDismissed(userId);
      if (cancelled || wasDismissed) return;
      try {
        const res = await api.buyer.recommendedBrands(12);
        if (cancelled) return;
        setBrands(res.brands);
        setFollowedBrandCount(res.followedBrandCount ?? 0);
        setDismissed(false);
      } catch { /* honest: no row when we can't load it */ }
    })();
    return () => { cancelled = true; };
  }, [api, isSignedIn, userId, demo]);

  if (!shouldShowBrandsRow({ signedIn: demo || !!isSignedIn, dismissed, brandCount: brands.length, followedBrandCount })) {
    return null;
  }

  return (
    <View style={styles.wrap} testID="brands-you-might-like">
      <View style={styles.headRow}>
        <Text style={[TYPE_SCALE.headline, { color: theme.text }]}>Brands you might like</Text>
        <PressableScale
          onPress={() => { setDismissed(true); if (userId) void writeDismissed(userId); }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss brands you might like"
          style={styles.dismiss}
          testID="brands-you-might-like-dismiss"
        >
          <Feather name="x" size={18} color={theme.muted} />
        </PressableScale>
      </View>
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
  wrap: { paddingTop: SP.sm, paddingBottom: SP.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: SP.md, paddingRight: SP.xs },
  dismiss: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  track: { flexDirection: 'row', gap: 12, paddingHorizontal: SP.md, paddingTop: 2 },
});
