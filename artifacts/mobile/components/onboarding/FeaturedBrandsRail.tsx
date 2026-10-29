/**
 * Onboarding's featured brands rail (Dev's less-AI pass, item 54): Dev's own
 * brands, each shown with three of its real product photos — a copy of
 * Grailed's "Curate your Feed" designer card (three listing photos, name,
 * listing count, Follow), reskinned black / white / silver. Renders nothing
 * when there are no featured brands. Follow state lives in the parent step
 * (BrandsToFollowStep) so a brand followed here counts toward "Follow all".
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { Button } from '@/components/ui/Button';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { FeaturedBrand } from '@/services/discoverService';
import { radius } from '@/constants/radii';
import { SPACE } from './onboardingTokens';

import { FONT, FS } from '@/lib/theme';
const CARD_WIDTH = 188;

export function FeaturedBrandsRail({
  brands, following, pending, onToggle,
}: {
  brands: FeaturedBrand[];
  following: Record<string, boolean>;
  pending: Record<string, boolean>;
  onToggle: (brand: FeaturedBrand) => void;
}) {
  const { theme } = useAppTheme();
  const styles = createStyles(theme);
  if (brands.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.rail}
      contentContainerStyle={styles.railContent}
      testID="onboarding-featured-brands"
    >
      {brands.map((brand) => {
        const isFollowing = !!following[brand.sellerId];
        return (
          <View key={brand.id} style={styles.card} testID={`onboarding-featured-brand-${brand.sellerId}`}>
            <View style={styles.photos}>
              {brand.productImages.slice(0, 3).map((uri, i) => (
                <CachedImage key={`${uri}-${i}`} source={{ uri }} style={styles.photo} contentFit="cover" />
              ))}
            </View>
            <View style={styles.body}>
              <View style={styles.nameRow}>
                <Text numberOfLines={1} style={styles.name}>{brand.name}</Text>
                {brand.verified && <Feather name="check-circle" size={12} color={theme.text} />}
              </View>
              <Text style={styles.count}>
                {brand.productCount.toLocaleString()} {brand.productCount === 1 ? 'product' : 'products'}
              </Text>
              <Button
                label={isFollowing ? 'Following' : 'Follow'}
                variant={isFollowing ? 'secondary' : 'primary'}
                size="small"
                fullWidth
                loading={!!pending[brand.sellerId]}
                onPress={() => onToggle(brand)}
                accessibilityLabel={`${isFollowing ? 'Unfollow' : 'Follow'} ${brand.name}`}
                testID={`onboarding-featured-follow-${brand.sellerId}`}
              />
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  // flexGrow 0: a horizontal ScrollView otherwise stretches to fill the step on web.
  rail: { flexGrow: 0, marginBottom: SPACE.md },
  railContent: { gap: 10, alignItems: 'flex-start' },
  card: {
    width: CARD_WIDTH, backgroundColor: theme.card, borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, overflow: 'hidden',
  },
  photos: { flexDirection: 'row', gap: 1, backgroundColor: theme.border },
  photo: { flex: 1, aspectRatio: 4 / 5, backgroundColor: theme.surface },
  body: { padding: 12, gap: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { flexShrink: 1, fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  count: { fontSize: 12, fontFamily: FONT.medium, color: theme.muted, marginBottom: 4 },
});
