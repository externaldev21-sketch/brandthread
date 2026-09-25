/**
 * Buyer onboarding — "Brands to follow" step. Shown after the style/vibe
 * picks. Loads a lightweight list of active brands from the discover-brands
 * endpoint and lets the buyer follow any/all of them before entering the
 * app, using the same follow mechanism as the rest of the app
 * (socialService.setSellerFollowing) — no parallel follow system.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { discoverBrands, type DiscoverBrand } from '@/services/discoverService';
import { setSellerFollowing } from '@/services/socialService';
import { PressableScale, Reveal, StepHeadline, StepSub } from './OnboardingUI';
import { RADIUS, SPACE, TYPE } from './onboardingTokens';

export function BrandsToFollowStep() {
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
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <StepHeadline>Follow a few{'\n'}brands to start.</StepHeadline>
      <StepSub>Your Thread gets better with every brand you follow. You can skip this for now.</StepSub>

      {brands.length > 0 && (
        <Reveal index={2}>
          <PressableScale
            testID="onboarding-brands-follow-all"
            style={[styles.followAllBtn, { borderColor: theme.border }]}
            onPress={followAll}
            accessibilityRole="button"
          >
            <Feather name="plus" size={15} color={theme.text} />
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
        <Text style={styles.emptyText}>Couldn't load brands right now. You can follow brands anytime from Discover.</Text>
      )}

      {!loading && !loadError && brands.length === 0 && (
        <Text style={styles.emptyText}>No brands to show yet — check back soon.</Text>
      )}

      <View style={styles.grid}>
        {brands.map((brand, i) => {
          const isFollowing = !!following[brand.sellerId];
          const isPending = !!pending[brand.sellerId];
          return (
            <Reveal key={brand.id} index={Math.min(i, 9) + 3} style={styles.cardWrap}>
              <PressableScale
                testID={`onboarding-brand-card-${brand.sellerId}`}
                style={[styles.card, isFollowing && { borderColor: theme.text, borderWidth: 1, backgroundColor: theme.accentDim }]}
                accessibilityRole="button"
                accessibilityState={{ selected: isFollowing, disabled: isPending }}
                accessibilityLabel={`${isFollowing ? 'Unfollow' : 'Follow'} ${brand.name}`}
                onPress={() => { void toggleFollow(brand); }}
                disabled={isPending}
              >
                <View style={styles.cardTop}>
                  {brand.logoUrl ? (
                    <Image source={{ uri: brand.logoUrl }} style={styles.logo} />
                  ) : (
                    <View style={[styles.logoFallback, { backgroundColor: theme.surface }]}>
                      <Text style={[styles.logoFallbackText, { color: theme.text }]}>
                        {(brand.name || '?').slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={[styles.followBadge, isFollowing && { backgroundColor: theme.text, borderColor: theme.text }]}>
                    {isPending ? (
                      <ActivityIndicator size="small" color={isFollowing ? theme.background : theme.muted} />
                    ) : (
                      <Feather name={isFollowing ? 'check' : 'plus'} size={13} color={isFollowing ? theme.background : theme.muted} />
                    )}
                  </View>
                </View>
                <View style={styles.nameRow}>
                  <Text numberOfLines={1} style={styles.cardName}>{brand.name}</Text>
                  {brand.verified && <Feather name="check-circle" size={11} color={theme.text} />}
                </View>
              </PressableScale>
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
    borderWidth: StyleSheet.hairlineWidth, borderRadius: RADIUS.pill, paddingHorizontal: 16, minHeight: 40,
    marginTop: SPACE.lg, marginBottom: SPACE.md,
  },
  followAllText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  loadingWrap: { paddingVertical: SPACE.xxl, alignItems: 'center' },
  emptyText: { ...TYPE.label, color: theme.muted, paddingVertical: SPACE.lg, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: SPACE.xs },
  cardWrap: { width: '31%' },
  card: {
    backgroundColor: theme.card, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border, padding: 10, gap: 8,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo: { width: 36, height: 36, borderRadius: 18 },
  logoFallback: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  logoFallbackText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  followBadge: {
    width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardName: { flexShrink: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold', color: theme.text },
});
