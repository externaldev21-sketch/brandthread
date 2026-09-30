/**
 * SHIPPING ADDRESS, inline on the page (Shop "Review & Pay"): no second
 * screen, no sheet.
 *
 *  - Signed-in buyers with an address book see their saved addresses as
 *    selectable rows, then "Use a new address", which opens the form right
 *    here.
 *  - Everyone else gets the form directly:
 *      full name, street (the app's Google Places autocomplete), apt, city,
 *      state (picker), ZIP, country (picker).
 *  - "Save to my addresses" for signed-in buyers entering a new one.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { AddressAutocompleteInput } from '@/components/AddressAutocompleteInput';
import { getCheckoutAddressErrors } from '@/lib/checkoutReadiness';
import { recipientName } from '@/lib/checkoutPayment';
import { COUNTRIES, US_STATES, normalizeUsState } from '@/lib/addressRegions';
import type { CheckoutAddress } from '@/services/cartTypes';
import { FONT, FS, SP } from '@/lib/theme';
import { CheckoutField, CheckoutSection, OptionRow, PickerField, useCheckoutColors, type CheckoutColors } from './CheckoutPrimitives';

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

function savedLines(address: SavedAddress): string[] {
  return [
    [address.street, address.line2].filter(Boolean).join(', '),
    `${address.city}, ${address.state} ${address.postalCode}`,
  ];
}

/** "Jordan Reyes" → first "Jordan", last "Reyes" (everything after the first space). */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const clean = fullName.replace(/\s+/g, ' ').trimStart();
  const space = clean.indexOf(' ');
  if (space < 0) return { firstName: clean, lastName: '' };
  return { firstName: clean.slice(0, space), lastName: clean.slice(space + 1) };
}

