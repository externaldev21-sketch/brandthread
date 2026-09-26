/**
 * Full reviews list for one product — reached via "See all reviews" from the
 * Shop sheet or PDP's ProductReviewsSection.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useApi } from '@/lib/api';
import { FONT, FS, SP, BORDER_SUBTLE, FG, MUTED, SUBTLE, CARD_ELEVATED, GOLD, SCREEN_BG } from '@/lib/theme';
import type { ReviewItem } from '@/components/ProductReviewsSection';

function Stars({ rating }: { rating: number }) {
  const full = Math.round(Math.max(0, Math.min(5, rating)));
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <Feather key={i} name="star" size={13} color={i < full ? GOLD : BORDER_SUBTLE} />
      ))}
    </View>
  );
}

export default function ProductReviewsScreen() {
  const { productId, productName } = useLocalSearchParams<{ productId: string; productName?: string }>();
  const api = useApi();
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [avgRating, setAvgRating] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!productId) return;
    let active = true;
    api.reviews.forProduct(productId)
      .then(data => {
        if (!active) return;
        setReviews(data.reviews ?? []);
        setAvgRating(data.avgRating ?? 0);
        setTotalCount(data.totalCount ?? 0);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productId, api]);

  return (
    <View style={s.root}>
      <ScreenHeader title={productName || 'Reviews'} subtitle={totalCount > 0 ? `${avgRating.toFixed(1)} · ${totalCount} reviews` : undefined} />
      {loading ? (
        <View style={s.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={reviews}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: SP.md }}
          ListEmptyComponent={<View style={s.center}><Text style={s.muted}>No reviews yet</Text></View>}
          renderItem={({ item }) => (
            <View style={s.card}>
              <View style={s.headerRow}>
                <View style={s.avatar}>
                  <Text style={s.avatarText}>{(item.buyerName?.[0] ?? '?').toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{item.buyerName ?? 'Brandthread buyer'}</Text>
                  <Stars rating={item.rating} />
                </View>
                <Text style={s.date}>
                  {new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
              </View>
              {!!item.body && <Text style={s.body}>{item.body}</Text>}
            </View>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: SCREEN_BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  muted: { color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.sm },
  card: { paddingBottom: SP.md, marginBottom: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: FS.sm, fontFamily: FONT.bold, color: FG },
  name: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  date: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  body: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 20 },
});
