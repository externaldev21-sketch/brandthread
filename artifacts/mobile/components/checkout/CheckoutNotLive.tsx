/**
 * "Checkout isn't live yet" — shown by checkout (and the bag's Checkout
 * button leads here) whenever Stripe isn't set up on BOTH the server and the
 * app (lib/checkoutLive.ts). Nothing is charged and no order is faked.
 *
 * Layout is GOAT's end-of-flow screen (mobbin.com/flows/
 * 92a0951d-9af9-455d-8a9b-18d905b43b9f, last frame): a plain message near the
 * bottom, one full-width primary button and a text link under it.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { FONT, FS, SP } from '@/lib/theme';
import { GUTTER, useCheckoutColors } from './CheckoutPrimitives';

export function CheckoutNotLive({ onBackToBag, onKeepShopping }: { onBackToBag: () => void; onKeepShopping: () => void }) {
  const ck = useCheckoutColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingBottom: Math.max(insets.bottom, SP.md) + SP.md }]} testID="checkout-not-live">
      <Text style={[styles.title, { color: ck.text }]} accessibilityRole="header">Checkout isn’t live yet</Text>
      <Text style={[styles.body, { color: ck.muted }]}>
        We’re finishing setting up payments. Your bag is saved, and you haven’t been charged.
      </Text>
      <Button label="Back to bag" variant="primary" onPress={onBackToBag} fullWidth style={styles.primary} testID="checkout-not-live-bag" />
      <TouchableOpacity onPress={onKeepShopping} accessibilityRole="link" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.link} testID="checkout-not-live-shop">
        <Text style={[styles.linkText, { color: ck.text }]}>Keep shopping</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: GUTTER },
  title: { fontFamily: FONT.bold, fontSize: FS.lg },
  body: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 20, marginTop: SP.xs },
  primary: { marginTop: SP.lg },
  link: { alignSelf: 'center', marginTop: SP.md },
  linkText: { fontFamily: FONT.medium, fontSize: FS.base, textDecorationLine: 'underline' },
});
