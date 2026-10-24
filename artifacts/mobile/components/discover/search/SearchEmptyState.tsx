/**
 * Focused, nothing-typed state of the Discover search overlay — TikTok's
 * search landing (Mobbin flow "Searching TikTok",
 * https://mobbin.com/flows/97a8565f-1675-4edb-b8e0-a2668bf009d7), in order:
 *   1. Recent searches — clock, term, × per row; "See more" past 5,
 *      "Clear all" in the section header.
 *   2. Trending — TikTok's "You may like" two-column list: rank number,
 *      term, and a Hot/New tag only when the server's counts earned it.
 *   3. Trending brands — avatar, name, Follow.
 *   4. Trending products — small photo rows.
 * Every row comes from the API (see useSearchTrending); nothing here is
 * filler. Reskinned to Brandthread's black/white/silver.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import FollowButton from '@/components/social/FollowButton';
import { useSignInGate } from '@/hooks/useSignInGate';
import { hapticSelection } from '@/lib/haptics';
import { formatCents } from '@/lib/money';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII, radius } from '@/constants/radii';
import { toColumnsRowMajor } from '@/lib/discoverSearch';
import type { TrendingBrandItem, TrendingProductItem, TrendingQuery } from './useSearchTrending';

const RECENT_COLLAPSED = 5;

export function SearchEmptyState({
  recent,
  onRecentPress,
  onRecentRemove,
  onClearRecent,
  queries,
  brands,
  products,
  onQueryPress,
  onBrandPress,
  onProductPress,
}: {
  recent: string[];
  onRecentPress: (term: string) => void;
  onRecentRemove: (term: string) => void;
  onClearRecent: () => void;
  queries: TrendingQuery[];
  brands: TrendingBrandItem[];
  products: TrendingProductItem[];
  onQueryPress: (term: string) => void;
  onBrandPress: (id: string) => void;
  onProductPress: (id: string) => void;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const { requireSignIn } = useSignInGate();
  const [expanded, setExpanded] = useState(false);
  const shownRecent = expanded ? recent : recent.slice(0, RECENT_COLLAPSED);

  return (
    <View testID="discover-search-empty">
      {recent.length > 0 && (
        <View testID="discover-search-recent">
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent</Text>
            <Pressable
              onPress={() => { hapticSelection(); onClearRecent(); }}
              accessibilityRole="button"
              accessibilityLabel="Clear all recent searches"
              hitSlop={12}
              testID="discover-search-clear-recent"
            >
              <Text style={styles.sectionAction}>Clear all</Text>
            </Pressable>
          </View>
          {shownRecent.map((term) => (
            <View key={term} style={styles.recentRow}>
              <Pressable
                style={styles.recentTap}
                onPress={() => { hapticSelection(); onRecentPress(term); }}
                accessibilityRole="button"
                accessibilityLabel={`Search ${term}`}
              >
                <Feather name="clock" size={18} color={theme.muted} />
                <Text style={styles.recentText} numberOfLines={1}>{term}</Text>
              </Pressable>
              <Pressable
                onPress={() => { hapticSelection(); onRecentRemove(term); }}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${term} from recent searches`}
                hitSlop={12}
                style={styles.recentRemove}
              >
                <Feather name="x" size={18} color={theme.muted} />
              </Pressable>
            </View>
          ))}
          {!expanded && recent.length > RECENT_COLLAPSED && (
            <Pressable
              style={styles.seeMore}
              onPress={() => { hapticSelection(); setExpanded(true); }}
              accessibilityRole="button"
              testID="discover-search-see-more"
            >
              <Text style={styles.seeMoreText}>See more</Text>
              <Feather name="chevron-down" size={16} color={theme.muted} />
            </Pressable>
          )}
        </View>
      )}

      {queries.length > 0 && (
        <View testID="discover-search-trending">
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Trending</Text>
          </View>
          {toColumnsRowMajor(queries).map((row) => (
            <View key={row.map((q) => q.term).join('|')} style={styles.trendRow}>
              {row.map((q) => (
                <Pressable
                  key={q.term}
                  style={styles.trendCell}
                  onPress={() => { hapticSelection(); onQueryPress(q.term); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Search ${q.term}${q.tag ? `, ${q.tag}` : ''}`}
                >
                  <Text style={[styles.trendRank, q.rank <= 3 && styles.trendRankTop]}>{q.rank}</Text>
                  <Text style={styles.trendTerm} numberOfLines={1}>{q.term}</Text>
                  {q.tag && (
                    <View style={[styles.tag, q.tag === 'hot' && styles.tagHot]}>
                      <Text style={[styles.tagText, q.tag === 'hot' && styles.tagTextHot]}>{q.tag === 'hot' ? 'Hot' : 'New'}</Text>
                    </View>
                  )}
                </Pressable>
              ))}
              {row.length === 1 && <View style={styles.trendCell} />}
            </View>
          ))}
        </View>
      )}

      {brands.length > 0 && (
        <View testID="discover-search-brands">
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Trending brands</Text>
          </View>
          {brands.map((b) => (
            <View key={b.id} style={styles.entityRow}>
              <Pressable
                style={styles.entityTap}
                onPress={() => onBrandPress(b.id)}
                accessibilityRole="button"
                accessibilityLabel={b.name}
              >
                {b.imageUri ? (
                  <CachedImage source={{ uri: b.imageUri }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarInitials}>{b.initials}</Text>
                  </View>
                )}
                <View style={styles.entityText}>
                  <View style={styles.nameRow}>
                    <Text style={styles.entityName} numberOfLines={1}>{b.name}</Text>
                    {b.verified && <Feather name="check-circle" size={13} color={theme.text} />}
                  </View>
                  {b.subline ? <Text style={styles.entitySub} numberOfLines={1}>{b.subline}</Text> : null}
                </View>
              </Pressable>
              <FollowButton
                userId={b.id}
                name={b.name}
                initial={{ isFollowing: false, isFollowedBy: false, isMutual: false }}
                size="compact"
                guard={requireSignIn}
                style={styles.follow}
              />
            </View>
          ))}
        </View>
      )}

      {products.length > 0 && (
        <View testID="discover-search-products">
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Trending products</Text>
          </View>
          {products.map((p) => (
            <Pressable
              key={p.id}
              style={styles.productRow}
              onPress={() => onProductPress(p.id)}
              accessibilityRole="button"
              accessibilityLabel={p.name}
            >
              {p.imageUri ? (
                <CachedImage source={{ uri: p.imageUri }} style={styles.productImage} contentFit="cover" />
              ) : (
                <View style={[styles.productImage, styles.avatarFallback]}>
                  <Feather name="image" size={18} color={theme.muted} />
                </View>
              )}
              <View style={styles.entityText}>
                <Text style={styles.entityName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.entitySub} numberOfLines={1}>
                  {[p.brand, p.priceCents != null ? formatCents(p.priceCents) : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={theme.muted} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.md, paddingBottom: SPACING.xs,
  },
  sectionTitle: { ...TYPE_SCALE.headline, color: theme.text },
  sectionAction: { ...TYPE_SCALE.footnote, fontFamily: FONT.semibold, color: theme.muted },
  recentRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SCREEN_GUTTER, minHeight: 44 },
  recentTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 44 },
  recentText: { ...TYPE_SCALE.body, color: theme.text, flex: 1 },
  recentRemove: { paddingLeft: SPACING.sm, minHeight: 44, justifyContent: 'center' },
  seeMore: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xxs, minHeight: 44 },
  seeMoreText: { ...TYPE_SCALE.footnote, fontFamily: FONT.medium, color: theme.muted },
  trendRow: { flexDirection: 'row', paddingHorizontal: SCREEN_GUTTER, gap: SPACING.md },
  trendCell: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, minHeight: 44 },
  trendRank: { ...TYPE_SCALE.body, fontFamily: FONT.semibold, color: theme.muted, width: 20, textAlign: 'center' },
  trendRankTop: { color: theme.text, fontFamily: FONT.bold },
  trendTerm: { ...TYPE_SCALE.body, color: theme.text, flexShrink: 1 },
  tag: {
    paddingHorizontal: 6, height: 18, borderRadius: radius.sm / 2, justifyContent: 'center',
    borderWidth: 1, borderColor: theme.border,
  },
  // Hot = solid silver/white chip; New = outline. Monochrome per the palette rule.
  tagHot: { backgroundColor: theme.text, borderColor: theme.text },
  tagText: { ...TYPE_SCALE.caption, fontFamily: FONT.semibold, color: theme.muted },
  tagTextHot: { color: theme.background },
  entityRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SCREEN_GUTTER, paddingVertical: SPACING.xs, gap: SPACING.sm },
  entityTap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  avatar: { width: 44, height: 44, borderRadius: RADII.avatar, backgroundColor: theme.surface },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface },
  avatarInitials: { ...TYPE_SCALE.footnote, fontFamily: FONT.bold, color: theme.text },
  entityText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xxs },
  entityName: { ...TYPE_SCALE.body, fontFamily: FONT.semibold, color: theme.text, flexShrink: 1 },
  entitySub: { ...TYPE_SCALE.footnote, color: theme.muted },
  follow: { minWidth: 88 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SCREEN_GUTTER, paddingVertical: SPACING.xs },
  productImage: { width: 48, height: 60, borderRadius: radius.sm, backgroundColor: theme.surface },
});
