/**
 * Brandthread Inventory Location Management Screen
 */

import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, FlatList, TouchableOpacity, TextInput, Switch, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, ORANGE, RED, GOLD, GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, ICON, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, IconButton, StatusBadge, SectionHeader, EmptyState } from '@/components/BrandthreadUI';
import { getLocations, addLocation, updateLocation, archiveLocation } from '@/services/inventoryService';
import { InventoryLocation, LocationType, LOCATION_TYPES } from '@/services/inventoryTypes';

type Mode = 'list' | 'add' | 'edit';

const EMPTY_FORM = {
  name: '',
  type: 'warehouse' as LocationType,
  address: '',
  fulfillmentEnabled: true,
  isPrimary: false,
};

export default function InventoryLocationScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const ls = React.useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>('list');
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [selected, setSelected] = useState<InventoryLocation | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [loadingList, setLoadingList] = useState(true);

  const loadLocations = useCallback(async () => {
    setLoadingList(true);
    try {
      const locs = await getLocations();
      setLocations(locs);
    } catch {
      Alert.alert('Error', 'Failed to load locations.');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadLocations();
    }, [loadLocations])
  );

  const goList = () => {
    setMode('list');
    setSelected(null);
    setForm({ ...EMPTY_FORM });
    loadLocations();
  };

  const goAdd = () => {
    setSelected(null);
    setForm({ ...EMPTY_FORM });
    setMode('add');
  };

  const goEdit = (loc: InventoryLocation) => {
    setSelected(loc);
    setForm({
      name: loc.name,
      type: loc.type,
      address: loc.address ?? '',
      fulfillmentEnabled: loc.fulfillmentEnabled,
      isPrimary: loc.isPrimary,
    });
    setMode('edit');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSetPrimary = async (loc: InventoryLocation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await updateLocation(loc.id, { isPrimary: true });
      await loadLocations();
    } catch {
      Alert.alert('Error', 'Failed to set primary location.');
    }
  };

  const handleArchive = (loc: InventoryLocation) => {
    if (loc.totalUnits > 0) {
      Alert.alert(
        'Cannot Archive',
        `Location has ${loc.totalUnits} units. Reassign inventory first.`
      );
      return;
    }
    Alert.alert(
      'Archive Location',
      `Archive "${loc.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: async () => {
            try {
              await archiveLocation(loc.id);
              await loadLocations();
            } catch {
              Alert.alert('Error', 'Failed to archive location.');
            }
          },
        },
      ]
    );
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      Alert.alert('Validation', 'Location name is required.');
      return;
    }
    setSaving(true);
    try {
      if (mode === 'add') {
        await addLocation({
          name: form.name.trim(),
          type: form.type,
          address: form.address.trim() || undefined,
          fulfillmentEnabled: form.fulfillmentEnabled,
        });
        if (form.isPrimary) {
          const locs = await getLocations();
          const newest = locs[locs.length - 1];
          if (newest) await updateLocation(newest.id, { isPrimary: true });
        }
      } else if (mode === 'edit' && selected) {
        await updateLocation(selected.id, {
          name: form.name.trim(),
          type: form.type,
          address: form.address.trim() || undefined,
          fulfillmentEnabled: form.fulfillmentEnabled,
          isPrimary: form.isPrimary ? true : undefined,
        });
      }
      goList();
    } catch {
      Alert.alert('Error', 'Failed to save location.');
    } finally {
      setSaving(false);
    }
  };

  // ── LIST MODE ───────────────────────────────────────────────────────────────

  if (mode === 'list') {
    return (
      <View style={[ls.root, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={ls.header}>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
            style={ls.backBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <Text style={ls.headerTitle}>Inventory Locations</Text>
          <TouchableOpacity onPress={goAdd} style={ls.addBtn}>
            <Feather name="plus" size={ICON.sm} color={PURPLE} />
            <Text style={ls.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>

        {loadingList ? (
          <View style={ls.centered}>
            <ActivityIndicator color={PURPLE} />
          </View>
        ) : locations.length === 0 ? (
          <ScrollView contentContainerStyle={ls.emptyContainer}>
            <EmptyState
              icon="map-pin"
              title="No locations yet"
              description="Add a location to track where your products are stored."
              action={{ label: 'Add Location', onPress: goAdd, icon: 'plus' }}
            />
          </ScrollView>
        ) : (
          <FlatList
            data={locations}
            keyExtractor={item => item.id}
            contentContainerStyle={ls.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <BrandthreadCard style={ls.locationCard}>
                {/* Top row: badges + name */}
                <View style={ls.locTitleRow}>
                  {item.isPrimary && (
                    <StatusBadge label="★ PRIMARY" variant="purple" small />
                  )}
                  <Text style={ls.locName} numberOfLines={1}>{item.name}</Text>
                  {item.fulfillmentEnabled && (
                    <StatusBadge label="● Fulfillment" variant="success" small />
                  )}
                </View>

                {/* Subtitle */}
                <Text style={ls.locMeta}>
                  {LOCATION_TYPES.find(t => t.key === item.type)?.label ?? item.type}
                  {item.address ? ` · ${item.address}` : ''}
                </Text>

                {/* Stats */}
                <View style={ls.statsRow}>
                  <Text style={ls.statText}>{item.totalUnits} total</Text>
                  <Text style={ls.statDot}>·</Text>
                  <Text style={ls.statText}>{item.availableUnits} available</Text>
                  <Text style={ls.statDot}>·</Text>
                  <Text style={ls.statText}>{item.reservedUnits} reserved</Text>
                  <Text style={ls.statDot}>·</Text>
                  <Text style={ls.statText}>{item.incomingUnits} incoming</Text>
                </View>

                {item.lowStockCount > 0 && (
                  <View style={ls.alertRow}>
                    <StatusBadge label={`${item.lowStockCount} low stock`} variant="warning" small />
                  </View>
                )}

                {/* Actions */}
                <View style={ls.actionRow}>
                  <TouchableOpacity style={ls.actionBtn} onPress={() => goEdit(item)}>
                    <Feather name="edit-2" size={12} color={PURPLE} />
                    <Text style={[ls.actionBtnText, { color: PURPLE }]}>Edit</Text>
                  </TouchableOpacity>
                  {!item.isPrimary && (
                    <TouchableOpacity style={ls.actionBtn} onPress={() => handleSetPrimary(item)}>
                      <Feather name="star" size={12} color={GOLD} />
                      <Text style={[ls.actionBtnText, { color: GOLD }]}>Set Primary</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[ls.actionBtn, { borderColor: 'rgba(248,113,113,0.3)' }]} onPress={() => handleArchive(item)}>
                    <Feather name="archive" size={12} color={RED} />
                    <Text style={[ls.actionBtnText, { color: RED }]}>Archive</Text>
                  </TouchableOpacity>
                </View>
              </BrandthreadCard>
            )}
          />
        )}

        {/* Bottom add button */}
        {locations.length > 0 && (
          <View style={[ls.bottomBar, { paddingBottom: insets.bottom + SP.md }]}>
            <PrimaryButton label="+ Add Location" onPress={goAdd} />
          </View>
        )}
      </View>
    );
  }

  // ── ADD / EDIT MODE ─────────────────────────────────────────────────────────

  return (
    <View style={[ls.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={ls.header}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); goList(); }}
          style={ls.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={ls.headerTitle}>{mode === 'add' ? 'Add Location' : 'Edit Location'}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={[ls.formContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Name */}
        <View style={ls.fieldGroup}>
          <Text style={ls.fieldLabel}>Name *</Text>
          <TextInput
            style={ls.textInput}
            value={form.name}
            onChangeText={v => setForm(f => ({ ...f, name: v }))}
            placeholder="e.g. Main Warehouse"
            placeholderTextColor={SUBTLE}
          />
        </View>

        {/* Type chips */}
        <View style={ls.fieldGroup}>
          <Text style={ls.fieldLabel}>Type</Text>
          <View style={ls.chipGrid}>
            {LOCATION_TYPES.map((lt, idx) => {
              const isActive = form.type === lt.key;
              return (
                <TouchableOpacity
                  key={lt.key}
                  style={[ls.typeChip, isActive && ls.typeChipActive]}
                  onPress={() => { Haptics.selectionAsync(); setForm(f => ({ ...f, type: lt.key })); }}
                  activeOpacity={0.8}
                >
                  <Text style={[ls.typeChipText, isActive && ls.typeChipTextActive]}>{lt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Address */}
        <View style={ls.fieldGroup}>
          <Text style={ls.fieldLabel}>Address</Text>
          <TextInput
            style={[ls.textInput, ls.textInputMulti]}
            value={form.address}
            onChangeText={v => setForm(f => ({ ...f, address: v }))}
            placeholder="Street, City, State ZIP"
            placeholderTextColor={SUBTLE}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {/* Fulfillment switch */}
        <View style={ls.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={ls.switchLabel}>Fulfillment Enabled</Text>
            <Text style={ls.switchDesc}>Enable this location for order fulfillment</Text>
          </View>
          <Switch
            value={form.fulfillmentEnabled}
            onValueChange={v => setForm(f => ({ ...f, fulfillmentEnabled: v }))}
            trackColor={{ false: BORDER, true: PURPLE }}
            thumbColor={FG}
          />
        </View>

        {/* Primary switch */}
        <View style={ls.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={ls.switchLabel}>Set as Primary</Text>
            <Text style={ls.switchDesc}>Make this the primary location</Text>
          </View>
          <Switch
            value={form.isPrimary}
            onValueChange={v => setForm(f => ({ ...f, isPrimary: v }))}
            trackColor={{ false: BORDER, true: PURPLE }}
            thumbColor={FG}
          />
        </View>

        {/* Save */}
        <View style={{ marginTop: SP.lg }}>
          <PrimaryButton
            label="Save Location"
            icon="check"
            onPress={handleSave}
            loading={saving}
          />
        </View>
        <View style={{ marginTop: SP.sm }}>
          <SecondaryButton
            label="Cancel"
            onPress={goList}
          />
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (theme: { accent: string; accentLight: string; accentDim: string; secondary: string; secondaryDim: string }) => {
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    minHeight: 56,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
    flex: 1,
    textAlign: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SP.sm,
    paddingVertical: 6,
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
  },
  addBtnText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: PURPLE,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  listContent: {
    padding: SP.md,
    gap: SP.sm,
    paddingBottom: 120,
  },
  locationCard: {
    marginBottom: 0,
  },
  locTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  locName: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
    flex: 1,
  },
  locMeta: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    marginBottom: 8,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  statText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: SUBTLE,
  },
  statDot: {
    fontSize: FS.xs,
    color: SUBTLE,
  },
  alertRow: {
    marginBottom: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: SP.sm,
    flexWrap: 'wrap',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
  },
  actionBtnText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
  },
  bottomBar: {
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: BG,
  },
  // Form styles
  formContent: {
    padding: SP.md,
    gap: SP.md,
  },
  fieldGroup: {
    gap: SP.sm,
  },
  fieldLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: MUTED,
    letterSpacing: 0.2,
  },
  textInput: {
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.md,
    height: 52,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: FG,
  },
  textInputMulti: {
    height: 90,
    paddingTop: SP.sm,
    paddingBottom: SP.sm,
    textAlignVertical: 'top',
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    width: '47%',
    alignItems: 'center',
  },
  typeChipActive: {
    backgroundColor: PURPLE_DIM,
    borderColor: BORDER_ACTIVE,
  },
  typeChipText: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  typeChipTextActive: {
    color: PURPLE,
    fontFamily: FONT.semibold,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
  },
  switchLabel: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
    marginBottom: 2,
  },
  switchDesc: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  });
};
