import { haptics } from '@/lib/haptics';
/**
 * Buyer onboarding — "Brands to follow" step, laid out like Instagram's
 * "Try following 5+ people" (rows with a select circle). Title, subtitle
 * and buttons come from the shared onboarding StepScreen. Shown after the style/vibe
 * picks. Loads a lightweight list of active brands from the discover-brands
 * endpoint and lets the buyer follow any/all of them before entering the
 * app, using the same follow mechanism as the rest of the app
 * (socialService.setSellerFollowing) — no parallel follow system.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CachedImage as Image } from '@/components/CachedImage';
import { Icon } from '@/components/ui';
import * as Haptics from 'expo-haptics';
import { hapticFollow } from '@/lib/haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { discoverBrands, featuredBrands, type DiscoverBrand, type FeaturedBrand } from '@/services/discoverService';
import { setSellerFollowing } from '@/services/socialService';
import { SPACE } from './onboardingTokens';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { FILL_ELEVATED, FONT, TEXT } from '@/lib/theme';
import { FeaturedBrandsRail } from './FeaturedBrandsRail';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { demoOnboardingBrands } from '@/lib/onboarding/demoBrands';

export function BrandsToFollowStep({ onLikedChange, onNoBrands }: {
  onLikedChange?: (sellerIds: string[]) => void;
  onNoBrands?: () => void;
} = {}) {
  const { theme } = useAppTheme();
  const styles = createStyles(theme);

  const [brands, setBrands] = useState<DiscoverBrand[]>([]);
  // Dev's own brands with their real product photos, first (less-AI pass,
  // item 54). Empty unless the server lists them — the step is then unchanged.
  const [featured, setFeatured] = useState<FeaturedBrand[]>([]);
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
    const featuredRequest = featuredBrands()
      .then((list) => { if (!cancelled) setFeatured(list); })
      .catch(() => { /* optional rail — the rest of the step still works */ });
    discoverBrands(24)
      .then((list) => { if (!cancelled) setBrands(list); })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(async () => { await featuredRequest; if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Report the brands the buyer picked so onboarding can also save them as
  // liked_brand_ids (follows above are unchanged).
  useEffect(() => {
    if (!onLikedChange) return;
    onLikedChange(Object.keys(following).filter((id) => following[id] && !id.startsWith('preview-brand-')));
  }, [following, onLikedChange]);

  useEffect(() => {
    if (loading || loadError || brands.length || featured.length || skipped.current || !onNoBrands) return;
    skipped.current = true;
    onNoBrands();
  }, [loading, loadError, brands.length, featured.length, onNoBrands]);

  async function toggleFollow(brand: { sellerId: string }) {
    const next = !following[brand.sellerId];
    hapticFollow(next);
    // Optimistic — the follow API itself is the source of truth; on failure
    // we revert the toggle rather than losing the app to an inconsistent state.
    setFollowing((prev) => ({ ...prev, [brand.sellerId]: next }));
    if (brand.sellerId.startsWith('preview-brand-')) return;
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
    hapticFollow(true);
    const toFollow = [...featured, ...gridBrands].filter((b) => !following[b.sellerId]);
    setFollowing((prev) => {
      const next = { ...prev };
      toFollow.forEach((b) => { next[b.sellerId] = true; });
      return next;
    });
    await Promise.all(toFollow.filter((b) => !b.sellerId.startsWith('preview-brand-')).map((b) =>
      setSellerFollowing(b.sellerId, true).catch(() => {
        setFollowing((prev) => ({ ...prev, [b.sellerId]: false }));
      }),
    ));
  }

  const followedCount = Object.values(following).filter(Boolean).length;
  const featuredIds = new Set(featured.map((b) => b.sellerId));
  const gridBrands = brands.filter((b) => !featuredIds.has(b.sellerId));
  const totalBrands = featured.length + gridBrands.length;

  return (
    <View testID="onboarding-brands-list">
      {loading && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={theme.text} />
        </View>
      )}

      {!loading && loadError && (
        <Text style={styles.emptyText}>Couldn't load brands. You can follow brands from Discover.</Text>
      )}

      <FeaturedBrandsRail
        brands={featured}
        following={following}
        pending={pending}
        onToggle={(brand) => { void toggleFollow(brand); }}
      />

      {!loading && !loadError && totalBrands === 0 && (
        <Text style={styles.emptyText}>No brands to follow yet. Brands you follow from Discover show up in your feed.</Text>
      )}

      {brands.length > 1 && (
        <Pressable
          testID="onboarding-brands-follow-all"
          style={styles.followAll}
          onPress={followAll}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={[styles.followAllText, { color: theme.text }]}>
            Follow all{followedCount > 0 ? ` (${followedCount}/${brands.length})` : ''}
          </Text>
        </Pressable>
      )}

      {gridBrands.map((brand) => {
        const isFollowing = !!following[brand.sellerId];
        const isPending = !!pending[brand.sellerId];
        return (
          <View key={brand.id}>
          <Pressable
            testID={`onboarding-brand-card-${brand.sellerId}`}
            style={styles.row}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isFollowing, disabled: isPending }}
            accessibilityLabel={`${isFollowing ? 'Unfollow' : 'Follow'} ${brand.name}`}
            onPress={() => { void toggleFollow(brand); }}
            disabled={isPending}
          >
            {brand.logoUrl ? (
              <Image source={{ uri: brand.logoUrl }} style={styles.logo} />
            ) : (
              <View style={[styles.logo, styles.logoFallback]}>
                <Text style={[styles.logoFallbackText, { color: theme.text }]}>
                  {(brand.name || '?').slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.rowText}>
              <View style={styles.nameRow}>
                <Text numberOfLines={1} style={styles.name}>{brand.name}</Text>
                {brand.verified && <VerifiedBadge />}
              </View>
              <Text numberOfLines={1} style={styles.handle}>
                {brand.handle ? `@${brand.handle} · ` : ''}{brand.productCount ?? 0} listings
              </Text>
            </View>
            <View style={[styles.select, isFollowing && { backgroundColor: theme.text, borderColor: theme.text }]}>
              {isPending ? (
                <ActivityIndicator size="small" color={isFollowing ? theme.background : theme.muted} />
              ) : isFollowing ? (
                <Icon name="check" size={14} color={theme.background} />
              ) : null}
            </View>
          </Pressable>
          {(brand.productImages?.length ?? 0) > 0 ? (
            <View style={styles.photos}>
              {brand.productImages?.slice(0, 3).map((uri) => (
                <Image key={uri} source={{ uri }} style={styles.photo} accessibilityLabel={`${brand.name} product`} />
              ))}
            </View>
          ) : null}
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  photos: { flexDirection: 'row', gap: 6, marginBottom: SPACE.sm },
  photo: { flex: 1, aspectRatio: 4 / 5, borderRadius: 10 },
  loadingWrap: { paddingVertical: SPACE.xxl, alignItems: 'center' },
  emptyText: { ...TEXT.subhead, color: theme.muted, paddingVertical: SPACE.lg },
  followAll: { alignSelf: 'flex-end', paddingVertical: SPACE.xs },
  followAllText: { ...TEXT.subhead, fontFamily: FONT.semibold },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: 60, paddingVertical: SPACE.xs },
  logo: { width: 44, height: 44, borderRadius: 22 },
  logoFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: FILL_ELEVATED },
  logoFallbackText: { fontSize: 17, fontFamily: FONT.bold },
  rowText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { ...TEXT.headline, color: theme.text, flexShrink: 1 },
  handle: { ...TEXT.footnote, color: theme.muted, marginTop: 1 },
  select: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: theme.muted,
    alignItems: 'center', justifyContent: 'center',
  },
});
