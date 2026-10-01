/**
 * Shared buyer-facing reviews section — average rating + count, a rating
 * breakdown, a fit meter, and the 2-3 most recent reviews, with "See all
 * reviews" opening the full list. Used by both the Shop sheet and the PDP so
 * review UI never drifts between the two surfaces.
 *
 * Studied against Nike, SSENSE, GOAT, and Amazon product review sections on
 * Mobbin:
 * https://mobbin.com/apps/nike-ios/262929e0-4b39-45f6-9f57-93c40d21d4b0/screens
 * https://mobbin.com/apps/ssense-ios/eb0dc389-c1a1-4477-8f0c-de907d47da39/screens
 * https://mobbin.com/apps/goat-ios/be6ac541-8cd6-4b1d-9e08-cb643497b298/screens
 * https://mobbin.com/apps/amazon-ios/6f088459-24a0-457c-8c5c-89ac95d7e51a/screens
 *
 * Renders nothing when there are no reviews — no empty box.
 *
 * Migration 113 added photos, size bought, fit note, persisted helpful votes
 * and the seller reply to the reviews API. "Verified buyer" comes from the
 * server-derived `verifiedPurchase` flag; the optional rows render only when
 * a review has them.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { StarRating } from '@/components/StarRating';
import { CachedImage } from '@/components/CachedImage';
import { FONT, FS, BORDER_SUBTLE, FG, MUTED, SUBTLE, CARD_ELEVATED } from '@/lib/theme';
import * as Haptics from 'expo-haptics';
import { applyHelpfulToggle, fitChipText, isVerifiedReview } from '@/lib/reviewDisplay';

export interface ReviewItem {
  id: string;
  rating: number;
  body?: string | null;
  buyerName?: string | null;
  buyerAvatar?: string | null;
  createdAt: string;
  /** Every real review is order-verified server-side; true for seeded preview data too. */
  verifiedBuyer?: boolean;
  /** Server-derived: the review is tied to a real delivered order. */
  verifiedPurchase?: boolean;
  sellerReply?: string | null;
  sellerRepliedAt?: string | null;
  viewerHelpful?: boolean;
  sizeBought?: string | null;
  /** e.g. "Runs small", "True to size", "Runs large". */
  fitNote?: string | null;
  /** -2 (runs very small) .. 0 (true to size) .. 2 (runs very large), drives the fit meter. */
  fitScale?: number | null;
  photos?: string[];
  helpfulCount?: number;
}

export interface ReviewsSeed {
  reviews: ReviewItem[];
  avgRating: number;
  totalCount: number;
}

function FitMeter({ avgFitScale }: { avgFitScale: number }) {
  const { theme } = useAppTheme();
  // 5 stops: -2..2. Round to the nearest stop so the marker sits on a dot.
  const stopIndex = Math.max(0, Math.min(4, Math.round(avgFitScale) + 2));
  return (
    <View style={fitS.wrap}>
      <Text style={fitS.label}>Fit</Text>
      <Text style={fitS.value}>
        {['Runs small', 'Runs slightly small', 'True to size', 'Runs slightly large', 'Runs large'][stopIndex]}
      </Text>
      <View style={fitS.track}>
        {[0, 1, 2, 3, 4].map(i => (
          <View
            key={i}
            style={[
              fitS.dot,
              { backgroundColor: i === stopIndex ? theme.accent : theme.borderSubtle },
              i === stopIndex && fitS.dotActive,
            ]}
          />
        ))}
      </View>
      <View style={fitS.endLabels}>
        <Text style={fitS.endLabel}>Runs small</Text>
        <Text style={fitS.endLabel}>Runs large</Text>
      </View>
    </View>
  );
}

