/**
 * Buyer checkout — four buyer-facing stages:
 * information, delivery, review/pay, confirmation.
 * Stripe Checkout is the sole payment entry point; card data is never collected here.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View, Animated, Image, KeyboardAvoidingView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '@/hooks/useColors';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import {
  applyDiscount, clearCart, clearCheckoutSession, createCheckoutSession,
  getCart, getCheckoutSession, removeDiscount, saveCheckoutProgress, validateCart,
} from '@/services/cartService';
import {
  CheckoutAddress, CheckoutContact, CheckoutDiscount, CheckoutSession, CheckoutStep,
} from '@/services/cartTypes';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@clerk/expo';
import {
  BG, BORDER, CARD, CARD_ELEVATED, FG, FONT, FS,
  MUTED, ON_DARK, RADIUS, RED, RED_DIM,
  SP, SUCCESS, SUCCESS_DIM, SUBTLE, COMP, ICON
} from '@/lib/theme';
import { formatCents } from '@/lib/money';
import {
  getCheckoutBlockingSection,
  getFirstIncompleteCheckoutSection,
  mergeCheckoutFormState,
} from '@/lib/checkoutReadiness';
import { CheckoutSkeleton, HapticSwitch } from '@/components/BrandthreadUI';

const STEPS: CheckoutStep[] = ['information', 'delivery', 'review', 'confirmation'];
const money = formatCents;

function Card({ children }: { children: React.ReactNode }) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  return <View style={styles.card}>{children}</View>;
}

function Input({ label, value, onChange, keyboardType = 'default', autoCapitalize = 'sentences' }: {
  label: string; value: string; onChange: (value: string) => void; keyboardType?: any; autoCapitalize?: any;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType={keyboardType} autoCapitalize={autoCapitalize}
        placeholder={label} placeholderTextColor={SUBTLE} accessibilityLabel={label} style={styles.input} />
    </View>
  );
}

function Progress({ step }: { step: CheckoutStep }) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const index = Math.max(0, STEPS.indexOf(step));
  return (
    <View style={styles.progress}>
      {STEPS.slice(0, 3).map((item, itemIndex) => (
        <View key={item} style={[styles.progressSegment, itemIndex <= index && styles.progressSegmentActive]} />
      ))}
    </View>
  );
}

type GuidedCheckoutSection = 'information' | 'delivery' | 'review';

function GuidedSection({ title, summary, expanded, complete, onPress, children }: {
  title: string;
  summary: string;
  expanded: boolean;
  complete: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  return (
    <View style={styles.guidedSection}>
      <TouchableOpacity
        style={styles.guidedHeader}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}. ${summary}`}
      >
        <View style={[styles.guidedStatus, complete && styles.guidedStatusComplete]}>
          <Feather name={complete ? 'check' : 'circle'} size={14} color={complete ? BG : MUTED} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.guidedTitle}>{title}</Text>
          <Text style={styles.guidedSummary} numberOfLines={1}>{summary}</Text>
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={19} color={MUTED} />
      </TouchableOpacity>
      {expanded && <View style={styles.guidedBody}>{children}</View>}
    </View>
  );
}

function Information({ contact, address, onContact, onAddress, savedAddresses, onSelectAddress }: {
  contact: Partial<CheckoutContact>; address: Partial<CheckoutAddress> & { saveAddress?: boolean, label?: string };
  onContact: (value: Partial<CheckoutContact>) => void; onAddress: (value: Partial<CheckoutAddress> & { saveAddress?: boolean, label?: string }) => void;
  savedAddresses: any[]; onSelectAddress: (addr: any) => void;
}) {
  const colors = useColors();
  const { theme } = useAppTheme();
  const { isSignedIn } = useAuth();
  const PURPLE = colors.primary;
  const styles = makeStyles(theme);
  const [showAddressForm, setShowAddressForm] = useState(!isSignedIn || savedAddresses.length === 0);

  return (
    <>
      {!isSignedIn && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Feather name="info" size={16} color={PURPLE} />
            <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Guest Checkout</Text>
          </View>
          <Text style={styles.muted}>Your email is used for receipts and updates. Your address is used for this order only.</Text>
        </Card>
      )}

      <Card>
        <Text style={styles.sectionTitle}>Contact</Text>
        <Input label="Email" value={contact.email ?? ''} keyboardType="email-address" autoCapitalize="none"
          onChange={email => onContact({ ...contact, email })} />
        <Input label="Phone (optional)" value={contact.phone ?? ''} keyboardType="phone-pad"
          onChange={phone => onContact({ ...contact, phone })} />
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}><Text style={styles.toggleTitle}>Order updates</Text><Text style={styles.muted}>Email updates about your order</Text></View>
          <HapticSwitch value={contact.orderUpdates !== 'none'} onValueChange={enabled => onContact({ ...contact, orderUpdates: enabled ? 'email' : 'none' })} trackColor={{ true: PURPLE }} />
        </View>
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>Shipping address</Text>

        {isSignedIn && savedAddresses.length > 0 && !showAddressForm && (
          <View style={{ gap: SP.sm, marginBottom: SP.md }}>
            {savedAddresses.map(addr => (
              <TouchableOpacity
                key={addr.id}
                style={[styles.savedAddressCard, address.id === addr.id && styles.savedAddressCardActive]}
                onPress={() => onSelectAddress(addr)}
                accessibilityRole="radio"
                accessibilityState={{ selected: address.id === addr.id }}
                accessibilityLabel={`${addr.label}, ${addr.recipientName}, ${addr.street}, ${addr.city}, ${addr.state} ${addr.postalCode}`}
              >
                <View style={[styles.radio, address.id === addr.id && styles.radioActive]} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.methodTitle}>{addr.label}</Text>
                    {addr.isDefault && <View style={styles.defaultBadge}><Text style={styles.defaultBadgeText}>Default</Text></View>}
                  </View>
                  <Text style={styles.muted}>{addr.recipientName}</Text>
                  <Text style={styles.muted}>{addr.street}, {addr.city}, {addr.state} {addr.postalCode}</Text>
                </View>
              </TouchableOpacity>
            ))}
            {!!address.id && (
              <TouchableOpacity
                style={styles.addNewAddressBtn}
                onPress={() => {
                  onAddress({ ...address, id: undefined, saveAddress: false });
                  setShowAddressForm(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Edit address for this order"
              >
                <Feather name="edit-2" size={16} color={theme.accentLight} />
                <Text style={styles.addNewAddressText}>Edit for this order</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.addNewAddressBtn}
              onPress={() => { onAddress({ country: 'US' }); setShowAddressForm(true); }}
              accessibilityRole="button"
              accessibilityLabel="Add a new address"
            >
              <Feather name="plus" size={16} color={theme.accentLight} />
              <Text style={styles.addNewAddressText}>Add a new address</Text>
            </TouchableOpacity>
          </View>
        )}

        {showAddressForm && (
          <>
            {isSignedIn && savedAddresses.length > 0 && (
              <TouchableOpacity style={styles.useSavedBtn} onPress={() => setShowAddressForm(false)} accessibilityRole="button" accessibilityLabel="Use a saved address">
                <Feather name="arrow-left" size={14} color={theme.accentLight} />
                <Text style={styles.useSavedText}>Use a saved address</Text>
              </TouchableOpacity>
            )}
            {isSignedIn && (
              <Input label="Address label (e.g. Home, Office)" value={address.label ?? ''} onChange={label => onAddress({ ...address, label })} />
            )}
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

            {isSignedIn && (
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}><Text style={styles.toggleTitle}>Save this address</Text><Text style={styles.muted}>Save to your address book</Text></View>
                <HapticSwitch value={address.saveAddress !== false} onValueChange={enabled => onAddress({ ...address, saveAddress: enabled })} trackColor={{ true: PURPLE }} />
              </View>
            )}
            {isSignedIn && address.saveAddress !== false && (
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}><Text style={styles.toggleTitle}>Set as default</Text></View>
                <HapticSwitch value={address.isDefault === true} onValueChange={enabled => onAddress({ ...address, isDefault: enabled })} trackColor={{ true: PURPLE }} />
              </View>
            )}
          </>
        )}
      </Card>
    </>
  );
}

function Delivery({ session, onSelect, onApply, onRemove }: {
  session: CheckoutSession; onSelect: (sellerId: string, methodId: string) => void;
  onApply: (code: string) => Promise<void>; onRemove: (code: string) => void;
}) {
  const { theme } = useAppTheme();
  const PURPLE_LIGHT = theme.accentLight;
  const styles = makeStyles(theme);
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
              onPress={() => onSelect(group.sellerId, method.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: group.selectedMethodId === method.id }}
              accessibilityLabel={`${method.service}, ${method.estimatedDelivery}, ${money(method.priceCents)}`}
            >
              <View style={[styles.radio, group.selectedMethodId === method.id && styles.radioActive]} />
              <View style={{ flex: 1 }}><Text style={styles.methodTitle}>{method.service}</Text><Text style={styles.muted}>{method.estimatedDelivery}</Text></View>
              <Text style={styles.methodTitle}>{money(method.priceCents)}</Text>
            </TouchableOpacity>
          ))}
        </Card>
      ))}
      <Card>
        <TouchableOpacity
          style={styles.promoToggle}
          onPress={() => setShowPromo(value => !value)}
          accessibilityRole="button"
          accessibilityLabel="Have a promo code?"
          accessibilityState={{ expanded: showPromo }}
          accessibilityHint={showPromo ? 'Hides the promo code field' : 'Shows the promo code field'}
        >
          <View style={styles.row}><Feather name="tag" size={16} color={PURPLE_LIGHT} /><Text style={styles.sectionTitle}>Have a promo code?</Text></View>
          <Feather name={showPromo ? 'chevron-up' : 'chevron-down'} size={18} color={MUTED} />
        </TouchableOpacity>
        {showPromo && (
          <>
            <View style={styles.promoRow}>
              <TextInput value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="Enter code" placeholderTextColor={SUBTLE} accessibilityLabel="Promo code" style={[styles.input, { flex: 1, marginBottom: 0 }]} />
              <TouchableOpacity style={styles.applyButton} disabled={applying || !code.trim()} onPress={async () => { setApplying(true); await onApply(code); setCode(''); setApplying(false); }} accessibilityRole="button" accessibilityLabel="Apply promo code" accessibilityState={{ disabled: applying || !code.trim(), busy: applying }}>
                <Text style={styles.applyText}>{applying ? '...' : 'Apply'}</Text>
              </TouchableOpacity>
            </View>
            {session.discounts.map(discount => (
              <View style={styles.discountRow} key={discount.code}>
                <Text style={styles.discountText}>{discount.isValid ? `${discount.code} · ${discount.description}` : discount.errorMessage}</Text>
                <TouchableOpacity onPress={() => onRemove(discount.code)} accessibilityRole="button" accessibilityLabel={`Remove promo code ${discount.code}`}><Text style={styles.removeText}>Remove</Text></TouchableOpacity>
              </View>
            ))}
          </>
        )}
      </Card>
    </>
  );
}

function Review({ session, onAck }: { session: CheckoutSession; onAck: (key: string, checked: boolean) => void }) {
  const { theme } = useAppTheme();
  const { isSignedIn } = useAuth();
  const CYAN = theme.secondary, PURPLE_LIGHT = theme.accentLight;
  const styles = makeStyles(theme);
  const address = session.shippingAddress;
  return (
    <>
      <Card>
        <Text style={styles.sectionTitle}>Review your order</Text>
        <Text style={styles.address}>{address?.firstName} {address?.lastName}{'\n'}{address?.line1}{'\n'}{address?.city}, {address?.state} {address?.postalCode}</Text>
        {session.deliveryGroups.flatMap(group => group.items).map(item => (
          <View key={item.id} style={styles.line}><View style={{ flex: 1 }}><Text style={styles.lineName}>{item.productName}</Text><Text style={styles.muted}>{item.variantTitle} · Qty {item.quantity}</Text></View><Text style={styles.lineName}>{money(item.priceCents * item.quantity)}</Text></View>
        ))}
        <View style={styles.divider} />
        <View style={styles.line}><Text style={styles.muted}>Subtotal</Text><Text style={styles.lineName}>{money(session.summary.subtotalCents)}</Text></View>
        {session.summary.discountTotalCents > 0 && <View style={styles.line}><Text style={styles.muted}>Discount</Text><Text style={[styles.lineName, { color: SUCCESS }]}>−{money(session.summary.discountTotalCents)}</Text></View>}
        <View style={styles.line}><Text style={styles.muted}>Shipping</Text><Text style={styles.lineName}>{money(session.summary.shippingTotalCents)}</Text></View>
        <View style={styles.line}><Text style={styles.muted}>Tax</Text><Text style={styles.lineName}>{money(session.summary.taxTotalCents)}</Text></View>
        <View style={styles.divider} />
        <View style={styles.line}><Text style={styles.total}>Total</Text><Text style={styles.total}>{money(session.summary.totalCents)}</Text></View>
      </Card>
      {session.deliveryGroups.length > 1 && (
        <View style={styles.multiSeller}><Feather name="layers" size={16} color={CYAN} /><Text style={styles.multiSellerText}>Your cart contains items from {session.deliveryGroups.length} sellers. You will complete a separate secure Stripe payment for each seller.</Text></View>
      )}
      <Card>
        <View style={styles.row}><Feather name="lock" size={17} color={PURPLE_LIGHT} /><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Pay securely with Stripe</Text><Text style={styles.muted}>You’ll enter your payment details in Stripe Checkout. Brandthread never collects card numbers.</Text></View></View>
        <Text style={[styles.muted, { marginTop: SP.sm }]}>
          {isSignedIn
            ? 'Cards saved from earlier purchases will appear automatically in Stripe Checkout.'
            : 'Your payment details stay with Stripe and are not saved to a Brandthread account.'}
        </Text>
      </Card>
      {session.acknowledgments.map(ack => (
        <TouchableOpacity
          key={ack.key}
          style={styles.ack}
          onPress={() => onAck(ack.key, !ack.acknowledged)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: ack.acknowledged }}
          accessibilityLabel={ack.label}
          accessibilityHint={ack.required ? 'Required before payment' : undefined}
        >
          <View style={[styles.checkbox, ack.acknowledged && styles.checkboxActive]}>{ack.acknowledged && <Feather name="check" size={12} color={ON_DARK} />}</View>
          <Text style={styles.ackText}>{ack.label}</Text>
        </TouchableOpacity>
      ))}
    </>
  );
}

const CONFETTI = [
  { left: '5%', color: SUCCESS, delay: 0, x: -14 },
  { left: '13%', color: 'accent', delay: 90, x: 18 },
  { left: '22%', color: 'secondary', delay: 180, x: -8 },
  { left: '31%', color: '#F59E0B', delay: 50, x: 14 },
  { left: '42%', color: '#F87171', delay: 230, x: -18 },
  { left: '53%', color: SUCCESS, delay: 110, x: 10 },
  { left: '64%', color: 'accent', delay: 20, x: -12 },
  { left: '73%', color: 'secondary', delay: 260, x: 17 },
  { left: '82%', color: '#F59E0B', delay: 140, x: -10 },
  { left: '92%', color: '#F87171', delay: 70, x: 13 },
] as const;

function Confirmation({ session, orderNumbers, finalizing, onRefresh, refreshing }: {
  session: CheckoutSession; orderNumbers: string[]; finalizing: boolean; onRefresh: () => void; refreshing: boolean;
}) {
  const colors = useColors();
  const { theme } = useAppTheme();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const PURPLE = colors.primary, PURPLE_LIGHT = theme.accentLight;
  const styles = makeStyles(theme);
  const checkScale = useRef(new Animated.Value(0)).current;
  const confettiProgress = useRef(new Animated.Value(0)).current;
  const orderItems = session.deliveryGroups.flatMap(group => group.items);
  const deliveryEstimates = session.deliveryGroups
    .map(group => group.availableMethods.find(method => method.id === group.selectedMethodId)?.estimatedDelivery)
    .filter((value): value is string => !!value);
  const preOrderEstimates = orderItems.map(item => item.preOrderEstShipDate).filter((value): value is string => !!value);
  const estimateLabels = [...new Set([...deliveryEstimates, ...preOrderEstimates])];
  const primaryEstimate = estimateLabels[0] ?? 'Tracking updates coming soon';

  useEffect(() => {
    Animated.parallel([
      Animated.spring(checkScale, { toValue: 1, useNativeDriver: true, tension: 62, friction: 6 }),
      Animated.timing(confettiProgress, { toValue: 1, duration: 1250, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={styles.confirmation}>
      {!finalizing && (
        <View style={styles.confettiLayer} pointerEvents="none">
          {CONFETTI.map((particle, index) => (
            <Animated.View
              key={index}
              style={[
                styles.confetti,
                {
                  left: particle.left,
                  backgroundColor: particle.color === 'accent'
                    ? theme.accent
                    : particle.color === 'secondary'
                      ? theme.secondary
                      : particle.color,
                  opacity: confettiProgress.interpolate({ inputRange: [0, 0.82, 1], outputRange: [1, 1, 0] }),
                  transform: [
                    { translateX: confettiProgress.interpolate({ inputRange: [0, 1], outputRange: [0, particle.x] }) },
                    { translateY: confettiProgress.interpolate({ inputRange: [0, 1], outputRange: [-40 - particle.delay / 8, 190] }) },
                    { rotate: confettiProgress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${180 + index * 48}deg`] }) },
                  ],
                },
              ]}
            />
          ))}
        </View>
      )}

      <View style={styles.successHalo}>
        <Animated.View style={[styles.confirmIcon, finalizing && { backgroundColor: PURPLE }, { transform: [{ scale: checkScale }] }]}>
          <Feather name={finalizing ? 'clock' : 'check'} size={38} color={ON_DARK} />
        </Animated.View>
      </View>
      <Text style={styles.confirmEyebrow}>{finalizing ? 'PAYMENT RECEIVED' : 'PURCHASE COMPLETE'}</Text>
      <Text style={styles.headline}>{finalizing ? 'Almost there' : 'It’s yours.'}</Text>
      <Text style={styles.confirmText}>{finalizing ? 'We’re finalizing your order with the seller. This can take a moment after payment.' : 'Your order is confirmed. We’ll keep you updated every step of the way.'}</Text>

      {!finalizing && (
        <View style={styles.deliveryHero}>
          <View style={[styles.deliveryIcon, { backgroundColor: theme.accentDim }]}>
            <Feather name="truck" size={22} color={theme.accentLight} />
          </View>
          <Text style={styles.deliveryLabel}>ESTIMATED DELIVERY</Text>
          <Text style={styles.deliveryDate}>{primaryEstimate}</Text>
          {estimateLabels.length > 1 && <Text style={styles.deliverySub}>Your items will arrive in {estimateLabels.length} shipments</Text>}
        </View>
      )}

      {!!orderItems.length && (
        <View style={styles.confirmItems}>
          <Text style={styles.confirmItemsLabel}>{orderItems.length} {orderItems.length === 1 ? 'ITEM' : 'ITEMS'} IN YOUR ORDER</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.confirmItemsRow}>
            {orderItems.map(item => (
              <View style={styles.confirmProduct} key={item.id}>
                {item.imageUri ? (
                  <Image source={{ uri: item.imageUri }} style={styles.confirmProductImage} resizeMode="cover" />
                ) : (
                  <View style={[styles.confirmProductImage, styles.confirmProductFallback]}><Feather name="image" size={20} color={SUBTLE} /></View>
                )}
                {item.quantity > 1 && <View style={styles.confirmQty}><Text style={styles.confirmQtyText}>{item.quantity}</Text></View>}
                <Text style={styles.confirmProductName} numberOfLines={2}>{item.productName}</Text>
                <Text style={styles.confirmProductVariant} numberOfLines={1}>{item.variantTitle}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.orderNumbers}>
        {orderNumbers.map(number => <Text style={styles.orderNumber} key={number}>{number}</Text>)}
      </View>

      {finalizing ? (
        <TouchableOpacity style={styles.refreshButton} onPress={onRefresh} disabled={refreshing} accessibilityRole="button" accessibilityLabel="Check order status" accessibilityState={{ disabled: refreshing, busy: refreshing }}>
          {refreshing ? <ActivityIndicator color={PURPLE_LIGHT} /> : <Text style={styles.refreshText}>Check order status</Text>}
        </TouchableOpacity>
      ) : (
        <View style={{ marginTop: SP.xl, width: '100%', gap: SP.sm }}>
          {!isSignedIn && (
            <TouchableOpacity style={styles.createAccountBtn} onPress={() => router.replace('/sign-in' as never)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Create an account">
              <Text style={styles.createAccountText}>Create an account</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.continueShopBtn} onPress={() => router.replace('/(buyer)/discover' as never)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Continue shopping">
            <Text style={styles.continueShopText}>Continue shopping</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function BuyerCheckoutScreen() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const PURPLE = colors.primary, PURPLE_LIGHT = theme.accentLight, PURPLE_DIM = colors.accent, CYAN = theme.secondary, CYAN_DIM = theme.secondaryDim;
  const SHADOW_PURPLE = { shadowColor: theme.shadowColor, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 };
  const styles = makeStyles(theme);
  const { source } = useLocalSearchParams<{ source?: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const { back } = useThreadPull();
  const usesThreadPull = pathname === '/thread-checkout';
  const leaveCheckout = () => usesThreadPull ? back() : router.back();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { isSignedIn } = useAuth();
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [contact, setContact] = useState<Partial<CheckoutContact>>({ orderUpdates: 'email', marketingConsent: false });
  const [address, setAddress] = useState<Partial<CheckoutAddress> & { saveAddress?: boolean, label?: string }>({ country: 'US' });
  const [savedAddresses, setSavedAddresses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');
  const [canRetryPayment, setCanRetryPayment] = useState(false);
  const [orders, setOrders] = useState<string[]>([]);
  const [pendingSessionIds, setPendingSessionIds] = useState<string[]>([]);
  const [expandedSection, setExpandedSection] = useState<GuidedCheckoutSection>('information');
  const paid = useRef(new Map<string, string>());

  useEffect(() => { (async () => {
    let next = await getCheckoutSession();
    if (!next) {
      const cart = await getCart();
      if (!cart.items.length) { leaveCheckout(); return; }
      next = await createCheckoutSession(cart, source === 'buynow');
    }
    if (next.step === 'contact' || next.step === 'shipping' || next.step === 'discounts' || next.step === 'payment') next.step = 'information';
    const restoredContact: Partial<CheckoutContact> = next.contact ?? { orderUpdates: 'email', marketingConsent: false };
    const restoredAddress: Partial<CheckoutAddress> & { saveAddress?: boolean; label?: string } =
      next.shippingAddress ?? { country: 'US', saveAddress: true };
    const firstIncomplete = getFirstIncompleteCheckoutSection(restoredContact, restoredAddress, next);
    if (next.step !== 'confirmation') next.step = firstIncomplete;
    setSession(next); setContact(restoredContact);
    setAddress(restoredAddress);
    setExpandedSection(firstIncomplete);
    const restoredOrders: string[] = [];
    const restoredPending: string[] = [];
    for (const [sellerId, payment] of Object.entries(next.paidGroups ?? {})) {
      if (payment.orderNumber) {
        restoredOrders.push(payment.orderNumber);
        paid.current.set(sellerId, payment.orderNumber);
      } else {
        restoredPending.push(payment.guestAccessToken
          ? `${payment.stripeSessionId}|${payment.guestAccessToken}`
          : payment.stripeSessionId);
      }
    }
    setOrders(restoredOrders);
    setPendingSessionIds(restoredPending);

    if (isSignedIn) {
      try {
        const addresses = await api.buyer.addresses.list();
        setSavedAddresses(addresses);

        if (addresses.length > 0 && !next.shippingAddress) {
          const defaultAddr = addresses.find((a: any) => a.isDefault) || addresses[0];
          handleSelectAddress(defaultAddr);
        }
      } catch (e) {
        // ignore
      }
    }

    setLoading(false);
  })(); }, []);

  const handleSelectAddress = (addr: any) => {
    const parts = addr.recipientName ? addr.recipientName.split(' ') : [];
    const firstName = parts[0] || '';
    const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
    setAddress({
      id: addr.id,
      firstName, lastName,
      line1: addr.street, line2: addr.line2,
      city: addr.city, state: addr.state,
      postalCode: addr.postalCode, country: addr.country,
      saveAddress: false,
    });
  };

  const persist = async (next: CheckoutSession) => {
    const snapshot = mergeCheckoutFormState(next, contact, address);
    setSession(snapshot);
    await saveCheckoutProgress(snapshot);
  };
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
    if (!isSignedIn) return true;
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
      setExpandedSection('delivery');
      return;
    }
    if (current.step === 'delivery') {
      if (current.deliveryGroups.some(group => !group.selectedMethodId)) {
        Alert.alert('Choose delivery', 'Select a delivery option for every seller before reviewing your order.');
        return;
      }
      if (!await validateServerCart()) return;
      await persist({ ...current, step: 'review' });
      setExpandedSection('review');
      return;
    }
    if (current.step === 'review') {
      const blockingSection = getCheckoutBlockingSection(contact, address, current);
      if (blockingSection === 'information') {
        setExpandedSection('information');
        validateInformation();
        return;
      }
      if (blockingSection === 'delivery') {
        setExpandedSection('delivery');
        Alert.alert('Choose delivery', 'Select a delivery option for every seller before paying.');
        return;
      }
      if (blockingSection === 'acknowledgments' || !await validateServerCart()) {
        if (blockingSection === 'acknowledgments') {
          setExpandedSection('review');
          Alert.alert('Acknowledgment required', 'Please accept the required policies before paying.');
        }
        return;
      }
      await pay();
    }
  };
  const pay = async () => {
    setPlacing(true); setError(''); setCanRetryPayment(false);
    const unresolved: string[] = []; const confirmed: string[] = [];
    const paidGroups = { ...(current.paidGroups ?? {}) };
    try {
      for (const group of current.deliveryGroups) {
        if (paid.current.has(group.sellerId)) { confirmed.push(paid.current.get(group.sellerId)!); continue; }

        let result: any;
        if (isSignedIn) {
          result = await api.buyer.checkout.createSession(group.items.map(item => ({ variantId: item.variantId, productId: item.productId, quantity: item.quantity })), {
            contactEmail: contact.email,
            shippingAddress: { name: `${address.firstName} ${address.lastName}`.trim(), street: address.line1!, line2: address.line2, city: address.city!, state: address.state!, zip: address.postalCode!, country: address.country || 'US' },
            clientIdempotencyKey: `${current.idempotencyKey}_${group.sellerId}`,
            ...(current.loyaltyRedemption && current.deliveryGroups.length === 1
              ? { loyaltyToken: current.loyaltyRedemption.token }
              : {}),
          });
        } else {
          result = await api.guest.checkout.createSession(group.items.map(item => ({ variantId: item.variantId, productId: item.productId, quantity: item.quantity })), {
            contactEmail: contact.email,
            shippingAddress: { name: `${address.firstName} ${address.lastName}`.trim(), street: address.line1!, line2: address.line2, city: address.city!, state: address.state!, zip: address.postalCode!, country: address.country || 'US' },
            clientIdempotencyKey: `${current.idempotencyKey}_${group.sellerId}`,
          });
        }

        paidGroups[group.sellerId] = {
          stripeSessionId: result.sessionId,
          ...(result.guestAccessToken ? { guestAccessToken: result.guestAccessToken } : {}),
        };
        await persist({ ...current, paidGroups });

        const browser = await WebBrowser.openBrowserAsync(result.url);
        if (browser.type === 'cancel' || browser.type === 'dismiss') { setError('Payment was cancelled. Your cart is still saved.'); setPlacing(false); return; }

        let verification: any;
        for (let attempt = 0; attempt < 6; attempt++) {
          if (isSignedIn) {
            verification = await api.buyer.checkout.verifySession(result.sessionId);
          } else {
            verification = await api.guest.checkout.verifySession(result.sessionId, result.guestAccessToken);
          }
          if (verification.orderNumber || verification.paymentStatus === 'paid') break;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        if (verification?.paymentStatus !== 'paid') {
          setError(verification?.declineReason ?? 'Your payment was declined. Please try a different card or contact your card issuer.');
          setCanRetryPayment(true);
          setPlacing(false);
          return;
        }
        if (verification.orderNumber) {
          confirmed.push(verification.orderNumber);
          paid.current.set(group.sellerId, verification.orderNumber);
          paidGroups[group.sellerId] = {
            ...paidGroups[group.sellerId],
            orderNumber: verification.orderNumber,
            amountTotalCents: verification.amountTotal ?? undefined,
          };
          await persist({ ...current, paidGroups });
        } else {
          unresolved.push(isSignedIn ? result.sessionId : `${result.sessionId}|${result.guestAccessToken}`);
        }
      }
      setOrders(confirmed); setPendingSessionIds(unresolved);
      if (!unresolved.length) await clearCart();

      // Save address if requested
      if (isSignedIn && address.saveAddress !== false && !address.id) {
        try {
          await api.buyer.addresses.create({
            label: address.label || 'Saved Address',
            recipientName: `${address.firstName} ${address.lastName}`.trim(),
            street: address.line1,
            line2: address.line2 || undefined,
            city: address.city,
            state: address.state,
            postalCode: address.postalCode,
            country: address.country || 'US',
            phone: contact.phone || undefined,
            isDefault: address.isDefault || false,
          });
        } catch (e) {
          // ignore error, just don't crash checkout
        }
      }

      await persist({ ...current, paidGroups, step: 'confirmation' });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch { setError('We could not start secure checkout. Please try again.'); }
    setPlacing(false);
  };
  const retryPayment = async () => {
    await pay();
  };
  const refreshOrders = useCallback(async () => {
    setPlacing(true);
    const remaining: string[] = []; const found = [...orders];
    const paidGroups = { ...(current.paidGroups ?? {}) };
    for (const pending of pendingSessionIds) {
      try {
        let result: any;
        if (pending.includes('|')) {
          const [sid, token] = pending.split('|');
          result = await api.guest.checkout.verifySession(sid, token);
        } else {
          result = await api.buyer.checkout.verifySession(pending);
        }
        if (result.orderNumber) {
          found.push(result.orderNumber);
          const sessionId = pending.includes('|') ? pending.split('|')[0] : pending;
          const sellerId = Object.entries(paidGroups)
            .find(([, payment]) => payment.stripeSessionId === sessionId)?.[0];
          if (sellerId) {
            paidGroups[sellerId] = {
              ...paidGroups[sellerId],
              orderNumber: result.orderNumber,
              amountTotalCents: result.amountTotal ?? undefined,
            };
          }
        } else remaining.push(pending);
      } catch { remaining.push(pending); }
    }
    setOrders(found); setPendingSessionIds(remaining);
    await persist({ ...current, paidGroups, step: 'confirmation' });
    if (!remaining.length) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    if (!remaining.length) await clearCart();
    setPlacing(false);
  }, [api, current, orders, pendingSessionIds]);
  if (loading || !session) return <CheckoutSkeleton />;
  const informationComplete = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email ?? '')
    && !!address.firstName && !!address.lastName && !!address.line1 && !!address.city
    && !!address.state && (address.postalCode ?? '').trim().length >= 3 && !!address.country;
  const deliveryComplete = current.deliveryGroups.every(group => !!group.selectedMethodId);
  const reviewComplete = current.acknowledgments.every(ack => !ack.required || ack.acknowledged);
  const openSection = (step: GuidedCheckoutSection) => {
    setExpandedSection(step);
  };
  const label = current.step === 'review'
    ? canRetryPayment ? 'Try a different card' : `Continue to Stripe · ${money(current.summary.totalCents)}`
    : 'Continue';
  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding" keyboardVerticalOffset={0}>
       {current.step !== 'confirmation' && <View style={[styles.header, { paddingTop: insets.top + SP.xs }]}><TouchableOpacity style={styles.back} onPress={leaveCheckout} accessibilityRole="button" accessibilityLabel="Back"><Feather name="chevron-left" size={ICON.md} color={FG} /></TouchableOpacity><View style={{ flex: 1, alignItems: 'center' }}><Text style={styles.stepLabel}>Secure checkout</Text><Progress step={current.step} /></View><View style={styles.back} /></View>}
      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + (current.step === 'confirmation' ? 30 : 105) }} keyboardShouldPersistTaps="handled">
         {current.step !== 'confirmation' && (
           <>
             <GuidedSection title="Contact & shipping address" summary={informationComplete ? `${contact.email} · ${address.city}, ${address.state}` : 'Add your contact and delivery address'} expanded={expandedSection === 'information'} complete={informationComplete} onPress={() => openSection('information')}>
               <Information contact={contact} address={address} onContact={setContact} onAddress={setAddress} savedAddresses={savedAddresses} onSelectAddress={handleSelectAddress} />
             </GuidedSection>
             <GuidedSection title="Delivery & promo" summary={deliveryComplete ? `${current.deliveryGroups.length} delivery choice${current.deliveryGroups.length === 1 ? '' : 's'} selected` : 'Choose delivery and add a promo code'} expanded={expandedSection === 'delivery'} complete={deliveryComplete} onPress={() => openSection('delivery')}>
               <Delivery session={current} onSelect={(sellerId, methodId) => void persist({ ...current, deliveryGroups: current.deliveryGroups.map(group => group.sellerId === sellerId ? { ...group, selectedMethodId: methodId } : group) })} onApply={async code => { const discount = await applyDiscount(code, current.summary.subtotalCents, current.discounts); await persist({ ...current, discounts: [...current.discounts.filter(item => item.code !== discount.code), discount] }); }} onRemove={code => void removeDiscount(code, current.discounts).then(discounts => persist({ ...current, discounts }))} />
             </GuidedSection>
             <GuidedSection title="Review & policies" summary={`${money(current.summary.totalCents)} · Stripe secure payment`} expanded={expandedSection === 'review'} complete={reviewComplete} onPress={() => openSection('review')}>
               <Review session={current} onAck={(key, checked) => void persist({ ...current, acknowledgments: current.acknowledgments.map(ack => ack.key === key ? { ...ack, acknowledged: checked } : ack) })} />
             </GuidedSection>
           </>
         )}
        {current.step === 'confirmation' && <Confirmation session={current} orderNumbers={orders} finalizing={pendingSessionIds.length > 0} onRefresh={refreshOrders} refreshing={placing} />}
         {!!error && <View style={styles.error}>
           <Feather name="alert-circle" size={16} color={RED} style={{ marginTop: 2 }} />
           <View style={{ flex: 1 }}>
             <Text style={styles.errorText}>{error}</Text>
              {canRetryPayment && <TouchableOpacity style={styles.retryButton} onPress={retryPayment} disabled={placing} accessibilityRole="button" accessibilityLabel="Try a different card" accessibilityState={{ disabled: placing, busy: placing }}>
               <Feather name="credit-card" size={14} color={RED} />
               <Text style={styles.retryText}>Try a different card</Text>
             </TouchableOpacity>}
           </View>
         </View>}
      </ScrollView>
        {current.step !== 'confirmation' && <View style={[styles.bottom, { paddingBottom: insets.bottom + SP.sm }]}><TouchableOpacity style={styles.continue} disabled={placing} onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); void (canRetryPayment ? retryPayment() : handleContinue()); }} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: placing, busy: placing }}><LinearGradient colors={theme.primaryGradient} style={styles.continueGradient}>{placing ? <ActivityIndicator color={theme.onAccent} /> : <Text style={[styles.continueText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>{label}</Text>}</LinearGradient></TouchableOpacity></View>}
    </KeyboardAvoidingView>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent, PURPLE_LIGHT = theme.accentLight, PURPLE_DIM = theme.accentDim, CYAN = theme.secondary, CYAN_DIM = theme.secondaryDim;
  const SHADOW_PURPLE = { shadowColor: theme.shadowColor, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 };
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' }, loading: { flex: 1, backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingBottom: SP.sm }, back: { width: COMP.minTouchTarget, height: COMP.minTouchTarget, justifyContent: 'center', alignItems: 'center' }, stepLabel: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, marginBottom: 5 }, progress: { flexDirection: 'row', gap: 4, width: 120 }, progressSegment: { height: 4, flex: 1, borderRadius: 2, backgroundColor: CARD_ELEVATED }, progressSegmentActive: { backgroundColor: PURPLE },
   card: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md, marginBottom: SP.md }, sectionTitle: { fontFamily: FONT.semibold, fontSize: FS.base, color: FG, marginBottom: SP.sm }, field: { marginBottom: SP.sm }, fieldLabel: { color: MUTED, fontFamily: FONT.semibold, fontSize: FS.xs, textTransform: 'uppercase', marginBottom: 4 }, input: { minHeight: COMP.inputH, borderRadius: RADIUS.md, backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, color: FG, fontFamily: FONT.regular, paddingHorizontal: SP.md, paddingVertical: SP.sm }, twoCol: { flexDirection: 'row', gap: SP.sm }, toggleRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingTop: SP.sm }, toggleTitle: { color: FG, fontFamily: FONT.medium, fontSize: FS.sm }, muted: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19 },
   guidedSection: { borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.lg, overflow: 'hidden', marginBottom: SP.sm },
   guidedHeader: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm },
   guidedStatus: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
   guidedStatusComplete: { backgroundColor: SUCCESS, borderColor: SUCCESS },
   guidedTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
   guidedSummary: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 3 },
   guidedBody: { paddingHorizontal: SP.sm, paddingBottom: SP.sm },
  method: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.sm, borderRadius: RADIUS.md, marginBottom: 6 }, methodActive: { backgroundColor: PURPLE_DIM }, radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: MUTED }, radioActive: { borderColor: PURPLE, backgroundColor: PURPLE }, methodTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm }, promoToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm }, promoRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'center' }, applyButton: { backgroundColor: PURPLE_DIM, borderRadius: RADIUS.md, paddingHorizontal: SP.md, paddingVertical: 13 }, applyText: { color: PURPLE_LIGHT, fontFamily: FONT.bold, fontSize: FS.sm }, discountRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SP.sm, marginTop: SP.sm }, discountText: { flex: 1, color: SUCCESS, fontFamily: FONT.regular, fontSize: FS.sm }, removeText: { color: PURPLE_LIGHT, fontFamily: FONT.semibold, fontSize: FS.sm },
   address: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20, marginBottom: SP.md }, line: { flexDirection: 'row', justifyContent: 'space-between', gap: SP.sm, paddingVertical: 5 }, lineName: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm }, divider: { height: 1, backgroundColor: BORDER, marginVertical: SP.sm }, total: { color: FG, fontFamily: FONT.bold, fontSize: FS.lg }, multiSeller: { flexDirection: 'row', gap: SP.sm, backgroundColor: CYAN_DIM, borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md }, multiSellerText: { flex: 1, color: CYAN, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 }, ack: { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start', minHeight: COMP.minTouchTarget, marginBottom: SP.sm }, checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1, borderColor: MUTED, alignItems: 'center', justifyContent: 'center', marginTop: 1 }, checkboxActive: { backgroundColor: PURPLE, borderColor: PURPLE }, ackText: { flex: 1, color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: SP.md, backgroundColor: BG, borderTopWidth: 1, borderColor: BORDER }, continue: { overflow: 'hidden', borderRadius: RADIUS.lg, ...SHADOW_PURPLE }, continueGradient: { height: COMP.buttonH, alignItems: 'center', justifyContent: 'center' }, continueText: { fontFamily: FONT.bold, fontSize: FS.base }, error: { flexDirection: 'row', gap: SP.sm, backgroundColor: RED_DIM, padding: SP.md, borderRadius: RADIUS.md }, errorText: { color: RED, flex: 1, fontFamily: FONT.medium, fontSize: FS.sm, lineHeight: 20 }, retryButton: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: SP.sm, paddingVertical: 7, paddingHorizontal: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: RED }, retryText: { color: RED, fontFamily: FONT.semibold, fontSize: FS.sm },
  confirmation: { alignItems: 'center', paddingTop: SP.xl, position: 'relative', overflow: 'hidden' },
  confettiLayer: { position: 'absolute', top: 0, left: 0, right: 0, height: 220 },
  confetti: { position: 'absolute', top: 0, width: 8, height: 14, borderRadius: 2 },
  successHalo: { width: 112, height: 112, borderRadius: 56, backgroundColor: SUCCESS_DIM, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md },
  confirmIcon: { width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center', backgroundColor: SUCCESS },
  confirmEyebrow: { color: SUCCESS, fontFamily: FONT.bold, fontSize: 10, letterSpacing: 1.8, marginBottom: 7 },
  headline: { color: FG, fontFamily: FONT.extrabold, fontSize: FS.h1, letterSpacing: -1.2, marginBottom: SP.sm },
  confirmText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, textAlign: 'center', maxWidth: 330 },
  deliveryHero: { width: '100%', alignItems: 'center', backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.xl, padding: SP.lg, marginTop: SP.xl },
  deliveryIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm },
  deliveryLabel: { color: SUBTLE, fontFamily: FONT.bold, fontSize: 9, letterSpacing: 1.5, marginBottom: 5 },
  deliveryDate: { color: FG, fontFamily: FONT.extrabold, fontSize: FS.xl, textAlign: 'center', letterSpacing: -0.35 },
  deliverySub: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 6, textAlign: 'center' },
  confirmItems: { width: '100%', marginTop: SP.xl },
  confirmItemsLabel: { color: SUBTLE, fontFamily: FONT.bold, fontSize: 9, letterSpacing: 1.35, marginBottom: SP.sm },
  confirmItemsRow: { gap: 10, paddingRight: SP.md },
  confirmProduct: { width: 112 },
  confirmProductImage: { width: 112, height: 126, borderRadius: RADIUS.md, backgroundColor: CARD },
  confirmProductFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  confirmQty: { position: 'absolute', top: 7, right: 7, minWidth: 23, height: 23, paddingHorizontal: 5, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center' },
  confirmQtyText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: 10 },
  confirmProductName: { color: FG, fontFamily: FONT.semibold, fontSize: FS.xs, lineHeight: 16, marginTop: 7 },
  confirmProductVariant: { color: MUTED, fontFamily: FONT.regular, fontSize: 10, marginTop: 2 },
  orderNumbers: { width: '100%', marginTop: SP.lg, backgroundColor: CARD, borderRadius: RADIUS.md, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  orderNumber: { color: FG, fontFamily: FONT.bold, fontSize: FS.sm, textAlign: 'center', paddingVertical: 3 },
  refreshButton: { borderWidth: 1, borderColor: PURPLE, borderRadius: RADIUS.md, paddingHorizontal: SP.lg, paddingVertical: SP.sm, marginTop: SP.lg },
  refreshText: { color: PURPLE_LIGHT, fontFamily: FONT.bold, fontSize: FS.sm },
  createAccountBtn: { backgroundColor: PURPLE, height: COMP.buttonH, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' }, createAccountText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.base },
  continueShopBtn: { borderWidth: 1, borderColor: BORDER, height: COMP.buttonH, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' }, continueShopText: { color: FG, fontFamily: FONT.bold, fontSize: FS.base },
  savedAddressCard: { padding: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm }, savedAddressCardActive: { borderColor: PURPLE, backgroundColor: PURPLE_DIM },
  addNewAddressBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, borderStyle: 'dashed' }, addNewAddressText: { color: PURPLE_LIGHT, fontFamily: FONT.semibold, fontSize: FS.sm },
  useSavedBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SP.sm }, useSavedText: { color: PURPLE_LIGHT, fontFamily: FONT.semibold, fontSize: FS.sm },
  defaultBadge: { backgroundColor: SUCCESS_DIM, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }, defaultBadgeText: { color: SUCCESS, fontFamily: FONT.bold, fontSize: 10, textTransform: 'uppercase' },
  });
};