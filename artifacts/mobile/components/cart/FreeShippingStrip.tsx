/**
 * Free-shipping progress at the top of one bag section (one seller = one
 * order). Mobbin reference: HBX bag — a full-width line "Spend $X more…"
 * over a thin progress bar; once qualified the line says the order ships
 * free and the bar is full.
 *
 * Renders nothing when the seller has no threshold or the group holds a
 * pre-order. The bar animates only when the subtotal changes, so the motion
 * means "your progress moved".
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useFreeShippingThreshold } from '@/lib/freeShipping';
import { freeShippingLine, freeShippingProgress } from '@/lib/freeShippingProgress';
import { FONT, FS, SP } from '@/lib/theme';

export function FreeShippingStrip({ sellerId, sellerName, subtotalCents, hasPreOrder }: {
  sellerId: string;
  sellerName: string;
  subtotalCents: number;
  hasPreOrder: boolean;
}) {
  const threshold = useFreeShippingThreshold(sellerId);
  const progress = hasPreOrder ? null : freeShippingProgress(subtotalCents, threshold);
  if (!progress) return null;
  return <StripBody line={freeShippingLine(progress, sellerName)} fraction={progress.progress} subtotalCents={subtotalCents} sellerId={sellerId} />;
}

function StripBody({ line, fraction, subtotalCents, sellerId }: { line: string; fraction: number; subtotalCents: number; sellerId: string }) {
  const { theme } = useAppTheme();
  const width = useRef(new Animated.Value(fraction)).current;
  const lastSubtotal = useRef(subtotalCents);

  useEffect(() => {
    if (lastSubtotal.current === subtotalCents) {
      width.setValue(fraction);
      return;
    }
    lastSubtotal.current = subtotalCents;
    Animated.timing(width, {
      toValue: fraction,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [fraction, subtotalCents, width]);

  return (
    <View style={styles.root} testID={`cart-free-shipping-${sellerId}`} accessible accessibilityLabel={line}>
      <Text style={[styles.line, { color: theme.text }]}>{line}</Text>
      <View style={[styles.track, { backgroundColor: theme.border }]}>
        <Animated.View
          style={[styles.fill, {
            backgroundColor: theme.text,
            width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'], extrapolate: 'clamp' }),
          }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginBottom: SP.md },
  line: { fontSize: FS.sm, fontFamily: FONT.medium, marginBottom: SP.sm },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 3, borderRadius: 2 },
});
