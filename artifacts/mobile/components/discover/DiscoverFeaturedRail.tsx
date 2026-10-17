/**
 * "Featured" — brands an admin featured on Discover (GET /api/public/featured,
 * in curated order) plus brands that bought a time-boxed Featured slot
 * (admin-approved and paid; the server only returns brands inside their
 * window). Admin-featured threads show as a second row of post tiles that
 * open the post viewer. Sits under the filter row on Discover and reuses the
 * same DiscoverBrandCard as the Trending Brands rail. Renders nothing when
 * nothing is featured, and never errors the screen. Both endpoints are
 * public, so this is safe signed out; demo brands only appear with &demo=1.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useApi } from '@/hooks/useApi';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, SP } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { RADII } from '@/constants/radii';
import { CachedImage } from '@/components/CachedImage';
import { hapticLight } from '@/lib/haptics';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { featuredThreadTiles, mergeFeaturedBrands, type FeaturedThreadTile } from '@/lib/discoverFeatured';
import { DiscoverBrandCard } from './DiscoverBrandCard';
import type { DiscoverBrandCard as BrandCardData } from '@/lib/discoverFeed';

const CARD_WIDTH = 130;
const THREAD_IMAGE_HEIGHT = Math.round((CARD_WIDTH * 4) / 3);

const DEMO_BRANDS: BrandCardData[] = [
  { id: 'demo-featured-1', name: 'Maison Vela', verified: true, followersLabel: 'Featured' },
  { id: 'demo-featured-2', name: 'Atelier Nord', verified: false, followersLabel: 'Featured' },
  { id: 'demo-featured-3', name: 'Studio Sable', verified: true, followersLabel: 'Featured' },
];

export function DiscoverFeaturedRail() {
  const { theme } = useAppTheme();
  const api = useApi();
  const router = useRouter();
  const [brands, setBrands] = useState<BrandCardData[]>([]);
  const [threads, setThreads] = useState<FeaturedThreadTile[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Each source fails independently — one being down never hides the other.
      const [picks, paid] = await Promise.all([
        api.publicFeatured.list().catch(() => null),
        api.featuredSlots.active().catch(() => null),
      ]);
      if (!alive) return;
      const rows = mergeFeaturedBrands(picks?.brands, paid?.brands);
      setBrands(rows.length > 0 ? rows : isPreviewDemoMode() ? DEMO_BRANDS : []);
      setThreads(featuredThreadTiles(picks?.threads));
    })();
    return () => { alive = false; };
  }, [api]);

  if (brands.length === 0 && threads.length === 0) return null;
  return (
    <View style={{ marginTop: SP.sm, marginBottom: SP.md, paddingHorizontal: SP.md }} testID="discover-featured-rail">
      <Text style={[TYPE_SCALE.headline, { color: theme.text, marginBottom: 10 }]}>Featured</Text>
      {brands.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.track}>
          {brands.map((brand) => (
            <View key={brand.id} style={{ width: CARD_WIDTH }}>
              <DiscoverBrandCard brand={brand} />
            </View>
          ))}
        </ScrollView>
      ) : null}
      {threads.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.track}
          style={brands.length > 0 ? { marginTop: SP.md } : undefined}
          testID="discover-featured-threads"
        >
          {threads.map((thread) => (
            <Pressable
              key={thread.postId}
              onPress={() => {
                hapticLight();
                router.push(`/buyer-post-viewer?postId=${encodeURIComponent(thread.postId)}` as never);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Featured post${thread.caption ? `: ${thread.caption}` : ''}`}
              style={{ width: CARD_WIDTH }}
            >
              {thread.imageUri ? (
                <CachedImage source={{ uri: thread.imageUri }} style={styles.image} contentFit="cover" contentPosition="top center" />
              ) : (
                <View style={[styles.image, styles.fallback, { backgroundColor: theme.card }]}>
                  <Feather name="play" size={24} color={theme.muted} />
                </View>
              )}
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{thread.label}</Text>
              {thread.caption ? (
                <Text style={[styles.caption, { color: theme.muted }]} numberOfLines={2}>{thread.caption}</Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', gap: 12 },
  image: { width: CARD_WIDTH, height: THREAD_IMAGE_HEIGHT, borderRadius: RADII.card },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 13, fontFamily: FONT.semibold, marginTop: 6 },
  caption: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
});
