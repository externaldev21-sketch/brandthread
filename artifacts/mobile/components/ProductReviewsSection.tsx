/**
 * Shared buyer-facing reviews section — average rating + count, a rating
 * breakdown, and the 2-3 most recent reviews, with "See all reviews" opening
 * the full list. Used by both the Shop sheet and the PDP so review UI never
 * drifts between the two surfaces (GOAT / SSENSE / Nike product-page pattern:
 * https://mobbin.com — reviews sit below description/options, never a boxed
 * empty state when there are none).
 *
 * Renders nothing when there are no reviews — no empty box.
 *
 * Note: the reviews schema doesn't yet carry buyer size-bought / fit-note /
 * photo fields (would need a migration), so this card shows avatar, name,
 * stars, date and text only. Those richer fields are a follow-up once the
 * schema supports them.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApi } from '@/lib/api';
import { FONT, FS, SP, RADIUS, BORDER, BORDER_SUBTLE, FG, MUTED, SUBTLE, CARD_ELEVATED, GOLD } from '@/lib/theme';

export interface ReviewItem {
  id: string;
  rating: number;
  body?: string | null;
  buyerName?: string | null;
  buyerAvatar?: string | null;
  createdAt: string;
}

export interface ReviewsSeed {
  reviews: ReviewItem[];
  avgRating: number;
  totalCount: number;
}

function Stars({ rating, size = 12 }: { rating: number; size?: number }) {
  const full = Math.round(Math.max(0, Math.min(5, rating)));
  return (
    <View style={{ flexDirection: 'row', gap: 1 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <Feather key={i} name="star" size={size} color={i < full ? GOLD : BORDER} style={i < full ? undefined : { opacity: 0.5 }} />
      ))}
    </View>
  );
}

export function ProductReviewsSection({
  productId, productName, seed,
}: {
  productId: string;
  productName?: string;
  /** Preview-mode: seeded data, skips the network call entirely. */
  seed?: ReviewsSeed;
}) {
  const api = useApi();
  const router = useRouter();
  const [data, setData] = useState<ReviewsSeed | null>(seed ?? null);
  const [loading, setLoading] = useState(!seed);

  useEffect(() => {
    if (seed) { setData(seed); setLoading(false); return; }
    let active = true;
    setLoading(true);
    api.reviews.forProduct(productId)
      .then(result => { if (active) setData(result); })
      .catch(() => { if (active) setData({ reviews: [], avgRating: 0, totalCount: 0 }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productId, seed, api]);

  if (loading || !data || data.totalCount === 0) return null;

  const breakdown = [5, 4, 3, 2, 1].map(star => ({
    star,
    count: data.reviews.filter(r => Math.round(r.rating) === star).length,
  }));
  const maxCount = Math.max(1, ...breakdown.map(b => b.count));
  const topReviews = data.reviews.filter(r => r.body?.trim()).slice(0, 3);

  return (
    <View style={s.wrap}>
      <View style={s.headerRow}>
        <Text style={s.title}>Reviews</Text>
        <TouchableOpacity
          onPress={() => router.push(`/product-reviews?productId=${encodeURIComponent(productId)}&productName=${encodeURIComponent(productName ?? '')}` as never)}
          accessibilityRole="button"
          accessibilityLabel="See all reviews"
        >
          <Text style={s.seeAll}>See all</Text>
        </TouchableOpacity>
      </View>

      <View style={s.summaryRow}>
        <View style={s.avgBlock}>
          <Text style={s.avgNumber}>{data.avgRating.toFixed(1)}</Text>
          <Stars rating={data.avgRating} size={13} />
          <Text style={s.countText}>{data.totalCount} review{data.totalCount !== 1 ? 's' : ''}</Text>
        </View>
        <View style={s.breakdownBlock}>
          {breakdown.map(b => (
            <View key={b.star} style={s.breakdownRow}>
              <Text style={s.breakdownLabel}>{b.star}</Text>
              <View style={s.breakdownTrack}>
                <View style={[s.breakdownFill, { width: `${(b.count / maxCount) * 100}%` }]} />
              </View>
            </View>
          ))}
        </View>
      </View>

      {topReviews.map(review => (
        <View key={review.id} style={s.reviewCard}>
          <View style={s.reviewHeader}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{(review.buyerName?.[0] ?? '?').toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.reviewerName}>{review.buyerName ?? 'Brandthread buyer'}</Text>
              <Stars rating={review.rating} />
            </View>
            <Text style={s.reviewDate}>
              {new Date(review.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </Text>
          </View>
          {!!review.body && <Text style={s.reviewBody}>{review.body}</Text>}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: BORDER_SUBTLE, marginBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: FS.sm, fontFamily: FONT.bold, color: FG, textTransform: 'uppercase', letterSpacing: 0.8 },
  seeAll: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  summaryRow: { flexDirection: 'row', gap: 20, marginBottom: 16, alignItems: 'center' },
  avgBlock: { alignItems: 'flex-start', gap: 3 },
  avgNumber: { fontSize: FS.xxl, fontFamily: FONT.bold, color: FG },
  countText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  breakdownBlock: { flex: 1, gap: 3 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  breakdownLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: SUBTLE, width: 8 },
  breakdownTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: CARD_ELEVATED, overflow: 'hidden' },
  breakdownFill: { height: '100%', backgroundColor: GOLD, borderRadius: 2 },
  reviewCard: { marginBottom: 14 },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: FS.xs, fontFamily: FONT.bold, color: FG },
  reviewerName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  reviewDate: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  reviewBody: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 19 },
});
