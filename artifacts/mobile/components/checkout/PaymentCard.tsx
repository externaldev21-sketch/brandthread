/**
 * Payment — express wallet button on top (GOAT "Buy with Apple Pay", American
 * Airlines "Pay with Apple Pay"), then card payment and any saved cards.
 *
 * Brandthread's real Stripe integration is Stripe-hosted Checkout (server
 * creates a Checkout Session, the app opens it — see pay() in
 * app/buyer-checkout.tsx). There is no in-app PaymentSheet: the app does not
 * ship @stripe/stripe-react-native. So nothing here collects card data:
 *  - The express button starts that same secure Stripe Checkout, where
 *    Stripe offers Apple Pay / Google Pay first when the device supports it.
 *  - Saved cards come from the real /api/buyer/payment-methods (the Stripe
 *    Customer the Checkout Session is created for), shown so the buyer knows
 *    they're on file; Stripe Checkout lists them for one-tap reuse.
 * The wallet button's black/white chrome and logo are the one place a
 * platform mark appears — everything else stays monochrome.
 */
import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { CheckoutCard, Hairline } from './CheckoutPrimitives';

export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth?: number;
  expYear?: number;
  isDefault?: boolean;
}

function brandLabel(brand: string) {
  if (!brand) return 'Card';
  if (brand.toLowerCase() === 'amex') return 'Amex';
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

function WalletMark({ color }: { color: string }) {
  if (Platform.OS === 'android') {
    return (
      <View style={styles.walletMark}>
        <Ionicons name="logo-google" size={18} color={color} />
        <Text style={[styles.walletText, { color }]}>Pay</Text>
      </View>
    );
  }
  if (Platform.OS === 'ios') {
    return (
      <View style={styles.walletMark}>
        <Text style={[styles.walletLead, { color }]}>Buy with</Text>
        <Ionicons name="logo-apple" size={20} color={color} style={{ marginTop: -3 }} />
        <Text style={[styles.walletText, { color }]}>Pay</Text>
      </View>
    );
  }
  // Web: Stripe Checkout offers whichever wallet this browser supports.
  return (
    <View style={styles.walletMark}>
      <Text style={[styles.walletLead, { color }]}>Express checkout</Text>
      <Ionicons name="logo-apple" size={17} color={color} style={{ marginTop: -2 }} />
      <Ionicons name="logo-google" size={15} color={color} />
    </View>
  );
}

export function PaymentCard({
  onExpressPay, disabled, loading, savedCards, sellerCount,
}: {
  onExpressPay: () => void;
  disabled: boolean;
  loading: boolean;
  savedCards: SavedCard[];
  sellerCount: number;
}) {
  const { theme } = useAppTheme();
  const defaultCard = savedCards.find(card => card.isDefault) ?? savedCards[0];
  const otherCards = savedCards.filter(card => card.id !== defaultCard?.id);
  const walletName = Platform.OS === 'android' ? 'Google Pay' : Platform.OS === 'ios' ? 'Apple Pay' : 'Apple Pay or Google Pay';

  return (
    <CheckoutCard title="Payment" testID="checkout-payment">
      {/* Dimmed via a wrapper: PressableScale drives its own opacity for the press feel. */}
      <View style={{ opacity: disabled ? 0.4 : 1 }}>
      <PressableScale
        onPress={onExpressPay}
        disabled={disabled || loading}
        style={[styles.wallet, { backgroundColor: theme.text }]}
        accessibilityRole="button"
        accessibilityLabel={`Pay with ${walletName}`}
        accessibilityHint="Opens Stripe's secure checkout with your wallet"
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        rippleEnabled={false}
        testID="checkout-express-pay"
      >
        {loading ? <ActivityIndicator color={theme.background} /> : <WalletMark color={theme.background} />}
      </PressableScale>
      </View>

      <View style={styles.orRow}>
        <Hairline style={styles.orLine} />
        <Text style={[styles.orText, { color: theme.subtle }]}>or pay by card</Text>
        <Hairline style={styles.orLine} />
      </View>

      <View style={styles.cardRow}>
        <View style={[styles.cardIcon, { borderColor: theme.border }]}>
          <Feather name="credit-card" size={16} color={theme.text} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>
            {defaultCard ? `${brandLabel(defaultCard.brand)} •••• ${defaultCard.last4}` : 'Credit or debit card'}
          </Text>
          <Text style={[styles.cardSub, { color: theme.muted }]}>
            {defaultCard
              ? `${defaultCard.isDefault ? 'Default · ' : ''}${defaultCard.expMonth && defaultCard.expYear ? `Expires ${String(defaultCard.expMonth).padStart(2, '0')}/${String(defaultCard.expYear).slice(-2)}` : 'Saved card'}`
              : 'Entered on Stripe’s secure page after you tap Place order'}
          </Text>
        </View>
      </View>
      {otherCards.map(card => (
        <View key={card.id} style={[styles.cardRow, { marginTop: SP.sm }]}>
          <View style={[styles.cardIcon, { borderColor: theme.border }]}>
            <Feather name="credit-card" size={16} color={theme.muted} />
          </View>
          <Text style={[styles.cardSub, { color: theme.muted, flex: 1, marginTop: 0 }]}>
            {brandLabel(card.brand)} •••• {card.last4}
          </Text>
        </View>
      ))}

      <View style={[styles.secure, { borderTopColor: theme.border }]}>
        <Feather name="lock" size={13} color={theme.muted} />
        <Text style={[styles.secureText, { color: theme.muted }]}>
          {sellerCount > 1
            ? `Secured by Stripe. Items from ${sellerCount} sellers are paid in ${sellerCount} separate secure payments.`
            : 'Secured by Stripe. Brandthread never sees or stores your full card number.'}
        </Text>
      </View>
    </CheckoutCard>
  );
}

const styles = StyleSheet.create({
  wallet: { height: 50, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center' },
  walletMark: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  walletLead: { fontFamily: FONT.medium, fontSize: FS.base + 1 },
  walletText: { fontFamily: FONT.semibold, fontSize: FS.md + 1, letterSpacing: -0.2 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginVertical: SP.md - 2 },
  orLine: { flex: 1, marginVertical: 0 },
  orText: { fontFamily: FONT.medium, fontSize: FS.xs + 1 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4 },
  cardIcon: { width: 40, height: 28, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: FONT.semibold, fontSize: FS.base },
  cardSub: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2, lineHeight: 18 },
  secure: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm,
    borderTopWidth: StyleSheet.hairlineWidth, marginTop: SP.md - 2, paddingTop: SP.sm + 4,
  },
  secureText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.xs + 1, lineHeight: 17 },
});
