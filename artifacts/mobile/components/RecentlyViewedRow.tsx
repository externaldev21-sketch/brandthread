/**
 * "Recently viewed" row — shared by Discover and the bag.
 * Backed by GET /api/buyer/recently-viewed (real per-buyer view history,
 * recorded from buyer-product-detail.tsx on each product view).
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';

interface RecentlyViewedItem {
  productId: string;
  name: string;
  brand: string;
  image: string | null;
  priceCents: number | null;
  viewedAt: string;
}

export function RecentlyViewedRow({ style }: { style?: object }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const api = useApi();
  const { isSignedIn } = useAuth();
  const [items, setItems] = useState<RecentlyViewedItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isSignedIn) { setLoaded(true); return; }
    let cancelled = false;
    api.buyer.recentlyViewed.list(12)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [api, isSignedIn]);

  // No skeleton/empty-state here by design — a "Recently viewed" section
  // simply isn't shown until there's real history, same as the pattern used
  // for the "Worn in these videos" row on product detail.
  if (!loaded || items.length === 0) return null;

  return (
    <View style={style}>
      <Text style={[s.header, { color: theme.muted }]}>Recently viewed</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: SP.sm }}
      >
        {items.map((item) => (
          <TouchableOpacity
            key={item.productId}
            style={s.card}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.brand}${item.priceCents != null ? `, ${formatCents(item.priceCents)}` : ''}`}
            onPress={() => {
              router.push(`/thread-product-detail?productId=${encodeURIComponent(item.productId)}&productName=${encodeURIComponent(item.name)}` as never);
            }}
          >
            {item.image ? (
              <CachedImage source={{ uri: item.image }} style={[s.image, { backgroundColor: theme.cardElevated }]} contentFit="cover" />
            ) : (
              <View style={[s.image, { backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center' }]}>
                <Feather name="image" size={18} color={theme.muted} />
              </View>
            )}
            <Text style={[s.name, { color: theme.text }]} numberOfLines={1}>{item.name}</Text>
            {item.priceCents != null && (
              <Text style={[s.price, { color: theme.muted }]}>{formatCents(item.priceCents)}</Text>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    fontSize: FS.sm, fontFamily: FONT.semibold, textTransform: 'uppercase',
    letterSpacing: 0.4, marginBottom: SP.sm,
  },
  card: { width: 104 },
  image: { width: 104, height: 104, borderRadius: RADIUS.md },
  name: { fontSize: FS.xs, fontFamily: FONT.medium, marginTop: 6 },
  price: { fontSize: FS.xs, fontFamily: FONT.bold, marginTop: 2 },
});
