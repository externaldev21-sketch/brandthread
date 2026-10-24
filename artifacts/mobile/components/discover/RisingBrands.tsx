/**
 * "Rising this week" — Discover > Brands leaderboard of opted-in brands with
 * the biggest week-over-week order growth (GET /api/public/brands/rising).
 *
 * Copied from Doji's "Top Creators · Last 7 Days"
 * (https://mobbin.com/screens/f582260c-2eda-4f2f-a651-50c69377d389): a
 * numbered list, avatar, name, a one-line sub and a trailing Follow button,
 * reskinned dark. The sub is the growth percent only ("+42% orders"); order
 * counts are never shown or even sent by the server.
 *
 * The section renders nothing until at least 3 brands qualify. In preview,
 * only ?demo=1 gets sample rows; fresh preview stays empty.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import FollowButton from '@/components/social/FollowButton';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/hooks/useApi';
import { FONT, FS, SP } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { getPreviewRisingBrands } from '@/lib/previewRisingBrands';
import { RISING_SECTION_ROWS, risingBrandsToShow, risingSubline, type RisingBrand } from '@/lib/risingBrands';

/** Loads the leaderboard once; [] while loading, on error, or when hidden. */
export function useRisingBrands(): { brands: RisingBrand[]; loaded: boolean } {
  const api = useApi();
  const [brands, setBrands] = useState<RisingBrand[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      let rows: RisingBrand[] = [];
      if (isPreviewDemoMode()) {
        rows = getPreviewRisingBrands();
      } else {
        try {
          const res = await api.publicDiscovery.risingBrands();
          rows = Array.isArray(res?.brands) ? res.brands : [];
        } catch {
          rows = [];
        }
      }
      if (!active) return;
      setBrands(risingBrandsToShow(rows));
      setLoaded(true);
    })();
    return () => { active = false; };
  }, [api]);
  return { brands, loaded };
}

function initialsOf(name: string): string {
  return name.split(/\s+/).map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase();
}

export function RisingBrandRow({ brand }: { brand: RisingBrand }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  return (
    // Two SIBLING tap targets, never nested (see DiscoverEntityCard): the
    // row opens the store, Follow follows.
    <View style={styles.row}>
      {/* PressableScale styles its inner view, so the flex:1 slot is this wrapper. */}
      <View style={styles.rowTapSlot}>
      <PressableScale
        onPress={() => router.push(`/seller-profile?id=${encodeURIComponent(brand.sellerId)}&src=feed` as never)}
        style={styles.rowTap}
        accessibilityRole="button"
        accessibilityLabel={`${brand.rank}. ${brand.brandName}, ${risingSubline(brand.growthPct)}`}
        noMinHeight
      >
        <Text style={[styles.rank, { color: theme.text }]}>{brand.rank}</Text>
        {brand.logoUrl ? (
          <CachedImage source={{ uri: brand.logoUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: theme.border }]}>
            <Text style={[styles.initials, { color: theme.text }]}>{initialsOf(brand.brandName)}</Text>
          </View>
        )}
        <View style={styles.text}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{brand.brandName}</Text>
          <Text style={[styles.sub, { color: theme.muted }]} numberOfLines={1}>{risingSubline(brand.growthPct)}</Text>
        </View>
      </PressableScale>
      </View>
      <FollowButton
        userId={brand.sellerId}
        name={brand.brandName}
        initial={{ isFollowing: false, isFollowedBy: false, isMutual: false }}
        size="compact"
        style={styles.follow}
      />
    </View>
  );
}

/** Discover > Brands: at most 5 rows plus "See all" (the full 10). Hidden under 3. */
export function RisingBrandsSection() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { brands } = useRisingBrands();
  if (brands.length === 0) return null;
  const more = brands.length > RISING_SECTION_ROWS;
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={[TYPE_SCALE.headline, { color: theme.text }]} accessibilityRole="header">Rising this week</Text>
        {more ? (
          <PressableScale
            onPress={() => router.push('/buyer-rising-brands' as never)}
            accessibilityRole="button"
            accessibilityLabel="See all rising brands"
            hitSlop={8}
            noMinHeight
          >
            <Text style={[styles.seeAll, { color: theme.muted }]}>See all</Text>
          </PressableScale>
        ) : null}
      </View>
      {brands.slice(0, RISING_SECTION_ROWS).map((b) => <RisingBrandRow key={b.sellerId} brand={b} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.xs },
  seeAll: { fontFamily: FONT.medium, fontSize: FS.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 8 },
  rowTapSlot: { flex: 1, minWidth: 0 },
  rowTap: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rank: { width: 22, fontFamily: FONT.semibold, fontSize: FS.sm, textAlign: 'center' },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: FONT.bold, fontSize: FS.sm },
  text: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: FONT.semibold, fontSize: FS.sm },
  sub: { fontFamily: FONT.regular, fontSize: FS.xs },
  follow: { minWidth: 88 },
});