/** The seller's public reply under a review card (shared with the full list). */
export function SellerReplyBlock({ reply, repliedAt }: { reply?: string | null; repliedAt?: string | null }) {
  const { theme } = useAppTheme();
  if (!reply) return null;
  return (
    <View style={[replyS.box, { backgroundColor: theme.cardElevated }]} accessibilityLabel="Seller reply">
      <View style={replyS.head}>
        <Feather name="corner-down-right" size={12} color={theme.muted} />
        <Text style={[replyS.label, { color: theme.text }]}>Seller reply</Text>
        {!!repliedAt && (
          <Text style={[replyS.date, { color: theme.muted }]}>
            {new Date(repliedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </Text>
        )}
      </View>
      <Text style={[replyS.body, { color: theme.muted }]}>{reply}</Text>
    </View>
  );
}

function ReviewPhotoViewer({ photos, startIndex, onClose }: { photos: string[]; startIndex: number; onClose: () => void }) {
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <TouchableOpacity style={photoS.backdrop} activeOpacity={1} onPress={onClose} accessibilityLabel="Close photo">
        <CachedImage source={{ uri: photos[startIndex] }} style={photoS.image} contentFit="contain" />
      </TouchableOpacity>
    </Modal>
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
  const { theme } = useAppTheme();
  const [data, setData] = useState<ReviewsSeed | null>(seed ?? null);
  const [loading, setLoading] = useState(!seed);
  const [openPhoto, setOpenPhoto] = useState<{ photos: string[]; index: number } | null>(null);
  const { isSignedIn } = useAuth();
  // Per-review helpful state layered over the server value (persisted via the API).
  const [helpful, setHelpful] = useState<Record<string, { helpfulCount: number; viewerHelpful: boolean }>>({});

  const toggleHelpful = (review: ReviewItem) => {
    const current = helpful[review.id] ?? { helpfulCount: review.helpfulCount ?? 0, viewerHelpful: !!review.viewerHelpful };
    const next = applyHelpfulToggle(current);
    void Haptics.selectionAsync();
    setHelpful(prev => ({ ...prev, [review.id]: next }));
    // Seeded preview data has no server rows; everything else persists.
    if (seed) return;
    const call = current.viewerHelpful ? api.reviews.unmarkHelpful(review.id) : api.reviews.markHelpful(review.id);
    call
      .then(server => setHelpful(prev => ({ ...prev, [review.id]: server })))
      .catch(() => setHelpful(prev => ({ ...prev, [review.id]: current })));
  };

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

  const sampleCount = data.reviews.length || 1;
  const breakdown = [5, 4, 3, 2, 1].map(star => {
    const count = data.reviews.filter(r => Math.round(r.rating) === star).length;
    return { star, count, pct: Math.round((count / sampleCount) * 100) };
  });
  const maxCount = Math.max(1, ...breakdown.map(b => b.count));
  const topReviews = data.reviews.filter(r => r.body?.trim()).slice(0, 3);
  const fitScales = data.reviews.map(r => r.fitScale).filter((v): v is number => typeof v === 'number');
  const avgFitScale = fitScales.length > 0 ? fitScales.reduce((a, b) => a + b, 0) / fitScales.length : null;

  return (
    <View style={s.wrap}>
      <View style={s.headerRow}>
        <Text style={s.title}>Reviews ({data.totalCount})</Text>
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
          <StarRating rating={data.avgRating} size={14} />
          <Text style={s.countText}>{data.totalCount} review{data.totalCount !== 1 ? 's' : ''}</Text>
        </View>
        <View style={s.breakdownBlock}>
          {breakdown.map(b => (
            <View key={b.star} style={s.breakdownRow}>
              <Text style={s.breakdownLabel}>{b.star}</Text>
              <View style={s.breakdownTrack}>
                <View style={[s.breakdownFill, { width: `${(b.count / maxCount) * 100}%`, backgroundColor: theme.accent }]} />
              </View>
              <Text style={s.breakdownPct}>{b.pct}%</Text>
            </View>
          ))}
        </View>
      </View>

      {avgFitScale != null && <FitMeter avgFitScale={avgFitScale} />}

      {topReviews.map(review => {
        const { helpfulCount, viewerHelpful } = helpful[review.id]
          ?? { helpfulCount: review.helpfulCount ?? 0, viewerHelpful: !!review.viewerHelpful };
        const chip = fitChipText(review);
        return (
          <View key={review.id} style={s.reviewCard}>
            <View style={s.reviewHeader}>
              {review.buyerAvatar ? (
                <CachedImage source={{ uri: review.buyerAvatar }} style={s.avatar} recyclingKey={review.id} />
              ) : (
                <View style={s.avatar}>
                  <Text style={s.avatarText}>{(review.buyerName?.[0] ?? '?').toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <View style={s.nameRow}>
                  <Text style={s.reviewerName}>{review.buyerName ?? 'Brandthread buyer'}</Text>
                  {isVerifiedReview(review) && (
                    <View style={s.verifiedBadge}>
                      <Feather name="check-circle" size={11} color={theme.accent} />
                      <Text style={[s.verifiedText, { color: theme.accent }]}>Verified buyer</Text>
                    </View>
                  )}
                </View>
                <StarRating rating={review.rating} size={12} />
              </View>
              <Text style={s.reviewDate}>
                {new Date(review.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </Text>
            </View>

            {chip && (
              <View style={s.fitChip}>
                <Text style={s.fitChipText}>{chip}</Text>
              </View>
            )}

            {!!review.body && <Text style={s.reviewBody}>{review.body}</Text>}

            {!!review.photos?.length && (
              <View style={s.photoRow}>
                {review.photos.map((uri, i) => (
                  <TouchableOpacity
                    key={uri + i}
                    onPress={() => setOpenPhoto({ photos: review.photos!, index: i })}
                    accessibilityRole="button"
                    accessibilityLabel={`View review photo ${i + 1}`}
                  >
                    <CachedImage source={{ uri }} style={s.photoThumb} recyclingKey={uri} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <SellerReplyBlock reply={review.sellerReply} repliedAt={review.sellerRepliedAt} />

            <TouchableOpacity
              style={s.helpfulRow}
              onPress={() => toggleHelpful(review)}
              // Signed-out visitors can read but not vote.
              disabled={!isSignedIn && !seed}
              accessibilityRole="button"
              accessibilityState={{ selected: viewerHelpful, disabled: !isSignedIn && !seed }}
              accessibilityLabel={`Mark helpful, ${helpfulCount} people found this helpful`}
            >
              <Feather name="thumbs-up" size={12} color={viewerHelpful ? theme.text : MUTED} />
              <Text style={[s.helpfulText, viewerHelpful && { color: theme.text }]}>Helpful ({helpfulCount})</Text>
            </TouchableOpacity>
          </View>
        );
      })}

      {openPhoto && (
        <ReviewPhotoViewer
          photos={openPhoto.photos}
          startIndex={openPhoto.index}
          onClose={() => setOpenPhoto(null)}
        />
      )}
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
  countText: { fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED },
  breakdownBlock: { flex: 1, gap: 4 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breakdownLabel: { fontSize: FS.meta, fontFamily: FONT.medium, color: SUBTLE, width: 10 },
  breakdownTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: CARD_ELEVATED, overflow: 'hidden' },
  breakdownFill: { height: '100%', borderRadius: 2 },
  breakdownPct: { fontSize: FS.meta, fontFamily: FONT.medium, color: SUBTLE, width: 34, textAlign: 'right' },
  reviewCard: { marginBottom: 16 },
  reviewHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: FS.meta, fontFamily: FONT.bold, color: FG },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 },
  reviewerName: { fontSize: FS.sm, fontFamily: FONT.bold, color: FG },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  // Was fontSize: 10 (below the 11pt floor) — "Verified buyer" specifically
  // measured as blurry-small on live.
  verifiedText: { fontSize: FS.meta, fontFamily: FONT.semibold },
  reviewDate: { fontSize: FS.meta, fontFamily: FONT.medium, color: SUBTLE },
  fitChip: { alignSelf: 'flex-start', backgroundColor: CARD_ELEVATED, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 6 },
  fitChipText: { fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED },
  reviewBody: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED, lineHeight: 19, marginBottom: 8 },
  photoRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  photoThumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: CARD_ELEVATED },
  helpfulRow: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  helpfulText: { fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED },
});

const replyS = StyleSheet.create({
  box: { borderRadius: 10, padding: 10, marginBottom: 8, gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: FS.meta, fontFamily: FONT.bold, flex: 1 },
  date: { fontSize: FS.meta, fontFamily: FONT.medium },
  body: { fontSize: FS.sm, fontFamily: FONT.medium, lineHeight: 19 },
});

const fitS = StyleSheet.create({
  wrap: { marginBottom: 18 },
  label: { fontSize: FS.meta, fontFamily: FONT.bold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  value: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: 8 },
  track: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  dot: { flex: 1, height: 4, borderRadius: 2 },
  dotActive: { height: 8, borderRadius: 4 },
  endLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  endLabel: { fontSize: FS.meta, fontFamily: FONT.medium, color: SUBTLE },
});

const photoS = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '80%' },
});
