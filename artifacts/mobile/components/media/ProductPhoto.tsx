/**
 * Product photo with the app's one placeholder (Dev's less-AI pass, item 48):
 * when a product has no photo, or the photo fails to load, the slot shows a
 * flat dark tile with the brand's initial — never an icon, gradient or
 * "No image" text.
 */
import React, { useState } from 'react';
import { LayoutChangeEvent, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import type { ImageContentFit, ImageStyle } from 'expo-image';
import { CachedImage } from '@/components/CachedImage';
import { CREATE_CANVAS, FONT } from '@/lib/theme';

export const PRODUCT_PLACEHOLDER_BG = CREATE_CANVAS.surface;
const INITIAL_COLOR = CREATE_CANVAS.silverDim;

/** First letter or digit of the brand (falls back to the product name). */
export function brandInitial(...names: (string | null | undefined)[]): string {
  for (const name of names) {
    const match = name?.trim().match(/[\p{L}\p{N}]/u);
    if (match) return match[0].toUpperCase();
  }
  return '';
}

export function ProductPhotoPlaceholder({
  brand,
  name,
  style,
  testID,
}: {
  /** Brand / store name — its initial is what the tile shows. */
  brand?: string | null;
  /** Product name, used only when the brand is unknown. */
  name?: string | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const [side, setSide] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const next = Math.min(width, height);
    if (Math.abs(next - side) > 0.5) setSide(next);
  };
  const initial = brandInitial(brand, name);
  const fontSize = Math.max(11, Math.min(64, Math.round(side * 0.36)));
  return (
    <View
      testID={testID ?? 'product-photo-placeholder'}
      onLayout={onLayout}
      style={[styles.tile, style]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {side > 0 && initial ? (
        <Text style={[styles.initial, { fontSize, lineHeight: Math.round(fontSize * 1.2) }]} allowFontScaling={false}>
          {initial}
        </Text>
      ) : null}
    </View>
  );
}

export function ProductPhoto({
  uri,
  brand,
  name,
  style,
  contentFit = 'cover',
  recyclingKey,
  accessibilityLabel,
  testID,
}: {
  uri?: string | null;
  brand?: string | null;
  name?: string | null;
  style?: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  recyclingKey?: string;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  if (!uri || failedUri === uri) {
    return <ProductPhotoPlaceholder brand={brand} name={name} style={style} />;
  }
  return (
    <CachedImage
      testID={testID}
      source={{ uri }}
      style={style as StyleProp<ImageStyle>}
      contentFit={contentFit}
      recyclingKey={recyclingKey}
      accessibilityLabel={accessibilityLabel}
      onError={() => setFailedUri(uri)}
    />
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: PRODUCT_PLACEHOLDER_BG, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { color: INITIAL_COLOR, fontFamily: FONT.semibold, textAlign: 'center' },
});
