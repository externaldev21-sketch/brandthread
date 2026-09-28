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
 *
 * Wallet button spec (Apple Pay HIG + Google Pay brand guidelines, and
 * Mobbin: Revolut / Posh dark checkouts — white pill, black " Pay"):
 *  - On this always-dark UI it is the platforms' WHITE style: pure #FFFFFF
 *    fill, pure #000000 mark and text — never theme-derived (a colored theme
 *    used to tint the Apple mark purple/olive/navy, which neither brand allows).
 *  - "Buy with" + mark in the platform's own system typeface (SF on iOS /
 *    Safari, Roboto on Android) — not the app's Inter, which isn't part of
 *    either lockup.
 *  - Height 50pt (above Apple's 30pt / Google's 40dp minimums); pill corner
 *    radius, which both platforms allow (PKPaymentButton.cornerRadius /
 *    Google Pay buttonRadius).
 *  - Web: real Apple Pay availability is detectable (Safari's
 *    ApplePaySession.canMakePayments()), so Safari with Apple Pay gets the
 *    Apple Pay button; every other browser gets a neutral, unbranded
 *    "Express checkout" button — brand marks are never combined in one
 *    custom button. Stripe Checkout then offers whichever wallet that
 *    browser really supports.
 *  - Google's official mark uses the multicolor "G"; the app's monochrome
 *    rule keeps it single-color here (flagged in the PR for a decision).
 */
import React, { useEffect, useState } from 'react';
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

const WALLET_BG = '#FFFFFF';
const WALLET_FG = '#000000';

export type WalletKind = 'apple' | 'google' | 'express';

/** Safari exposes ApplePaySession; canMakePayments() is true when Apple Pay is usable here. */
export function detectWebApplePay(win: unknown = typeof window !== 'undefined' ? window : undefined): boolean {
  try {
    const session = (win as { ApplePaySession?: { canMakePayments?: () => boolean } } | undefined)?.ApplePaySession;
    return !!session?.canMakePayments?.();
  } catch {
    return false;
  }
}

export function useWalletKind(): WalletKind {
  const [webApplePay, setWebApplePay] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') setWebApplePay(detectWebApplePay());
  }, []);
  if (Platform.OS === 'ios') return 'apple';
  if (Platform.OS === 'android') return 'google';
  return webApplePay ? 'apple' : 'express';
}

export const WALLET_NAMES: Record<WalletKind, string> = {
  apple: 'Apple Pay',
  google: 'Google Pay',
  express: 'express checkout',
};

function WalletMark({ kind }: { kind: WalletKind }) {
  if (kind === 'google') {
    return (
      <View style={styles.walletMark}>
        <Text style={styles.walletLead}>Buy with</Text>
        <Ionicons name="logo-google" size={18} color={WALLET_FG} />
        <Text style={styles.walletText}>Pay</Text>
      </View>
    );
  }
  if (kind === 'apple') {
    return (
      <View style={styles.walletMark}>
        <Text style={styles.walletLead}>Buy with</Text>
        <Ionicons name="logo-apple" size={20} color={WALLET_FG} style={{ marginTop: -3 }} />
        <Text style={styles.walletText}>Pay</Text>
      </View>
    );
  }
  // No wallet mark we can vouch for (non-Safari web): plain, unbranded.
  return (
    <View style={styles.walletMark}>
      <Feather name="zap" size={16} color={WALLET_FG} />
      <Text style={styles.walletLead}>Express checkout</Text>
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
  const walletKind = useWalletKind();

  return (
    <CheckoutCard title="Payment" testID="checkout-payment">
      {/* Dimmed via a wrapper: PressableScale drives its own opacity for the press feel. */}
      <View style={{ opacity: disabled ? 0.4 : 1 }}>
      <PressableScale
        onPress={onExpressPay}
        disabled={disabled || loading}
        style={styles.wallet}
        accessibilityRole="button"
        accessibilityLabel={walletKind === 'express' ? 'Express checkout' : `Buy with ${WALLET_NAMES[walletKind]}`}
        accessibilityHint={walletKind === 'express'
          ? "Opens Stripe's secure checkout, which offers Apple Pay or Google Pay when your browser supports it"
          : "Opens Stripe's secure checkout with your wallet"}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        rippleEnabled={false}
        testID="checkout-express-pay"
      >
        {loading ? <ActivityIndicator color={WALLET_FG} /> : <WalletMark kind={walletKind} />}
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

const SYSTEM_FONT = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Roboto, system-ui, sans-serif',
});

const styles = StyleSheet.create({
  wallet: { height: 50, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: WALLET_BG },
  walletMark: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  // The platform's own typeface, not Inter (see the module comment).
  walletLead: { fontFamily: SYSTEM_FONT, fontWeight: '500', fontSize: FS.base + 1, color: WALLET_FG },
  walletText: { fontFamily: SYSTEM_FONT, fontWeight: '600', fontSize: FS.md + 1, letterSpacing: -0.2, color: WALLET_FG },
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
