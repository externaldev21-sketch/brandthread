/**
 * Buyer onboarding — "Brands to follow" step, laid out like Instagram's
 * "Try following 5+ people" (rows with a select circle). Title, subtitle
 * and buttons come from the shared onboarding StepScreen. Shown after the style/vibe
 * picks. Loads a lightweight list of active brands from the discover-brands
 * endpoint and lets the buyer follow any/all of them before entering the
 * app, using the same follow mechanism as the rest of the app
 * (socialService.setSellerFollowing) — no parallel follow system.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { discoverBrands, type DiscoverBrand } from '@/services/discoverService';
import { setSellerFollowing } from '@/services/socialService';
import { SPACE } from './onboardingTokens';
import { FILL_ELEVATED, FONT, TEXT } from '@/lib/theme';

export function BrandsToFollowStep({ onLikedChange }: { onLikedChange?: (sellerIds: string[]) => void } = {}) {
  const { theme } = useAppTheme();
  const styles = createStyles(theme);

  const [brands, setBrands] = useState<DiscoverBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [following, setFollowing] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    discoverBrands(24)
      .then((list) => { if (!cancelled) setBrands(list); })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Report the brands the buyer picked so onboarding can also save them as
  // liked_brand_ids (follows above are unchanged).
  useEffect(() => {
    if (!onLikedChange) return;
    onLikedChange(Object.keys(following).filter((id) => following[id]));
  }, [following, onLikedChange]);

  async function toggleFollow(brand: DiscoverBrand) {
    const next = !following[brand.sellerId];
    Haptics.selectionAsync();
    // Optimistic — the follow API itself is the source of truth; on failure
    // we revert the toggle rather than losing the app to an inconsistent state.
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

  async function followAll() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const toFollow = brands.filter((b) => !following[b.sellerId]);
    setFollowing((prev) => {
      const next = { ...prev };
      toFollow.forEach((b) => { next[b.sellerId] = true; });
      return next;
    });
    await Promise.all(toFollow.map((b) =>
      setSellerFollowing(b.sellerId, true).catch(() => {
        setFollowing((prev) => ({ ...prev, [b.sellerId]: false }));
      }),
    ));
  }

  const followedCount = Object.values(following).filter(Boolean).length;

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

      {!loading && !loadError && brands.length === 0 && (
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

      {brands.map((brand) => {
        const isFollowing = !!following[brand.sellerId];
        const isPending = !!pending[brand.sellerId];
        return (
          <Pressable
            key={brand.id}
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
                {brand.verified && <Icon name="check-circle" size={13} color={theme.text} />}
              </View>
              {brand.brandType ? <Text numberOfLines={1} style={styles.handle}>{brand.brandType}</Text> : null}
            </View>
            <View style={[styles.select, isFollowing && { backgroundColor: theme.text, borderColor: theme.text }]}>
              {isPending ? (
                <ActivityIndicator size="small" color={isFollowing ? theme.background : theme.muted} />
              ) : isFollowing ? (
                <Icon name="check" size={14} color={theme.background} />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
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
