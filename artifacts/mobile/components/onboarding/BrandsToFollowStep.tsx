/**
 * Buyer onboarding — "Brands to follow". Shown after the style/size picks.
 * Each brand is a card: avatar, name, live listing count, a Follow button and
 * three of its own newest product photos, all from
 * GET /api/public/brands/discover. Follows use the app's one follow path
 * (socialService.setSellerFollowing).
 *
 * With `demo=1` in the dev/web preview the list comes from the bundled demo
 * catalogue instead; nowhere else. If the API has no brands at all, the step
 * tells onboarding to move on (`onNoBrands`) rather than show an empty screen.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { demoOnboardingBrands } from '@/lib/onboarding/demoBrands';
import { discoverBrands, type DiscoverBrand } from '@/services/discoverService';
import { setSellerFollowing } from '@/services/socialService';
import { PressableScale, Reveal, StepHeadline, StepSub } from './OnboardingUI';
import { SPACE, TYPE } from './onboardingTokens';
import { radius } from '@/constants/radii';

const isDemoBrand = (id: string) => id.startsWith('preview-brand-');

export function BrandsToFollowStep({
  onLikedChange,
  onNoBrands,
}: {
  onLikedChange?: (sellerIds: string[]) => void;
  /** Called once when the API returns no brands at all, so the step can be skipped. */
  onNoBrands?: () => void;
} = {}) {
  const { theme } = useAppTheme();
  const styles = createStyles(theme);

  const [brands, setBrands] = useState<DiscoverBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [following, setFollowing] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const skipped = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (isPreviewDemoMode()) {
      setBrands(demoOnboardingBrands());
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    discoverBrands(24)
      .then((list) => { if (!cancelled) setBrands(list); })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Truly no brands (not a failed request): skip the step instead of showing an empty one.
  useEffect(() => {
    if (loading || loadError || brands.length > 0 || skipped.current || !onNoBrands) return;
    skipped.current = true;
    onNoBrands();
  }, [loading, loadError, brands.length, onNoBrands]);

  // Report the brands the buyer picked so onboarding can also save them as
  // liked_brand_ids (follows above are unchanged).
  useEffect(() => {
    if (!onLikedChange) return;
    onLikedChange(Object.keys(following).filter((id) => following[id] && !isDemoBrand(id)));
  }, [following, onLikedChange]);

  async function toggleFollow(brand: DiscoverBrand) {
    const next = !following[brand.sellerId];
    Haptics.selectionAsync();
    setFollowing((prev) => ({ ...prev, [brand.sellerId]: next }));
    if (isDemoBrand(brand.sellerId)) return;
    // Optimistic — the follow API is the source of truth; on failure revert.
    setPending((prev) => ({ ...prev, [brand.sellerId]: true }));
    try {
      await setSellerFollowing(brand.sellerId, next);
    } catch {
      setFollowing((prev) => ({ ...prev, [brand.sellerId]: !next }));
    } finally {
      setPending((prev) => ({ ...prev, [brand.sellerId]: false }));
    }
  }

  async function followAll() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const toFollow = brands.filter((b) => !following[b.sellerId]);
    setFollowing((prev) => {
      const next = { ...prev };
      toFollow.forEach((b) => { next[b.sellerId] = true; });
      return next;
    });
    await Promise.all(toFollow.filter((b) => !isDemoBrand(b.sellerId)).map((b) =>
      setSellerFollowing(b.sellerId, true).catch(() => {
        setFollowing((prev) => ({ ...prev, [b.sellerId]: false }));
      }),
    ));
  }

  const followedCount = Object.values(following).filter(Boolean).length;

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <StepHeadline>Follow a few{'\n'}brands to start.</StepHeadline>
      <StepSub>Your Thread shows more of what the brands you follow post and drop.</StepSub>

      {brands.length > 1 && (
        <Reveal index={2}>
          <PressableScale
            testID="onboarding-brands-follow-all"
            style={[styles.followAllBtn, { borderColor: theme.border }]}
            onPress={followAll}
            accessibilityRole="button"
          >
            <Text style={[styles.followAllText, { color: theme.text }]}>
              Follow all{followedCount > 0 ? ` (${followedCount}/${brands.length})` : ''}
            </Text>
          </PressableScale>
        </Reveal>
      )}

      {loading && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={theme.text} />
        </View>
      )}

      {!loading && loadError && (
        <Text style={styles.emptyText}>Brands didn't load. You can follow brands from Discover any time.</Text>
      )}

      <View style={styles.list}>
        {brands.map((brand, i) => {
          const isFollowing = !!following[brand.sellerId];
          const photos = (brand.productImages ?? []).slice(0, 3);
          return (
            <Reveal key={brand.id} index={Math.min(i, 6) + 3}>
              <View style={styles.card} testID={`onboarding-brand-card-${brand.sellerId}`}>
                <View style={styles.cardTop}>
                  {brand.logoUrl ? (
                    <Image source={{ uri: brand.logoUrl }} style={styles.logo} />
                  ) : (
                    <View style={[styles.logo, styles.logoFallback, { backgroundColor: theme.surface }]}>
                      <Text style={[styles.logoFallbackText, { color: theme.text }]}>
                        {(brand.name || '?').slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.nameCol}>
                    <Text numberOfLines={1} style={styles.cardName}>{brand.name}</Text>
                    {brand.productCount ? (
                      <Text style={styles.cardMeta}>
                        {brand.productCount.toLocaleString('en-US')} {brand.productCount === 1 ? 'product' : 'products'}
                      </Text>
                    ) : null}
                  </View>
                  <PressableScale
                    testID={`onboarding-follow-${brand.sellerId}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${isFollowing ? 'Unfollow' : 'Follow'} ${brand.name}`}
                    accessibilityState={{ selected: isFollowing, busy: !!pending[brand.sellerId] }}
                    disabled={!!pending[brand.sellerId]}
                    onPress={() => { void toggleFollow(brand); }}
                    style={[
                      styles.followBtn,
                      isFollowing
                        ? { borderWidth: 1, borderColor: theme.border }
                        : { backgroundColor: theme.accent },
                    ]}
                  >
                    <Text style={[styles.followBtnText, { color: isFollowing ? theme.text : theme.onAccent }]}>
                      {isFollowing ? 'Following' : 'Follow'}
                    </Text>
                  </PressableScale>
                </View>
                {photos.length > 0 ? (
                  <View style={styles.photos}>
                    {[0, 1, 2].map((p) => (photos[p]
                      ? <CachedImage key={p} source={{ uri: photos[p] }} style={styles.photo} contentFit="cover" />
                      : <View key={p} style={[styles.photo, { backgroundColor: theme.surface }]} />))}
                  </View>
                ) : null}
              </View>
            </Reveal>
          );
        })}
      </View>
    </ScrollView>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  scroll: { flexGrow: 1, paddingTop: SPACE.xs, paddingBottom: SPACE.xxl },
  followAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 16, minHeight: 40,
    marginTop: SPACE.lg,
  },
  followAllText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  loadingWrap: { paddingVertical: SPACE.xxl, alignItems: 'center' },
  emptyText: { ...TYPE.label, color: theme.muted, paddingVertical: SPACE.lg },
  list: { gap: SPACE.sm, marginTop: SPACE.md },
  card: {
    backgroundColor: theme.card, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border, padding: 12, gap: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 40, height: 40, borderRadius: 20 },
  logoFallback: { alignItems: 'center', justifyContent: 'center' },
  logoFallbackText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  nameCol: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: theme.text },
  cardMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: theme.muted, marginTop: 2 },
  followBtn: { height: 34, minWidth: 92, paddingHorizontal: 16, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  followBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  photos: { flexDirection: 'row', gap: 6 },
  photo: { flex: 1, aspectRatio: 4 / 5, borderRadius: 10, overflow: 'hidden' },
});
