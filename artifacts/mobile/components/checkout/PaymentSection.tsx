/**
 * Express pay (top of the page) and PAYMENT.
 *
 * In-app (the default):
 *  - Express: the official Apple Pay / Google Pay button (StripePayment).
 *    The sheet supplies name, shipping address, contact and payment.
 *  - Payment: saved cards as selectable rows, then "Use a new card", which
 *    shows Stripe's secure card field inline. Card data stays inside
 *    Stripe's field: PCI SAQ-A, nothing reaches Brandthread's server.
 *
 * Hosted fallback (flag, guests, preorders, Thread Cash, loyalty, or no
 * Stripe native module as in Expo Go) and the dev-web preview:
 *  - Express: a white "Buy with Apple Pay / Google Pay" pill that starts the
 *    same Pay action (Stripe's hosted page offers the wallet there).
 *  - Payment: says where the card is entered.
 *
 * Wallet button spec (Apple Pay HIG + Google Pay brand guidelines): on this
 * always-dark page it is the platforms' WHITE style, pure #FFFFFF fill with
 * a pure #000000 mark and text in the platform's own typeface, 50pt tall,
 * pill-shaped. Non-Safari web gets a neutral "Express checkout" button,
 * since brand marks are never combined in one custom button.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Icon } from '@/components/ui/Icon';
import { PressableScale } from '@/components/BrandthreadUI';
import type { PaymentPath } from '@/lib/checkoutPayment';
import { FONT, FS, SP } from '@/lib/theme';
import { CheckoutSection, OptionRow, useCheckoutColors, type CheckoutColors } from './CheckoutPrimitives';
import { CardEntry } from './StripePayment';
import { radius } from '@/constants/radii';

export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth?: number;
  expYear?: number;
  isDefault?: boolean;
}

export const NEW_CARD = 'new';
/** Buy now, pay later (Klarna / Afterpay): shows Stripe's Payment Element on its Klarna / Afterpay tabs. */
export const BNPL = 'bnpl';

function brandLabel(brand: string) {
  if (!brand) return 'Card';
  if (brand.toLowerCase() === 'amex') return 'Amex';
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

function expiry(card: SavedCard): string {
  return card.expMonth && card.expYear
    ? `Expires ${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`
    : 'Saved card';
}

// ─── Hosted / preview express button ─────────────────────────────────────────

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
      <View style={walletStyles.walletMark}>
        <Text style={walletStyles.walletLead}>Buy with</Text>
        <Ionicons name="logo-google" size={18} color={WALLET_FG} />
        <Text style={walletStyles.walletText}>Pay</Text>
      </View>
    );
  }
  if (kind === 'apple') {
    return (
      <View style={walletStyles.walletMark}>
        <Text style={walletStyles.walletLead}>Buy with</Text>
        <Ionicons name="logo-apple" size={20} color={WALLET_FG} style={{ marginTop: -3 }} />
        <Text style={walletStyles.walletText}>Pay</Text>
      </View>
    );
  }
  return (
    <View style={walletStyles.walletMark}>
      <Icon name="zap" size={16} color={WALLET_FG} />
      <Text style={walletStyles.walletLead}>Express checkout</Text>
    </View>
  );
}

export function HostedExpressButton({
  onPress, disabled, loading,
}: {
  onPress: () => void;
  disabled: boolean;
  loading: boolean;
}) {
  const walletKind = useWalletKind();
  return (
    // Dimmed via a wrapper: PressableScale drives its own opacity for the press feel.
    <View style={{ opacity: disabled ? 0.4 : 1 }}>
      <PressableScale
        onPress={onPress}
        disabled={disabled || loading}
        style={walletStyles.wallet}
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
  );
}

/** Express row: the wallet button, then "or" before the rest of the form. */
export function ExpressSection({ children, visible }: { children: React.ReactNode; visible: boolean }) {
  const ck = useCheckoutColors();
  const styles = useMemo(() => makeStyles(ck), [ck]);
  return (
    // Stays mounted while hidden: the in-app wallet button reports whether a
    // wallet is available only once it has mounted.
    <View style={visible ? styles.express : styles.hidden} testID="checkout-express">
      {children}
      <View style={styles.orRow}>
        <View style={styles.orLine} />
        <Text style={styles.orText}>or</Text>
        <View style={styles.orLine} />
      </View>
    </View>
  );
}

// ─── PAYMENT ─────────────────────────────────────────────────────────────────

