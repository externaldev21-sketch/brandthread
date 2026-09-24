import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { CachedImage } from '@/components/CachedImage';

// Fixed 4:5 aspect ratio for every card so the grid never has uneven row
// heights — no per-image aspect-ratio measurement.
export const GRID_CARD_ASPECT = 0.8;

export type SearchProductTileItem = {
  id: string;
  name: string;
  brand: string;
  color: string;
  initials: string;
  imageUri?: string | null;
  /** Omitted for the "suggested products" empty-state set, which has no price. */
  priceCents?: number;
};

/** Product grid card — a 4:5 image, price chip overlay, name and brand row. */
export function ProductTile({ item, accent, onPress, width }: {
  item: SearchProductTileItem;
  accent: string;
  onPress: () => void;
  width: number;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);

  return (
    <TouchableOpacity style={[styles.card, { width }]} onPress={onPress} activeOpacity={0.88}>
      <View style={[styles.media, { width, height: width / GRID_CARD_ASPECT, backgroundColor: item.color }]}>
        {item.imageUri ? (
          <CachedImage source={{ uri: item.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={styles.fallback}>
            <Text style={styles.fallbackInitials}>{item.initials}</Text>
            <View style={styles.fallbackLine} />
          </View>
        )}
        {typeof item.priceCents === 'number' && (
          <View style={styles.priceChip}>
            <Text style={styles.priceText}>{formatCents(item.priceCents)}</Text>
          </View>
        )}
      </View>
      <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
      <View style={styles.brandRow}>
        <View style={[styles.brandDot, { backgroundColor: item.color }]} />
        <Text style={styles.brand} numberOfLines={1}>{item.brand}</Text>
        <Feather name="bookmark" size={13} color={accent} />
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  card: {},
  media: { borderRadius: 18, overflow: 'hidden', justifyContent: 'flex-end' },
  fallback: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: `${theme.background}24` },
  fallbackInitials: { color: theme.onAccent, fontSize: 36, fontFamily: 'Inter_700Bold' },
  fallbackLine: { width: 42, height: 2, borderRadius: 1, backgroundColor: `${theme.onAccent}8A`, marginTop: 10 },
  priceChip: { alignSelf: 'flex-start', backgroundColor: `${theme.background}C7`, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 6, margin: 9 },
  priceText: { color: theme.text, fontSize: 12, fontFamily: 'Inter_700Bold' },
  // Fixed height accommodates two lines so cards never shift height whether
  // the product name wraps or not (numberOfLines={2} below).
  name: { color: theme.text, fontSize: 14, lineHeight: 18, height: 36, fontFamily: 'Inter_700Bold', marginTop: 8 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5, height: 20 },
  brandDot: { width: 15, height: 15, borderRadius: 8 },
  brand: { color: theme.muted, fontSize: 11, fontFamily: 'Inter_500Medium', flex: 1 },
});
