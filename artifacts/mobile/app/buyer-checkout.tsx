/**
 * Buyer checkout — single canonical route for all purchase paths.
 * Adapted from Depop iOS interaction sequence:
 *   1. Checkout summary with compact item rows, editable shipping/payment rows, persistent Pay action
 *   2. Address: two-step (fields → normalized preview with recipient/phone/email)
 *   3. Payment: Stripe hosted session, server revalidation, integer cents, multi-seller
 *   4. Confirmation: Brandthread thank-you, Message seller, View purchase, delivery estimate
 *
 * Stripe Checkout is the sole payment entry point; card data is never collected here.
 * source param carries attribution; thread-checkout.tsx is a redirect alias.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View, Animated, Image,
  KeyboardAvoidingView, Modal,
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
  SP, SUCCESS, SUCCESS_DIM, SUBTLE, COMP, ICON, ORANGE, ORANGE_DIM,
} from '@/lib/theme';
import { formatCents } from '@/lib/money';
import {
  getCheckoutBlockingSection,
  getFirstIncompleteCheckoutSection,
  mergeCheckoutFormState,
} from '@/lib/checkoutReadiness';
import { CheckoutSkeleton, HapticSwitch } from '@/components/BrandthreadUI';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS: CheckoutStep[] = ['information', 'delivery', 'review', 'confirmation'];
const money = formatCents;

/**
 * A fully verified order reference returned from the server after Stripe payment.
 * `id`     — server-assigned UUID / numeric ID used for all API calls and navigation.
 * `number` — human-readable display string shown to the buyer (e.g. "BT-1234").
 */
export interface VerifiedOrder {
  id: string;
  number: string;
  sellerId: string;
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  return <View style={[s.card, style]}>{children}</View>;
}

