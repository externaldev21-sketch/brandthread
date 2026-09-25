/**
 * Brandthread — Seller Locations
 * Multi-location inventory management wired to real backend.
 */
import React, { useState, useCallback } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, TextInput, Modal,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useApi } from '@/lib/api';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';

interface Location {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
  phone?: string;
  is_active: boolean;
  is_primary: boolean;
  fulfills_online_orders: boolean;
  created_at: string;
}

const TABS = ['All', 'Active', 'Inactive'];

export default function LocationsScreen() {
  const colors = useColors();
  const api = useApi();
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<Location | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [form, setForm] = useState({ name: '', address: '', city: '', state: '', country: 'US', zip: '', phone: '' });

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.seller.locations() as any;
      setLocations(data.locations ?? []);
    } catch {
      setLocations([]);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const filtered = locations.filter(loc => {
    if (activeTab === 'Active')   return loc.is_active;
    if (activeTab === 'Inactive') return !loc.is_active;
    return true;
  });

  function openAdd() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditTarget(null);
    setForm({ name: '', address: '', city: '', state: '', country: 'US', zip: '', phone: '' });
    setModalVisible(true);
  }

  function openEdit(loc: Location) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditTarget(loc);
    setForm({
      name: loc.name, address: loc.address ?? '', city: loc.city ?? '',
      state: loc.state ?? '', country: loc.country ?? 'US', zip: loc.zip ?? '', phone: loc.phone ?? '',
    });
    setModalVisible(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { Alert.alert('Name is required'); return; }
    setSaving(true);
    try {
      if (editTarget) {
        await api.seller.updateLocation(editTarget.id, form) as any;
      } else {
        await api.seller.createLocation(form) as any;
      }
      setModalVisible(false);
      await load();
    } catch {
      Alert.alert('Error', 'Could not save location. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(loc: Location) {
    Alert.alert('Delete location', `Remove "${loc.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await api.seller.deleteLocation(loc.id) as any;
            await load();
          } catch (e: any) {
            Alert.alert('Cannot delete', e?.message ?? 'Please try again.');
          }
        },
      },
    ]);
  }

  async function toggleActive(loc: Location) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await api.seller.updateLocation(loc.id, { isActive: !loc.is_active }) as any;
      await load();
    } catch {}
  }

  const activeCount = locations.filter(l => l.is_active).length;

  return (
    <View style={[s.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Locations" />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          <View style={s.section}>
            {/* Header */}
            <View style={s.rowBetween}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[s.sectionTitle, { color: colors.foreground }]}>All locations</Text>
                <Text style={[s.sectionSubtitle, { color: colors.mutedForeground }]}>
                  Using {activeCount} of 10 active location{activeCount !== 1 ? 's' : ''} available on your plan
                </Text>
              </View>
              <TouchableOpacity onPress={openAdd} activeOpacity={0.7} style={[s.addBtn, { borderColor: colors.border }]}>
                <Text style={[s.addBtnText, { color: colors.foreground }]}>Add location</Text>
              </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View style={s.toolbarRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                <View style={[s.tabsRow, { backgroundColor: colors.secondary }]}>
                  {TABS.map((tab) => (
                    <TouchableOpacity
                      key={tab}
                      onPress={() => { Haptics.selectionAsync(); setActiveTab(tab); }}
                      activeOpacity={0.7}
                      style={[s.tabChip, activeTab === tab && { backgroundColor: colors.card }]}
                    >
                      <Text style={[s.tabText, { color: activeTab === tab ? colors.foreground : colors.mutedForeground }, activeTab === tab && s.tabTextActive]}>
                        {tab}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* Location list */}
            {filtered.length === 0 ? (
              <View style={[s.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="map-pin" size={28} color={colors.mutedForeground} style={{ marginBottom: 10 }} />
                <Text style={[s.emptyText, { color: colors.mutedForeground }]}>
                  {activeTab === 'All' ? 'No locations yet. Add your first location.' : `No ${activeTab.toLowerCase()} locations.`}
                </Text>
              </View>
            ) : (
              <View style={[s.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {filtered.map((loc, i) => (
                  <View key={loc.id} style={[s.locationRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <View style={s.rowStart}>
                        <Text style={[s.rowLabel, { color: colors.foreground }]}>{loc.name}</Text>
                        {loc.is_primary && (
                           <View style={[s.primaryBadge, { backgroundColor: colors.accent, borderColor: colors.primary }]}>
                             <Text style={[s.primaryBadgeText, { color: colors.primary }]}>Primary</Text>
                          </View>
                        )}
                      </View>
                      {(loc.city || loc.country) && (
                        <Text style={[s.rowDescription, { color: colors.mutedForeground }]}>
                          {[loc.city, loc.state, loc.country].filter(Boolean).join(', ')}
                        </Text>
                      )}
                      {loc.address && (
                        <Text style={[s.rowAddress, { color: colors.mutedForeground }]} numberOfLines={1}>{loc.address}</Text>
                      )}
                    </View>
                    <View style={s.locActions}>
                      <TouchableOpacity
                        onPress={() => toggleActive(loc)}
                        activeOpacity={0.7}
                        style={[s.statusPill, { backgroundColor: loc.is_active ? `${colors.success}20` : `${colors.border}80` }]}
                      >
                        <Text style={[s.statusPillText, { color: loc.is_active ? colors.success : colors.mutedForeground }]}>
                          {loc.is_active ? 'Active' : 'Inactive'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => openEdit(loc)} style={s.iconAction} activeOpacity={0.7}>
                        <Feather name="edit-2" size={15} color={colors.mutedForeground} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDelete(loc)} style={s.iconAction} activeOpacity={0.7}>
                        <Feather name="trash-2" size={15} color={colors.mutedForeground} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {/* Add / Edit Modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={[s.modal, { backgroundColor: colors.background }]}>
          <View style={[s.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setModalVisible(false)} style={s.modalCloseBtn}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[s.modalTitle, { color: colors.foreground }]}>
              {editTarget ? 'Edit location' : 'Add location'}
            </Text>
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={[s.modalSaveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
            >
              {saving ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Text style={[s.modalSaveBtnText, { color: colors.primaryForeground }]}>Save</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.modalBody}>
            {[
              { label: 'Location name *', key: 'name', placeholder: 'e.g. Main Warehouse' },
              { label: 'Address', key: 'address', placeholder: '123 Example St' },
              { label: 'City', key: 'city', placeholder: 'Los Angeles' },
              { label: 'State / Province', key: 'state', placeholder: 'CA' },
              { label: 'ZIP / Postal code', key: 'zip', placeholder: '90001' },
              { label: 'Country', key: 'country', placeholder: 'US' },
              { label: 'Phone', key: 'phone', placeholder: '+1 555 000 0000' },
            ].map(({ label, key, placeholder }) => (
              <View key={key} style={s.formField}>
                <Text style={[s.formLabel, { color: colors.mutedForeground }]}>{label}</Text>
                <TextInput
                  value={(form as any)[key]}
                  onChangeText={v => setForm(prev => ({ ...prev, [key]: v }))}
                  placeholder={placeholder}
                  placeholderTextColor={colors.mutedForeground}
                  style={[s.formInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle: { fontSize: 15, fontFamily: FONT.semibold, marginBottom: 4 },
  sectionSubtitle: { fontSize: 12, fontFamily: FONT.regular, lineHeight: 17 },
  rowStart: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 },
  addBtn: { borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 14, paddingVertical: 9, alignSelf: 'flex-start' },
  addBtnText: { fontSize: 13, fontFamily: FONT.semibold },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  tabsRow: { flexDirection: 'row', borderRadius: RADIUS.sm, padding: 3, gap: 2 },
  tabChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  tabText: { fontSize: 12, fontFamily: FONT.medium },
  tabTextActive: { fontFamily: FONT.semibold },
  emptyCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 40, alignItems: 'center' },
  emptyText: { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', lineHeight: 20 },
  listCard: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  locationRow: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, gap: 10 },
  rowLabel: { fontSize: 14, fontFamily: FONT.semibold },
  primaryBadge: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  primaryBadgeText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  rowDescription: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  rowAddress: { fontSize: 11, fontFamily: FONT.regular, marginTop: 1 },
  locActions: { flexDirection: 'column', alignItems: 'flex-end', gap: 6 },
  statusPill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillText: { fontSize: 11, fontFamily: FONT.semibold },
  iconAction: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  // Modal
  modal: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 14, borderBottomWidth: 1 },
  modalCloseBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: FS.base, fontFamily: FONT.bold },
  modalSaveBtn: { borderRadius: RADIUS.sm, paddingHorizontal: 16, paddingVertical: 8 },
  modalSaveBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  modalBody: { padding: 20, gap: 16, paddingBottom: 60 },
  formField: { gap: 6 },
  formLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  formInput: { borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: FS.sm, fontFamily: FONT.regular },
});
