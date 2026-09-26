/**
 * Full reviews list for one product — reached via "See all reviews" from the
 * Shop sheet or PDP's ProductReviewsSection. Filter chips (With photos, star
 * rating, size) narrow the list client-side, per Nike/Amazon-style review
 * screens on Mobbin.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, Image, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { StarRating } from '@/components/StarRating';
import { FONT, FS, SP, BORDER_SUBTLE, FG, MUTED, SUBTLE, CARD_ELEVATED, SCREEN_BG } from '@/lib/theme';
import type { ReviewItem } from '@/components/ProductReviewsSection';

type StarFilter = 5 | 4 | 3 | 2 | 1 | null;

export default function ProductReviewsScreen() {
  const { productId, productName } = useLocalSearchParams<{ productId: string; productName?: string }>();
  const api = useApi();
  const { theme } = useAppTheme();
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [avgRating, setAvgRating] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [photosOnly, setPhotosOnly] = useState(false);
  const [starFilter, setStarFilter] = useState<StarFilter>(null);
  const [sizeFilter, setSizeFilter] = useState<string | null>(null);

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

  const sizes = useMemo(
    () => [...new Set(reviews.map(r => r.sizeBought).filter((v): v is string => !!v))],
    [reviews],
  );

  const filtered = reviews.filter(r =>
    (!photosOnly || !!r.photos?.length) &&
    (!starFilter || Math.round(r.rating) === starFilter) &&
    (!sizeFilter || r.sizeBought === sizeFilter),
  );

  return (
    <View style={s.root}>
      <ScreenHeader title={productName || 'Reviews'} subtitle={totalCount > 0 ? `${avgRating.toFixed(1)} · ${totalCount} reviews` : undefined} />
      {loading ? (
        <View style={s.center}><ActivityIndicator /></View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsRow}>
            <Chip label="With photos" active={photosOnly} onPress={() => setPhotosOnly(v => !v)} accent={theme.accent} />
            {([5, 4, 3, 2, 1] as const).map(star => (
              <Chip
                key={star}
                label={`${star}★`}
                active={starFilter === star}
                onPress={() => setStarFilter(f => (f === star ? null : star))}
                accent={theme.accent}
              />
            ))}
            {sizes.map(size => (
              <Chip
                key={size}
                label={size}
                active={sizeFilter === size}
                onPress={() => setSizeFilter(f => (f === size ? null : size))}
                accent={theme.accent}
              />
            ))}
          </ScrollView>

          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            contentContainerStyle={{ padding: SP.md }}
            ListEmptyComponent={<View style={s.center}><Text style={s.muted}>No matching reviews</Text></View>}
            renderItem={({ item }) => (
              <View style={s.card}>
                <View style={s.headerRow}>
                  {item.buyerAvatar ? (
                    <Image source={{ uri: item.buyerAvatar }} style={s.avatar} />
                  ) : (
                    <View style={s.avatar}>
                      <Text style={s.avatarText}>{(item.buyerName?.[0] ?? '?').toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={s.nameRow}>
                      <Text style={s.name}>{item.buyerName ?? 'Brandthread buyer'}</Text>
                      {item.verifiedBuyer && (
                        <View style={s.verifiedBadge}>
                          <Feather name="check-circle" size={11} color={theme.accent} />
                          <Text style={[s.verifiedText, { color: theme.accent }]}>Verified buyer</Text>
                        </View>
                      )}
                    </View>
                    <StarRating rating={item.rating} size={12} />
                  </View>
                  <Text style={s.date}>
                    {new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </View>
                {(item.sizeBought || item.fitNote) && (
                  <View style={s.fitChip}>
                    <Text style={s.fitChipText}>
                      {item.sizeBought ? `Size bought: ${item.sizeBought}` : ''}
                      {item.sizeBought && item.fitNote ? ' · ' : ''}
                      {item.fitNote ? `Fits ${item.fitNote.toLowerCase()}` : ''}
                    </Text>
                  </View>
                )}
                {!!item.body && <Text style={s.body}>{item.body}</Text>}
                {!!item.photos?.length && (
                  <View style={s.photoRow}>
                    {item.photos.map((uri, i) => (
                      <Image key={uri + i} source={{ uri }} style={s.photoThumb} />
                    ))}
                  </View>
                )}
              </View>
            )}
          />
        </>
      )}
    </View>
  );
}

function Chip({ label, active, onPress, accent }: { label: string; active: boolean; onPress: () => void; accent: string }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[s.chip, active && { backgroundColor: accent, borderColor: accent }]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[s.chipText, active && { color: '#000' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: SCREEN_BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  muted: { color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.sm },
  chipsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: BORDER_SUBTLE },
  chipText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED },
  card: { paddingBottom: SP.md, marginBottom: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: FS.sm, fontFamily: FONT.bold, color: FG },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 },
  name: { fontSize: FS.sm, fontFamily: FONT.bold, color: FG },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  verifiedText: { fontSize: 10, fontFamily: FONT.semibold },
  date: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  fitChip: { alignSelf: 'flex-start', backgroundColor: CARD_ELEVATED, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 6 },
  fitChipText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  body: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 20, marginBottom: 8 },
  photoRow: { flexDirection: 'row', gap: 6 },
  photoThumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: CARD_ELEVATED },
});
