/**
 * SHIPPING ADDRESS, inline on the page (Shop "Review & Pay"): no second
 * screen, no sheet.
 *
 *  - Signed-in buyers with an address book see their saved addresses as
 *    selectable rows, then "Use a new address", which opens the form right
 *    here.
 *  - Everyone else gets the form directly:
 *      full name, street (the app's Google Places autocomplete), apt,
 *      ZIP + state, city, country. Typing a US ZIP fills City and State
 *      (GET /api/geo/postal), so most buyers never open the State picker;
 *      the State / Country pickers are bottom sheets with search and the
 *      likely value first (components/checkout/RegionPickerSheet).
 *  - "Save to my addresses" for signed-in buyers entering a new one.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { AddressAutocompleteInput } from '@/components/AddressAutocompleteInput';
import { getCheckoutAddressErrors } from '@/lib/checkoutReadiness';
import { recipientName } from '@/lib/checkoutPayment';
import { COUNTRIES, US_STATES, normalizeUsState } from '@/lib/addressRegions';
import { deviceCountry, suggestedRegion, usStateForZip } from '@/lib/regionPicker';
import { useApi } from '@/hooks/useApi';
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
  address, onChange, savedAddresses, onSelectSaved, canSaveAddresses, showErrors, bare,
}: {
  address: CheckoutAddressDraft;
  onChange: (next: CheckoutAddressDraft) => void;
  savedAddresses: SavedAddress[];
  onSelectSaved: (address: SavedAddress) => void;
  canSaveAddresses: boolean;
  showErrors: boolean;
  /** Inside a sheet that already says "Shipping address": no heading or divider. */
  bare?: boolean;
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

  // ZIP → City and State. The ZIP decides the state (USPS); the city is
  // filled when empty, when this autofill put it there, or when the state
  // changed with the ZIP (a city typed for another state is stale).
  const api = useApi();
  const autofilled = useRef<{ city?: string; state?: string }>({});
  const addressRef = useRef(address);
  addressRef.current = address;
  const zip5 = country === 'US' && /^\d{5}$/.test((address.postalCode ?? '').trim()) ? address.postalCode!.trim() : null;
  useEffect(() => {
    if (!zip5) return;
    let active = true;
    const timer = setTimeout(() => {
      void api.buyer.addresses.lookupPostal(zip5)
        .then(found => {
          const latest = addressRef.current;
          if (!active || !found || (latest.postalCode ?? '').trim() !== zip5) return;
          const patch: CheckoutAddressDraft = {};
          const city = (latest.city ?? '').trim();
          const state = (latest.state ?? '').trim();
          const stateChanged = !!state && normalizeUsState(state) !== found.state;
          if (!city || city === autofilled.current.city || stateChanged) patch.city = found.city;
          if (normalizeUsState(state) !== found.state) patch.state = found.state;
          autofilled.current = { city: patch.city ?? autofilled.current.city, state: patch.state ?? autofilled.current.state };
          if (patch.city !== undefined || patch.state !== undefined) onChange({ ...latest, ...patch, id: undefined });
        })
        .catch(() => {});
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zip5]);

  const zipState = suggestedRegion(US_STATES, usStateForZip(address.postalCode));
  const localeCountry = suggestedRegion(COUNTRIES, deviceCountry());

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
      <View style={styles.twoCol}>
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
        {country === 'US' ? (
          <PickerField
            label="State"
            value={normalizeUsState(address.state ?? '')}
            options={US_STATES}
            onChange={state => set({ state })}
            error={errors.state}
            showError={showErrors}
            placeholder="Select"
            suggested={zipState}
            suggestedLabel="From your ZIP code"
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
      </View>
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
      <PickerField
        label="Country"
        value={country}
        options={COUNTRIES}
        onChange={next => set({ country: next, ...(next !== country ? { state: '' } : {}) })}
        error={errors.country}
        showError={showErrors}
        suggested={localeCountry}
        suggestedLabel="Your region"
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
            accessibilityLabel="Save to my addresses"
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <CheckoutSection title={bare ? undefined : 'Shipping address'} first={bare} testID="checkout-shipping">
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