export function ShippingSection({
  address, onChange, savedAddresses, onSelectSaved, canSaveAddresses, showErrors,
}: {
  address: CheckoutAddressDraft;
  onChange: (next: CheckoutAddressDraft) => void;
  savedAddresses: SavedAddress[];
  onSelectSaved: (address: SavedAddress) => void;
  canSaveAddresses: boolean;
  showErrors: boolean;
}) {
  const ck = useCheckoutColors();
  const styles = useMemo(() => makeStyles(ck), [ck]);
  const hasSaved = savedAddresses.length > 0;
  const usingNew = !address.id;
  const errors = getCheckoutAddressErrors(address);
  const country = (address.country || 'US').toUpperCase();
  const set = (patch: CheckoutAddressDraft) => onChange({ ...address, ...patch, id: undefined });

  // The name is one field; keep what's typed (including a trailing space)
  // and only re-sync when the address changes from outside (a saved
  // address picked, or a wallet sheet filled it).
  const [nameText, setNameText] = useState(recipientName(address));
  useEffect(() => {
    const incoming = recipientName(address);
    if (incoming !== nameText.replace(/\s+/g, ' ').trim()) setNameText(incoming);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address.firstName, address.lastName]);

  const form = (
    <View style={hasSaved ? styles.formUnderRows : undefined} testID="checkout-address-form">
      <CheckoutField
        label="Full name"
        value={nameText}
        onChangeText={text => { setNameText(text); set(splitFullName(text)); }}
        error={errors.firstName}
        showError={showErrors}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        testID="checkout-full-name"
      />
      <AddressAutocompleteInput
        value={address.line1 ?? ''}
        country={country}
        onChangeText={line1 => set({ line1 })}
        onSelect={selected => set({
          line1: selected.line1, city: selected.city,
          state: selected.country === 'US' ? normalizeUsState(selected.state) : selected.state,
          postalCode: selected.postalCode, country: selected.country,
        })}
      />
      {showErrors && errors.line1 ? <Text style={styles.inlineError}>{errors.line1}</Text> : null}
      <CheckoutField
        label="Apt, suite, etc. (optional)"
        value={address.line2 ?? ''}
        onChangeText={line2 => set({ line2 })}
        textContentType="streetAddressLine2"
        autoComplete="address-line2"
        style={{ marginTop: SP.sm }}
        testID="checkout-line2"
      />
      <CheckoutField
        label="City"
        value={address.city ?? ''}
        onChangeText={city => set({ city })}
        error={errors.city}
        showError={showErrors}
        autoCapitalize="words"
        textContentType="addressCity"
        testID="checkout-city"
      />
      <View style={styles.twoCol}>
        {country === 'US' ? (
          <PickerField
            label="State"
            value={normalizeUsState(address.state ?? '')}
            options={US_STATES}
            onChange={state => set({ state })}
            error={errors.state}
            showError={showErrors}
            placeholder="Select"
            style={styles.col}
            testID="checkout-state"
          />
        ) : (
          <CheckoutField
            label="State / Province"
            value={address.state ?? ''}
            onChangeText={state => set({ state })}
            error={errors.state}
            showError={showErrors}
            autoCapitalize="words"
            textContentType="addressState"
            style={styles.col}
            testID="checkout-state"
          />
        )}
        <CheckoutField
          label={country === 'US' ? 'ZIP code' : 'Postal code'}
          value={address.postalCode ?? ''}
          onChangeText={postalCode => set({ postalCode })}
          error={errors.postalCode}
          showError={showErrors}
          autoCapitalize="characters"
          keyboardType={country === 'US' ? 'number-pad' : 'default'}
          autoComplete="postal-code"
          textContentType="postalCode"
          style={styles.col}
          testID="checkout-zip"
        />
      </View>
      <PickerField
        label="Country"
        value={country}
        options={COUNTRIES}
        onChange={next => set({ country: next, ...(next !== country ? { state: '' } : {}) })}
        error={errors.country}
        showError={showErrors}
        testID="checkout-country"
      />
      {canSaveAddresses ? (
        <View style={styles.saveRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.saveTitle}>Save to my addresses</Text>
            <Text style={styles.saveHint}>Use it again next time</Text>
          </View>
          <HapticSwitch
            value={address.saveAddress !== false}
            onValueChange={saveAddress => set({ saveAddress })}
            trackColor={{ false: ck.fieldBorder, true: ck.text }}
            thumbColor={address.saveAddress !== false ? ck.bg : ck.text}
            accessibilityLabel="Save to my addresses"
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <CheckoutSection title="Shipping address" testID="checkout-shipping">
      {hasSaved ? (
        <View accessibilityRole="radiogroup">
          {savedAddresses.map(saved => (
            <OptionRow
              key={saved.id}
              selected={address.id === saved.id}
              onPress={() => onSelectSaved(saved)}
              title={saved.recipientName || saved.label || 'Saved address'}
              lines={savedLines(saved)}
              testID={`checkout-saved-address-${saved.id}`}
            />
          ))}
          <OptionRow
            selected={usingNew}
            onPress={() => { if (!usingNew) onChange({ country: 'US', saveAddress: true }); }}
            title="Use a new address"
            last={!usingNew}
            testID="checkout-new-address"
          />
        </View>
      ) : null}
      {!hasSaved || usingNew ? form : null}
    </CheckoutSection>
  );
}

function makeStyles(ck: CheckoutColors) {
  return StyleSheet.create({
    formUnderRows: { paddingTop: SP.md },
    twoCol: { flexDirection: 'row', gap: SP.sm + 4 },
    col: { flex: 1 },
    inlineError: { fontFamily: FONT.medium, fontSize: FS.meta, color: ck.text, marginTop: -2 },
    saveRow: {
      flexDirection: 'row', alignItems: 'center', gap: SP.sm,
      borderTopWidth: 1, borderTopColor: ck.divider, paddingTop: SP.md, marginTop: SP.xs,
    },
    saveTitle: { fontFamily: FONT.medium, fontSize: FS.base, color: ck.text },
    saveHint: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2, color: ck.muted },
  });
}
