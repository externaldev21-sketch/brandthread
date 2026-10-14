/**
 * Buyer onboarding — "Curate your feed", Grailed's screen 1:1 in black,
 * white and silver: a search field, brand rows (logo, name, FOLLOW) and a
 * rail of brand cards showing three of the brand's own listing photos and
 * its live listing count.
 *
 * Every brand, photo and count comes from GET /api/public/brands/discover.
 * Following uses the app's one follow path (socialService.setSellerFollowing),
 * optimistically, reverting on failure. Nothing here is required: NEXT reads
 * SKIP until something is followed.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { CachedImage } from '@/components/CachedImage';
import { discoverBrands, type DiscoverBrand } from '@/services/discoverService';
import { setSellerFollowing } from '@/services/socialService';
import { Body, FollowButton, GUTTER, Headline, ONB_TYPE, SquareButton, StepScreen, useKitTheme } from './kit';

/** Grailed asks for five; it's a suggestion, never a gate. */
export const FOLLOW_GOAL = 5;
const RAIL_MAX = 8;
const CARD_W = 220;

export function filterBrands(brands: DiscoverBrand[], query: string): DiscoverBrand[] {
  const q = query.trim().toLowerCase().replace(/^@/, '');
  if (!q) return brands;
  return brands.filter((b) => b.name.toLowerCase().includes(q) || (b.handle ?? '').toLowerCase().includes(q));
}

