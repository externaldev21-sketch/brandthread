/**
 * "Just copped" story card: the product a buyer just bought, in the same
 * 9:16 ShareCardFrame (Brandthread wordmark + product QR) as the profile
 * cards.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import type { CoppedCardData } from '@/lib/coppedCard';
import { ShareCardFrame } from './ShareCardFrame';

export const CoppedShareCard = React.forwardRef<View, { theme: AppThemePreset; data: CoppedCardData }>(
  function CoppedShareCard({ theme, data }, ref) {
    return (
      <ShareCardFrame ref={ref} theme={theme} qrValue={data.url}>
        <Text style={[styles.eyebrow, { color: theme.muted }]}>Just copped</Text>
        <View style={[styles.photo, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}>
          {data.imageUri ? (
            <Image source={{ uri: data.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <Feather name="shopping-bag" size={32} color={theme.muted} />
          )}
        </View>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={2}>{data.productName}</Text>
        <Text style={[styles.brand, { color: theme.muted }]} numberOfLines={1}>
          {data.brandHandle || data.brandName}
        </Text>
        {data.moreCount > 0 ? (
          <Text style={[styles.more, { color: theme.muted }]}>+{data.moreCount} more</Text>
        ) : null}
      </ShareCardFrame>
    );
  },
);

const styles = StyleSheet.create({
  eyebrow: { fontFamily: FONT.semibold, fontSize: FS.xs, marginBottom: SP.sm },
  photo: {
    width: 168,
    height: 210,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontFamily: FONT.bold, fontSize: FS.lg, textAlign: 'center', marginTop: SP.md },
  brand: { fontFamily: FONT.medium, fontSize: FS.sm, textAlign: 'center', marginTop: 2 },
  more: { fontFamily: FONT.regular, fontSize: FS.xs, textAlign: 'center', marginTop: SP.xs },
});
