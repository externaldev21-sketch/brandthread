import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, COMP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { useAuth } from '@clerk/expo';
import { Header } from '@/components/layout';
import { EmptyState } from '@/components/BrandthreadUI';

export default function BuyerAddressesScreen() {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { userId } = useAuth();

  const [addresses, setAddresses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
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
      setLoading(false);
      return;
    }
    try {
      const data = await api.buyer.addresses.list();
      setAddresses(data);
    } catch {
      setAddresses([]);
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
          await api.buyer.addresses.delete(id);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await load();
        } catch {
          Alert.alert('Error', 'Could not delete address.');
        }
      }}
    ]);
  };

  const handleSetDefault = async (id: string) => {
    try {
      Haptics.selectionAsync();
      await api.buyer.addresses.setDefault(id);
      await load();
    } catch {
      Alert.alert('Error', 'Could not set default address.');
    }
  };

  if (loading) {
    return (
      <View style={[styles.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  const showForm = isCreating || editingId;

  return (
    <View style={styles.root}>
      <Header
        title={showForm ? (isCreating ? 'Add address' : 'Edit address') : 'Shipping addresses'}
        onBack={() => { if (showForm) handleCancel(); else router.back(); }}
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          
          {showForm ? (
            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={styles.label}>Label (e.g. Home, Office)</Text>
                    <TextInput value={label} onChangeText={setLabel} style={styles.input} placeholder="Label" placeholderTextColor={theme.subtle} />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Recipient name</Text>
                <TextInput value={recipientName} onChangeText={setRecipientName} style={styles.input} placeholder="Full name" placeholderTextColor={theme.subtle} />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Street address</Text>
                <TextInput value={street} onChangeText={setStreet} style={styles.input} placeholder="123 Main St" placeholderTextColor={theme.subtle} />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Apt, Suite, etc. (optional)</Text>
                <TextInput value={line2} onChangeText={setLine2} style={styles.input} placeholder="Apt 4B" placeholderTextColor={theme.subtle} />
              </View>
              <View style={styles.row}>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>City</Text>
                  <TextInput value={city} onChangeText={setCity} style={styles.input} placeholder="City" placeholderTextColor={theme.subtle} />
                </View>
                <View style={[styles.field, { flex: 1, marginLeft: SP.sm }]}>
                  <Text style={styles.label}>State / Province</Text>
                  <TextInput value={state} onChangeText={setState} style={styles.input} placeholder="State" placeholderTextColor={theme.subtle} />
                </View>
              </View>
              <View style={styles.row}>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>ZIP / Postal Code</Text>
                  <TextInput value={postalCode} onChangeText={setPostalCode} style={styles.input} placeholder="ZIP" placeholderTextColor={theme.subtle} />
                </View>
                <View style={[styles.field, { flex: 1, marginLeft: SP.sm }]}>
                  <Text style={styles.label}>Country</Text>
                  <TextInput value={country} onChangeText={setCountry} style={styles.input} placeholder="US" placeholderTextColor={theme.subtle} />
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Phone (optional)</Text>
                <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" style={styles.input} placeholder="Phone number" placeholderTextColor={theme.subtle} />
              </View>

              {!isDefault && (
                <TouchableOpacity style={styles.defaultToggle} onPress={() => setIsDefault(!isDefault)} activeOpacity={0.7}>
                  <View style={[styles.checkbox, isDefault && styles.checkboxActive]}>
                     {isDefault && <Feather name="check" size={14} color={theme.onAccent} />}
                  </View>
                  <Text style={styles.defaultToggleText}>Set as default address</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={handleSave} disabled={saving} activeOpacity={0.8}>
                {saving ? <ActivityIndicator color={theme.onAccent} /> : <Text style={styles.saveBtnText}>Save Address</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {addresses.length === 0 ? (
                <EmptyState
                  icon="map-pin"
                  title="No saved addresses"
                  description="You haven't saved any addresses yet."
                />
              ) : (
                <View style={styles.list}>
                  {addresses.map(addr => (
                    <View key={addr.id} style={styles.card}>
                      <View style={styles.cardHeader}>
                        <View style={styles.row}>
                          <Text style={styles.cardLabel}>{addr.label}</Text>
                          {addr.isDefault && <View style={styles.defaultBadge}><Text style={styles.defaultBadgeText}>Default</Text></View>}
                        </View>
                        <View style={styles.actions}>
                          <TouchableOpacity onPress={() => handleEdit(addr)} style={styles.actionBtn}>
                           <Feather name="edit-2" size={16} color={theme.muted} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => handleDelete(addr.id)} style={styles.actionBtn}>
                           <Feather name="trash-2" size={16} color={theme.error} />
                          </TouchableOpacity>
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
                        <TouchableOpacity style={styles.makeDefaultBtn} onPress={() => handleSetDefault(addr.id)}>
                          <Text style={styles.makeDefaultText}>Set as default</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              )}

              <TouchableOpacity style={styles.addBtn} onPress={handleAddNew} activeOpacity={0.8}>
                <Feather name="plus" size={18} color={theme.accentLight} />
                <Text style={styles.addBtnText}>Add new address</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },

  empty: { padding: SP.xl, alignItems: 'center', marginTop: SP.xl },
  emptyText: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.base, textAlign: 'center' },
  
  list: { gap: SP.md, marginBottom: SP.lg },
  card: { backgroundColor: theme.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SP.md, borderBottomWidth: 1, borderBottomColor: theme.border },
  row: { flexDirection: 'row', alignItems: 'center' },
  cardLabel: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base },
  defaultBadge: { backgroundColor: `${theme.success}26`, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.sm, marginLeft: SP.sm },
  defaultBadgeText: { color: theme.success, fontFamily: FONT.semibold, fontSize: FS.xs },
  actions: { flexDirection: 'row', gap: SP.sm },
  actionBtn: { padding: 4 },
  cardBody: { padding: SP.md },
  addressText: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
  makeDefaultBtn: { borderTopWidth: 1, borderTopColor: theme.border, padding: SP.md, alignItems: 'center' },
  makeDefaultText: { color: theme.accentLight, fontFamily: FONT.medium, fontSize: FS.sm },

  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: SP.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.accent, borderStyle: 'dashed' },
  addBtnText: { color: theme.accentLight, fontFamily: FONT.semibold, fontSize: FS.base },

  form: { gap: SP.md },
  field: { gap: 6 },
  label: { color: theme.muted, fontFamily: FONT.medium, fontSize: FS.sm },
  input: { backgroundColor: theme.cardElevated, borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.md, paddingHorizontal: SP.md, height: COMP.inputH, color: theme.text, fontFamily: FONT.regular, fontSize: FS.base },
  
  defaultToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: SP.xs },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: theme.muted, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  defaultToggleText: { color: theme.text, fontFamily: FONT.medium, fontSize: FS.base },
  
  saveBtn: { backgroundColor: theme.accent, height: COMP.buttonH, borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center', marginTop: SP.lg },
  saveBtnText: { color: theme.onAccent, fontFamily: FONT.bold, fontSize: FS.base },
});