function Input({
  label, value, onChange, keyboardType = 'default', autoCapitalize = 'sentences',
  placeholder, multiline, numberOfLines,
}: {
  label: string; value: string; onChange: (v: string) => void;
  keyboardType?: any; autoCapitalize?: any; placeholder?: string;
  multiline?: boolean; numberOfLines?: number;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        placeholder={placeholder ?? label}
        placeholderTextColor={SUBTLE}
        accessibilityLabel={label}
        style={[s.input, multiline && { minHeight: 72, textAlignVertical: 'top' }]}
        multiline={multiline}
        numberOfLines={numberOfLines}
      />
    </View>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function Progress({ step }: { step: CheckoutStep }) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const index = Math.max(0, STEPS.indexOf(step));
  return (
    <View style={s.progress}>
      {STEPS.slice(0, 3).map((item, i) => (
        <View key={item} style={[s.progressSegment, i <= index && s.progressSegmentActive]} />
      ))}
    </View>
  );
}

// ─── Guided section accordion ─────────────────────────────────────────────────

type GuidedCheckoutSection = 'information' | 'delivery' | 'review';

function GuidedSection({
  title, summary, expanded, complete, onPress, children,
}: {
  title: string; summary: string; expanded: boolean; complete: boolean;
  onPress: () => void; children: React.ReactNode;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  return (
    <View style={s.guidedSection}>
      <TouchableOpacity
        style={s.guidedHeader}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}. ${summary}`}
      >
        <View style={[s.guidedStatus, complete && s.guidedStatusComplete]}>
          <Feather name={complete ? 'check' : 'circle'} size={14} color={complete ? BG : MUTED} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.guidedTitle}>{title}</Text>
          <Text style={s.guidedSummary} numberOfLines={1}>{summary}</Text>
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={19} color={MUTED} />
      </TouchableOpacity>
      {expanded && <View style={s.guidedBody}>{children}</View>}
    </View>
  );
}

// ─── Receipt bottom sheet ─────────────────────────────────────────────────────

function ReceiptSheet({
  session, visible, onClose,
}: {
  session: CheckoutSession; visible: boolean; onClose: () => void;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <TouchableOpacity style={s.sheetBackdrop} activeOpacity={1} onPress={onClose} accessibilityLabel="Close receipt" />
      <View style={[s.sheetContainer, { paddingBottom: insets.bottom + SP.md }]}>
        <View style={s.sheetHandle} />
        <View style={s.sheetHeaderRow}>
          <Text style={s.sheetTitle}>Order summary</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Close">
            <Feather name="x" size={20} color={FG} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {session.deliveryGroups.flatMap(g => g.items).map(item => (
            <View key={item.id} style={s.receiptItemRow}>
              {item.imageUri ? (
                <Image source={{ uri: item.imageUri }} style={s.receiptThumb} resizeMode="cover" />
              ) : (
                <View style={[s.receiptThumb, { alignItems: 'center', justifyContent: 'center', backgroundColor: CARD_ELEVATED }]}>
                  <Feather name="image" size={18} color={SUBTLE} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.receiptItemName} numberOfLines={2}>{item.productName}</Text>
                <Text style={s.receiptItemVariant}>{item.variantTitle}</Text>
                {item.quantity > 1 && <Text style={s.receiptItemVariant}>Qty {item.quantity}</Text>}
              </View>
              <Text style={s.receiptItemPrice}>{money(item.priceCents * item.quantity)}</Text>
            </View>
          ))}

          <View style={s.divider} />
          <View style={s.line}>
            <Text style={s.muted}>Subtotal</Text>
            <Text style={s.lineName}>{money(session.summary.subtotalCents)}</Text>
          </View>
          {session.summary.discountTotalCents > 0 && (
            <View style={s.line}>
              <Text style={s.muted}>Discount</Text>
              <Text style={[s.lineName, { color: SUCCESS }]}>−{money(session.summary.discountTotalCents)}</Text>
            </View>
          )}
          <View style={s.line}>
            <Text style={s.muted}>Shipping</Text>
            <Text style={s.lineName}>
              {session.summary.shippingTotalCents === 0 ? (
                <Text style={{ color: SUCCESS }}>Free</Text>
              ) : money(session.summary.shippingTotalCents)}
            </Text>
          </View>
          <View style={s.line}>
            <Text style={s.muted}>Tax</Text>
            <Text style={s.lineName}>{money(session.summary.taxTotalCents)}</Text>
          </View>
          <View style={s.divider} />
          <View style={s.line}>
            <Text style={s.total}>Total</Text>
            <Text style={s.total}>{money(session.summary.totalCents)}</Text>
          </View>
          <Text style={[s.muted, { fontSize: FS.xs, textAlign: 'center', marginTop: SP.sm, lineHeight: 18 }]}>
            Final amount confirmed by Stripe Checkout. Tax calculated at payment.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Checkout Summary (Depop-pattern compact rows) ────────────────────────────

function CheckoutSummaryView({
  session, onTapSummary, onTapShipping, onTapAddress,
}: {
  session: CheckoutSession;
  onTapSummary: () => void;
  onTapShipping: () => void;
  onTapAddress: () => void;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const addr = session.shippingAddress;
  const addressLine = addr
    ? `${addr.line1}, ${addr.city}`
    : 'Add new address';

  return (
    <Card>
      {/* Item rows */}
      {session.deliveryGroups.flatMap(g => g.items).map(item => (
        <View key={item.id} style={s.summaryItemRow}>
          {item.imageUri ? (
            <Image source={{ uri: item.imageUri }} style={s.summaryThumb} resizeMode="cover" />
          ) : (
            <View style={[s.summaryThumb, { alignItems: 'center', justifyContent: 'center', backgroundColor: CARD_ELEVATED }]}>
              <Feather name="image" size={14} color={SUBTLE} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.summaryItemName} numberOfLines={2}>{item.productName}</Text>
            <Text style={s.summaryItemVariant}>{item.variantTitle}</Text>
            {item.isPreOrder && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <Feather name="clock" size={10} color={theme.secondary} />
                <Text style={[s.summaryItemVariant, { color: theme.secondary }]}>Pre-order</Text>
              </View>
            )}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.summaryItemPrice}>{money(item.priceCents * item.quantity)}</Text>
            {item.quantity > 1 && <Text style={s.summaryItemVariant}>×{item.quantity}</Text>}
          </View>
        </View>
      ))}

      <View style={s.divider} />

      {/* Tappable summary total row */}
      <TouchableOpacity
        style={s.summaryTotalRow}
        onPress={onTapSummary}
        accessibilityRole="button"
        accessibilityLabel={`Total ${money(session.summary.totalCents)}. Tap to view receipt breakdown.`}
      >
        <View style={{ flex: 1 }}>
          <Text style={s.summaryTotalLabel}>Total: {money(session.summary.totalCents)}</Text>
          {session.summary.shippingTotalCents === 0 && (
            <Text style={s.freeShippingLabel}>Free shipping</Text>
          )}
        </View>
        <Feather name="chevron-right" size={18} color={MUTED} />
      </TouchableOpacity>

      <View style={s.divider} />

      {/* Editable shipping method */}
      <TouchableOpacity
        style={s.summaryEditRow}
        onPress={onTapShipping}
        accessibilityRole="button"
        accessibilityLabel="Change shipping method"
      >
        <Feather name="truck" size={15} color={MUTED} />
        <View style={{ flex: 1 }}>
          <Text style={s.summaryEditLabel}>Shipping</Text>
          {session.deliveryGroups.map(g => {
            const m = g.availableMethods.find(x => x.id === g.selectedMethodId);
            return m ? (
              <Text key={g.sellerId} style={s.summaryEditValue} numberOfLines={1}>
                {m.service} · {money(m.priceCents)}
              </Text>
            ) : (
              <Text key={g.sellerId} style={[s.summaryEditValue, { color: ORANGE }]}>Choose shipping</Text>
            );
          })}
        </View>
        <Feather name="chevron-right" size={16} color={MUTED} />
      </TouchableOpacity>

      {/* Editable Ships to */}
      <TouchableOpacity
        style={s.summaryEditRow}
        onPress={onTapAddress}
        accessibilityRole="button"
        accessibilityLabel="Change shipping address"
      >
        <Feather name="map-pin" size={15} color={MUTED} />
        <View style={{ flex: 1 }}>
          <Text style={s.summaryEditLabel}>Ships to</Text>
          <Text style={s.summaryEditValue} numberOfLines={1}>{addressLine}</Text>
        </View>
        <Feather name="chevron-right" size={16} color={MUTED} />
      </TouchableOpacity>
    </Card>
  );
}

// ─── Address two-step flow ────────────────────────────────────────────────────

type AddressStep = 'fields' | 'preview';

function AddressEditor({
  address, contact, onAddress, onContact, savedAddresses, onSelectAddress, onDone,
}: {
  address: Partial<CheckoutAddress> & { saveAddress?: boolean; label?: string };
  contact: Partial<CheckoutContact>;
  onAddress: (v: Partial<CheckoutAddress> & { saveAddress?: boolean; label?: string }) => void;
  onContact: (v: Partial<CheckoutContact>) => void;
  savedAddresses: any[];
  onSelectAddress: (addr: any) => void;
  onDone: () => void;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const { isSignedIn } = useAuth();
  const insets = useSafeAreaInsets();
  const PURPLE = theme.accent;
  const PURPLE_LIGHT = theme.accentLight;
  const PURPLE_DIM = theme.accentDim;

  const [addrStep, setAddrStep] = useState<AddressStep>('fields');
  const [showSaved, setShowSaved] = useState(isSignedIn && savedAddresses.length > 0 && !!address.id);

  const validateFields = () => {
    if (!address.line1?.trim() || !address.city?.trim() || !address.state?.trim() || !address.postalCode?.trim() || !address.country?.trim()) {
      Alert.alert('Missing fields', 'Please fill in address, city, state, postal code, and country.');
      return false;
    }
    return true;
  };

  const handleFieldsContinue = () => {
    if (!validateFields()) return;
    setAddrStep('preview');
  };

  const handlePreviewConfirm = () => {
    if (!contact.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
      Alert.alert('Email required', 'Enter a valid email address to receive order confirmation.');
      return;
    }
    onDone();
  };

  if (showSaved) {
    return (
      <View>
        <Text style={s.sectionTitle}>Saved addresses</Text>
        {savedAddresses.map(addr => {
          const isSelected = address.id === addr.id;
          return (
            <TouchableOpacity
              key={addr.id}
              style={[s.savedAddressCard, isSelected && { borderColor: PURPLE, backgroundColor: PURPLE_DIM }]}
              onPress={() => onSelectAddress(addr)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${addr.label ?? 'Address'}, ${addr.recipientName}, ${addr.street}, ${addr.city}, ${addr.state} ${addr.postalCode}`}
            >
              <View style={[s.radio, isSelected && { borderColor: PURPLE, backgroundColor: PURPLE }]} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
                  <Text style={s.methodTitle}>{addr.label ?? 'Saved Address'}</Text>
                  {isSelected && (
                    <View style={s.selectedBadge}><Text style={s.selectedBadgeText}>Selected</Text></View>
                  )}
                  {addr.isDefault && (
                    <View style={s.defaultBadge}><Text style={s.defaultBadgeText}>Default</Text></View>
                  )}
                </View>
                <Text style={s.muted}>{addr.recipientName}</Text>
                <Text style={s.muted}>{addr.street}{addr.line2 ? `, ${addr.line2}` : ''}</Text>
                <Text style={s.muted}>{addr.city}, {addr.state} {addr.postalCode}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          style={s.addNewAddressBtn}
          onPress={() => { onAddress({ country: 'US' }); setShowSaved(false); setAddrStep('fields'); }}
          accessibilityRole="button"
          accessibilityLabel="Add a new address"
        >
          <Feather name="plus" size={16} color={PURPLE_LIGHT} />
          <Text style={[s.addNewAddressText, { color: PURPLE_LIGHT }]}>Add new address</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.continueBtn, { backgroundColor: PURPLE, marginTop: SP.md }]}
          onPress={() => { if (address.id) onDone(); else Alert.alert('Select an address', 'Choose a saved address or add a new one.'); }}
          accessibilityRole="button"
          accessibilityLabel="Continue with selected address"
        >
          <Text style={[s.continueBtnText, { color: theme.onAccent }]}>Continue</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Step A: Address fields
  if (addrStep === 'fields') {
    return (
      <View>
        {isSignedIn && savedAddresses.length > 0 && (
          <TouchableOpacity
            style={s.useSavedBtn}
            onPress={() => setShowSaved(true)}
            accessibilityRole="button"
            accessibilityLabel="Use a saved address"
          >
            <Feather name="arrow-left" size={14} color={PURPLE_LIGHT} />
            <Text style={[s.useSavedText, { color: PURPLE_LIGHT }]}>Use a saved address</Text>
          </TouchableOpacity>
        )}

        <Input label="Address line 1" value={address.line1 ?? ''} onChange={v => onAddress({ ...address, line1: v })} />
        <Input label="Address line 2" placeholder="Optional" value={address.line2 ?? ''} onChange={v => onAddress({ ...address, line2: v })} />
        <Input label="City" value={address.city ?? ''} onChange={v => onAddress({ ...address, city: v })} />

        <View style={s.twoCol}>
          <View style={{ flex: 1 }}>
            <Input label="State / Province or region" value={address.state ?? ''} autoCapitalize="characters" onChange={v => onAddress({ ...address, state: v })} />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Zip or postal code" value={address.postalCode ?? ''} autoCapitalize="characters" onChange={v => onAddress({ ...address, postalCode: v })} />
          </View>
        </View>

        <Input label="Country" value={address.country ?? 'US'} autoCapitalize="characters" onChange={v => onAddress({ ...address, country: v })} />

        {isSignedIn && (
          <>
            <View style={s.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.toggleTitle}>Save this address</Text>
                <Text style={s.muted}>Save to your address book</Text>
              </View>
              <HapticSwitch
                value={address.saveAddress !== false}
                onValueChange={v => onAddress({ ...address, saveAddress: v })}
                trackColor={{ true: PURPLE }}
              />
            </View>
            {address.saveAddress !== false && (
              <Input
                label="Address label (e.g. Home, Office)"
                value={address.label ?? ''}
                onChange={v => onAddress({ ...address, label: v })}
              />
            )}
          </>
        )}

        <TouchableOpacity
          style={[s.continueBtn, { backgroundColor: PURPLE, marginTop: SP.md }]}
          onPress={handleFieldsContinue}
          accessibilityRole="button"
          accessibilityLabel="Continue to address confirmation"
        >
          <Text style={[s.continueBtnText, { color: theme.onAccent }]}>Continue</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Step B: Normalized preview — recipient name, phone, email
  const addrPreview = [
    address.line1,
    address.line2,
    `${address.city}, ${address.state} ${address.postalCode}`,
    address.country,
  ].filter(Boolean).join('\n');

  return (
    <View>
      <Text style={[s.sectionTitle, { marginBottom: SP.xs }]}>Confirm address and details</Text>

      {/* Normalized address preview card */}
      <View style={[s.card, { marginBottom: SP.md, backgroundColor: CARD_ELEVATED }]}>
        <Text style={[s.muted, { lineHeight: 22 }]}>{addrPreview}</Text>
      </View>

      <View style={s.twoCol}>
        <View style={{ flex: 1 }}>
          <Input
            label="First name"
            value={address.firstName ?? ''}
            onChange={v => onAddress({ ...address, firstName: v })}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            label="Last name"
            value={address.lastName ?? ''}
            onChange={v => onAddress({ ...address, lastName: v })}
          />
        </View>
      </View>

      <Input
        label="Phone number"
        placeholder="Optional"
        value={contact.phone ?? ''}
        keyboardType="phone-pad"
        autoCapitalize="none"
        onChange={v => onContact({ ...contact, phone: v })}
      />

      <Input
        label="Email"
        value={contact.email ?? ''}
        keyboardType="email-address"
        autoCapitalize="none"
        onChange={v => onContact({ ...contact, email: v })}
      />

      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SP.md }}
        onPress={() => setAddrStep('fields')}
        accessibilityRole="button"
        accessibilityLabel="Edit address fields"
      >
        <Feather name="arrow-left" size={14} color={PURPLE_LIGHT} />
        <Text style={[s.useSavedText, { color: PURPLE_LIGHT }]}>Edit address</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.continueBtn, { backgroundColor: PURPLE }]}
        onPress={handlePreviewConfirm}
        accessibilityRole="button"
        accessibilityLabel="Confirm and add address"
      >
        <Text style={[s.continueBtnText, { color: theme.onAccent }]}>Confirm and add address</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Information section (contact + address) ──────────────────────────────────

