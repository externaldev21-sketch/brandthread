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
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { UseThreadCashCard } from '@/components/thread-cash/UseThreadCashCard';
import {
  applyDiscount, clearCheckoutSession, createCheckoutSession,
  getCart, getCheckoutSession, removeCartItems, removeDiscount, saveCheckoutProgress, validateCart,
} from '@/services/cartService';
import {
  CheckoutAddress, CheckoutContact, CheckoutDiscount, CheckoutSession, CheckoutStep,
} from '@/services/cartTypes';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@clerk/expo';
import {
  BG, BORDER, CARD, CARD_ELEVATED, FG, FONT, FS,
  MUTED, ON_DARK, RADIUS, RED, RED_DIM,
  SP, SUCCESS, SUCCESS_DIM, SUBTLE, COMP, ICON, ORANGE, ORANGE_DIM, TYPE,
} from '@/lib/theme';

type ThemeAliases = {
  theme: AppThemePreset;
  BG: string; BORDER: string; CARD: string; CARD_ELEVATED: string;
  FG: string; MUTED: string; SUBTLE: string;
  RED: string; RED_DIM: string; SUCCESS: string; SUCCESS_DIM: string;
  ORANGE: string; ORANGE_DIM: string;
};

// Maps known Stripe decline reason codes to plain-language copy. Falls back to a
// generic decline message when the code is unrecognized, and to a "still
// confirming" message when there's no decline reason at all (e.g. a timeout).
function humanDeclineReason(reason?: string | null): string {
  if (!reason) return "We're still confirming your payment. This can take a minute — check your order status shortly.";
  const known: Record<string, string> = {
    card_declined: 'Your card was declined. Try another card or contact your bank.',
    insufficient_funds: 'Your card was declined for insufficient funds. Try another card.',
    expired_card: 'That card has expired. Try another card.',
    incorrect_cvc: 'The security code didn’t match. Check it and try again.',
    processing_error: 'Something went wrong processing your card. Try again.',
    incorrect_number: 'That card number looks incorrect. Check it and try again.',
  };
  return known[reason] ?? 'Your card was declined. Try another card or contact your bank.';
}

function useThemeAliases(): ThemeAliases {
  const { theme } = useAppTheme();
  return {
    theme,
    BG: theme.background, BORDER: theme.border, CARD: theme.card, CARD_ELEVATED: theme.cardElevated,
    FG: theme.text, MUTED: theme.muted, SUBTLE: theme.subtle,
    RED: theme.error, RED_DIM: `${theme.error}26`, SUCCESS: theme.success, SUCCESS_DIM: `${theme.success}26`,
    ORANGE: theme.warning, ORANGE_DIM: `${theme.warning}26`,
  };
}
import { formatCents } from '@/lib/money';
import {
  getCheckoutBlockingSection,
  getFirstIncompleteCheckoutSection,
  mergeCheckoutFormState,
} from '@/lib/checkoutReadiness';
import { CheckoutSkeleton, HapticSwitch, PressableScale } from '@/components/BrandthreadUI';
import { AddressAutocompleteInput } from '@/components/AddressAutocompleteInput';
import { StickyFooter } from '@/components/layout';
import { requestContextualPushPermission } from '@/lib/contextualPushPermission';
import { trackAndRelayConversionEvent } from '@/lib/marketingPixels';
import { Button, IconButton } from '@/components/ui';
import { BuyerProtectionNote } from '@/components/BuyerProtectionNote';
import { RADII } from '@/constants/radii';
import { TABULAR_NUMS, TYPE_SCALE } from '@/constants/typography';

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
  const { theme, BG, BORDER, CARD, CARD_ELEVATED, FG, MUTED, SUBTLE, RED, RED_DIM, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM } = useThemeAliases();
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
  const { theme, BG, BORDER, CARD, CARD_ELEVATED, FG, MUTED, SUBTLE, RED, RED_DIM, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM } = useThemeAliases();
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

// ─── Checkout summary card ────────────────────────────────────────────────────

/**
 * Product summary card — always visible at the top of the single-screen
 * checkout (GOAT Order Review / Luma pattern): photo + name + size/variant +
 * qty, one card per line item.
 */
