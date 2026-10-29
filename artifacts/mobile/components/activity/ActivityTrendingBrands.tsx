/**
 * Activity's inline "Trending brands" section (replaces the old "Find people
 * to follow" link). Rendered as the Activity list's footer, so it always
 * sits BELOW the newest-first activity rows and moves down as activity
 * grows; with no activity it sits near the top under a quiet line.
 *
 * X-style list (same rules as the #1056 reframe): 17 bold section title on
 * the 16pt gutter with a quiet "See all" on the right, then full-width rows —
 * 40pt seamless avatar, bold name + verified check, one gray meta line, and
 * a Follow button — split by hairlines aligned to the text column.
 *
 * Data comes from useActivityTrendingBrands (the same endpoint the Trending
 * brands screen uses). Follow is the shared FollowButton: optimistic, real
 * /api/social/follow call, rolls back on failure. Renders nothing when there
 * are no brands.
 */
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Avatar } from '@/components/ui/Avatar';
import FollowButton from '@/components/social/FollowButton';
import { FONT } from '@/lib/theme';
import { DENSE_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';
import type { TrendingBrandRow } from '@/lib/discoveryShelves';

const GUTTER = 16;
const AVATAR = 40;
const AVATAR_GAP = 12;
const NOT_FOLLOWING = { isFollowing: false, isFollowedBy: false, isMutual: false } as const;

const TrendingBrandItem = React.memo(function TrendingBrandItem({ brand, first, onOpen }: {
  brand: TrendingBrandRow;
  first: boolean;
  onOpen: (id: string) => void;
}) {
  const { theme } = useAppTheme();
  const handleOpen = useCallback(() => onOpen(brand.id), [brand.id, onOpen]);
  return (
    <View style={styles.row} testID={`activity-trending-row-${brand.id}`}>
      {/* Two sibling tap targets (profile, Follow), never nested — a
          Pressable inside a Pressable is a nested <button> on web. */}
      <Pressable
        onPress={handleOpen}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${brand.name}${brand.verified ? ', verified' : ''}${brand.followersLabel ? `, ${brand.followersLabel}` : ''}`}
      >
        <Avatar uri={brand.imageUri} name={brand.name} size={AVATAR} />
        <View style={[styles.text, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>
              {brand.name}
            </Text>
            {brand.verified && (
              <Feather name="check-circle" size={14} color={theme.text} accessibilityElementsHidden importantForAccessibility="no" />
            )}
          </View>
          <Text style={[styles.meta, { color: theme.muted }]} numberOfLines={1} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>
            {brand.followersLabel ?? 'Trending this week'}
          </Text>
        </View>
      </Pressable>
      <View style={[styles.action, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
        <FollowButton userId={brand.id} name={brand.name} initial={NOT_FOLLOWING} size="compact" style={styles.follow} />
      </View>
    </View>
  );
});

export function ActivityTrendingBrands({ brands }: { brands: readonly TrendingBrandRow[] }) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const openBrand = useCallback((id: string) => {
    router.push(`/seller-profile?id=${encodeURIComponent(id)}&src=feed` as never);
  }, [router]);
  const seeAll = useCallback(() => router.push('/buyer-trending?type=brands' as never), [router]);

  if (brands.length === 0) return null;
  return (
    <View style={styles.section} testID="activity-trending-brands">
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}
          style={[styles.title, { color: theme.text }]}
        >
          Trending brands
        </Text>
        <Pressable
          onPress={seeAll}
          accessibilityRole="button"
          accessibilityLabel="See all trending brands"
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          style={({ pressed }) => pressed && styles.pressed}
          testID="activity-trending-see-all"
        >
          <Text style={[styles.seeAll, { color: theme.muted }]} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>See all</Text>
        </Pressable>
      </View>
      {brands.map((brand, index) => (
        <TrendingBrandItem key={brand.id} brand={brand} first={index === 0} onOpen={openBrand} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: 8, paddingBottom: 8 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: GUTTER, paddingTop: 12, paddingBottom: 8,
  },
  title: { flex: 1, minWidth: 0, fontSize: 17, lineHeight: 22, fontFamily: FONT.bold, letterSpacing: -0.2 },
  seeAll: { fontSize: 15, lineHeight: 20, fontFamily: FONT.regular },
  row: { flexDirection: 'row', alignItems: 'stretch', paddingLeft: GUTTER },
  main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: AVATAR_GAP },
  // Hairline sits on the text column (not under the avatar), X-style.
  text: { flex: 1, minWidth: 0, minHeight: 64, justifyContent: 'center', gap: 2, paddingVertical: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0 },
  name: { flexShrink: 1, minWidth: 0, fontSize: 15, lineHeight: 20, fontFamily: FONT.bold },
  meta: { fontSize: 13, lineHeight: 18, fontFamily: FONT.regular },
  action: { justifyContent: 'center', paddingLeft: 12, paddingRight: GUTTER },
  follow: { minWidth: 92 },
  pressed: { opacity: 0.6 },
});
