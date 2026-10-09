import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { FONT, COMP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';
import { useAuth } from '@clerk/expo';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button, Card, IconButton } from '@/components/ui';
import { EmptyState } from '@/components/BrandthreadUI';
import { hapticDestructiveConfirm, hapticSuccess, hapticToggle } from '@/lib/haptics';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { goBackOr } from '@/lib/navigation/goBackOr';

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
  const [isDefault, setIsDefault] = useState(false);

  const load = async () => {
    if (!userId) {
      setAddresses([]);
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
    Haptics.selectionAsync();
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
    Haptics.selectionAsync();
    setEditingId(addr.id);
    setIsCreating(false);
    setLabel(addr.label || '');
    setRecipientName(addr.recipientName || '');
    setStreet(addr.street || '');
    setLine2(addr.line2 || '');
    setCity(addr.city || '');
    setState(addr.state || '');
    setPostalCode(addr.postalCode || '');
    setCountry(addr.country || 'US');
    setPhone(addr.phone || '');
    setIsDefault(addr.isDefault);
  };

  const handleCancel = () => {
    setEditingId(null);
    setIsCreating(false);
  };

  const handleSave = async () => {
    if (!label || !recipientName || !street || !city || !state || !postalCode || !country) {
      Alert.alert('Missing fields', 'Please fill out all required fields.');
      return;
    }

    setSaving(true);
    const body = {
      label, recipientName, street, line2: line2 || undefined,
      city, state, postalCode, country, phone: phone || undefined,
      isDefault
    };

    try {
      if (isCreating) {
        await api.buyer.addresses.create(body);
      } else if (editingId) {
        await api.buyer.addresses.update(editingId, body);
      }
      hapticSuccess();
      await load();
      handleCancel();
    } catch (e: any) {
      Alert.alert('Error', "Couldn't save this address. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    Alert.alert('Delete Address', 'Are you sure you want to remove this address?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          hapticDestructiveConfirm();
          await api.buyer.addresses.delete(id);
          await load();
        } catch {
          Alert.alert('Error', 'Could not delete address.');
        }
      }}
    ]);
  };

  const handleSetDefault = async (id: string) => {
    try {
      hapticToggle();
      await api.buyer.addresses.setDefault(id);
      await load();
    } catch {
      Alert.alert('Error', 'Could not set default address.');
    }
  };

  const showForm = isCreating || editingId;

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
                <TextInput value={label} onChangeText={setLabel} style={styles.input} placeholder="Label" placeholderTextColor={palette.mutedForeground} returnKeyType="next" />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Recipient name</Text>
                <TextInput value={recipientName} onChangeText={setRecipientName} style={styles.input} placeholder="Full name" placeholderTextColor={palette.mutedForeground} autoCapitalize="words" textContentType="name" autoComplete="name" returnKeyType="next" />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Street address</Text>
                <TextInput value={street} onChangeText={setStreet} style={styles.input} placeholder="123 Main St" placeholderTextColor={palette.mutedForeground} textContentType="streetAddressLine1" autoComplete="street-address" returnKeyType="next" />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Apt, Suite, etc. (optional)</Text>
                <TextInput value={line2} onChangeText={setLine2} style={styles.input} placeholder="Apt 4B" placeholderTextColor={palette.mutedForeground} textContentType="streetAddressLine2" returnKeyType="next" />
              </View>
              <View style={styles.row}>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>City</Text>
                  <TextInput value={city} onChangeText={setCity} style={styles.input} placeholder="City" placeholderTextColor={palette.mutedForeground} autoCapitalize="words" textContentType="addressCity" returnKeyType="next" />
                </View>
                <View style={[styles.field, { flex: 1, marginLeft: SPACING.sm }]}>
                  <Text style={styles.label}>State / Province</Text>
                  <TextInput value={state} onChangeText={setState} style={styles.input} placeholder="State" placeholderTextColor={palette.mutedForeground} autoCapitalize="characters" textContentType="addressState" returnKeyType="next" />
                </View>
              </View>
              <View style={styles.row}>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>ZIP / Postal Code</Text>
                  <TextInput value={postalCode} onChangeText={setPostalCode} style={styles.input} placeholder="ZIP" placeholderTextColor={palette.mutedForeground} keyboardType="number-pad" textContentType="postalCode" autoComplete="postal-code" returnKeyType="next" />
                </View>
                <View style={[styles.field, { flex: 1, marginLeft: SPACING.sm }]}>
                  <Text style={styles.label}>Country</Text>
                  <TextInput value={country} onChangeText={setCountry} style={styles.input} placeholder="US" placeholderTextColor={palette.mutedForeground} autoCapitalize="characters" textContentType="countryName" returnKeyType="next" />
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Phone (optional)</Text>
                <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" style={styles.input} placeholder="Phone number" placeholderTextColor={palette.mutedForeground} textContentType="telephoneNumber" autoComplete="tel" returnKeyType="done" />
              </View>

              <TouchableOpacity
                style={styles.defaultToggle}
                onPress={() => setIsDefault(true)}
                disabled={isDefault}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityLabel="Set as default address"
                accessibilityState={{ checked: isDefault, disabled: isDefault }}
              >
                <View style={[styles.checkbox, isDefault && styles.checkboxActive]}>
                  {isDefault && <Feather name="check" size={14} color={theme.onAccent} />}
                </View>
                <Text style={styles.defaultToggleText}>Set as default address</Text>
              </TouchableOpacity>

              <Button label="Save Address" onPress={handleSave} loading={saving} style={{ marginTop: SPACING.lg }} />
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
                    accessibilityLabel="Retry loading saved addresses"
                    onPress={() => {
                      setLoading(true);
                      void load();
                    }}
                  />
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
                  {addresses.map(addr => (
                    <Card key={addr.id} style={styles.card}>
                      <View style={styles.cardHeader}>
                        <View style={styles.row}>
                          <Text style={styles.cardLabel}>{addr.label}</Text>
                          {addr.isDefault && <View style={styles.defaultBadge}><Text style={styles.defaultBadgeText}>Default</Text></View>}
                        </View>
                        <View style={styles.actions}>
                          <IconButton name="edit-2" accessibilityLabel={`Edit ${addr.label} address`} onPress={() => handleEdit(addr)} variant="plain" size={16} color={theme.muted} />
                          <IconButton name="trash-2" accessibilityLabel={`Delete ${addr.label} address`} onPress={() => handleDelete(addr.id)} variant="plain" size={16} color={theme.error} />
                        </View>
                      </View>

                      <View style={styles.cardBody}>
                        <Text style={styles.addressText}>{addr.recipientName}</Text>
                        <Text style={styles.addressText}>{addr.street}</Text>
                        {!!addr.line2 && <Text style={styles.addressText}>{addr.line2}</Text>}
                        <Text style={styles.addressText}>{addr.city}, {addr.state} {addr.postalCode}</Text>
                        <Text style={styles.addressText}>{addr.country}</Text>
                        {!!addr.phone && <Text style={styles.addressText}>{addr.phone}</Text>}
                      </View>

                      {!addr.isDefault && (
                        <Button
                          label="Set as default"
                          accessibilityLabel={`Set ${addr.label} as default address`}
                          onPress={() => handleSetDefault(addr.id)}
                          variant="tertiary"
                          style={styles.makeDefaultBtn}
                        />
                      )}
                    </Card>
                  ))}
                </View>
              )}

              <Button label="Add new address" onPress={handleAddNew} variant="secondary" icon="plus" style={styles.addBtn} />
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

  defaultToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: SPACING.xxs },
  checkbox: { width: 22, height: 22, borderRadius: 8, borderWidth: 1, borderColor: theme.muted, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  defaultToggleText: { ...TYPE_SCALE.body, fontFamily: FONT.medium, color: theme.text },
});
