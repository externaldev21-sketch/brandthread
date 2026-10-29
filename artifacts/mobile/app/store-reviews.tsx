/**
 * A store's reviews (features 64 + 65), reached by tapping the rating chip on
 * the store header. Copied from Etsy's shop Reviews tab
 * (https://mobbin.com/flows/9af12237-2251-45af-b227-c09f55ff2aba):
 * big overall score + rating count on the left, one bar per detail rating on
 * the right ("Item as described", "Shipping"), a Photos filter chip, then the
 * review list.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CachedImage } from '@/components/CachedImage';
import { StarRating } from '@/components/StarRating';
import { SellerReplyBlock, type ReviewItem } from '@/components/ProductReviewsSection';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { LONG_LIST_TUNING } from '@/lib/listTuning';
import { useReviewActions } from '@/lib/useReviewActions';
import { fitChipText, isVerifiedReview } from '@/lib/reviewDisplay';
import { DETAIL_RATING_ROWS, hasDetailRatings, type StoreDetailRatings } from '@/lib/storeTrust';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { hapticSelection } from '@/lib/haptics';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';

export default function StoreReviewsScreen() {
  const { sellerId } = useLocalSearchParams<{ sellerId: string }>();
  const api = useApi();
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const openReviewActions = useReviewActions();
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [avgRating, setAvgRating] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [details, setDetails] = useState<StoreDetailRatings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [photosOnly, setPhotosOnly] = useState(false);
  const activeRef = useRef(true);
  useEffect(() => () => { activeRef.current = false; }, []);

  const load = useCallback(async () => {
    if (!sellerId) return;
    try {
      const data = await api.reviews.forSeller(sellerId);
      if (!activeRef.current) return;
      setReviews(data.reviews ?? []);
      setAvgRating(data.avgRating ?? 0);
      setTotalCount(data.totalCount ?? 0);
      setDetails(data.details ?? null);
      setLoadFailed(false);
    } catch {
      if (activeRef.current) setLoadFailed(true);
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }, [api, sellerId]);

  useEffect(() => { void load(); }, [load]);
  const pull = usePullToRefresh(load);

  const photoCount = reviews.filter((r) => !!r.photos?.length).length;
  const visible = photosOnly ? reviews.filter((r) => !!r.photos?.length) : reviews;

  const summary = (
    <View>
      <View style={s.summary} testID="store-reviews-summary">
        <View style={s.scoreCol}>
          <View style={s.scoreRow}>
            <Text style={s.score}>{avgRating.toFixed(1)}</Text>
            <Text style={s.scoreStar}>★</Text>
          </View>
          <Text style={s.scoreCount}>{totalCount} {totalCount === 1 ? 'rating' : 'ratings'}</Text>
        </View>
        {hasDetailRatings(details) ? (
          <View style={s.detailsCol}>
            {DETAIL_RATING_ROWS.map(({ key, label }) => {
              const agg = details![key];
              return (
                <View key={key} style={s.detailRow} accessibilityLabel={agg.count ? `${label} ${agg.avg.toFixed(1)} out of 5` : `${label} not rated yet`}>
                  <Text style={s.detailLabel} numberOfLines={1}>{label}</Text>
                  <View style={s.track}>
                    <View style={[s.fill, { width: `${Math.min(100, (agg.avg / 5) * 100)}%` }]} />
                  </View>
                  <Text style={s.detailValue}>{agg.count ? agg.avg.toFixed(1) : '–'}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
      {photoCount > 0 ? (
        <View style={s.chipsRow}>
          <Pressable
            onPress={() => { hapticSelection(); setPhotosOnly((v) => !v); }}
            style={[s.chip, photosOnly && s.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: photosOnly }}
            testID="store-reviews-photos-chip"
          >
            <Text style={[s.chipText, photosOnly && s.chipTextActive]}>Photos ({photoCount})</Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={s.showing}>Showing {visible.length} of {totalCount} reviews</Text>
    </View>
  );

  return (
    <View style={s.root}>
      <ScreenHeader title="Reviews" />
      {loading ? (
        <View style={{ padding: SP.md, gap: SP.md }}>
          <SkeletonBlock width="100%" height={72} />
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ gap: 6 }}>
              <SkeletonBlock width="40%" height={13} />
              <SkeletonBlock width="90%" height={13} />
            </View>
          ))}
        </View>
      ) : loadFailed && reviews.length === 0 ? (
        <ErrorState message="Couldn't load reviews." onRetry={() => { void load(); }} style={{ flex: 1 }} />
      ) : (
        <FlatList
          {...LONG_LIST_TUNING}
          data={visible}
          keyExtractor={(item) => item.id}
          refreshControl={pull.refreshControl}
          ListHeaderComponent={summary}
          contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.lg }}
          ListEmptyComponent={<Text style={s.empty}>No reviews yet.</Text>}
          renderItem={({ item }) => (
            <View style={s.review}>
              <Pressable onLongPress={() => openReviewActions(item)} delayLongPress={400}>
                <View style={s.reviewTop}>
                  <Text style={s.name} numberOfLines={1}>{item.buyerName ?? 'Brandthread buyer'}</Text>
                  <Text style={s.date}>
                    {new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </View>
                <View style={s.starsRow}>
                  <StarRating rating={item.rating} size={13} />
                  {isVerifiedReview(item) ? (
                    <View style={s.verified}>
                      <Feather name="check-circle" size={12} color={theme.muted} />
                      <Text style={s.verifiedText}>Verified buyer</Text>
                    </View>
                  ) : null}
                </View>
                {fitChipText(item) ? <Text style={s.meta}>{fitChipText(item)}</Text> : null}
                {item.body ? <Text style={s.body}>{item.body}</Text> : null}
                {item.photos?.length ? (
                  <View style={s.photoRow}>
                    {item.photos.map((uri, i) => (
                      <CachedImage key={uri + i} source={{ uri }} style={s.photo} recyclingKey={uri} />
                    ))}
                  </View>
                ) : null}
              </Pressable>
              <SellerReplyBlock reply={item.sellerReply} repliedAt={item.sellerRepliedAt} />
            </View>
          )}
        />
      )}
    </View>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    summary: { flexDirection: 'row', alignItems: 'center', gap: SP.lg, paddingVertical: SP.md },
    scoreCol: { alignItems: 'center', minWidth: 84 },
    scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    score: { fontFamily: FONT.bold, fontSize: 34, lineHeight: 41, color: theme.text, fontVariant: ['tabular-nums'] },
    scoreStar: { fontSize: FS.xxl, color: theme.text },
    scoreCount: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted },
    detailsCol: { flex: 1, gap: SP.sm },
    detailRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
    detailLabel: { width: 112, fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text },
    track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: theme.border, overflow: 'hidden' },
    fill: { height: 4, borderRadius: 2, backgroundColor: theme.text },
    detailValue: { width: 26, textAlign: 'right', fontFamily: FONT.medium, fontSize: FS.sm, color: theme.text, fontVariant: ['tabular-nums'] },
    chipsRow: { flexDirection: 'row', gap: SP.sm, paddingBottom: SP.sm },
    chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: theme.border, justifyContent: 'center' },
    chipActive: { borderColor: theme.text, borderWidth: 1.5 },
    chipText: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.muted },
    chipTextActive: { color: theme.text },
    showing: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, paddingBottom: SP.sm },
    empty: { fontFamily: FONT.regular, fontSize: FS.base, color: theme.muted, paddingTop: SP.lg },
    review: { paddingVertical: SP.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
    reviewTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
    name: { flex: 1, fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text },
    date: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted },
    starsRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: 4 },
    verified: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    verifiedText: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted },
    meta: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, marginTop: 6 },
    body: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, color: theme.text, marginTop: 6 },
    photoRow: { flexDirection: 'row', gap: 6, marginTop: SP.sm },
    photo: { width: 64, height: 64, borderRadius: RADIUS.sm, backgroundColor: theme.card },
  });
}
