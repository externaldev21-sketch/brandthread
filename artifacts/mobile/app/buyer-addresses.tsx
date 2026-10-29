import { hapticDestructiveConfirm, hapticSuccess, hapticToggle, haptics } from '@/lib/haptics';

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';

import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';

import { Icon } from '@/components/ui/Icon';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRouter } from 'expo-router';

import { FONT, COMP } from '@/lib/theme';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { useColors } from '@/hooks/useColors';

import { useApi } from '@/lib/api';

import { useAuth } from '@clerk/expo';

import { ScreenHeader } from '@/components/ScreenHeader';

import { Button, Card, IconButton } from '@/components/ui';

import { EmptyState } from '@/components/BrandthreadUI';


import { TYPE_SCALE } from '@/constants/typography';

import { SPACING } from '@/constants/spacing';

import { RADII } from '@/constants/radii';

import { goBackOr } from '@/lib/navigation/goBackOr';

import { isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';

import { PREVIEW_CHECKOUT_ADDRESS, PREVIEW_CHECKOUT_CONTACT } from '@/lib/previewCheckout';

import { showAlert, confirmAlert } from '@/lib/actionSheet';

import { friendlyError } from '@/lib/friendlyError';

// Country: the same searchable picker as checkout's Country field
// (components/checkout/ShippingSection → PickerField → RegionPickerSheet),
// storing the same ISO code ("US") the free-text field did.
import { RegionPickerSheet } from '@/components/checkout/RegionPickerSheet';

import { COUNTRIES } from '@/lib/addressRegions';

import { deviceCountry, suggestedRegion } from '@/lib/regionPicker';

type AddressAction = 'delete' | 'default';

/** "US" → "United States"; unknown / legacy values show as stored. */
export function countryName(code: string | null | undefined): string {
  const value = (code ?? '').trim();
  return COUNTRIES.find(c => c.value === value.toUpperCase())?.label ?? value;
}

/** Stored country → picker value: ISO codes are upper-cased, anything else kept. */
function normalizeCountry(code: string | null | undefined): string {
  const value = (code ?? '').trim();
  if (!value) return 'US';
  const upper = value.toUpperCase();
  return COUNTRIES.some(c => c.value === upper) ? upper : value;
}

/**
 * Sample addresses for the populated buyer demo (`?bt_preview=buyer&demo=1`)
 * only — the same "Jordan Reyes" the demo checkout pre-fills. A fresh preview
 * and every real account start with none.
 */
const PREVIEW_DEMO_ADDRESSES = [
  {
    id: 'preview-address-home',
    label: 'Home',
    recipientName: `${PREVIEW_CHECKOUT_ADDRESS.firstName} ${PREVIEW_CHECKOUT_ADDRESS.lastName}`,
    street: PREVIEW_CHECKOUT_ADDRESS.line1,
    line2: 'Apt 4B',
    city: PREVIEW_CHECKOUT_ADDRESS.city,
    state: PREVIEW_CHECKOUT_ADDRESS.state,
    postalCode: PREVIEW_CHECKOUT_ADDRESS.postalCode,
    country: PREVIEW_CHECKOUT_ADDRESS.country,
    phone: PREVIEW_CHECKOUT_CONTACT.phone,
    isDefault: true,
  },
  {
    id: 'preview-address-work',
    label: 'Work',
    recipientName: `${PREVIEW_CHECKOUT_ADDRESS.firstName} ${PREVIEW_CHECKOUT_ADDRESS.lastName}`,
    street: '85 Broad Street',
    line2: 'Floor 12',
    city: 'New York',
    state: 'NY',
    postalCode: '10004',
    country: 'US',
    isDefault: false,
  },
];

export default function BuyerAddressesScreen() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const styles = makeStyles(theme, palette);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { userId } = useAuth();

  const [addresses, setAddresses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // Per-address delete / set-default in flight. The ref guards synchronous
  // double taps (before the disabled state re-renders); it also covers the
  // delete confirmation so a double tap can't stack two dialogs.
  const [pending, setPending] = useState<Record<string, AddressAction>>({});
  const pendingRef = useRef<Record<string, AddressAction | 'confirm'>>({});
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);

  // Form
  const [label, setLabel] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [street, setStreet] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('US');
  const [phone, setPhone] = useState('');
  // Return key walks the address form top to bottom.
  const fieldRefs = useRef<Record<string, TextInput | null>>({});
  const focusField = (key: string) => () => fieldRefs.current[key]?.focus();
  const [isDefault, setIsDefault] = useState(false);

  // Signed-out buyer preview: no account, so never call the protected
  // address API — edits stay on this screen. Demo seeds sample addresses.
  const localPreview = !userId && isBuyerDevPreview();
  // Signed out for real: saving would fail, so offer sign-in instead of a form.
  const signedOut = !userId && !localPreview;

  const load = async () => {
    if (!userId) {
      if (localPreview && isPreviewDemoMode()) {
        setAddresses(prev => (prev.length ? prev : PREVIEW_DEMO_ADDRESSES));
      } else if (!localPreview) {
        setAddresses([]);
      }
      setLoadError('');
      setLoading(false);
      return;
    }
    try {
      const data = await api.buyer.addresses.list();
      setAddresses(Array.isArray(data) ? data : []);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load your saved addresses.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [userId]);

  const handleAddNew = () => {
    setEditingId(null);
    setIsCreating(true);
    setLabel('Home');
    setRecipientName('');
    setStreet('');
    setLine2('');
    setCity('');
    setState('');
    setPostalCode('');
    setCountry('US');
    setPhone('');
    setIsDefault(addresses.length === 0);
  };

  const handleEdit = (addr: any) => {
    setEditingId(addr.id);
    setIsCreating(false);
    setLabel(addr.label || '');
    setRecipientName(addr.recipientName || '');
    setStreet(addr.street || '');
    setLine2(addr.line2 || '');
    setCity(addr.city || '');
    setState(addr.state || '');
    setPostalCode(addr.postalCode || '');
    setCountry(normalizeCountry(addr.country));
    setPhone(addr.phone || '');
    setIsDefault(addr.isDefault);
  };

  const handleCancel = () => {
    setEditingId(null);
    setIsCreating(false);
  };

  const handleSave = async () => {
    const missing = [
      [label, 'label'], [recipientName, 'recipient name'], [street, 'street address'],
      [city, 'city'], [state, 'state'], [postalCode, 'ZIP / postal code'], [country, 'country'],
    ].filter(([value]) => !value.trim()).map(([, name]) => name);
    if (missing.length > 0) {
      showAlert('Missing fields', `Please add: ${missing.join(', ')}.`);
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;

    setSaving(true);
    const body = {
      label, recipientName, street, line2: line2 || undefined,
      city, state, postalCode, country, phone: phone || undefined,
      isDefault
    };

    if (localPreview) {
      const id = editingId ?? `preview-address-${Date.now()}`;
      setAddresses(prev => {
        const next = isCreating ? [...prev, { id, ...body }] : prev.map(a => (a.id === id ? { ...a, ...body } : a));
        return isDefault ? next.map(a => ({ ...a, isDefault: a.id === id })) : next;
      });
      handleCancel();
      savingRef.current = false;
      setSaving(false);
      return;
    }

    try {
      if (isCreating) {
        await api.buyer.addresses.create(body);
      } else if (editingId) {
        await api.buyer.addresses.update(editingId, body);
      }
      await load();
      handleCancel();
    } catch (e: unknown) {
      showAlert("Couldn't save address", friendlyError(e, 'Try again.'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const beginPending = (id: string, action: AddressAction) => {
    pendingRef.current[id] = action;
    setPending(prev => ({ ...prev, [id]: action }));
  };
  const endPending = (id: string) => {
    delete pendingRef.current[id];
    setPending(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleDelete = async (id: string) => {
    if (pendingRef.current[id]) return;
    pendingRef.current[id] = 'confirm';
    const confirmed = await confirmAlert({
      title: 'Delete address?',
      message: 'Are you sure you want to remove this address?',
      cancelLabel: 'Keep',
      confirmLabel: 'Delete address',
      destructive: true,
    });
    if (!confirmed) {
      delete pendingRef.current[id];
      return;
    }
    if (localPreview) {
      delete pendingRef.current[id];
      setAddresses(prev => prev.filter(a => a.id !== id));
      return;
    }
    beginPending(id, 'delete');
    try {
      await api.buyer.addresses.delete(id);
      await load();
    } catch (e: unknown) {
      showAlert("Couldn't delete address", friendlyError(e, 'Try again.'));
    } finally {
      endPending(id);
    }
  };

  const handleSetDefault = async (id: string) => {
    if (pendingRef.current[id]) return;
    if (localPreview) { setAddresses(prev => prev.map(a => ({ ...a, isDefault: a.id === id }))); return; }
    beginPending(id, 'default');
    try {
      await api.buyer.addresses.setDefault(id);
      await load();
    } catch (e: unknown) {
      showAlert("Couldn't set default address", friendlyError(e, 'Try again.'));
    } finally {
      endPending(id);
    }
  };

  const localeCountry = suggestedRegion(COUNTRIES, deviceCountry());

  const showForm = isCreating || editingId;
  // The first address, and the current default, must stay default (the
  // checkbox used to lock on after any tap, with no way to undo it).
  const defaultLocked = isCreating
    ? addresses.length === 0
    : !!addresses.find(a => a.id === editingId)?.isDefault;

  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Shipping addresses" />
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={showForm ? (isCreating ? 'Add address' : 'Edit address') : 'Shipping addresses'}
        onBack={() => { if (showForm) handleCancel(); else goBackOr(router); }}
        backAccessibilityLabel={showForm ? 'Close address form' : 'Go back'}
        variant={showForm ? 'modal' : 'push'}
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">

          {showForm ? (
            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={styles.label}>Label (e.g. Home, Office)</Text>
                <TextInput value={label} ref={(r) => { fieldRefs.current.label = r; }} accessibilityLabel="Label" onChangeText={setLabel} style={styles.input} placeholder="Home" placeholderTextColor={palette.mutedForeground} returnKeyType="next" autoComplete="off" blurOnSubmit={false} onSubmitEditing={focusField('recipientName')} />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Recipient name</Text>
                <TextInput value={recipientName} ref={(r) => { fieldRefs.current.recipientName = r; }} accessibilityLabel="Recipient name" onChangeText={setRecipientName} style={styles.input} placeholder="Maya Chen" placeholderTextColor={palette.mutedForeground} autoCapitalize="words" textContentType="name" autoComplete="name" returnKeyType="next" blurOnSubmit={false} onSubmitEditing={focusField('street')} />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Street address</Text>
                <TextInput value={street} ref={(r) => { fieldRefs.current.street = r; }} accessibilityLabel="Street address" onChangeText={setStreet} style={styles.input} placeholder="123 Main St" placeholderTextColor={palette.mutedForeground} textContentType="streetAddressLine1" autoComplete="address-line1" returnKeyType="next" blurOnSubmit={false} onSubmitEditing={focusField('line2')} />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Apt, Suite, etc. (optional)</Text>
                <TextInput value={line2} ref={(r) => { fieldRefs.current.line2 = r; }} accessibilityLabel="Apt, suite, etc. (optional)" onChangeText={setLine2} style={styles.input} placeholder="Apt 4B" placeholderTextColor={palette.mutedForeground} textContentType="streetAddressLine2" returnKeyType="next" autoComplete="address-line2" blurOnSubmit={false} onSubmitEditing={focusField('city')} />
              </View>
              <View style={styles.row}>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>City</Text>
                  <TextInput value={city} ref={(r) => { fieldRefs.current.city = r; }} accessibilityLabel="City" onChangeText={setCity} style={styles.input} placeholder="Los Angeles" placeholderTextColor={palette.mutedForeground} autoCapitalize="words" textContentType="addressCity" returnKeyType="next" autoComplete="postal-address-locality" blurOnSubmit={false} onSubmitEditing={focusField('state')} />
                </View>
                <View style={[styles.field, { flex: 1, marginLeft: SPACING.sm }]}>
                  <Text style={styles.label}>State / Province</Text>
                  <TextInput value={state} ref={(r) => { fieldRefs.current.state = r; }} accessibilityLabel="State / province" onChangeText={setState} style={styles.input} placeholder="CA" placeholderTextColor={palette.mutedForeground} autoCapitalize="characters" textContentType="addressState" returnKeyType="next" autoComplete="postal-address-region" blurOnSubmit={false} onSubmitEditing={focusField('postalCode')} />
                </View>
              </View>
              <View style={styles.row}>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>ZIP / postal code</Text>
                  <TextInput value={postalCode} ref={(r) => { fieldRefs.current.postalCode = r; }} accessibilityLabel="ZIP / postal code" onChangeText={setPostalCode} style={styles.input} placeholder="90012" placeholderTextColor={palette.mutedForeground} keyboardType={country === 'US' ? 'number-pad' : 'default'} autoCapitalize="characters" autoCorrect={false} textContentType="postalCode" autoComplete="postal-code" returnKeyType="next" blurOnSubmit={false} onSubmitEditing={focusField('phone')} />
                </View>
                <View style={[styles.field, { flex: 1, marginLeft: SPACING.sm }]}>
                  <Text style={styles.label}>Country</Text>
                  <TouchableOpacity
                    style={[styles.input, styles.picker]}
                    onPress={() => setCountryPickerOpen(true)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Country: ${countryName(country) || 'not chosen'}`}
                    accessibilityHint="Opens a list of countries"
                    testID="address-country"
                  >
                    <Text style={[styles.pickerText, !country && { color: palette.mutedForeground }]} numberOfLines={1}>
                      {countryName(country) || 'Select'}
                    </Text>
                    <Icon name="chevron-down" size={16} color={theme.muted} />
                  </TouchableOpacity>
                  <RegionPickerSheet
                    visible={countryPickerOpen}
                    title="Country"
                    options={COUNTRIES}
                    value={country}
                    suggested={localeCountry}
                    suggestedLabel="Your region"
                    onSelect={setCountry}
                    onClose={() => setCountryPickerOpen(false)}
                    testID="address-country-picker"
                  />
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Phone (optional)</Text>
                <TextInput value={phone} ref={(r) => { fieldRefs.current.phone = r; }} accessibilityLabel="Phone (optional)" onChangeText={setPhone} keyboardType="phone-pad" style={styles.input} placeholder="Phone number" placeholderTextColor={palette.mutedForeground} textContentType="telephoneNumber" autoComplete="tel" returnKeyType="done" onSubmitEditing={() => fieldRefs.current.phone?.blur()} />
              </View>

              <TouchableOpacity
                style={styles.defaultToggle}
                onPress={() => setIsDefault(v => !v)}
                disabled={defaultLocked}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityLabel="Set as default address"
                accessibilityState={{ checked: isDefault, disabled: defaultLocked }}
              >
                <View style={[styles.checkbox, isDefault && styles.checkboxActive]}>
                  {isDefault && <Icon name="check" size={14} color={theme.onAccent} />}
                </View>
                <Text style={styles.defaultToggleText}>Set as default address</Text>
              </TouchableOpacity>

              <Button label="Save address" onPress={handleSave} loading={saving} style={{ marginTop: SPACING.lg }} />
            </View>
          ) : (
            <>
              {loadError ? (
                <View style={styles.errorWrap} accessibilityRole="alert">
                  <EmptyState
                    icon="alert-circle"
                    title="Addresses unavailable"
                    description="We couldn't load your saved addresses. Check your connection and try again."
                    compact
                  />
                  <Button
                    label="Try again"
                    size="slim"
                    accessibilityLabel="Retry loading saved addresses"
                    onPress={() => {
                      setLoading(true);
                      void load();
                    }}
                  />
                </View>
              ) : signedOut ? (
                <View style={styles.errorWrap}>
                  <EmptyState
                    icon="map-pin"
                    title="Sign in to save addresses"
                    description="Your shipping addresses are saved to your account for faster checkout."
                    compact
                  />
                  <Button label="Sign in" size="slim" onPress={() => router.push('/sign-in' as never)} />
                </View>
              ) : addresses.length === 0 ? (
                <EmptyState
                  icon="map-pin"
                  title="No saved addresses"
                  description="You haven't saved any addresses yet. Add one to speed up checkout."
                  compact
                />
              ) : (
                <View style={styles.list}>
                  {addresses.map(addr => {
                    const busy = pending[addr.id];
                    return (
                    <Card key={addr.id} style={styles.card}>
                      <View style={styles.cardHeader}>
                        <View style={styles.row}>
                          <Text style={styles.cardLabel}>{addr.label}</Text>
                          {addr.isDefault && <View style={styles.defaultBadge}><Text style={styles.defaultBadgeText}>Default</Text></View>}
                        </View>
                        <View style={styles.actions}>
                          <IconButton name="edit-2" accessibilityLabel={`Edit ${addr.label} address`} onPress={() => handleEdit(addr)} disabled={!!busy} variant="plain" size={16} color={theme.muted} />
                          {busy === 'delete' ? (
                            <View
                              style={styles.actionSpinner}
                              accessible
                              accessibilityRole="button"
                              accessibilityLabel={`Deleting ${addr.label} address`}
                              accessibilityState={{ disabled: true, busy: true }}
                              testID={`address-delete-pending-${addr.id}`}
                            >
                              <ActivityIndicator size="small" color={theme.muted} />
                            </View>
                          ) : (
                            <IconButton name="trash-2" accessibilityLabel={`Delete ${addr.label} address`} onPress={() => handleDelete(addr.id)} disabled={!!busy} variant="plain" size={16} color={theme.error} />
                          )}
                        </View>
                      </View>

                      <View style={styles.cardBody}>
                        <Text style={styles.addressText}>{addr.recipientName}</Text>
                        <Text style={styles.addressText}>{addr.street}</Text>
                        {!!addr.line2 && <Text style={styles.addressText}>{addr.line2}</Text>}
                        <Text style={styles.addressText}>{addr.city}, {addr.state} {addr.postalCode}</Text>
                        <Text style={styles.addressText}>{countryName(addr.country)}</Text>
                        {!!addr.phone && <Text style={styles.addressText}>{addr.phone}</Text>}
                      </View>

                      {!addr.isDefault && (
                        <Button
                          label="Set as default"
                          accessibilityLabel={`Set ${addr.label} as default address`}
                          onPress={() => handleSetDefault(addr.id)}
                          loading={busy === 'default'}
                          disabled={!!busy}
                          variant="tertiary"
                          style={styles.makeDefaultBtn}
                        />
                      )}
                    </Card>
                    );
                  })}
                </View>
              )}

              {signedOut ? null : (
                <Button label="Add new address" onPress={handleAddNew} variant="secondary" icon="plus" style={styles.addBtn} />
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme'], palette: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorWrap: { alignItems: 'center', gap: SPACING.md, marginTop: SPACING.lg },

  list: { gap: SPACING.md, marginBottom: SPACING.xl },
  card: { padding: 0, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
  row: { flexDirection: 'row', alignItems: 'center' },
  cardLabel: { ...TYPE_SCALE.body, fontFamily: FONT.semibold, color: theme.text },
  defaultBadge: { backgroundColor: `${theme.success}26`, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADII.chip, marginLeft: SPACING.sm },
  defaultBadgeText: { ...TYPE_SCALE.caption, fontFamily: FONT.semibold, color: theme.success },
  actions: { flexDirection: 'row', gap: SPACING.xs },
  cardBody: { padding: SPACING.md },
  addressText: { ...TYPE_SCALE.callout, color: theme.muted, lineHeight: 20 },
  makeDefaultBtn: { minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, borderRadius: 0, marginTop: 0 },

  addBtn: { borderStyle: 'dashed', borderColor: theme.accent },

  form: { gap: SPACING.md },
  field: { gap: 6 },
  label: { ...TYPE_SCALE.footnote, fontFamily: FONT.medium, color: theme.muted },
  input: { backgroundColor: theme.cardElevated, borderWidth: 1, borderColor: theme.border, borderRadius: RADII.input, paddingHorizontal: SPACING.md, height: COMP.inputH, color: theme.text, ...TYPE_SCALE.body },
  picker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.xs },
  pickerText: { ...TYPE_SCALE.body, color: theme.text, flexShrink: 1 },
  actionSpinner: { width: COMP.iconBtn, height: COMP.iconBtn, alignItems: 'center', justifyContent: 'center' },

  defaultToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: SPACING.xxs },
  checkbox: { width: 22, height: 22, borderRadius: 8, borderWidth: 1, borderColor: theme.muted, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  defaultToggleText: { ...TYPE_SCALE.body, fontFamily: FONT.medium, color: theme.text },
});