function CheckoutSummaryView({ session }: { session: CheckoutSession }) {
  const { theme, CARD_ELEVATED, MUTED, SUBTLE } = useThemeAliases();
  const s = makeStyles(theme);

  return (
    <Card>
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
            <Text style={s.summaryItemVariant}>{item.variantTitle}{item.quantity > 1 ? ` · Qty ${item.quantity}` : ''}</Text>
            {item.isPreOrder && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <Feather name="clock" size={10} color={theme.secondary} />
                <Text style={[s.summaryItemVariant, { color: theme.secondary }]}>Pre-order</Text>
              </View>
            )}
          </View>
          <Text style={s.summaryItemPrice}>{money(item.priceCents * item.quantity)}</Text>
        </View>
      ))}
    </Card>
  );
}

/**
 * Order total — a single collapsed row that expands to the full
 * subtotal/shipping/tax/discount/Thread Cash breakdown in place (no sheet),
 * per the Luma / American Airlines "review & pay" pattern.
 */
function OrderTotalCard({
  session, expanded, onToggle,
}: {
  session: CheckoutSession;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { theme, MUTED, SUCCESS } = useThemeAliases();
  const s = makeStyles(theme);
  const threadCashCents = session.threadCashRedemption?.discountCents ?? 0;

  return (
    <Card>
      <TouchableOpacity
        style={s.totalRow}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Total ${money(session.summary.totalCents)}. ${expanded ? 'Collapse' : 'View'} price breakdown.`}
      >
        <Text style={s.totalRowLabel}>Total</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={s.totalRowValue}>{money(session.summary.totalCents)}</Text>
          <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={MUTED} />
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={s.totalBreakdown}>
          <View style={s.line}>
            <Text style={s.muted}>Subtotal</Text>
            <Text style={s.lineName}>{money(session.summary.subtotalCents)}</Text>
          </View>
          <View style={s.line}>
            <Text style={s.muted}>Shipping</Text>
            <Text style={[s.lineName, session.summary.shippingTotalCents === 0 && { color: SUCCESS }]}>
              {session.summary.shippingTotalCents === 0 ? 'Free' : money(session.summary.shippingTotalCents)}
            </Text>
          </View>
          <View style={s.line}>
            <Text style={s.muted}>Tax</Text>
            <Text style={s.lineName}>{session.summary.taxTotalCents > 0 ? money(session.summary.taxTotalCents) : 'Calculated at payment'}</Text>
          </View>
          {session.summary.discountTotalCents > 0 && (
            <View style={s.line}>
              <Text style={s.muted}>Discount</Text>
              <Text style={[s.lineName, { color: SUCCESS }]}>−{money(session.summary.discountTotalCents)}</Text>
            </View>
          )}
          {threadCashCents > 0 && (
            <View style={s.line}>
              <Text style={s.muted}>Thread Cash</Text>
              <Text style={[s.lineName, { color: SUCCESS }]}>−{money(threadCashCents)}</Text>
            </View>
          )}
        </View>
      )}
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
  const { theme, BG, BORDER, CARD, CARD_ELEVATED, FG, MUTED, SUBTLE, RED, RED_DIM, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM } = useThemeAliases();
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
    if (!address.firstName?.trim() || !address.lastName?.trim()) {
      Alert.alert('Name required', 'Enter your first and last name for delivery.');
      return;
    }
    if (!contact.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
      Alert.alert('Email required', 'Enter a valid email address to receive order confirmation.');
      return;
    }
    if (!contact.phone?.trim() || !/^[0-9+(). -]{7,32}$/.test(contact.phone.trim())) {
      Alert.alert('Phone required', 'Enter a valid phone number for delivery updates.');
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

        <AddressAutocompleteInput
          value={address.line1 ?? ''}
          country={address.country ?? 'US'}
          onChangeText={v => onAddress({ ...address, line1: v })}
          onSelect={selected => onAddress({
            ...address,
            line1: selected.line1,
            city: selected.city,
            state: selected.state,
            postalCode: selected.postalCode,
            country: selected.country,
          })}
        />
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
                trackColor={{ false: theme.borderSubtle, true: PURPLE }}
                thumbColor={theme.onAccent}
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
  const { theme, BG, BORDER, CARD, CARD_ELEVATED, FG, MUTED, SUBTLE, RED, RED_DIM, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM } = useThemeAliases();
  const s = makeStyles(theme);
  const { isSignedIn } = useAuth();
  const PURPLE = theme.accent;
  const PURPLE_LIGHT = theme.accentLight;
  const [addrModalVisible, setAddrModalVisible] = useState(false);
  const insets = useSafeAreaInsets();

  return (
    <>
      {/* Guest checkout: compact email + phone only. Signed-in buyers already
          have a verified email/phone on file, so no contact card is shown —
          keeps the screen to one section per real decision (Mobbin: GOAT,
          Shop app, American Airlines all skip a standalone contact card for
          logged-in buyers). */}
      {!isSignedIn && (
        <Card>
          <Text style={s.sectionTitle}>Contact</Text>
          <View style={s.twoCol}>
            <View style={{ flex: 1 }}>
              <Input
                label="Email"
                value={contact.email ?? ''}
                keyboardType="email-address"
                autoCapitalize="none"
                onChange={v => onContact({ ...contact, email: v })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Input
                label="Phone"
                value={contact.phone ?? ''}
                keyboardType="phone-pad"
                onChange={v => onContact({ ...contact, phone: v })}
              />
            </View>
          </View>
        </Card>
      )}

      <Card>
        <View style={s.addressRowHeader}>
          <Text style={[s.sectionTitle, { marginBottom: 0 }]}>Shipping address</Text>
          {address.line1 && (
            <TouchableOpacity
              onPress={() => setAddrModalVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Change shipping address"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[s.changeLink, { color: PURPLE_LIGHT }]}>Change</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Compact address summary — tapping Change opens the two-step modal */}
        {address.line1 ? (
          <View style={s.addressCompactRow}>
            <View style={[s.addressPin, { backgroundColor: theme.accentDim }]}>
              <Feather name="map-pin" size={14} color={theme.accentLight} />
            </View>
            <View style={{ flex: 1 }}>
              {(address.firstName || address.lastName) && (
                <Text style={s.addressName}>{address.firstName} {address.lastName}</Text>
              )}
              <Text style={s.muted} numberOfLines={2}>
                {address.line1}{address.line2 ? `, ${address.line2}` : ''}, {address.city}, {address.state} {address.postalCode}
              </Text>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={s.addNewAddressBtn}
            onPress={() => setAddrModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Add shipping address"
          >
            <Feather name="plus" size={16} color={PURPLE_LIGHT} />
            <Text style={[s.addNewAddressText, { color: PURPLE_LIGHT }]}>Add address</Text>
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
  const { theme, BG, BORDER, CARD, CARD_ELEVATED, FG, MUTED, SUBTLE, RED, RED_DIM, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM } = useThemeAliases();
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
          <Text style={s.sectionTitle}>
            {session.deliveryGroups.length > 1 ? `Delivery from ${group.sellerName}` : 'Delivery'}
          </Text>
          <View style={{ gap: SP.sm }}>
            {group.availableMethods.map(method => {
              const selected = group.selectedMethodId === method.id;
              return (
                <TouchableOpacity
                  key={method.id}
                  style={[s.methodCard, selected && { borderColor: PURPLE, backgroundColor: PURPLE_DIM }]}
                  onPress={() => onSelect(group.sellerId, method.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${method.service}, ${method.estimatedDelivery}, ${money(method.priceCents)}`}
                >
                  <View style={[s.radio, selected && { borderColor: PURPLE, backgroundColor: PURPLE }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.methodTitle}>{method.service}</Text>
                    <Text style={s.muted}>{method.estimatedDelivery}</Text>
                  </View>
                  <Text style={[s.methodTitle, method.priceCents === 0 && { color: SUCCESS }]}>
                    {method.priceCents === 0 ? 'Free' : money(method.priceCents)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
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
  const { theme, MUTED, SUCCESS } = useThemeAliases();
  const s = makeStyles(theme);
  const { isSignedIn } = useAuth();
  const PURPLE = theme.accent;
  const CYAN = theme.secondary;

  return (
    <>
      {session.deliveryGroups.length > 1 && (
        <View style={s.multiSeller}>
          <Feather name="layers" size={16} color={CYAN} />
          <Text style={[s.multiSellerText, { color: CYAN }]}>
            Your cart contains items from {session.deliveryGroups.length} sellers. You'll complete a separate secure Stripe payment for each seller.
          </Text>
        </View>
      )}

      <Card>
        <Text style={s.sectionTitle}>Payment</Text>
        <View style={s.paymentRow}>
          <View style={[s.paymentIcon, { backgroundColor: theme.cardElevated }]}>
            <Feather name="smartphone" size={16} color={theme.text} />
          </View>
          <Text style={s.paymentRowText}>Apple Pay · Google Pay</Text>
        </View>
        <View style={s.paymentRow}>
          <View style={[s.paymentIcon, { backgroundColor: theme.cardElevated }]}>
            <Feather name="credit-card" size={16} color={theme.text} />
          </View>
          <Text style={s.paymentRowText}>
            {isSignedIn ? 'Saved cards, or add a new card' : 'Card — add at payment'}
          </Text>
        </View>
        <View style={[s.paymentRow, { marginBottom: 0 }]}>
          <Feather name="lock" size={13} color={MUTED} />
          <Text style={[s.muted, { flex: 1 }]}>
            You'll finish payment securely in Stripe Checkout. Brandthread never sees or stores your card number.
          </Text>
        </View>
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
            {ack.acknowledged && <Feather name="check" size={12} color={theme.onAccent} />}
          </View>
          <Text style={s.ackText}>{ack.label}</Text>
        </TouchableOpacity>
      ))}
    </>
  );
}

