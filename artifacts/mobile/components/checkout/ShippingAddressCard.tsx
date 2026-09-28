/**
 * Shipping address — SSENSE "Shipping" row + Shop app saved-address list.
 *
 * - Signed-in buyers with an address book see their saved addresses as a
 *   radio list (Shop app pattern) plus "Add a new address".
 * - Otherwise: the filled address summary with an "Edit" link, or an
 *   "Add shipping address" placeholder row (SSENSE empty state).
 *
 * Adding/editing opens `AddressSheet`: a full form with the app's existing
 * Google Places autocomplete (AddressAutocompleteInput → the server's
 * /buyer/addresses/autocomplete), edited on a draft and only committed on
 * "Use this address" so Cancel never leaves a half-typed address behind.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Platform, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale, HapticSwitch } from '@/components/BrandthreadUI';
import { AddressAutocompleteInput } from '@/components/AddressAutocompleteInput';
import { Button, IconButton } from '@/components/ui';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { getCheckoutAddressErrors, isCompleteCheckoutAddress } from '@/lib/checkoutReadiness';
import type { CheckoutAddress } from '@/services/cartTypes';
import { FONT, FS, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { CheckoutCard, CheckoutField, RadioDot } from './CheckoutPrimitives';

export type CheckoutAddressDraft = Partial<CheckoutAddress> & { saveAddress?: boolean; label?: string };

/** Shape returned by api.buyer.addresses.list(). */
export interface SavedAddress {
  id: string;
  label?: string | null;
  recipientName?: string | null;
  street: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
  phone?: string | null;
  isDefault?: boolean;
}

