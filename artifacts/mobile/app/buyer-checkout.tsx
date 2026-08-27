/**
 * Buyer checkout — four buyer-facing stages:
 * information, delivery, review/pay, confirmation.
 * Stripe Checkout is the sole payment entry point; card data is never collected here.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import {
  applyDiscount, clearCart, clearCheckoutSession, createCheckoutSession,
  getCart, getCheckoutSession, removeDiscount, saveCheckoutProgress, validateCart,
} from '@/services/cartService';
import {
  CheckoutAddress, CheckoutContact, CheckoutDiscount, CheckoutSession, CheckoutStep,
} from '@/services/cartTypes';
import { useApi } from '@/hooks/useApi';
import {
  BG, BORDER, CARD, CARD_ELEVATED, CYAN, CYAN_DIM, FG, FONT, FS, GRAD_PRIMARY,
  MUTED, ON_DARK, PURPLE, PURPLE_DIM, PURPLE_LIGHT, RADIUS, RED, RED_DIM,
  SP, SUCCESS, SUCCESS_DIM, SUBTLE, COMP, ICON, SHADOW_PURPLE,
} from '@/lib/theme';

const STEPS: CheckoutStep[] = ['information', 'delivery', 'review', 'confirmation'];
const money = (value: number) => `$${value.toFixed(2)}`;

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function Input({ label, value, onChange, keyboardType = 'default', autoCapitalize = 'sentences' }: {
  label: string; value: string; onChange: (value: string) => void; keyboardType?: any; autoCapitalize?: any;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType={keyboardType} autoCapitalize={autoCapitalize}
        placeholder={label} placeholderTextColor={SUBTLE} style={styles.input} />
    </View>
  );
}

function Progress({ step }: { step: CheckoutStep }) {
  const index = Math.max(0, STEPS.indexOf(step));
  return (
    <View style={styles.progress}>
      {STEPS.slice(0, 3).map((item, itemIndex) => (
        <View key={item} style={[styles.progressSegment, itemIndex <= index && styles.progressSegmentActive]} />
      ))}
    </View>
  );
}

function Information({ contact, address, onContact, onAddress }: {
  contact: Partial<CheckoutContact>; address: Partial<CheckoutAddress>;
  onContact: (value: Partial<CheckoutContact>) => void; onAddress: (value: Partial<CheckoutAddress>) => void;
}) {
  return (
    <>
      <Card>
        <Text style={styles.sectionTitle}>Contact</Text>
        <Input label="Email" value={contact.email ?? ''} keyboardType="email-address" autoCapitalize="none"
          onChange={email => onContact({ ...contact, email })} />
        <Input label="Phone (optional)" value={contact.phone ?? ''} keyboardType="phone-pad"
          onChange={phone => onContact({ ...contact, phone })} />
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}><Text style={styles.toggleTitle}>Order updates</Text><Text style={styles.muted}>Email updates about your order</Text></View>
          <Switch value={contact.orderUpdates !== 'none'} onValueChange={enabled => onContact({ ...contact, orderUpdates: enabled ? 'email' : 'none' })} trackColor={{ true: PURPLE }} />
        </View>
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>Shipping address</Text>
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}><Input label="First name" value={address.firstName ?? ''} onChange={firstName => onAddress({ ...address, firstName })} /></View>
          <View style={{ flex: 1 }}><Input label="Last name" value={address.lastName ?? ''} onChange={lastName => onAddress({ ...address, lastName })} /></View>
        </View>
        <Input label="Address" value={address.line1 ?? ''} onChange={line1 => onAddress({ ...address, line1 })} />
        <Input label="Apartment, suite, etc. (optional)" value={address.line2 ?? ''} onChange={line2 => onAddress({ ...address, line2 })} />
        <Input label="City" value={address.city ?? ''} onChange={city => onAddress({ ...address, city })} />
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}><Input label="State" value={address.state ?? ''} autoCapitalize="characters" onChange={state => onAddress({ ...address, state })} /></View>
          <View style={{ flex: 1 }}><Input label="ZIP / postal code" value={address.postalCode ?? ''} autoCapitalize="characters" onChange={postalCode => onAddress({ ...address, postalCode })} /></View>
        </View>
        <Input label="Country" value={address.country ?? 'US'} autoCapitalize="characters" onChange={country => onAddress({ ...address, country })} />
      </Card>
    </>
  );
}

function Delivery({ session, onSelect, onApply, onRemove }: {
  session: CheckoutSession; onSelect: (sellerId: string, methodId: string) => void;
  onApply: (code: string) => Promise<void>; onRemove: (code: string) => void;
}) {
  const [showPromo, setShowPromo] = useState(session.discounts.length > 0);
  const [code, setCode] = useState('');
  const [applying, setApplying] = useState(false);
  return (
    <>
      {session.deliveryGroups.map(group => (
        <Card key={group.sellerId}>
          <Text style={styles.sectionTitle}>Delivery from {group.sellerName}</Text>
          {group.availableMethods.map(method => (
            <TouchableOpacity key={method.id} style={[styles.method, group.selectedMethodId === method.id && styles.methodActive]}
              onPress={() => onSelect(group.sellerId, method.id)}>
              <View style={[styles.radio, group.selectedMethodId === method.id && styles.radioActive]} />
              <View style={{ flex: 1 }}><Text style={styles.methodTitle}>{method.service}</Text><Text style={styles.muted}>{method.estimatedDelivery}</Text></View>
              <Text style={styles.methodTitle}>{money(method.price)}</Text>
            </TouchableOpacity>
          ))}
        </Card>
      ))}
      <Card>
        <TouchableOpacity style={styles.promoToggle} onPress={() => setShowPromo(value => !value)}>
          <View style={styles.row}><Feather name="tag" size={16} color={PURPLE_LIGHT} /><Text style={styles.sectionTitle}>Have a promo code?</Text></View>
          <Feather name={showPromo ? 'chevron-up' : 'chevron-down'} size={18} color={MUTED} />
        </TouchableOpacity>
        {showPromo && (
          <>
            <View style={styles.promoRow}>
              <TextInput value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="Enter code" placeholderTextColor={SUBTLE} style={[styles.input, { flex: 1, marginBottom: 0 }]} />
              <TouchableOpacity style={styles.applyButton} disabled={applying || !code.trim()} onPress={async () => { setApplying(true); await onApply(code); setCode(''); setApplying(false); }}>
                <Text style={styles.applyText}>{applying ? '...' : 'Apply'}</Text>
              </TouchableOpacity>
            </View>
            {session.discounts.map(discount => (
              <View style={styles.discountRow} key={discount.code}>
                <Text style={styles.discountText}>{discount.isValid ? `${discount.code} · ${discount.description}` : discount.errorMessage}</Text>
                <TouchableOpacity onPress={() => onRemove(discount.code)}><Text style={styles.removeText}>Remove</Text></TouchableOpacity>
              </View>
            ))}
          </>
        )}
      </Card>
    </>
  );
}

function Review({ session, onAck }: { session: CheckoutSession; onAck: (key: string, checked: boolean) => void }) {
  const address = session.shippingAddress;
  return (
    <>
      <Card>
        <Text style={styles.sectionTitle}>Review your order</Text>
        <Text style={styles.address}>{address?.firstName} {address?.lastName}{'\n'}{address?.line1}{'\n'}{address?.city}, {address?.state} {address?.postalCode}</Text>
        {session.deliveryGroups.flatMap(group => group.items).map(item => (
          <View key={item.id} style={styles.line}><View style={{ flex: 1 }}><Text style={styles.lineName}>{item.productName}</Text><Text style={styles.muted}>{item.variantTitle} · Qty {item.quantity}</Text></View><Text style={styles.lineName}>{money(item.price * item.quantity)}</Text></View>
        ))}
        <View style={styles.divider} />
        <View style={styles.line}><Text style={styles.muted}>Subtotal</Text><Text style={styles.lineName}>{money(session.summary.subtotal)}</Text></View>
        {session.summary.discountTotal > 0 && <View style={styles.line}><Text style={styles.muted}>Discount</Text><Text style={[styles.lineName, { color: SUCCESS }]}>−{money(session.summary.discountTotal)}</Text></View>}
        <View style={styles.line}><Text style={styles.muted}>Shipping</Text><Text style={styles.lineName}>{money(session.summary.shippingTotal)}</Text></View>
        <View style={styles.line}><Text style={styles.muted}>Tax</Text><Text style={styles.lineName}>{money(session.summary.taxTotal)}</Text></View>
        <View style={styles.divider} />
        <View style={styles.line}><Text style={styles.total}>Total</Text><Text style={styles.total}>{money(session.summary.total)}</Text></View>
      </Card>
      {session.deliveryGroups.length > 1 && (
        <View style={styles.multiSeller}><Feather name="layers" size={16} color={CYAN} /><Text style={styles.multiSellerText}>Your cart contains items from {session.deliveryGroups.length} sellers. You will complete a separate secure Stripe payment for each seller.</Text></View>
      )}
      <Card>
        <View style={styles.row}><Feather name="lock" size={17} color={PURPLE_LIGHT} /><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Pay securely with Stripe</Text><Text style={styles.muted}>You’ll enter your payment details in Stripe Checkout. Brandthread never collects card numbers.</Text></View></View>
        <Text style={[styles.muted, { marginTop: SP.sm }]}>Cards saved from earlier purchases will appear automatically in Stripe Checkout.</Text>
      </Card>
      {session.acknowledgments.map(ack => (
        <TouchableOpacity key={ack.key} style={styles.ack} onPress={() => onAck(ack.key, !ack.acknowledged)}>
          <View style={[styles.checkbox, ack.acknowledged && styles.checkboxActive]}>{ack.acknowledged && <Feather name="check" size={12} color={ON_DARK} />}</View>
          <Text style={styles.ackText}>{ack.label}</Text>
        </TouchableOpacity>
      ))}
    </>
  );
}

function Confirmation({ orderNumbers, finalizing, onRefresh, refreshing }: {
  orderNumbers: string[]; finalizing: boolean; onRefresh: () => void; refreshing: boolean;
}) {
  return (
    <View style={styles.confirmation}>
      <View style={[styles.confirmIcon, finalizing && { backgroundColor: PURPLE }]}><Feather name={finalizing ? 'clock' : 'check'} size={34} color={ON_DARK} /></View>
      <Text style={styles.headline}>{finalizing ? 'Payment received' : 'Order confirmed'}</Text>
      <Text style={styles.confirmText}>{finalizing ? 'We’re finalizing your order with the seller. This can take a moment after payment.' : 'Your order is in. We’ll keep you updated by email.'}</Text>
      {orderNumbers.map(number => <Text style={styles.orderNumber} key={number}>{number}</Text>)}
      {finalizing && <TouchableOpacity style={styles.refreshButton} onPress={onRefresh} disabled={refreshing}>{refreshing ? <ActivityIndicator color={PURPLE_LIGHT} /> : <Text style={styles.refreshText}>Check order status</Text>}</TouchableOpacity>}
    </View>
  );
}

export default function BuyerCheckoutScreen() {
  const { source } = useLocalSearchParams<{ source?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [contact, setContact] = useState<Partial<CheckoutContact>>({ orderUpdates: 'email', marketingConsent: false });
  const [address, setAddress] = useState<Partial<CheckoutAddress>>({ country: 'US' });
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');
  const [orders, setOrders] = useState<string[]>([]);
  const [pendingSessionIds, setPendingSessionIds] = useState<string[]>([]);
  const paid = useRef(new Map<string, string>());

  useEffect(() => { (async () => {
    let next = await getCheckoutSession();
    if (!next) {
      const cart = await getCart();
      if (!cart.items.length) { router.back(); return; }
      next = await createCheckoutSession(cart, source === 'buynow');
    }
    if (next.step === 'contact' || next.step === 'shipping' || next.step === 'discounts' || next.step === 'payment') next.step = 'information';
    setSession(next); setContact(next.contact ?? { orderUpdates: 'email', marketingConsent: false }); setAddress(next.shippingAddress ?? { country: 'US' }); setLoading(false);
  })(); }, []);

  const persist = async (next: CheckoutSession) => { setSession(next); await saveCheckoutProgress(next); };
  const current = session as CheckoutSession;
  const validateInformation = () => {
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email ?? '');
    const validZip = (address.postalCode ?? '').trim().length >= 3;
    if (!validEmail || !address.firstName || !address.lastName || !address.line1 || !address.city || !address.state || !validZip || !address.country) {
      Alert.alert('Check your information', 'Enter a valid email and complete every required shipping address field.');
      return false;
    }
    return true;
  };
  const validateServerCart = async () => {
    try {
      const result = await validateCart(
        current.deliveryGroups.flatMap(group => group.items),
        current.discounts.filter(discount => discount.isValid).map(discount => discount.code),
      );
      if (!result.isValid) { Alert.alert('Update your cart', result.issues.map(issue => `• ${issue.message}`).join('\n')); return false; }
      return true;
    } catch {
      Alert.alert('Unable to verify cart', 'We could not confirm current prices and availability. Check your connection and try again.');
      return false;
    }
  };
  const handleContinue = async () => {
    if (current.step === 'information') {
      if (!validateInformation() || !await validateServerCart()) return;
      await persist({ ...current, contact: contact as CheckoutContact, shippingAddress: address as CheckoutAddress, step: 'delivery' });
      return;
    }
    if (current.step === 'delivery') {
      if (!await validateServerCart()) return;
      await persist({ ...current, step: 'review' });
      return;
    }
    if (current.step === 'review') {
      if (current.acknowledgments.some(ack => ack.required && !ack.acknowledged) || !await validateServerCart()) {
        if (current.acknowledgments.some(ack => ack.required && !ack.acknowledged)) Alert.alert('Acknowledgment required', 'Please accept the required policies before paying.');
        return;
      }
      await pay();
    }
  };
  const pay = async () => {
    setPlacing(true); setError('');
    const unresolved: string[] = []; const confirmed: string[] = [];
    try {
      for (const group of current.deliveryGroups) {
        if (paid.current.has(group.sellerId)) { confirmed.push(paid.current.get(group.sellerId)!); continue; }
        const result = await api.buyer.checkout.createSession(group.items.map(item => ({ variantId: item.variantId, productId: item.productId, quantity: item.quantity })), {
          contactEmail: contact.email,
          shippingAddress: { name: `${address.firstName} ${address.lastName}`.trim(), street: address.line1!, city: address.city!, state: address.state!, zip: address.postalCode!, country: address.country || 'US' },
          clientIdempotencyKey: `${current.idempotencyKey}_${group.sellerId}`,
          ...(current.loyaltyRedemption && current.deliveryGroups.length === 1
            ? { loyaltyToken: current.loyaltyRedemption.token }
            : {}),
        });
        const browser = await WebBrowser.openBrowserAsync(result.url);
        if (browser.type === 'cancel' || browser.type === 'dismiss') { setError('Payment was cancelled. Your cart is still saved.'); setPlacing(false); return; }
        let verification: any;
        for (let attempt = 0; attempt < 6; attempt++) {
          verification = await api.buyer.checkout.verifySession(result.sessionId);
          if (verification.orderNumber || verification.paymentStatus !== 'paid') break;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        if (verification?.paymentStatus !== 'paid') { setError(verification?.declineReason ?? 'Payment could not be completed. Please try again.'); setPlacing(false); return; }
        if (verification.orderNumber) { confirmed.push(verification.orderNumber); paid.current.set(group.sellerId, verification.orderNumber); } else unresolved.push(result.sessionId);
      }
      setOrders(confirmed); setPendingSessionIds(unresolved);
      if (!unresolved.length) { await clearCart(); await clearCheckoutSession(); }
      await persist({ ...current, step: 'confirmation' });
    } catch { setError('We could not start secure checkout. Please try again.'); }
    setPlacing(false);
  };
  const refreshOrders = useCallback(async () => {
    setPlacing(true);
    const remaining: string[] = []; const found = [...orders];
    for (const id of pendingSessionIds) {
      try { const result = await api.buyer.checkout.verifySession(id); if (result.orderNumber) found.push(result.orderNumber); else remaining.push(id); } catch { remaining.push(id); }
    }
    setOrders(found); setPendingSessionIds(remaining);
    if (!remaining.length) { await clearCart(); await clearCheckoutSession(); }
    setPlacing(false);
  }, [api, orders, pendingSessionIds]);
  if (loading || !session) return <View style={styles.loading}><ActivityIndicator color={PURPLE} size="large" /></View>;
  const label = current.step === 'review' ? `Continue to Stripe · ${money(current.summary.total)}` : 'Continue';
  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {current.step !== 'confirmation' && <View style={[styles.header, { paddingTop: insets.top + SP.xs }]}><TouchableOpacity style={styles.back} onPress={() => { const index = STEPS.indexOf(current.step); if (index <= 0) router.back(); else void persist({ ...current, step: STEPS[index - 1] }); }}><Feather name="chevron-left" size={ICON.md} color={FG} /></TouchableOpacity><View style={{ flex: 1, alignItems: 'center' }}><Text style={styles.stepLabel}>{current.step === 'information' ? 'Information' : current.step === 'delivery' ? 'Delivery' : 'Review & Pay'}</Text><Progress step={current.step} /></View><View style={styles.back} /></View>}
      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + (current.step === 'confirmation' ? 30 : 105) }} keyboardShouldPersistTaps="handled">
        {current.step === 'information' && <Information contact={contact} address={address} onContact={setContact} onAddress={setAddress} />}
        {current.step === 'delivery' && <Delivery session={current} onSelect={(sellerId, methodId) => void persist({ ...current, deliveryGroups: current.deliveryGroups.map(group => group.sellerId === sellerId ? { ...group, selectedMethodId: methodId } : group) })} onApply={async code => { const discount = await applyDiscount(code, current.summary.subtotal, current.discounts); await persist({ ...current, discounts: [...current.discounts.filter(item => item.code !== discount.code), discount] }); }} onRemove={code => void removeDiscount(code, current.discounts).then(discounts => persist({ ...current, discounts }))} />}
        {current.step === 'review' && <Review session={current} onAck={(key, checked) => void persist({ ...current, acknowledgments: current.acknowledgments.map(ack => ack.key === key ? { ...ack, acknowledged: checked } : ack) })} />}
        {current.step === 'confirmation' && <Confirmation orderNumbers={orders} finalizing={pendingSessionIds.length > 0} onRefresh={refreshOrders} refreshing={placing} />}
        {!!error && <View style={styles.error}><Feather name="alert-circle" size={16} color={RED} /><Text style={styles.errorText}>{error}</Text></View>}
      </ScrollView>
      {current.step !== 'confirmation' && <View style={[styles.bottom, { paddingBottom: insets.bottom + SP.sm }]}><TouchableOpacity style={styles.continue} disabled={placing} onPress={handleContinue}><LinearGradient colors={[...GRAD_PRIMARY]} style={styles.continueGradient}>{placing ? <ActivityIndicator color={ON_DARK} /> : <Text style={styles.continueText}>{label}</Text>}</LinearGradient></TouchableOpacity></View>}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG }, loading: { flex: 1, backgroundColor: BG, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingBottom: SP.sm }, back: { width: 42, height: 42, justifyContent: 'center', alignItems: 'center' }, stepLabel: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, marginBottom: 5 }, progress: { flexDirection: 'row', gap: 4, width: 120 }, progressSegment: { height: 4, flex: 1, borderRadius: 2, backgroundColor: CARD_ELEVATED }, progressSegmentActive: { backgroundColor: PURPLE },
  card: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md, marginBottom: SP.md }, sectionTitle: { fontFamily: FONT.semibold, fontSize: FS.base, color: FG, marginBottom: SP.sm }, field: { marginBottom: SP.sm }, fieldLabel: { color: MUTED, fontFamily: FONT.semibold, fontSize: FS.xs, textTransform: 'uppercase', marginBottom: 4 }, input: { height: COMP.inputH, borderRadius: RADIUS.md, backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, color: FG, fontFamily: FONT.regular, paddingHorizontal: SP.md }, twoCol: { flexDirection: 'row', gap: SP.sm }, toggleRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingTop: SP.sm }, toggleTitle: { color: FG, fontFamily: FONT.medium, fontSize: FS.sm }, muted: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19 },
  method: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.sm, borderRadius: RADIUS.md, marginBottom: 6 }, methodActive: { backgroundColor: PURPLE_DIM }, radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: MUTED }, radioActive: { borderColor: PURPLE, backgroundColor: PURPLE }, methodTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm }, promoToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm }, promoRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'center' }, applyButton: { backgroundColor: PURPLE_DIM, borderRadius: RADIUS.md, paddingHorizontal: SP.md, paddingVertical: 13 }, applyText: { color: PURPLE_LIGHT, fontFamily: FONT.bold, fontSize: FS.sm }, discountRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SP.sm, marginTop: SP.sm }, discountText: { flex: 1, color: SUCCESS, fontFamily: FONT.regular, fontSize: FS.sm }, removeText: { color: PURPLE_LIGHT, fontFamily: FONT.semibold, fontSize: FS.sm },
  address: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20, marginBottom: SP.md }, line: { flexDirection: 'row', justifyContent: 'space-between', gap: SP.sm, paddingVertical: 5 }, lineName: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm }, divider: { height: 1, backgroundColor: BORDER, marginVertical: SP.sm }, total: { color: FG, fontFamily: FONT.bold, fontSize: FS.lg }, multiSeller: { flexDirection: 'row', gap: SP.sm, backgroundColor: CYAN_DIM, borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md }, multiSellerText: { flex: 1, color: CYAN, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 }, ack: { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start', marginBottom: SP.sm }, checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1, borderColor: MUTED, alignItems: 'center', justifyContent: 'center', marginTop: 1 }, checkboxActive: { backgroundColor: PURPLE, borderColor: PURPLE }, ackText: { flex: 1, color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: SP.md, backgroundColor: BG, borderTopWidth: 1, borderColor: BORDER }, continue: { overflow: 'hidden', borderRadius: RADIUS.lg, ...SHADOW_PURPLE }, continueGradient: { height: COMP.buttonH, alignItems: 'center', justifyContent: 'center' }, continueText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.base }, error: { flexDirection: 'row', gap: SP.sm, backgroundColor: RED_DIM, padding: SP.md, borderRadius: RADIUS.md }, errorText: { color: RED, flex: 1, fontFamily: FONT.medium, fontSize: FS.sm },
  confirmation: { alignItems: 'center', paddingTop: SP.xxl }, confirmIcon: { width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center', backgroundColor: SUCCESS, marginBottom: SP.md }, headline: { color: FG, fontFamily: FONT.bold, fontSize: FS.xxl, marginBottom: SP.sm }, confirmText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, textAlign: 'center', maxWidth: 320 }, orderNumber: { color: FG, fontFamily: FONT.bold, fontSize: FS.base, marginTop: SP.md }, refreshButton: { borderWidth: 1, borderColor: PURPLE, borderRadius: RADIUS.md, paddingHorizontal: SP.lg, paddingVertical: SP.sm, marginTop: SP.lg }, refreshText: { color: PURPLE_LIGHT, fontFamily: FONT.bold, fontSize: FS.sm },
});