// ─── Confirmation screen ──────────────────────────────────────────────────────

// Colors are theme keywords resolved at render time (never literal hex) so
// confetti stays monochrome-brand and reacts to all 12 themes.
const CONFETTI = [
  { left: '5%', color: 'success', delay: 0, x: -14 },
  { left: '13%', color: 'accent', delay: 90, x: 18 },
  { left: '22%', color: 'secondary', delay: 180, x: -8 },
  { left: '31%', color: 'secondary', delay: 50, x: 14 },
  { left: '42%', color: 'foreground', delay: 230, x: -18 },
  { left: '53%', color: 'success', delay: 110, x: 10 },
  { left: '64%', color: 'accent', delay: 20, x: -12 },
  { left: '73%', color: 'secondary', delay: 260, x: 17 },
  { left: '82%', color: 'secondary', delay: 140, x: -10 },
  { left: '92%', color: 'foreground', delay: 70, x: 13 },
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
  const { theme, BG, BORDER, CARD, CARD_ELEVATED, FG, MUTED, SUBTLE, RED, RED_DIM, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM } = useThemeAliases();
  const s = makeStyles(theme);
  const { isSignedIn, userId } = useAuth();
  const api = useApi();
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
    // A completed purchase is a meaningful, server-backed moment — exactly
    // when contextualPushPermission.ts wants to ask, never on first launch.
    if (firstVerified?.id) void requestContextualPushPermission(userId, api);
  }, [firstVerified?.id, userId, api]);

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
                    : particle.color === 'success' ? theme.success
                    : theme.text,
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
        <Text style={s.deliveryLabel}>Estimated delivery</Text>
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
        <Button
          label="Check order status"
          variant="tertiary"
          loading={refreshing}
          onPress={onRefresh}
          style={{ marginTop: SP.lg }}
        />
      ) : (
        <View style={{ marginTop: SP.xl, width: '100%', gap: SP.sm }}>
          <View style={{ flexDirection: 'row', gap: SP.sm }}>
            {/*
              "Track order" is ONLY enabled when we have a verified server order ID.
              If orderId is absent (still finalizing / webhook not yet received),
              this button stays disabled — never falls back to orderNumber for routing.
            */}
            <Button
              label="Track order"
              icon="package"
              variant="primary"
              disabled={!firstVerified?.id}
              onPress={handleViewPurchase}
              style={{ flex: 1 }}
            />
            <Button
              label="Keep shopping"
              variant="secondary"
              onPress={() => router.replace('/(buyer)/discover' as never)}
              style={{ flex: 1 }}
            />
          </View>

          {firstGroup && (
            <Button
              label="Message seller"
              icon="message-circle"
              variant="tertiary"
              onPress={handleMessageSeller}
              fullWidth
            />
          )}

          {!isSignedIn && (
            <Button
              label="Create an account"
              variant="secondary"
              onPress={() => router.replace('/sign-in' as never)}
              fullWidth
            />
          )}
        </View>
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function BuyerCheckoutScreen() {
  const { theme, BG, BORDER, CARD, CARD_ELEVATED, FG, MUTED, SUBTLE, RED, RED_DIM, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM } = useThemeAliases();
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
  const threadCashCheckoutEnabled = useFeatureFlag('threadCashCheckoutDiscount');

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
  const [orderSummaryExpanded, setOrderSummaryExpanded] = useState(false);
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

      // Meta Pixel + Conversions API — fires once when checkout actually
      // starts (session freshly loaded/created), not on every re-render.
      if (next.step !== 'confirmation') {
        void trackAndRelayConversionEvent(
          'InitiateCheckout',
          { value: next.summary.totalCents / 100, currency: next.summary.currency },
          { valueCents: next.summary.totalCents, currency: next.summary.currency },
        );
      }

      // Load saved addresses for authenticated users
      if (isSignedIn) {
        try {
          const [addresses, profile] = await Promise.all([
            api.buyer.addresses.list(),
            api.auth.me(),
          ]);
          setSavedAddresses(addresses);
          setContact(previous => ({
            ...previous,
            email: previous.email?.trim() || profile.email || '',
          }));
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
    setContact(previous => ({
      ...previous,
      phone: addr.phone || previous.phone || '',
    }));
  };

  const persist = async (next: CheckoutSession) => {
    const snapshot = mergeCheckoutFormState(next, contact, address);
    setSession(snapshot);
    await saveCheckoutProgress(snapshot);
  };

  const current = session as CheckoutSession;

  const validateInformation = () => {
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email ?? '');
    const validPhone = /^[0-9+(). -]{7,32}$/.test((contact.phone ?? '').trim());
    const validZip = (address.postalCode ?? '').trim().length >= 3;
    if (!validEmail || !validPhone || !address.firstName || !address.lastName || !address.line1 || !address.city || !address.state || !validZip || !address.country) {
      Alert.alert('Check your information', 'Enter your first and last name, a valid email and phone number, and every required shipping address field.');
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

  /**
   * Single "Place order" action for the one-screen checkout — every section
   * is always visible, so instead of stepping through information → delivery
   * → review one screen at a time, this runs the same validation chain
   * handleContinue used to run per-step, then pays. No payment logic below
   * this point changes; only the number of taps to reach it does.
   */
  const handlePlaceOrder = async () => {
    if (!validateInformation()) return;
    if (current.deliveryGroups.some(g => !g.selectedMethodId)) {
      Alert.alert('Choose delivery', 'Select a delivery option for every seller before paying.');
      return;
    }
    const blockingSection = getCheckoutBlockingSection(contact, address, current);
    if (blockingSection === 'acknowledgments') {
      Alert.alert('Acknowledgment required', 'Please accept the required policies before paying.');
      return;
    }
    if (!await validateServerCart()) return;
    await persist({ ...current, contact: contact as CheckoutContact, shippingAddress: address as CheckoutAddress, step: 'review' });
    await pay();
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
              contactEmail: contact.email!,
              contactPhone: contact.phone!,
              shippingAddress: {
                recipientName: `${address.firstName} ${address.lastName}`.trim(),
                street: address.line1!,
                line2: address.line2,
                city: address.city!,
                state: address.state!,
                postalCode: address.postalCode!,
                country: address.country || 'US',
                phone: contact.phone!,
              },
              clientIdempotencyKey: `${current.idempotencyKey}_${group.sellerId}`,
              ...(current.loyaltyRedemption && current.deliveryGroups.length === 1
                ? { loyaltyToken: current.loyaltyRedemption.token }
                : {}),
              // THREAD CASH HOOK POINT: server currently rejects this token
              // outright (see routes/buyer.ts) until checkout can fund the
              // discount without changing seller payout — see
              // docs/payments/thread-cash-checkout-todo.md. Wired here so the
              // rest of the flow needs no changes once that lands.
              ...(current.threadCashRedemption && current.deliveryGroups.length === 1
                ? { threadCashToken: current.threadCashRedemption.token }
                : {}),
              ...(current.deliveryGroups.length === 1 && current.discounts.find(d => d.isValid)
                ? { discountCode: current.discounts.find(d => d.isValid)!.code }
                : {}),
            },
          );
        } else {
          result = await api.guest.checkout.createSession(
            group.items.map(item => ({ variantId: item.variantId, productId: item.productId, quantity: item.quantity })),
            {
              contactEmail: contact.email!,
              contactPhone: contact.phone!,
              shippingAddress: {
                name: `${address.firstName} ${address.lastName}`.trim(),
                street: address.line1!,
                line2: address.line2,
                city: address.city!,
                state: address.state!,
                zip: address.postalCode!,
                country: address.country || 'US',
                phone: contact.phone!,
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
          setError(humanDeclineReason(verification?.declineReason));
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

          // Meta Pixel + Conversions API — fires exactly once per newly
          // verified order (this branch only runs the first time a group's
          // payment resolves to a real order id).
          const purchaseValueCents = verification.amountTotal ?? current.summary.totalCents;
          void trackAndRelayConversionEvent(
            'Purchase',
            { value: purchaseValueCents / 100, currency: current.summary.currency, content_ids: group.items.map(item => item.productId) },
            { valueCents: purchaseValueCents, currency: current.summary.currency },
          );
        } else {
          // orderId not yet available — persist the stripe session for reconciliation.
          unresolved.push(isSignedIn ? result.sessionId : `${result.sessionId}|${result.guestAccessToken}`);
        }
      }

      setVerifiedOrders(confirmed);
      setPendingSessionIds(unresolved);
      // Remove only the items that were actually part of this checkout
      // session — a single-item Buy Now (or a partial "checkout selected")
      // must never wipe unrelated items still sitting in the buyer's cart.
      if (!unresolved.length) {
        await removeCartItems(current.deliveryGroups.flatMap(group => group.items.map(item => item.id)));
      }

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
      await removeCartItems(current.deliveryGroups.flatMap(group => group.items.map(item => item.id)));
    }
    setPlacing(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, current, verifiedOrders, pendingSessionIds]);

  if (loading || !session) return <CheckoutSkeleton />;

  const ctaLabel = canRetryPayment ? 'Try a different card' : 'Place order';
  const isConfirmation = current.step === 'confirmation';

  return (
    <KeyboardAvoidingView style={s.root} behavior="padding" keyboardVerticalOffset={0}>
      {/* Header — title below the safe area, close/back at the leading edge. No
          step progress bar: every section below renders on one screen. */}
      {!isConfirmation && (
        <View style={[s.header, { paddingTop: insets.top + SP.xs }]}>
          <IconButton
            name={usesThreadPull ? 'x' : 'chevron-left'}
            variant="plain"
            onPress={leaveCheckout}
            accessibilityLabel={usesThreadPull ? 'Close checkout' : 'Back'}
          />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={s.headerTitle}>Checkout</Text>
          </View>
          <View style={s.back} />
        </View>
      )}

      <ScrollView
        contentContainerStyle={{
          padding: SP.md,
          paddingBottom: insets.bottom + (isConfirmation ? 30 : 120),
        }}
        keyboardShouldPersistTaps="handled"
      >
        {!isConfirmation && (
          <>
            {/* Product summary — photo, name, brand, size, qty, price */}
            <CheckoutSummaryView session={current} />

            <Information
              contact={contact}
              address={address}
              onContact={setContact}
              onAddress={setAddress}
              savedAddresses={savedAddresses}
              onSelectAddress={handleSelectAddress}
            />

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

            {/* THREAD CASH HOOK POINT: same self-contained card cart.tsx uses,
                gated behind the same OFF-by-default 'threadCashCheckoutDiscount'
                flag. See components/thread-cash/UseThreadCashCard.tsx and
                docs/payments/thread-cash-checkout-todo.md — no checkout money
                logic is touched here. When the flag is off the row still shows,
                disabled, with an explanation, rather than disappearing. */}
            {isSignedIn && current.deliveryGroups.length === 1 && (
              <UseThreadCashCard
                maxDiscountCents={Math.max(0, current.summary.subtotalCents + current.summary.shippingTotalCents - 1)}
                redemption={current.threadCashRedemption ?? null}
                disabledReason={threadCashCheckoutEnabled ? undefined : 'Coming soon — not yet available at checkout'}
                onApply={(redemption) => void persist({ ...current, threadCashRedemption: redemption })}
                onRemove={() => void persist({ ...current, threadCashRedemption: undefined })}
              />
            )}

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

            <OrderTotalCard
              session={current}
              expanded={orderSummaryExpanded}
              onToggle={() => setOrderSummaryExpanded(v => !v)}
            />

            {/* Buyer protection — shown right before the buyer pays. */}
            <BuyerProtectionNote
              preorder={current.deliveryGroups.some(group => group.items.some(item => item.isPreOrder))}
              style={{ marginTop: SP.md }}
            />
          </>
        )}

        {isConfirmation && (
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

      {/* Sticky bottom bar — running total + one full-width primary CTA. */}
      {!isConfirmation && (
        <StickyFooter style={s.bottom}>
          <View style={s.stickyTotalRow}>
            <Text style={s.stickyTotalLabel}>Total</Text>
            <Text style={s.stickyTotalValue}>{money(current.summary.totalCents)}</Text>
          </View>
          <Button
            label={ctaLabel}
            icon="lock"
            loading={placing}
            fullWidth
            onPress={() => void (canRetryPayment ? retryPayment() : handlePlaceOrder())}
          />
        </StickyFooter>
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
  const BG = theme.background;
  const BORDER = theme.border;
  const CARD = theme.card;
  const CARD_ELEVATED = theme.cardElevated;
  const FG = theme.text;
  const MUTED = theme.muted;
  const SUBTLE = theme.subtle;
  const RED = theme.error;
  const RED_DIM = `${theme.error}26`;
  const SUCCESS = theme.success;
  const SUCCESS_DIM = `${theme.success}26`;
  const ORANGE = theme.warning;
  const ORANGE_DIM = `${theme.warning}26`;
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
    headerTitle: { fontFamily: FONT.bold, fontSize: FS.lg, color: FG },

    // Card
    card: {
      backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1,
      borderColor: BORDER, padding: SP.md, marginBottom: SP.md,
    },
    sectionTitle: { fontFamily: FONT.semibold, fontSize: FS.base, color: FG, marginBottom: SP.sm },

    // Address row (compact, "Change" link — no boxed sub-card)
    addressRowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.sm },
    changeLink: { fontFamily: FONT.semibold, fontSize: FS.sm },
    addressCompactRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
    addressPin: { width: 28, height: 28, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    addressName: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm, marginBottom: 2 },

    // Delivery option cards
    methodCard: {
      flexDirection: 'row', alignItems: 'center', gap: SP.sm,
      padding: SP.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    },

    // Payment section rows
    paymentRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
    paymentIcon: { width: 30, height: 30, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
    paymentRowText: { color: FG, fontFamily: FONT.medium, fontSize: FS.sm },

    // Collapsible order total
    totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    totalRowLabel: { ...TYPE.subheading, color: FG },
    totalRowValue: { ...TYPE.subheading, fontFamily: FONT.bold, color: FG, ...TABULAR_NUMS },
    totalBreakdown: { marginTop: SP.md, paddingTop: SP.md, borderTopWidth: 1, borderTopColor: BORDER, gap: 2 },

    // Sticky bottom bar
    stickyTotalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: SP.sm },
    stickyTotalLabel: { color: MUTED, fontFamily: FONT.medium, fontSize: FS.sm },
    stickyTotalValue: { color: FG, fontFamily: FONT.bold, fontSize: FS.xl, ...TABULAR_NUMS },

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
    guidedStatus: { width: 26, height: 26, borderRadius: RADII.pill, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
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
    summaryItemName: { ...TYPE.bodyMedium, fontFamily: FONT.semibold, color: FG },
    summaryItemVariant: { ...TYPE.caption, color: MUTED, marginTop: 2 },
    summaryItemPrice: { ...TYPE.bodyMedium, fontFamily: FONT.bold, color: FG },
    summaryTotalRow: {
      flexDirection: 'row', alignItems: 'center', paddingVertical: SP.sm,
    },
    summaryTotalLabel: { ...TYPE.subheading, color: FG },
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
    sheetHandle: { width: 36, height: 4, borderRadius: RADII.pill, backgroundColor: BORDER, alignSelf: 'center', marginBottom: SP.md },
    sheetHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.md },
    sheetTitle: { fontFamily: FONT.bold, fontSize: FS.md, color: FG },
    receiptItemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginBottom: SP.sm },
    receiptThumb: { width: 48, height: 60, borderRadius: RADIUS.sm, overflow: 'hidden', borderWidth: 1, borderColor: BORDER },
    receiptItemName: { ...TYPE.bodyMedium, fontFamily: FONT.semibold, color: FG },
    receiptItemVariant: { ...TYPE.caption, color: MUTED, marginTop: 2 },
    receiptItemPrice: { ...TYPE.bodyMedium, fontFamily: FONT.bold, color: FG },

    // Delivery methods
    method: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.sm, borderRadius: RADIUS.md, marginBottom: 6 },
    radio: { width: 18, height: 18, borderRadius: RADII.pill, borderWidth: 2, borderColor: MUTED },
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
    lineName: { ...TYPE.bodyMedium, fontFamily: FONT.semibold, color: FG },
    divider: { height: 1, backgroundColor: BORDER, marginVertical: SP.sm },
    total: { ...TYPE.subheading, color: FG },
    multiSeller: { flexDirection: 'row', gap: SP.sm, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md },
    multiSellerText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
    ack: { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start', minHeight: COMP.minTouchTarget, marginBottom: SP.sm },
    checkbox: { width: 20, height: 20, borderRadius: RADII.chip, borderWidth: 1, borderColor: MUTED, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    ackText: { flex: 1, color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },

    // Bottom CTA bar
    bottom: {},
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
    successHalo: { width: 112, height: 112, borderRadius: RADII.pill, backgroundColor: SUCCESS_DIM, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md },
    confirmIcon: { width: 78, height: 78, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: SUCCESS },
    confirmEyebrow: { color: SUCCESS, fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 1.8, marginBottom: 7 },
    headline: { color: FG, fontFamily: FONT.extrabold ?? FONT.bold, fontSize: FS.h1, letterSpacing: -1.2, marginBottom: SP.sm },
    confirmText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, textAlign: 'center', maxWidth: 330 },
    deliveryHero: { width: '100%', alignItems: 'center', backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.xl, padding: SP.lg, marginTop: SP.xl },
    deliveryIcon: { width: 46, height: 46, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm },
    deliveryLabel: { color: SUBTLE, fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 1.5, marginBottom: 5 },
    deliveryDate: { color: FG, fontFamily: FONT.extrabold ?? FONT.bold, fontSize: FS.xl, textAlign: 'center', letterSpacing: -0.35 },
    deliverySub: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 6, textAlign: 'center' },
    confirmItems: { width: '100%', marginTop: SP.xl },
    confirmItemsLabel: { color: SUBTLE, fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 1.35, marginBottom: SP.sm },
    confirmItemsRow: { gap: 10, paddingRight: SP.md },
    confirmProduct: { width: 112 },
    confirmProductImage: { width: 112, height: 126, borderRadius: RADIUS.md, backgroundColor: CARD },
    confirmProductFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
    confirmQty: { position: 'absolute', top: 7, right: 7, minWidth: 23, height: 23, paddingHorizontal: 5, borderRadius: RADII.pill, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center' },
    confirmQtyText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.xs },
    confirmProductName: { color: FG, fontFamily: FONT.semibold, fontSize: FS.xs, lineHeight: 16, marginTop: 7 },
    confirmProductVariant: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
    orderNumbers: { width: '100%', marginTop: SP.lg, backgroundColor: CARD, borderRadius: RADIUS.md, paddingHorizontal: SP.md, paddingVertical: SP.sm },
    orderNumber: { color: FG, fontFamily: FONT.bold, fontSize: FS.sm, textAlign: 'center', paddingVertical: 3 },

    // Address cards
    savedAddressCard: { padding: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginBottom: SP.sm },
    addNewAddressBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, borderStyle: 'dashed', marginTop: SP.xs },
    addNewAddressText: { fontFamily: FONT.semibold, fontSize: FS.sm },
    useSavedBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SP.sm },
    useSavedText: { fontFamily: FONT.semibold, fontSize: FS.sm },
    defaultBadge: { backgroundColor: SUCCESS_DIM, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    defaultBadgeText: { color: SUCCESS, fontFamily: FONT.bold, fontSize: FS.xs, textTransform: 'uppercase' },
    selectedBadge: { backgroundColor: PURPLE_DIM, borderWidth: 1, borderColor: PURPLE, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    selectedBadgeText: { color: PURPLE_LIGHT, fontFamily: FONT.bold, fontSize: FS.xs, textTransform: 'uppercase' },
  });
};