function addressLines(address: CheckoutAddressDraft): string[] {
  const name = [address.firstName, address.lastName].filter(Boolean).join(' ');
  return [
    name,
    [address.line1, address.line2].filter(Boolean).join(', '),
    [address.city, [address.state, address.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    address.country && address.country !== 'US' ? address.country : '',
  ].filter(Boolean);
}

function savedLines(address: SavedAddress): string[] {
  return [
    address.recipientName ?? '',
    [address.street, address.line2].filter(Boolean).join(', '),
    `${address.city}, ${address.state} ${address.postalCode}`,
  ].filter(Boolean);
}

export function ShippingAddressCard({
  address, onChange, savedAddresses, onSelectSaved, canSaveAddresses,
}: {
  address: CheckoutAddressDraft;
  onChange: (next: CheckoutAddressDraft) => void;
  savedAddresses: SavedAddress[];
  onSelectSaved: (address: SavedAddress) => void;
  /** Signed-in buyers can save a new address to their address book. */
  canSaveAddresses: boolean;
}) {
  const { theme } = useAppTheme();
  const [sheet, setSheet] = useState<null | 'new' | 'edit'>(null);
  const complete = isCompleteCheckoutAddress(address);
  const hasSaved = savedAddresses.length > 0;
  const usingNewAddress = !address.id && complete;

  const editLink = complete && !address.id ? (
    <PressableScale
      onPress={() => setSheet('edit')}
      accessibilityRole="button"
      accessibilityLabel="Edit shipping address"
      rippleEnabled={false}
      noMinHeight
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
    >
      <Text style={[styles.link, { color: theme.text }]}>Edit</Text>
    </PressableScale>
  ) : null;

  return (
    <CheckoutCard title="Shipping address" trailing={hasSaved ? null : editLink} testID="checkout-shipping">
      {hasSaved ? (
        <View style={styles.list}>
          {savedAddresses.map(saved => {
            const selected = address.id === saved.id;
            return (
              <PressableScale
                key={saved.id}
                onPress={() => onSelectSaved(saved)}
                style={[styles.option, { borderColor: selected ? theme.text : theme.border, borderWidth: selected ? 1.5 : 1 }]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${saved.label ?? 'Saved address'}: ${savedLines(saved).join(', ')}`}
                rippleEnabled={false}
              >
                <RadioDot selected={selected} />
                <View style={styles.optionCopy}>
                  <View style={styles.optionTitleRow}>
                    <Text style={[styles.optionTitle, { color: theme.text }]}>{saved.label || 'Saved address'}</Text>
                    {saved.isDefault ? (
                      <Text style={[styles.badge, { color: theme.muted, borderColor: theme.border }]}>Default</Text>
                    ) : null}
                  </View>
                  {savedLines(saved).map(line => (
                    <Text key={line} style={[styles.optionLine, { color: theme.muted }]} numberOfLines={1}>{line}</Text>
                  ))}
                </View>
              </PressableScale>
            );
          })}
          {usingNewAddress ? (
            // The Edit link is a sibling of the radio (not inside it): a
            // button nested in a role="radio" element is a nested
            // interactive control on web. Same visual row as before.
            <View style={[styles.option, { borderColor: theme.text, borderWidth: 1.5 }]}>
              <View style={styles.newAddressRadio} accessibilityRole="radio" accessibilityState={{ selected: true }}>
                <RadioDot selected />
                <View style={styles.optionCopy}>
                  <Text style={[styles.optionTitle, { color: theme.text }]}>New address</Text>
                  {addressLines(address).map(line => (
                    <Text key={line} style={[styles.optionLine, { color: theme.muted }]} numberOfLines={1}>{line}</Text>
                  ))}
                </View>
              </View>
              {editLink}
            </View>
          ) : null}
          <PressableScale
            onPress={() => setSheet('new')}
            style={[styles.addRow, { borderColor: theme.border }]}
            accessibilityRole="button"
            accessibilityLabel="Add a new address"
            rippleEnabled={false}
          >
            <Feather name="plus" size={16} color={theme.text} />
            <Text style={[styles.addText, { color: theme.text }]}>Add a new address</Text>
          </PressableScale>
        </View>
      ) : complete ? (
        <View accessible accessibilityLabel={`Shipping to ${addressLines(address).join(', ')}`}>
          {addressLines(address).map((line, index) => (
            <Text
              key={line}
              style={[index === 0 ? styles.summaryName : styles.summaryLine, { color: index === 0 ? theme.text : theme.muted }]}
            >
              {line}
            </Text>
          ))}
        </View>
      ) : (
        <PressableScale
          onPress={() => setSheet('new')}
          style={[styles.placeholder, { borderColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Add shipping address"
          rippleEnabled={false}
          testID="checkout-add-address"
        >
          <Feather name="map-pin" size={16} color={theme.muted} />
          <Text style={[styles.placeholderText, { color: theme.text }]}>Add shipping address</Text>
          <Feather name="chevron-right" size={18} color={theme.muted} />
        </PressableScale>
      )}

      <AddressSheet
        visible={sheet !== null}
        initial={sheet === 'edit' ? address : { country: address.country || 'US', firstName: address.firstName, lastName: address.lastName, saveAddress: true }}
        canSaveAddresses={canSaveAddresses}
        onCancel={() => setSheet(null)}
        onSubmit={next => { onChange({ ...next, id: undefined }); setSheet(null); }}
      />
    </CheckoutCard>
  );
}

function AddressSheet({
  visible, initial, canSaveAddresses, onCancel, onSubmit,
}: {
  visible: boolean;
  initial: CheckoutAddressDraft;
  canSaveAddresses: boolean;
  onCancel: () => void;
  onSubmit: (address: CheckoutAddressDraft) => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<CheckoutAddressDraft>(initial);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (visible) { setDraft(initial); setAttempted(false); }
    // Reset only when the sheet opens — `initial` is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const errors = getCheckoutAddressErrors(draft);
  const valid = Object.keys(errors).length === 0;
  const set = (patch: CheckoutAddressDraft) => setDraft(previous => ({ ...previous, ...patch }));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheetHeader, { paddingTop: Platform.OS === 'web' ? Math.max(insets.top, SP.sm) : SP.sm, borderBottomColor: theme.border }]}>
          <IconButton name="x" variant="plain" onPress={onCancel} accessibilityLabel="Close address form" />
          <Text style={[styles.sheetTitle, { color: theme.text }]}>Shipping address</Text>
          <View style={{ width: 44 }} />
        </View>
        <ScrollView
          contentContainerStyle={{ padding: SP.md, paddingBottom: Math.max(insets.bottom, SP.sm) + SP.xl }}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          overScrollMode="never"
        >
          <View style={styles.twoCol}>
            <CheckoutField
              label="First name" value={draft.firstName ?? ''} onChangeText={firstName => set({ firstName })}
              error={errors.firstName} showError={attempted} autoCapitalize="words" autoComplete="name-given"
              textContentType="givenName" style={{ flex: 1 }}
            />
            <CheckoutField
              label="Last name" value={draft.lastName ?? ''} onChangeText={lastName => set({ lastName })}
              error={errors.lastName} showError={attempted} autoCapitalize="words" autoComplete="name-family"
              textContentType="familyName" style={{ flex: 1 }}
            />
          </View>
          <AddressAutocompleteInput
            value={draft.line1 ?? ''}
            country={draft.country ?? 'US'}
            onChangeText={line1 => set({ line1 })}
            onSelect={selected => set({
              line1: selected.line1, city: selected.city, state: selected.state,
              postalCode: selected.postalCode, country: selected.country,
            })}
          />
          {attempted && errors.line1 ? (
            <Text style={[styles.inlineError, { color: theme.error }]}>{errors.line1}</Text>
          ) : null}
          <CheckoutField
            label="Apartment, suite, etc. (optional)" value={draft.line2 ?? ''} onChangeText={line2 => set({ line2 })}
            textContentType="streetAddressLine2" style={{ marginTop: SP.sm }}
          />
          <CheckoutField
            label="City" value={draft.city ?? ''} onChangeText={city => set({ city })}
            error={errors.city} showError={attempted} autoCapitalize="words" textContentType="addressCity"
          />
          <View style={styles.twoCol}>
            <CheckoutField
              label="State" value={draft.state ?? ''} onChangeText={state => set({ state })}
              error={errors.state} showError={attempted} autoCapitalize="characters" textContentType="addressState"
              style={{ flex: 1 }}
            />
            <CheckoutField
              label="ZIP code" value={draft.postalCode ?? ''} onChangeText={postalCode => set({ postalCode })}
              error={errors.postalCode} showError={attempted} autoCapitalize="characters" keyboardType="number-pad"
              autoComplete="postal-code" textContentType="postalCode" style={{ flex: 1 }}
            />
          </View>
          <CheckoutField
            label="Country" value={draft.country ?? 'US'} onChangeText={country => set({ country })}
            error={errors.country} showError={attempted} autoCapitalize="characters" textContentType="countryName"
          />

          {canSaveAddresses ? (
            <View style={[styles.saveRow, { borderColor: theme.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.saveTitle, { color: theme.text }]}>Save to my addresses</Text>
                <Text style={[styles.saveHint, { color: theme.muted }]}>Use it again next time</Text>
              </View>
              <HapticSwitch
                value={draft.saveAddress !== false}
                onValueChange={saveAddress => set({ saveAddress })}
                trackColor={{ false: theme.borderSubtle, true: theme.text }}
                thumbColor={theme.background}
              />
            </View>
          ) : null}

          <Button
            label="Use this address"
            variant="primary"
            fullWidth
            style={{ marginTop: SP.lg }}
            onPress={() => {
              if (!valid) { setAttempted(true); return; }
              onSubmit({ ...draft, line1: draft.line1?.trim(), city: draft.city?.trim(), state: draft.state?.trim(), postalCode: draft.postalCode?.trim() });
            }}
            testID="checkout-use-address"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  link: { fontFamily: FONT.semibold, fontSize: FS.sm, textDecorationLine: 'underline' },
  list: { gap: SP.sm },
  option: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm + 4,
    borderRadius: RADII.card, padding: SP.sm + 6,
  },
  optionCopy: { flex: 1, minWidth: 0 },
  newAddressRadio: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm + 4 },
  optionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: 2 },
  optionTitle: { fontFamily: FONT.semibold, fontSize: FS.base },
  optionLine: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19 },
  badge: {
    fontFamily: FONT.medium, fontSize: FS.xs, borderWidth: 1, borderRadius: RADII.chip,
    paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden',
  },
  addRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm,
    borderRadius: RADII.card, borderWidth: 1, borderStyle: 'dashed',
  },
  addText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  summaryName: { fontFamily: FONT.semibold, fontSize: FS.base, lineHeight: 21 },
  summaryLine: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
  placeholder: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4,
    borderWidth: 1, borderRadius: RADII.card, paddingHorizontal: SP.sm + 6, minHeight: 52,
  },
  placeholderText: { flex: 1, fontFamily: FONT.medium, fontSize: FS.base },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.sm, paddingBottom: SP.sm, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontFamily: FONT.semibold, fontSize: FS.md },
  twoCol: { flexDirection: 'row', gap: SP.sm + 4 },
  inlineError: { fontFamily: FONT.medium, fontSize: FS.xs + 1, marginTop: -2 },
  saveRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    borderTopWidth: StyleSheet.hairlineWidth, paddingTop: SP.md, marginTop: SP.xs,
  },
  saveTitle: { fontFamily: FONT.medium, fontSize: FS.base },
  saveHint: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2 },
});