function Information({
  contact, address, onContact, onAddress, savedAddresses, onSelectAddress,
}: {
  contact: Partial<CheckoutContact>;
  address: Partial<CheckoutAddress> & { saveAddress?: boolean; label?: string };
  onContact: (v: Partial<CheckoutContact>) => void;
  onAddress: (v: Partial<CheckoutAddress> & { saveAddress?: boolean; label?: string }) => void;
  savedAddresses: any[];
  onSelectAddress: (addr: any) => void;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const { isSignedIn } = useAuth();
  const PURPLE = theme.accent;
  const PURPLE_LIGHT = theme.accentLight;
  const [addrModalVisible, setAddrModalVisible] = useState(false);
  const insets = useSafeAreaInsets();

  return (
    <>
      {!isSignedIn && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Feather name="info" size={16} color={PURPLE} />
            <Text style={[s.sectionTitle, { marginBottom: 0 }]}>Guest Checkout</Text>
          </View>
          <Text style={s.muted}>Your email is used for receipts. Your address is used for this order only.</Text>
        </Card>
      )}

      <Card>
        <Text style={s.sectionTitle}>Contact</Text>
        <Input
          label="Email"
          value={contact.email ?? ''}
          keyboardType="email-address"
          autoCapitalize="none"
          onChange={v => onContact({ ...contact, email: v })}
        />
        <Input
          label="Phone (optional)"
          value={contact.phone ?? ''}
          keyboardType="phone-pad"
          onChange={v => onContact({ ...contact, phone: v })}
        />
        <View style={s.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.toggleTitle}>Order updates</Text>
            <Text style={s.muted}>Email updates about your order</Text>
          </View>
          <HapticSwitch
            value={contact.orderUpdates !== 'none'}
            onValueChange={v => onContact({ ...contact, orderUpdates: v ? 'email' : 'none' })}
            trackColor={{ true: PURPLE }}
          />
        </View>
      </Card>

      <Card>
        <Text style={s.sectionTitle}>Shipping address</Text>

        {/* Address summary row — tapping opens the two-step modal */}
        {address.line1 ? (
          <View style={{ marginBottom: SP.sm }}>
            <Text style={s.muted}>{address.line1}{address.line2 ? `, ${address.line2}` : ''}</Text>
            <Text style={s.muted}>{address.city}, {address.state} {address.postalCode}</Text>
            <Text style={s.muted}>{address.country}</Text>
            {(address.firstName || address.lastName) && (
              <Text style={s.muted}>{address.firstName} {address.lastName}</Text>
            )}
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SP.sm }}
              onPress={() => setAddrModalVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Edit shipping address"
            >
              <Feather name="edit-2" size={13} color={PURPLE_LIGHT} />
              <Text style={{ color: PURPLE_LIGHT, fontFamily: FONT.semibold, fontSize: FS.sm }}>Edit address</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={s.addNewAddressBtn}
            onPress={() => setAddrModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Add shipping address"
          >
            <Feather name="plus" size={16} color={PURPLE_LIGHT} />
            <Text style={[s.addNewAddressText, { color: PURPLE_LIGHT }]}>Add new address</Text>
          </TouchableOpacity>
        )}

        {/* Address editor modal */}
        <Modal
          visible={addrModalVisible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setAddrModalVisible(false)}
        >
          <KeyboardAvoidingView
            style={{ flex: 1, backgroundColor: BG }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingTop: insets.top + SP.sm, paddingBottom: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER }}>
              <Text style={{ fontFamily: FONT.bold, fontSize: FS.base, color: FG }}>Add new address</Text>
              <TouchableOpacity onPress={() => setAddrModalVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Close">
                <Feather name="x" size={20} color={FG} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
              <AddressEditor
                address={address}
                contact={contact}
                onAddress={onAddress}
                onContact={onContact}
                savedAddresses={savedAddresses}
                onSelectAddress={onSelectAddress}
                onDone={() => setAddrModalVisible(false)}
              />
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
      </Card>
    </>
  );
}

// ─── Delivery section ─────────────────────────────────────────────────────────