export function CurateFeedStep({
  counter,
  onLikedChange,
  onNext,
}: {
  counter: { current: number; total: number } | null;
  onLikedChange: (sellerIds: string[]) => void;
  onNext: () => void;
}) {
  const theme = useKitTheme();
  const [brands, setBrands] = useState<DiscoverBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const [following, setFollowing] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    discoverBrands(30)
      .then((list) => { if (!cancelled) setBrands(list); })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    onLikedChange(Object.keys(following).filter((id) => following[id]));
  }, [following, onLikedChange]);

  async function toggle(brand: DiscoverBrand) {
    const next = !following[brand.sellerId];
    void Haptics.selectionAsync().catch(() => {});
    setFollowing((prev) => ({ ...prev, [brand.sellerId]: next }));
    setPending((prev) => ({ ...prev, [brand.sellerId]: true }));
    try {
      await setSellerFollowing(brand.sellerId, next);
    } catch {
      setFollowing((prev) => ({ ...prev, [brand.sellerId]: !next }));
    } finally {
      setPending((prev) => ({ ...prev, [brand.sellerId]: false }));
    }
  }

  const followedCount = Object.values(following).filter(Boolean).length;
  const searching = query.trim().length > 0;
  const { firstRow, rail, rows } = useMemo(() => {
    if (searching) return { firstRow: null, rail: [], rows: filterBrands(brands, query) };
    const withPhotos = brands.filter((b) => (b.productImages?.length ?? 0) > 0).slice(0, RAIL_MAX);
    const railIds = new Set(withPhotos.map((b) => b.sellerId));
    const rest = brands.filter((b) => !railIds.has(b.sellerId));
    return { firstRow: rest[0] ?? null, rail: withPhotos, rows: rest.slice(1) };
  }, [brands, query, searching]);

  const renderRow = (brand: DiscoverBrand) => (
    <View key={brand.sellerId} style={styles.row} testID={`onboarding-brand-row-${brand.sellerId}`}>
      <BrandLogo brand={brand} />
      <View style={styles.rowText}>
        <Text style={[ONB_TYPE.label, { color: theme.text }]} numberOfLines={1}>{brand.name}</Text>
        {brand.productCount ? (
          <Text style={[ONB_TYPE.small, { color: theme.muted, marginTop: 2 }]}>{listings(brand.productCount)}</Text>
        ) : null}
      </View>
      <FollowButton
        following={!!following[brand.sellerId]}
        busy={!!pending[brand.sellerId]}
        name={brand.name}
        onPress={() => { void toggle(brand); }}
        testID={`onboarding-follow-${brand.sellerId}`}
      />
    </View>
  );

  return (
    <StepScreen
      counter={counter}
      scroll={false}
      testID="onboarding-brands"
      contentStyle={styles.noPad}
      footer={(
        <SquareButton
          testID="onboarding-next"
          label={followedCount > 0 ? 'Next' : 'Skip'}
          onPress={onNext}
        />
      )}
    >
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.gutter}>
          <Headline>Curate your feed</Headline>
          <Body>Follow {FOLLOW_GOAL} of your favorite brands to shop their drops.</Body>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Find a brand"
            placeholderTextColor={theme.subtle}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Find a brand"
            selectionColor={theme.text}
            style={[styles.search, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
            testID="onboarding-brand-search"
          />
        </View>

        {loading ? <ActivityIndicator color={theme.text} style={styles.loading} /> : null}
        {!loading && loadError ? (
          <Text style={[ONB_TYPE.body, styles.gutter, { color: theme.muted, marginTop: 24 }]}>
            Brands didn't load. You can follow brands from Discover any time.
          </Text>
        ) : null}
        {!loading && !loadError && (searching ? rows.length === 0 : brands.length === 0) ? (
          <Text style={[ONB_TYPE.body, styles.gutter, { color: theme.muted, marginTop: 24 }]}>
            {searching ? `No brands match "${query.trim()}".` : 'No brands yet.'}
          </Text>
        ) : null}

        <View style={styles.gutter}>{firstRow ? renderRow(firstRow) : null}</View>

        {rail.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
            style={styles.railWrap}
            testID="onboarding-brand-cards"
          >
            {rail.map((brand) => (
              <View key={brand.sellerId} style={[styles.card, { borderColor: theme.border }]} testID={`onboarding-brand-card-${brand.sellerId}`}>
                <View style={[styles.photos, { backgroundColor: theme.border }]}>
                  {[0, 1, 2].map((i) => {
                    const uri = brand.productImages?.[i];
                    return uri
                      ? <CachedImage key={i} source={{ uri }} style={styles.photo} contentFit="cover" />
                      : <View key={i} style={[styles.photo, { backgroundColor: theme.surface }]} />;
                  })}
                </View>
                <View style={styles.cardBody}>
                  <Text style={[ONB_TYPE.label, { color: theme.text, textAlign: 'center' }]} numberOfLines={1}>{brand.name}</Text>
                  <Text style={[ONB_TYPE.small, { color: theme.muted, marginTop: 4, marginBottom: 12 }]}>
                    {listings(brand.productCount ?? 0)}
                  </Text>
                  <FollowButton
                    following={!!following[brand.sellerId]}
                    busy={!!pending[brand.sellerId]}
                    name={brand.name}
                    onPress={() => { void toggle(brand); }}
                    testID={`onboarding-follow-${brand.sellerId}`}
                  />
                </View>
              </View>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.gutter}>{rows.map(renderRow)}</View>
      </ScrollView>
    </StepScreen>
  );
}

function listings(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'listing' : 'listings'}`;
}

function BrandLogo({ brand }: { brand: DiscoverBrand }) {
  const theme = useKitTheme();
  return (
    <View style={[styles.logo, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      {brand.logoUrl ? (
        <Image source={{ uri: brand.logoUrl }} style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />
      ) : (
        <Text style={[ONB_TYPE.label, { color: theme.text }]}>{(brand.name || '?').slice(0, 1).toUpperCase()}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  noPad: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 },
  scroll: { paddingTop: 8, paddingBottom: 24 },
  gutter: { paddingHorizontal: GUTTER },
  search: { marginTop: 20, height: 44, paddingHorizontal: 14, fontSize: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 0 },
  loading: { marginTop: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  rowText: { flex: 1 },
  logo: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  railWrap: { flexGrow: 0, marginVertical: 12 },
  rail: { paddingHorizontal: GUTTER, gap: 12 },
  card: { width: CARD_W, borderWidth: StyleSheet.hairlineWidth, borderRadius: 0, overflow: 'hidden' },
  photos: { flexDirection: 'row', gap: StyleSheet.hairlineWidth },
  photo: { flex: 1, aspectRatio: 3 / 4 },
  cardBody: { alignItems: 'center', paddingHorizontal: 12, paddingTop: 14, paddingBottom: 16 },
});