export function PaymentSection({
  path, savedCards, selectedCard, onSelectCard, onCardComplete, sellerCount, bnplAvailable,
}: {
  path: PaymentPath;
  savedCards: SavedCard[];
  /** A saved card's id, or NEW_CARD. */
  selectedCard: string;
  onSelectCard: (id: string) => void;
  onCardComplete: (complete: boolean) => void;
  sellerCount: number;
  /** Web, every seller opted in, amount eligible: offer Klarna / Afterpay next to saved cards. */
  bnplAvailable?: boolean;
}) {
  const ck = useCheckoutColors();
  const styles = useMemo(() => makeStyles(ck), [ck]);
  if (path === 'preview') {
    return (
      <CheckoutSection title="Payment" testID="checkout-payment">
        <View style={styles.noteRow} testID="checkout-preview-note">
          <Icon name="info" size={14} color={ck.muted} style={styles.noteIcon} />
          {/* No mention of "preview"/"demo" here — the dev/demo preview
              bypass must have zero user-visible tells (Dev's explicit
              request). The underlying `path === 'preview'` code path stays;
              only the copy shown for it changed. */}
          <Text style={styles.note}>This order won’t be charged.</Text>
        </View>
      </CheckoutSection>
    );
  }

  if (path === 'hosted') {
    return (
      <CheckoutSection title="Payment" testID="checkout-payment">
        <View style={styles.cardRow}>
          <View style={styles.cardIcon}><Icon name="credit-card" size={16} color={ck.text} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Card, Apple Pay or Google Pay</Text>
            <Text style={styles.cardSub}>Entered on Stripe’s secure page after you tap Pay</Text>
          </View>
        </View>
        <SecureLine sellerCount={sellerCount} hosted ck={ck} styles={styles} />
      </CheckoutSection>
    );
  }

  const showBnplRow = !!bnplAvailable && savedCards.length > 0;
  const showNewCard = savedCards.length === 0 || selectedCard === NEW_CARD || (showBnplRow && selectedCard === BNPL);
  return (
    <CheckoutSection title="Payment" testID="checkout-payment">
      {savedCards.length > 0 ? (
        <View accessibilityRole="radiogroup">
          {savedCards.map(card => (
            <OptionRow
              key={card.id}
              selected={selectedCard === card.id}
              onPress={() => onSelectCard(card.id)}
              title={`${brandLabel(card.brand)} •••• ${card.last4}`}
              lines={[`${card.isDefault ? 'Default · ' : ''}${expiry(card)}`]}
              testID={`checkout-saved-card-${card.id}`}
            />
          ))}
          <OptionRow
            selected={selectedCard === NEW_CARD}
            onPress={() => onSelectCard(NEW_CARD)}
            title="Use a new card"
            last={selectedCard !== NEW_CARD && !showBnplRow}
            testID="checkout-new-card"
          />
          {showBnplRow ? (
            <OptionRow
              selected={selectedCard === BNPL}
              onPress={() => onSelectCard(BNPL)}
              title="Klarna or Afterpay"
              lines={['Pay over time']}
              last={selectedCard !== BNPL}
              testID="checkout-bnpl"
            />
          ) : null}
        </View>
      ) : null}
      {showNewCard ? (
        <View style={savedCards.length > 0 ? styles.cardEntryUnderRows : undefined}>
          <CardEntry onCompleteChange={onCardComplete} />
        </View>
      ) : null}
      <SecureLine sellerCount={sellerCount} ck={ck} styles={styles} />
    </CheckoutSection>
  );
}

function SecureLine({ sellerCount, hosted, ck, styles }: {
  sellerCount: number; hosted?: boolean; ck: CheckoutColors; styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.secure}>
      <Icon name="lock" size={13} color={ck.muted} style={styles.noteIcon} />
      <Text style={styles.secureText}>
        {hosted && sellerCount > 1
          ? `Secured by Stripe. Items from ${sellerCount} sellers are paid in ${sellerCount} separate secure payments.`
          : sellerCount > 1
            ? `Secured by Stripe. One payment covers all ${sellerCount} sellers. Brandthread never sees your card number.`
            : 'Secured by Stripe. Brandthread never sees or stores your card number.'}
      </Text>
    </View>
  );
}

const SYSTEM_FONT = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Roboto, system-ui, sans-serif',
});

// The wallet button itself is fixed white/black per the platform brand spec
// (see the module comment) and does not follow the app theme, so its styles
// stay a plain module-level StyleSheet.
const walletStyles = StyleSheet.create({
  wallet: { height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: WALLET_BG },
  walletMark: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  // The platform's own typeface, not Inter (see the module comment).
  walletLead: { fontFamily: SYSTEM_FONT, fontWeight: '500', fontSize: FS.base + 1, color: WALLET_FG },
  walletText: { fontFamily: SYSTEM_FONT, fontWeight: '600', fontSize: FS.md + 1, letterSpacing: -0.2, color: WALLET_FG },
});

function makeStyles(ck: CheckoutColors) {
  return StyleSheet.create({
    express: { paddingTop: SP.md },
    hidden: { display: 'none' },
    orRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.md + 2, marginBottom: SP.xs + 2 },
    orLine: { flex: 1, height: 1, backgroundColor: ck.divider },
    orText: { fontFamily: FONT.medium, fontSize: FS.xs + 1, color: ck.subtle },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4 },
    cardIcon: {
      width: 40, height: 28, borderRadius: 6, borderWidth: 1, borderColor: ck.fieldBorder,
      alignItems: 'center', justifyContent: 'center',
    },
    cardTitle: { fontFamily: FONT.medium, fontSize: FS.base, color: ck.text },
    cardSub: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2, lineHeight: 18, color: ck.muted },
    cardEntryUnderRows: { paddingTop: SP.md },
    noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
    noteIcon: { marginTop: 2 },
    note: { flex: 1, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, color: ck.muted },
    secure: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginTop: SP.md },
    secureText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.xs + 1, lineHeight: 17, color: ck.muted },
  });
}
