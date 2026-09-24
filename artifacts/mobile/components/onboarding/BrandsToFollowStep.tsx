/**
 * Buyer onboarding — "Brands to follow" step. Shown after the style/vibe
 * picks. Loads a lightweight list of active brands from the discover-brands
 * endpoint and lets the buyer follow any/all of them before entering the
 * app, using the same follow mechanism as the rest of the app
 * (socialService.setSellerFollowing) — no parallel follow system.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { discoverBrands, type DiscoverBrand } from '@/services/discoverService';
import { setSellerFollowing } from '@/services/socialService';

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
      <Text style={styles.headline}>Follow a few{'\n'}brands to start.</Text>
      <Text style={styles.sub}>Your Thread gets better with every brand you follow. You can skip this for now.</Text>

      {brands.length > 0 && (
        <TouchableOpacity
          testID="onboarding-brands-follow-all"
          style={[styles.followAllBtn, { borderColor: theme.accent }]}
          onPress={followAll}
          activeOpacity={0.8}
        >
          <Feather name="plus-circle" size={15} color={theme.accentLight} />
          <Text style={[styles.followAllText, { color: theme.accentLight }]}>
            Follow all{followedCount > 0 ? ` (${followedCount}/${brands.length})` : ''}
          </Text>
        </TouchableOpacity>
      )}

      {loading && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={theme.accent} />
        </View>
      )}

      {!loading && loadError && (
        <Text style={styles.emptyText}>Couldn't load brands right now. You can follow brands anytime from Discover.</Text>
      )}

      {!loading && !loadError && brands.length === 0 && (
        <Text style={styles.emptyText}>No brands to show yet — check back soon.</Text>
      )}

      <View style={styles.grid}>
        {brands.map((brand) => {
          const isFollowing = !!following[brand.sellerId];
          const isPending = !!pending[brand.sellerId];
          return (
            <TouchableOpacity
              key={brand.id}
              testID={`onboarding-brand-card-${brand.sellerId}`}
              style={[styles.card, isFollowing && { borderColor: theme.accent, borderWidth: 1.5 }]}
              activeOpacity={0.85}
              onPress={() => { void toggleFollow(brand); }}
              disabled={isPending}
            >
              <View style={styles.cardTop}>
                {brand.logoUrl ? (
                  <Image source={{ uri: brand.logoUrl }} style={styles.logo} />
                ) : (
                  <View style={[styles.logoFallback, { backgroundColor: theme.accentDim }]}>
                    <Text style={[styles.logoFallbackText, { color: theme.accentLight }]}>
                      {(brand.name || '?').slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={[styles.followBadge, isFollowing && { backgroundColor: theme.accent }]}>
                  {isPending ? (
                    <ActivityIndicator size="small" color={isFollowing ? theme.onAccent : theme.muted} />
                  ) : (
                    <Feather name={isFollowing ? 'check' : 'plus'} size={13} color={isFollowing ? theme.onAccent : theme.muted} />
                  )}
                </View>
              </View>
              <Text numberOfLines={1} style={styles.cardName}>{brand.name}</Text>
              {brand.verified && <Feather name="check-circle" size={12} color={theme.accentLight} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  scroll: { flexGrow: 1, paddingTop: 8, paddingBottom: 40 },
  headline: { fontSize: 32, fontFamily: 'Inter_700Bold', color: theme.text, letterSpacing: -0.8, lineHeight: 38, marginBottom: 6 },
  sub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: theme.muted, lineHeight: 21, marginBottom: 16 },
  followAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    borderWidth: 1, borderRadius: 100, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 16,
  },
  followAllText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  loadingWrap: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: theme.muted, paddingVertical: 20, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    width: '31%', backgroundColor: theme.card, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border, padding: 10, gap: 6,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo: { width: 36, height: 36, borderRadius: 10 },
  logoFallback: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  logoFallbackText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  followBadge: {
    width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
  },
  cardName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: theme.text },
});