function Delivery({
  session, onSelect, onApply, onRemove,
}: {
  session: CheckoutSession;
  onSelect: (sellerId: string, methodId: string) => void;
  onApply: (code: string) => Promise<void>;
  onRemove: (code: string) => void;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const PURPLE = theme.accent;
  const PURPLE_LIGHT = theme.accentLight;
  const PURPLE_DIM = theme.accentDim;
  const [showPromo, setShowPromo] = useState(session.discounts.length > 0);
  const [code, setCode] = useState('');
  const [applying, setApplying] = useState(false);

  return (
    <>
      {session.deliveryGroups.map(group => (
        <Card key={group.sellerId}>
          <Text style={s.sectionTitle}>Delivery from {group.sellerName}</Text>
          {group.availableMethods.map(method => (
            <TouchableOpacity
              key={method.id}
              style={[s.method, group.selectedMethodId === method.id && { backgroundColor: PURPLE_DIM }]}
              onPress={() => onSelect(group.sellerId, method.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: group.selectedMethodId === method.id }}
              accessibilityLabel={`${method.service}, ${method.estimatedDelivery}, ${money(method.priceCents)}`}
            >
              <View style={[s.radio, group.selectedMethodId === method.id && { borderColor: PURPLE, backgroundColor: PURPLE }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.methodTitle}>{method.service}</Text>
                <Text style={s.muted}>{method.estimatedDelivery}</Text>
              </View>
              <Text style={[s.methodTitle, method.priceCents === 0 && { color: SUCCESS }]}>
                {method.priceCents === 0 ? 'Free' : money(method.priceCents)}
              </Text>
            </TouchableOpacity>
          ))}
        </Card>
      ))}

      <Card>
        <TouchableOpacity
          style={s.promoToggle}
          onPress={() => setShowPromo(v => !v)}
          accessibilityRole="button"
          accessibilityLabel="Have a promo code?"
          accessibilityState={{ expanded: showPromo }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm }}>
            <Feather name="tag" size={16} color={PURPLE_LIGHT} />
            <Text style={s.sectionTitle}>Have a promo code?</Text>
          </View>
          <Feather name={showPromo ? 'chevron-up' : 'chevron-down'} size={18} color={MUTED} />
        </TouchableOpacity>
        {showPromo && (
          <>
            <View style={s.promoRow}>
              <TextInput
                value={code}
                onChangeText={setCode}
                autoCapitalize="characters"
                placeholder="Enter code"
                placeholderTextColor={SUBTLE}
                accessibilityLabel="Promo code"
                style={[s.input, { flex: 1, marginBottom: 0 }]}
              />
              <TouchableOpacity
                style={[s.applyButton, { backgroundColor: PURPLE_DIM }]}
                disabled={applying || !code.trim()}
                onPress={async () => {
                  setApplying(true);
                  await onApply(code);
                  setCode('');
                  setApplying(false);
                }}
                accessibilityRole="button"
                accessibilityLabel="Apply promo code"
                accessibilityState={{ disabled: applying || !code.trim(), busy: applying }}
              >
                <Text style={[s.applyText, { color: PURPLE_LIGHT }]}>{applying ? '…' : 'Apply'}</Text>
              </TouchableOpacity>
            </View>
            {session.discounts.map(discount => (
              <View style={s.discountRow} key={discount.code}>
                <Text style={[s.discountText, !discount.isValid && { color: RED }]}>
                  {discount.isValid ? `${discount.code} · ${discount.description}` : discount.errorMessage}
                </Text>
                <TouchableOpacity
                  onPress={() => onRemove(discount.code)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove promo code ${discount.code}`}
                >
                  <Text style={[s.removeText, { color: PURPLE_LIGHT }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
      </Card>
    </>
  );
}

// ─── Review section ───────────────────────────────────────────────────────────

function Review({
  session, onAck,
}: {
  session: CheckoutSession;
  onAck: (key: string, checked: boolean) => void;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const { isSignedIn } = useAuth();
  const PURPLE = theme.accent;
  const PURPLE_LIGHT = theme.accentLight;
  const PURPLE_DIM = theme.accentDim;
  const CYAN = theme.secondary;
  const addr = session.shippingAddress;

  return (
    <>
      <Card>
        <Text style={s.sectionTitle}>Review your order</Text>
        {addr && (
          <Text style={s.address}>
            {addr.firstName} {addr.lastName}{'\n'}
            {addr.line1}{'\n'}
            {addr.city}, {addr.state} {addr.postalCode}
          </Text>
        )}
        {session.deliveryGroups.flatMap(g => g.items).map(item => (
          <View key={item.id} style={s.line}>
            <View style={{ flex: 1 }}>
              <Text style={s.lineName}>{item.productName}</Text>
              <Text style={s.muted}>{item.variantTitle} · Qty {item.quantity}</Text>
            </View>
            <Text style={s.lineName}>{money(item.priceCents * item.quantity)}</Text>
          </View>
        ))}
        <View style={s.divider} />
        <View style={s.line}>
          <Text style={s.muted}>Subtotal</Text>
          <Text style={s.lineName}>{money(session.summary.subtotalCents)}</Text>
        </View>
        {session.summary.discountTotalCents > 0 && (
          <View style={s.line}>
            <Text style={s.muted}>Discount</Text>
            <Text style={[s.lineName, { color: SUCCESS }]}>−{money(session.summary.discountTotalCents)}</Text>
          </View>
        )}
        <View style={s.line}>
          <Text style={s.muted}>Shipping</Text>
          <Text style={[s.lineName, session.summary.shippingTotalCents === 0 && { color: SUCCESS }]}>
            {session.summary.shippingTotalCents === 0 ? 'Free' : money(session.summary.shippingTotalCents)}
          </Text>
        </View>
        <View style={s.line}>
          <Text style={s.muted}>Tax</Text>
          <Text style={s.lineName}>{money(session.summary.taxTotalCents)}</Text>
        </View>
        <View style={s.divider} />
        <View style={s.line}>
          <Text style={s.total}>Total</Text>
          <Text style={s.total}>{money(session.summary.totalCents)}</Text>
        </View>
      </Card>

      {session.deliveryGroups.length > 1 && (
        <View style={s.multiSeller}>
          <Feather name="layers" size={16} color={CYAN} />
          <Text style={[s.multiSellerText, { color: CYAN }]}>
            Your cart contains items from {session.deliveryGroups.length} sellers. You'll complete a separate secure Stripe payment for each seller.
          </Text>
        </View>
      )}

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm }}>
          <Feather name="lock" size={17} color={PURPLE_LIGHT} />
          <View style={{ flex: 1 }}>
            <Text style={s.sectionTitle}>Pay securely with Stripe</Text>
            <Text style={s.muted}>
              You'll enter your payment details in Stripe Checkout. Brandthread never collects card numbers.
            </Text>
          </View>
        </View>
        <Text style={[s.muted, { marginTop: SP.sm }]}>
          {isSignedIn
            ? 'Cards saved from earlier purchases will appear automatically in Stripe Checkout.'
            : 'Your payment details stay with Stripe and are not saved to a Brandthread account.'}
        </Text>
      </Card>

      {session.acknowledgments.map(ack => (
        <TouchableOpacity
          key={ack.key}
          style={s.ack}
          onPress={() => onAck(ack.key, !ack.acknowledged)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: ack.acknowledged }}
          accessibilityLabel={ack.label}
          accessibilityHint={ack.required ? 'Required before payment' : undefined}
        >
          <View style={[s.checkbox, ack.acknowledged && { backgroundColor: PURPLE, borderColor: PURPLE }]}>
            {ack.acknowledged && <Feather name="check" size={12} color={ON_DARK} />}
          </View>
          <Text style={s.ackText}>{ack.label}</Text>
        </TouchableOpacity>
      ))}
    </>
  );
}

// ─── Confirmation screen ──────────────────────────────────────────────────────

const CONFETTI = [
  { left: '5%', color: SUCCESS, delay: 0, x: -14 },
  { left: '13%', color: 'accent', delay: 90, x: 18 },
  { left: '22%', color: 'secondary', delay: 180, x: -8 },
  { left: '31%', color: 'secondary', delay: 50, x: 14 },
  { left: '42%', color: '#F87171', delay: 230, x: -18 },
  { left: '53%', color: SUCCESS, delay: 110, x: 10 },
  { left: '64%', color: 'accent', delay: 20, x: -12 },
  { left: '73%', color: 'secondary', delay: 260, x: 17 },
  { left: '82%', color: 'secondary', delay: 140, x: -10 },
  { left: '92%', color: '#F87171', delay: 70, x: 13 },
] as const;

function Confirmation({
  session, verifiedOrders, finalizing, onRefresh, refreshing,
}: {
  session: CheckoutSession;
  /** Fully verified orders with server IDs. Empty when still finalizing. */
  verifiedOrders: VerifiedOrder[];
  finalizing: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const PURPLE = theme.accent;
  const PURPLE_LIGHT = theme.accentLight;

  const checkScale = useRef(new Animated.Value(0)).current;
  const confettiProgress = useRef(new Animated.Value(0)).current;

  const orderItems = session.deliveryGroups.flatMap(g => g.items);
  const deliveryEstimates = session.deliveryGroups
    .map(g => g.availableMethods.find(m => m.id === g.selectedMethodId)?.estimatedDelivery)
    .filter((v): v is string => !!v);
  const preOrderEstimates = orderItems.map(i => i.preOrderEstShipDate).filter((v): v is string => !!v);
  const estimateLabels = [...new Set([...deliveryEstimates, ...preOrderEstimates])];
  const primaryEstimate = estimateLabels[0] ?? 'Tracking updates coming soon';

  const firstGroup = session.deliveryGroups[0];
  const contactEmail = session.contact?.email ?? '';

  // First verified order — used for navigation. Only set once we have a real server ID.
  const firstVerified = verifiedOrders[0] ?? null;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(checkScale, { toValue: 1, useNativeDriver: true, tension: 62, friction: 6 }),
      Animated.timing(confettiProgress, { toValue: 1, duration: 1250, useNativeDriver: true }),
    ]).start();
  }, []);

  function handleMessageSeller() {
    if (!firstGroup) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const initials = firstGroup.sellerName.split(/\s+/).map(w => w[0] ?? '').slice(0, 2).join('').toUpperCase();
    // Use the display order number (not the ID) purely as context metadata in the conversation
    const contextOrderNumber = firstVerified?.number ?? '';
    router.push((
      '/buyer-conversation?participantId=' + encodeURIComponent(firstGroup.sellerId) +
      '&participantName=' + encodeURIComponent(firstGroup.sellerName) +
      '&participantHandle=' + encodeURIComponent('') +
      '&participantInitials=' + encodeURIComponent(initials) +
      '&participantColor=' + encodeURIComponent(PURPLE) +
      '&participantAccountType=seller' +
      '&type=buyer_to_seller_order' +
      '&contextOrderNumber=' + encodeURIComponent(contextOrderNumber)
    ) as never);
  }

  function handleViewPurchase() {
    // ONLY navigate when we have a verified server order ID — never fall back to orderNumber.
    if (!firstVerified?.id) return;
    router.push(('/buyer-order-detail?id=' + encodeURIComponent(firstVerified.id)) as never);
  }

  return (
    <View style={s.confirmation}>
      {!finalizing && (
        <View style={s.confettiLayer} pointerEvents="none">
          {CONFETTI.map((particle, index) => (
            <Animated.View
              key={index}
              style={[
                s.confetti,
                {
                  left: particle.left,
                  backgroundColor:
                    particle.color === 'accent' ? theme.accent
                    : particle.color === 'secondary' ? theme.secondary
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

      <View style={s.successHalo}>
        <Animated.View
          style={[
            s.confirmIcon,
            finalizing && { backgroundColor: PURPLE },
            { transform: [{ scale: checkScale }] },
          ]}
        >
          <Feather name={finalizing ? 'clock' : 'check'} size={38} color={ON_DARK} />
        </Animated.View>
      </View>

      <Text style={s.confirmEyebrow}>{finalizing ? 'PAYMENT RECEIVED' : 'PURCHASE COMPLETE'}</Text>
      <Text style={s.headline}>{finalizing ? 'Almost there' : 'Thank you!'}</Text>
      <Text style={s.confirmText}>
        {finalizing
          ? "We're finalizing your order. This can take a moment after payment."
          : contactEmail
            ? `We've sent your order confirmation to\n${contactEmail}`
            : "Your order is confirmed. We'll keep you updated every step of the way."}
      </Text>

      {!finalizing && estimateLabels.length > 0 && (
        <View style={s.deliveryHero}>
          <View style={[s.deliveryIcon, { backgroundColor: theme.accentDim }]}>
            <Feather name="truck" size={22} color={theme.accentLight} />
          </View>
          <Text style={s.deliveryLabel}>ESTIMATED DELIVERY</Text>
          <Text style={s.deliveryDate}>{primaryEstimate}</Text>
          {estimateLabels.length > 1 && (
            <Text style={s.deliverySub}>Your items will arrive in {estimateLabels.length} shipments</Text>
          )}
        </View>
      )}

      {/* Purchased items strip */}
      {orderItems.length > 0 && (
        <View style={s.confirmItems}>
          <Text style={s.confirmItemsLabel}>
            {orderItems.length} {orderItems.length === 1 ? 'ITEM' : 'ITEMS'} IN YOUR ORDER
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.confirmItemsRow}>
            {orderItems.map(item => (
              <View style={s.confirmProduct} key={item.id}>
                {item.imageUri ? (
                  <Image source={{ uri: item.imageUri }} style={s.confirmProductImage} resizeMode="cover" />
                ) : (
                  <View style={[s.confirmProductImage, s.confirmProductFallback]}>
                    <Feather name="image" size={20} color={SUBTLE} />
                  </View>
                )}
                {item.quantity > 1 && (
                  <View style={s.confirmQty}>
                    <Text style={s.confirmQtyText}>{item.quantity}</Text>
                  </View>
                )}
                <Text style={s.confirmProductName} numberOfLines={2}>{item.productName}</Text>
                <Text style={s.confirmProductVariant} numberOfLines={1}>{item.variantTitle}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Order numbers — display only, never used for routing */}
      {verifiedOrders.length > 0 && (
        <View style={s.orderNumbers}>
          {verifiedOrders.map(o => (
            <Text style={s.orderNumber} key={o.id}>{o.number}</Text>
          ))}
        </View>
      )}

      {/* Actions */}
      {finalizing ? (
        <TouchableOpacity
          style={s.refreshButton}
          onPress={onRefresh}
          disabled={refreshing}
          accessibilityRole="button"
          accessibilityLabel="Check order status"
          accessibilityState={{ disabled: refreshing, busy: refreshing }}
        >
          {refreshing
            ? <ActivityIndicator color={PURPLE_LIGHT} />
            : <Text style={[s.refreshText, { color: PURPLE_LIGHT }]}>Check order status</Text>}
        </TouchableOpacity>
      ) : (
        <View style={{ marginTop: SP.xl, width: '100%', gap: SP.sm }}>
          {/* Message seller + View purchase — mirroring Depop Thank you screen */}
          {firstGroup && (
            <View style={{ flexDirection: 'row', gap: SP.sm }}>
              <TouchableOpacity
                style={s.actionBtnOutline}
                onPress={handleMessageSeller}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Message seller"
              >
                <Feather name="message-circle" size={16} color={FG} />
                <Text style={s.actionBtnOutlineText}>Message seller</Text>
              </TouchableOpacity>
              {/*
                "View purchase" is ONLY rendered when we have a verified server order ID.
                If orderId is absent (still finalizing / webhook not yet received),
                this button stays hidden — never falls back to orderNumber for routing.
              */}
              {firstVerified?.id && (
                <TouchableOpacity
                  style={s.actionBtnOutline}
                  onPress={handleViewPurchase}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="View purchase"
                >
                  <Feather name="package" size={16} color={FG} />
                  <Text style={s.actionBtnOutlineText}>View purchase</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {!isSignedIn && (
            <TouchableOpacity
              style={s.createAccountBtn}
              onPress={() => router.replace('/sign-in' as never)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Create an account"
            >
              <Text style={s.createAccountText}>Create an account</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={s.continueShopBtn}
            onPress={() => router.replace('/(buyer)/discover' as never)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Continue shopping"
          >
            <Text style={s.continueShopText}>Continue shopping</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function BuyerCheckoutScreen() {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const PURPLE = theme.accent;
  const PURPLE_LIGHT = theme.accentLight;
  const SHADOW_PURPLE = {
    shadowColor: theme.shadowColor,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  };

  const { source } = useLocalSearchParams<{ source?: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const { back } = useThreadPull();
  // thread-checkout.tsx is a redirect alias — use ThreadPull transition if coming from there
  const usesThreadPull = pathname === '/thread-checkout';
  const leaveCheckout = () => (usesThreadPull ? back() : router.back());
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { isSignedIn } = useAuth();

  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [contact, setContact] = useState<Partial<CheckoutContact>>({ orderUpdates: 'email', marketingConsent: false });
  const [address, setAddress] = useState<Partial<CheckoutAddress> & { saveAddress?: boolean; label?: string }>({ country: 'US' });
  const [savedAddresses, setSavedAddresses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');
  const [canRetryPayment, setCanRetryPayment] = useState(false);
  /**
   * Fully verified orders — each entry has a real server `id` (used for navigation/API)
   * and a human-readable `number` (used for display only).
   */
  const [verifiedOrders, setVerifiedOrders] = useState<VerifiedOrder[]>([]);
  const [pendingSessionIds, setPendingSessionIds] = useState<string[]>([]);
  const [expandedSection, setExpandedSection] = useState<GuidedCheckoutSection>('information');
  const [receiptVisible, setReceiptVisible] = useState(false);
  /**
   * In-memory map: sellerId → verified server order ID.
   * Populated as each Stripe session is verified so we can skip already-paid groups
   * if pay() is called again (retry path) without double-charging.
   */
  const paidRef = useRef(new Map<string, string>());

  // Load / restore checkout session
  useEffect(() => {
    (async () => {
      let next = await getCheckoutSession();
      if (!next) {
        const cart = await getCart();
        if (!cart.items.length) { leaveCheckout(); return; }
        next = await createCheckoutSession(cart, source === 'buynow');
      }
      // Normalize legacy step values
      if (next.step === 'contact' || next.step === 'shipping' || next.step === 'discounts' || next.step === 'payment') {
        next.step = 'information';
      }
      const restoredContact: Partial<CheckoutContact> = next.contact ?? { orderUpdates: 'email', marketingConsent: false };
      const restoredAddress: Partial<CheckoutAddress> & { saveAddress?: boolean; label?: string } =
        next.shippingAddress ?? { country: 'US', saveAddress: true };
      const firstIncomplete = getFirstIncompleteCheckoutSection(restoredContact, restoredAddress, next);
      if (next.step !== 'confirmation') next.step = firstIncomplete;

      setSession(next);
      setContact(restoredContact);
      setAddress(restoredAddress);
      setExpandedSection(firstIncomplete);

      // Restore paid state — only entries with a verified orderId are considered confirmed.
      // Entries with only orderNumber (legacy sessions) are treated as pending until
      // re-verification returns an orderId.
      const restoredVerified: VerifiedOrder[] = [];
      const restoredPending: string[] = [];
      for (const [sellerId, payment] of Object.entries(next.paidGroups ?? {})) {
        if (payment.orderId && payment.orderNumber) {
          // Both id and number present — fully verified.
          restoredVerified.push({ id: payment.orderId, number: payment.orderNumber, sellerId });
          paidRef.current.set(sellerId, payment.orderId);
        } else if (payment.orderId && !payment.orderNumber) {
          // id but no display number (edge case) — still navigable, show id as fallback display.
          restoredVerified.push({ id: payment.orderId, number: payment.orderId, sellerId });
          paidRef.current.set(sellerId, payment.orderId);
        } else {
          // No orderId — needs re-verification against Stripe.
          restoredPending.push(payment.guestAccessToken
            ? `${payment.stripeSessionId}|${payment.guestAccessToken}`
            : payment.stripeSessionId);
        }
      }
      setVerifiedOrders(restoredVerified);
      setPendingSessionIds(restoredPending);

      // Load saved addresses for authenticated users
      if (isSignedIn) {
        try {
          const addresses = await api.buyer.addresses.list();
          setSavedAddresses(addresses);
          if (addresses.length > 0 && !next.shippingAddress) {
            const defaultAddr = addresses.find((a: any) => a.isDefault) || addresses[0];
            handleSelectAddress(defaultAddr);
          }
        } catch {
          // ignore
        }
      }

      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectAddress = (addr: any) => {
    const parts = addr.recipientName ? addr.recipientName.split(' ') : [];
    const firstName = parts[0] || '';
    const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
    setAddress({
      id: addr.id,
      firstName,
      lastName,
      line1: addr.street,
      line2: addr.line2,
      city: addr.city,
      state: addr.state,
      postalCode: addr.postalCode,
      country: addr.country,
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
        current.deliveryGroups.flatMap(g => g.items),
        current.discounts.filter(d => d.isValid).map(d => d.code),
      );
      if (!result.isValid) {
        Alert.alert('Update your cart', result.issues.map(i => `• ${i.message}`).join('\n'));
        return false;
      }
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
      if (current.deliveryGroups.some(g => !g.selectedMethodId)) {
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
    setPlacing(true);
    setError('');
    setCanRetryPayment(false);
    const unresolved: string[] = [];
    // Start from already-verified orders so multi-seller retries accumulate correctly.
    const confirmed: VerifiedOrder[] = [...verifiedOrders];
    const paidGroups = { ...(current.paidGroups ?? {}) };

    try {
      for (const group of current.deliveryGroups) {
        // Skip groups already verified in a previous payment attempt this session.
        if (paidRef.current.has(group.sellerId)) continue;

        let result: any;
        if (isSignedIn) {
          result = await api.buyer.checkout.createSession(
            group.items.map(item => ({ variantId: item.variantId, productId: item.productId, quantity: item.quantity })),
            {
              contactEmail: contact.email,
              shippingAddress: {
                name: `${address.firstName} ${address.lastName}`.trim(),
                street: address.line1!,
                line2: address.line2,
                city: address.city!,
                state: address.state!,
                zip: address.postalCode!,
                country: address.country || 'US',
              },
              clientIdempotencyKey: `${current.idempotencyKey}_${group.sellerId}`,
              ...(current.loyaltyRedemption && current.deliveryGroups.length === 1
                ? { loyaltyToken: current.loyaltyRedemption.token }
                : {}),
            },
          );
        } else {
          result = await api.guest.checkout.createSession(
            group.items.map(item => ({ variantId: item.variantId, productId: item.productId, quantity: item.quantity })),
            {
              contactEmail: contact.email,
              shippingAddress: {
                name: `${address.firstName} ${address.lastName}`.trim(),
                street: address.line1!,
                line2: address.line2,
                city: address.city!,
                state: address.state!,
                zip: address.postalCode!,
                country: address.country || 'US',
              },
              clientIdempotencyKey: `${current.idempotencyKey}_${group.sellerId}`,
            },
          );
        }

        paidGroups[group.sellerId] = {
          stripeSessionId: result.sessionId,
          ...(result.guestAccessToken ? { guestAccessToken: result.guestAccessToken } : {}),
        };
        await persist({ ...current, paidGroups });

        const browser = await WebBrowser.openBrowserAsync(result.url);
        if (browser.type === 'cancel' || browser.type === 'dismiss') {
          setError('Payment was cancelled. Your cart is still saved.');
          setPlacing(false);
          return;
        }

        // Verify with retries — webhook may be slightly behind.
        // We poll for orderId specifically; orderNumber alone is insufficient for navigation.
        let verification: any;
        for (let attempt = 0; attempt < 6; attempt++) {
          if (isSignedIn) {
            verification = await api.buyer.checkout.verifySession(result.sessionId);
          } else {
            verification = await api.guest.checkout.verifySession(result.sessionId, result.guestAccessToken);
          }
          if (verification.orderId || verification.paymentStatus === 'paid') break;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (verification?.paymentStatus !== 'paid') {
          setError(verification?.declineReason ?? 'Your payment was declined. Please try a different card or contact your card issuer.');
          setCanRetryPayment(true);
          setPlacing(false);
          return;
        }

        if (verification.orderId) {
          // Both id (for API/routing) and number (for display) from the verify response.
          const vo: VerifiedOrder = {
            id: verification.orderId,
            number: verification.orderNumber ?? verification.orderId,
            sellerId: group.sellerId,
          };
          confirmed.push(vo);
          paidRef.current.set(group.sellerId, vo.id);
          paidGroups[group.sellerId] = {
            ...paidGroups[group.sellerId],
            orderId: vo.id,
            orderNumber: vo.number,
            amountTotalCents: verification.amountTotal ?? undefined,
          };
          await persist({ ...current, paidGroups });
        } else {
          // orderId not yet available — persist the stripe session for reconciliation.
          unresolved.push(isSignedIn ? result.sessionId : `${result.sessionId}|${result.guestAccessToken}`);
        }
      }

      setVerifiedOrders(confirmed);
      setPendingSessionIds(unresolved);
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
            isDefault: (address as any).isDefault || false,
          });
        } catch {
          // ignore — address save is non-fatal
        }
      }

      await persist({ ...current, paidGroups, step: 'confirmation' });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setError('We could not start secure checkout. Please try again.');
    }
    setPlacing(false);
  };

  const retryPayment = async () => { await pay(); };

  const refreshOrders = useCallback(async () => {
    setPlacing(true);
    const remaining: string[] = [];
    // Start from what we already have; append newly-reconciled orders.
    const found: VerifiedOrder[] = [...verifiedOrders];
    const paidGroups = { ...(current.paidGroups ?? {}) };

    for (const pending of pendingSessionIds) {
      try {
        let result: any;
        const sessionId = pending.includes('|') ? pending.split('|')[0] : pending;
        if (pending.includes('|')) {
          const [sid, token] = pending.split('|');
          result = await api.guest.checkout.verifySession(sid, token);
        } else {
          result = await api.buyer.checkout.verifySession(pending);
        }

        // Only reconcile when the server returns a real orderId, not just an orderNumber.
        if (result.orderId) {
          const sellerId = Object.entries(paidGroups)
            .find(([, payment]) => payment.stripeSessionId === sessionId)?.[0];
          const vo: VerifiedOrder = {
            id: result.orderId,
            number: result.orderNumber ?? result.orderId,
            sellerId: sellerId ?? '',
          };
          found.push(vo);
          if (sellerId) {
            paidRef.current.set(sellerId, vo.id);
            paidGroups[sellerId] = {
              ...paidGroups[sellerId],
              orderId: vo.id,
              orderNumber: vo.number,
              amountTotalCents: result.amountTotal ?? undefined,
            };
          }
        } else {
          remaining.push(pending);
        }
      } catch {
        remaining.push(pending);
      }
    }

    setVerifiedOrders(found);
    setPendingSessionIds(remaining);
    await persist({ ...current, paidGroups, step: 'confirmation' });
    if (!remaining.length) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await clearCart();
    }
    setPlacing(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, current, verifiedOrders, pendingSessionIds]);

  if (loading || !session) return <CheckoutSkeleton />;

  const informationComplete = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email ?? '')
    && !!address.firstName && !!address.lastName && !!address.line1 && !!address.city
    && !!address.state && (address.postalCode ?? '').trim().length >= 3 && !!address.country;
  const deliveryComplete = current.deliveryGroups.every(g => !!g.selectedMethodId);
  const reviewComplete = current.acknowledgments.every(ack => !ack.required || ack.acknowledged);

  const ctaLabel = current.step === 'review'
    ? canRetryPayment ? 'Try a different card' : `Pay securely · ${money(current.summary.totalCents)}`
    : 'Continue';

  return (
    <KeyboardAvoidingView style={s.root} behavior="padding" keyboardVerticalOffset={0}>
      {/* Header */}
      {current.step !== 'confirmation' && (
        <View style={[s.header, { paddingTop: insets.top + SP.xs }]}>
          <TouchableOpacity
            style={s.back}
            onPress={leaveCheckout}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Feather name="chevron-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={s.stepLabel}>Secure checkout</Text>
            <Progress step={current.step} />
          </View>
          <View style={s.back} />
        </View>
      )}

      <ScrollView
        contentContainerStyle={{
          padding: SP.md,
          paddingBottom: insets.bottom + (current.step === 'confirmation' ? 30 : 105),
        }}
        keyboardShouldPersistTaps="handled"
      >
        {current.step !== 'confirmation' && (
          <>
            {/* Compact summary view always visible at top (Depop pattern) */}
            {current.step === 'review' && (
              <CheckoutSummaryView
                session={current}
                onTapSummary={() => setReceiptVisible(true)}
                onTapShipping={() => setExpandedSection('delivery')}
                onTapAddress={() => setExpandedSection('information')}
              />
            )}

            <GuidedSection
              title="Contact & shipping address"
              summary={informationComplete
                ? `${contact.email} · ${address.city}, ${address.state}`
                : 'Add your contact and delivery address'}
              expanded={expandedSection === 'information'}
              complete={informationComplete}
              onPress={() => setExpandedSection('information')}
            >
              <Information
                contact={contact}
                address={address}
                onContact={setContact}
                onAddress={setAddress}
                savedAddresses={savedAddresses}
                onSelectAddress={handleSelectAddress}
              />
            </GuidedSection>

            <GuidedSection
              title="Delivery & promo"
              summary={deliveryComplete
                ? `${current.deliveryGroups.length} delivery choice${current.deliveryGroups.length === 1 ? '' : 's'} selected`
                : 'Choose delivery and add a promo code'}
              expanded={expandedSection === 'delivery'}
              complete={deliveryComplete}
              onPress={() => setExpandedSection('delivery')}
            >
              <Delivery
                session={current}
                onSelect={(sellerId, methodId) =>
                  void persist({
                    ...current,
                    deliveryGroups: current.deliveryGroups.map(g =>
                      g.sellerId === sellerId ? { ...g, selectedMethodId: methodId } : g,
                    ),
                  })
                }
                onApply={async code => {
                  const discount = await applyDiscount(code, current.summary.subtotalCents, current.discounts);
                  await persist({ ...current, discounts: [...current.discounts.filter(d => d.code !== discount.code), discount] });
                }}
                onRemove={code =>
                  void removeDiscount(code, current.discounts).then(discounts =>
                    persist({ ...current, discounts }),
                  )
                }
              />
            </GuidedSection>

            <GuidedSection
              title="Review & policies"
              summary={`${money(current.summary.totalCents)} · Stripe secure payment`}
              expanded={expandedSection === 'review'}
              complete={reviewComplete}
              onPress={() => setExpandedSection('review')}
            >
              <Review
                session={current}
                onAck={(key, checked) =>
                  void persist({
                    ...current,
                    acknowledgments: current.acknowledgments.map(ack =>
                      ack.key === key ? { ...ack, acknowledged: checked } : ack,
                    ),
                  })
                }
              />
            </GuidedSection>
          </>
        )}

        {current.step === 'confirmation' && (
          <Confirmation
            session={current}
            verifiedOrders={verifiedOrders}
            finalizing={pendingSessionIds.length > 0}
            onRefresh={refreshOrders}
            refreshing={placing}
          />
        )}

        {!!error && (
          <View style={s.error}>
            <Feather name="alert-circle" size={16} color={RED} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={s.errorText}>{error}</Text>
              {canRetryPayment && (
                <TouchableOpacity
                  style={s.retryButton}
                  onPress={retryPayment}
                  disabled={placing}
                  accessibilityRole="button"
                  accessibilityLabel="Try a different card"
                  accessibilityState={{ disabled: placing, busy: placing }}
                >
                  <Feather name="credit-card" size={14} color={RED} />
                  <Text style={s.retryText}>Try a different card</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Persistent Pay securely CTA — hidden on confirmation */}
      {current.step !== 'confirmation' && (
        <View style={[s.bottom, { paddingBottom: insets.bottom + SP.sm }]}>
          <TouchableOpacity
            style={s.continue}
            disabled={placing}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              void (canRetryPayment ? retryPayment() : handleContinue());
            }}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            accessibilityState={{ disabled: placing, busy: placing }}
          >
            <LinearGradient colors={theme.primaryGradient} style={s.continueGradient}>
              {placing
                ? <ActivityIndicator color={theme.onAccent} />
                : (
                  <>
                    {current.step === 'review' && <Feather name="lock" size={16} color={theme.onAccent} style={{ marginRight: 6 }} />}
                    <Text style={[s.continueText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
                      {ctaLabel}
                    </Text>
                  </>
                )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {/* Receipt bottom sheet */}
      {session && (
        <ReceiptSheet
          session={current}
          visible={receiptVisible}
          onClose={() => setReceiptVisible(false)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent;
  const PURPLE_LIGHT = theme.accentLight;
  const PURPLE_DIM = theme.accentDim;
  const CYAN = theme.secondary;
  const SHADOW_PURPLE = {
    shadowColor: theme.shadowColor,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  };
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: SP.md, paddingBottom: SP.sm,
    },
    back: { width: COMP.minTouchTarget, height: COMP.minTouchTarget, justifyContent: 'center', alignItems: 'center' },
    stepLabel: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, marginBottom: 5 },
    progress: { flexDirection: 'row', gap: 4, width: 120 },
    progressSegment: { height: 4, flex: 1, borderRadius: 2, backgroundColor: CARD_ELEVATED },
    progressSegmentActive: { backgroundColor: PURPLE },

    // Card
    card: {
      backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1,
      borderColor: BORDER, padding: SP.md, marginBottom: SP.md,
    },
    sectionTitle: { fontFamily: FONT.semibold, fontSize: FS.base, color: FG, marginBottom: SP.sm },

    // Input fields
    field: { marginBottom: SP.sm },
    fieldLabel: { color: MUTED, fontFamily: FONT.semibold, fontSize: FS.xs, textTransform: 'uppercase', marginBottom: 4 },
    input: {
      minHeight: COMP.inputH, borderRadius: RADIUS.md,
      backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER,
      color: FG, fontFamily: FONT.regular, paddingHorizontal: SP.md, paddingVertical: SP.sm,
    },
    twoCol: { flexDirection: 'row', gap: SP.sm },
    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingTop: SP.sm },
    toggleTitle: { color: FG, fontFamily: FONT.medium, fontSize: FS.sm },
    muted: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19 },

    // Guided sections
    guidedSection: {
      borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_ELEVATED,
      borderRadius: RADIUS.lg, overflow: 'hidden', marginBottom: SP.sm,
    },
    guidedHeader: {
      minHeight: 72, flexDirection: 'row', alignItems: 'center',
      gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm,
    },
    guidedStatus: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
    guidedStatusComplete: { backgroundColor: SUCCESS, borderColor: SUCCESS },
    guidedTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
    guidedSummary: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 3 },
    guidedBody: { paddingHorizontal: SP.sm, paddingBottom: SP.sm },

    // Checkout summary (Depop compact rows)
    summaryItemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginBottom: SP.sm },
    summaryThumb: {
      width: 56, height: 68, borderRadius: RADIUS.sm,
      overflow: 'hidden', borderWidth: 1, borderColor: BORDER,
    },
    summaryItemName: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, lineHeight: 18 },
    summaryItemVariant: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },
    summaryItemPrice: { fontFamily: FONT.bold, fontSize: FS.sm, color: FG },
    summaryTotalRow: {
      flexDirection: 'row', alignItems: 'center', paddingVertical: SP.sm,
    },
    summaryTotalLabel: { fontFamily: FONT.bold, fontSize: FS.base, color: FG },
    freeShippingLabel: { fontFamily: FONT.medium, fontSize: FS.xs, color: SUCCESS, marginTop: 2 },
    summaryEditRow: {
      flexDirection: 'row', alignItems: 'center', gap: SP.sm,
      paddingVertical: SP.sm,
    },
    summaryEditLabel: { fontFamily: FONT.medium, fontSize: FS.xs, color: MUTED, marginBottom: 2 },
    summaryEditValue: { fontFamily: FONT.regular, fontSize: FS.sm, color: FG },

    // Receipt sheet
    sheetBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)' },
    sheetContainer: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20,
      borderTopWidth: 1, borderTopColor: BORDER,
      maxHeight: '80%', padding: SP.md,
    },
    sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: SP.md },
    sheetHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.md },
    sheetTitle: { fontFamily: FONT.bold, fontSize: FS.md, color: FG },
    receiptItemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginBottom: SP.sm },
    receiptThumb: { width: 48, height: 60, borderRadius: RADIUS.sm, overflow: 'hidden', borderWidth: 1, borderColor: BORDER },
    receiptItemName: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, lineHeight: 18 },
    receiptItemVariant: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },
    receiptItemPrice: { fontFamily: FONT.bold, fontSize: FS.sm, color: FG },

    // Delivery methods
    method: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.sm, borderRadius: RADIUS.md, marginBottom: 6 },
    radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: MUTED },
    methodTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },

    // Promo code
    promoToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    promoRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'center', marginTop: SP.sm },
    applyButton: { borderRadius: RADIUS.md, paddingHorizontal: SP.md, paddingVertical: 13 },
    applyText: { fontFamily: FONT.bold, fontSize: FS.sm },
    discountRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SP.sm, marginTop: SP.sm },
    discountText: { flex: 1, color: SUCCESS, fontFamily: FONT.regular, fontSize: FS.sm },
    removeText: { fontFamily: FONT.semibold, fontSize: FS.sm },

    // Review
    address: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20, marginBottom: SP.md },
    line: { flexDirection: 'row', justifyContent: 'space-between', gap: SP.sm, paddingVertical: 5 },
    lineName: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
    divider: { height: 1, backgroundColor: BORDER, marginVertical: SP.sm },
    total: { color: FG, fontFamily: FONT.bold, fontSize: FS.lg },
    multiSeller: { flexDirection: 'row', gap: SP.sm, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md },
    multiSellerText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
    ack: { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start', minHeight: COMP.minTouchTarget, marginBottom: SP.sm },
    checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1, borderColor: MUTED, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    ackText: { flex: 1, color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },

    // Bottom CTA bar
    bottom: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      padding: SP.md, backgroundColor: BG, borderTopWidth: 1, borderColor: BORDER,
    },
    continue: { overflow: 'hidden', borderRadius: RADIUS.lg, ...SHADOW_PURPLE },
    continueGradient: { height: COMP.buttonH, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    continueText: { fontFamily: FONT.bold, fontSize: FS.base },
    continueBtn: { borderRadius: RADIUS.lg, height: COMP.buttonH, alignItems: 'center', justifyContent: 'center' },
    continueBtnText: { fontFamily: FONT.bold, fontSize: FS.base },

    // Error
    error: { flexDirection: 'row', gap: SP.sm, backgroundColor: RED_DIM, padding: SP.md, borderRadius: RADIUS.md },
    errorText: { color: RED, flex: 1, fontFamily: FONT.medium, fontSize: FS.sm, lineHeight: 20 },
    retryButton: {
      flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
      marginTop: SP.sm, paddingVertical: 7, paddingHorizontal: SP.sm,
      borderRadius: RADIUS.md, borderWidth: 1, borderColor: RED,
    },
    retryText: { color: RED, fontFamily: FONT.semibold, fontSize: FS.sm },

    // Confirmation
    confirmation: { alignItems: 'center', paddingTop: SP.xl, position: 'relative', overflow: 'hidden' },
    confettiLayer: { position: 'absolute', top: 0, left: 0, right: 0, height: 220 },
    confetti: { position: 'absolute', top: 0, width: 8, height: 14, borderRadius: 2 },
    successHalo: { width: 112, height: 112, borderRadius: 56, backgroundColor: SUCCESS_DIM, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md },
    confirmIcon: { width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center', backgroundColor: SUCCESS },
    confirmEyebrow: { color: SUCCESS, fontFamily: FONT.bold, fontSize: 10, letterSpacing: 1.8, marginBottom: 7 },
    headline: { color: FG, fontFamily: FONT.extrabold ?? FONT.bold, fontSize: FS.h1, letterSpacing: -1.2, marginBottom: SP.sm },
    confirmText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, textAlign: 'center', maxWidth: 330 },
    deliveryHero: { width: '100%', alignItems: 'center', backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.xl, padding: SP.lg, marginTop: SP.xl },
    deliveryIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm },
    deliveryLabel: { color: SUBTLE, fontFamily: FONT.bold, fontSize: 9, letterSpacing: 1.5, marginBottom: 5 },
    deliveryDate: { color: FG, fontFamily: FONT.extrabold ?? FONT.bold, fontSize: FS.xl, textAlign: 'center', letterSpacing: -0.35 },
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
    refreshButton: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SP.lg, paddingVertical: SP.sm, marginTop: SP.lg },
    refreshText: { fontFamily: FONT.bold, fontSize: FS.sm },

    // Confirmation action buttons (Message seller / View purchase)
    actionBtnOutline: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 6, height: COMP.buttonH, borderRadius: RADIUS.md,
      borderWidth: 1, borderColor: BORDER, backgroundColor: CARD,
    },
    actionBtnOutlineText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
    createAccountBtn: { backgroundColor: PURPLE, height: COMP.buttonH, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
    createAccountText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.base },
    continueShopBtn: { borderWidth: 1, borderColor: BORDER, height: COMP.buttonH, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
    continueShopText: { color: FG, fontFamily: FONT.bold, fontSize: FS.base },

    // Address cards
    savedAddressCard: { padding: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginBottom: SP.sm },
    addNewAddressBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, borderStyle: 'dashed', marginTop: SP.xs },
    addNewAddressText: { fontFamily: FONT.semibold, fontSize: FS.sm },
    useSavedBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SP.sm },
    useSavedText: { fontFamily: FONT.semibold, fontSize: FS.sm },
    defaultBadge: { backgroundColor: SUCCESS_DIM, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    defaultBadgeText: { color: SUCCESS, fontFamily: FONT.bold, fontSize: 10, textTransform: 'uppercase' },
    selectedBadge: { backgroundColor: PURPLE_DIM, borderWidth: 1, borderColor: PURPLE, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    selectedBadgeText: { color: PURPLE_LIGHT, fontFamily: FONT.bold, fontSize: 10, textTransform: 'uppercase' },
  });
};
