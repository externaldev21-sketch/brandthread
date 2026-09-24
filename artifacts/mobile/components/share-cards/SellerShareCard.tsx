import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import type { SellerShareCardData, ShareCardVariant } from '@/lib/shareCard';
import { ShareCardFrame } from './ShareCardFrame';

interface SellerShareCardProps {
  theme: AppThemePreset;
  data: SellerShareCardData;
  variant: ShareCardVariant;
  qrValue: string | null;
}

export const SellerShareCard = React.forwardRef<View, SellerShareCardProps>(
  function SellerShareCard({ theme, data, variant, qrValue }, ref) {
    const initials = data.brandName.trim().slice(0, 2).toUpperCase() || '?';
    const products = data.products.slice(0, 3);
    const hasRating = !!data.rating && data.rating.totalCount > 0;

    return (
      <ShareCardFrame ref={ref} theme={theme} qrValue={qrValue}>
        <View style={[styles.logo, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}>
          {data.logoUri ? (
            <Image source={{ uri: data.logoUri }} style={styles.logoImg} />
          ) : (
            <Text style={[styles.logoInitials, { color: theme.text }]}>{initials}</Text>
          )}
        </View>

        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{data.brandName}</Text>
        <Text style={[styles.handle, { color: theme.muted }]} numberOfLines={1}>{data.handle}</Text>

        {hasRating ? (
          <View style={[styles.statPill, { borderColor: theme.border, backgroundColor: theme.cardGlass }]}>
            <Feather name="star" size={13} color={theme.text} />
            <Text style={[styles.statText, { color: theme.text }]}>
              {data.rating!.avgRating.toFixed(1)} ({data.rating!.totalCount})
            </Text>
          </View>
        ) : null}

        {variant === 'grid' && products.length > 0 ? (
          <View style={styles.thumbRow}>
            {products.map(product => (
              <View key={product.id} style={[styles.thumb, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}>
                {product.uri ? <Image source={{ uri: product.uri }} style={styles.thumbImg} /> : null}
              </View>
            ))}
          </View>
        ) : null}

        <Text style={[styles.tagline, { color: theme.muted }]}>Shop {data.brandName} on Brandthread</Text>
      </ShareCardFrame>
    );
  },
);

const styles = StyleSheet.create({
  logo: {
    width: 88,
    height: 88,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: SP.md,
  },
  logoImg: { width: '100%', height: '100%' },
  logoInitials: { fontFamily: FONT.bold, fontSize: FS.xxl },
  name: { fontFamily: FONT.bold, fontSize: FS.lg, textAlign: 'center' },
  handle: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2, textAlign: 'center' },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SP.md,
    paddingHorizontal: SP.md,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  statText: { fontFamily: FONT.semibold, fontSize: FS.xs },
  thumbRow: { flexDirection: 'row', gap: 6, marginTop: SP.lg },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  tagline: { fontFamily: FONT.medium, fontSize: FS.xs, marginTop: SP.lg, textAlign: 'center' },
});
