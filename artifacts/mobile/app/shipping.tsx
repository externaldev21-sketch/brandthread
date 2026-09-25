import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert, TextInput, ActivityIndicator } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '@/components/layout';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { isSellerSetupOrigin, SELLER_HOME_ROUTE } from '@/lib/setupNavigation';
import { completeSetupTaskAfter } from '@/lib/setupCompletion';
import { FS, SP, RADIUS } from '@/lib/theme';
import { dbStatusToOrderStatus } from '@/lib/orderStatusAdapter';
import { parseDecimalToCents } from '@/lib/money';
import { HapticSwitch } from '@/components/BrandthreadUI';

// ─── Types ──────────────────────────────────────────────────────────────────

type ZoneType = 'domestic' | 'country' | 'rest_of_world';
type PricingModel = 'flat' | 'weight_tiered';
type Duties = 'ddp' | 'dap';

interface WeightTier {
  id?: string;
  minWeightGrams: number;
  maxWeightGrams: number | null;
  rateCents: number;
}

interface ShippingZone {
  id: string;
  name: string;
  zoneType: ZoneType;
  countries: string[];
  pricingModel: PricingModel;
  flatRateCents: number;
  freeAboveCents: number | null;
  processingDays: number;
  carrierLabel: string | null;
  shipsInternationally: boolean;
  dutiesHandling: Duties;
  active: boolean;
  sortOrder: number;
  weightTiers: WeightTier[];
}

interface PackagePreset {
  id: string;
  name: string;
  weightOz: number;
  lengthIn: string;
  widthIn: string;
  heightIn: string;
}

const ZONE_TYPE_LABEL: Record<ZoneType, string> = {
  domestic: 'Domestic',
  country: 'Country',
  rest_of_world: 'Rest of world',
};

const CARRIER_SUGGESTIONS = [
  'USPS First Class', 'USPS Priority', 'USPS Priority Express',
  'UPS Ground', 'UPS 2nd Day Air', 'FedEx Ground', 'FedEx Express',
  'DHL Express', 'DHL eCommerce', 'Royal Mail', 'Canada Post',
];

function emptyZoneForm(zoneType: ZoneType) {
  return {
    id: null as string | null,
    name: zoneType === 'domestic' ? 'Domestic' : zoneType === 'rest_of_world' ? 'Rest of World' : '',
    zoneType,
    countriesText: '',
    pricingModel: 'flat' as PricingModel,
    flatRate: '',
    freeAbove: '',
    processingDays: '2',
    carrierLabel: '',
    shipsInternationally: zoneType !== 'domestic',
    dutiesHandling: 'dap' as Duties,
    weightTiers: [{ minWeightGrams: 0, maxWeightGrams: null as number | null, rateCents: 0 }] as WeightTier[],
  };
}
type ZoneForm = ReturnType<typeof emptyZoneForm>;

function shipmentProgress(status: string): number {
  // Order → Label → Pickup → Transit → Delivered, derived from the real
  // order status — never fabricated.
  switch (status) {
    case 'ready_to_ship': return 25;
    case 'shipped':       return 70;
    case 'delivered':     return 100;
    default:              return 10;
  }
}

function shipmentStatusLabel(status: string): string {
  switch (status) {
    case 'ready_to_ship': return 'Label Created';
    case 'shipped':       return 'In Transit';
    case 'delivered':     return 'Delivered';
    default:              return 'Processing';
  }
}

function capitalize(s: string) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function zoneRateSummary(zone: ShippingZone): string {
  if (zone.pricingModel === 'weight_tiered') {
    const tiers = zone.weightTiers ?? [];
    if (tiers.length === 0) return 'No tiers configured';
    const cheapest = [...tiers].sort((a, b) => a.rateCents - b.rateCents)[0];
    return `From ${formatCents(cheapest.rateCents)} · ${tiers.length} tier${tiers.length === 1 ? '' : 's'}`;
  }
  return zone.flatRateCents === 0 ? 'Free' : formatCents(zone.flatRateCents);
}

export default function ShippingScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams();
  const launchedFromSellerSetup = isSellerSetupOrigin(params.from);
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [sellerReturns, setSellerReturns] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);

  // Legacy flat-rate list — still supported server-side as a fallback, shown
  // read-only here once zones exist to avoid two competing editors.
  const [legacyRates, setLegacyRates] = useState<any[]>([]);

  const [zones, setZones] = useState<ShippingZone[]>([]);
  const [zonesLoading, setZonesLoading] = useState(true);
  const [shipFromCountry, setShipFromCountry] = useState('US');
  const [shipFromDraft, setShipFromDraft] = useState('US');
  const [shipFromEditing, setShipFromEditing] = useState(false);
  const [savingShipFrom, setSavingShipFrom] = useState(false);

  const [presets, setPresets] = useState<PackagePreset[]>([]);
  const [presetSheetVisible, setPresetSheetVisible] = useState(false);
  const [presetForm, setPresetForm] = useState({ id: null as string | null, name: '', weightOz: '', lengthIn: '', widthIn: '', heightIn: '' });
  const [presetSaving, setPresetSaving] = useState(false);

  const [zoneSheetVisible, setZoneSheetVisible] = useState(false);
  const [zoneForm, setZoneForm] = useState<ZoneForm>(emptyZoneForm('country'));
  const [zoneSaving, setZoneSaving] = useState(false);

  function leaveSetupDestination() {
    if (launchedFromSellerSetup) {
      router.replace(SELLER_HOME_ROUTE as never);
      return;
    }
    router.back();
  }

  const loadShipping = useCallback(() => {
    setZonesLoading(true);
    Promise.all([
      api.shippingZones.list().catch(() => []),
      api.shippingZones.getSettings().catch(() => ({ shipFromCountry: 'US' })),
      api.packagePresets.list().catch(() => ({ presets: [] })),
      api.shippingRates.list().catch(() => []),
    ]).then(([zoneRows, settings, presetRes, rateRows]) => {
      setZones(Array.isArray(zoneRows) ? zoneRows : []);
      setShipFromCountry(settings?.shipFromCountry ?? 'US');
      setShipFromDraft(settings?.shipFromCountry ?? 'US');
      setPresets(Array.isArray(presetRes?.presets) ? presetRes.presets : []);
      setLegacyRates(Array.isArray(rateRows) ? rateRows : []);
    }).finally(() => setZonesLoading(false));
  }, [api]);

  useEffect(() => {
    api.returns.listSeller().then(data => setSellerReturns(data ?? [])).catch(() => {});
    api.orders.list().then(data => setOrders(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => { loadShipping(); }, [loadShipping]));

  const orderStatuses = orders.map(o => dbStatusToOrderStatus(o.status));
  const pendingCount = orderStatuses.filter(s => s === 'new' || s === 'processing').length;
  const inTransitCount = orderStatuses.filter(s => s === 'shipped').length;
  const deliveredCount = orderStatuses.filter(s => s === 'delivered').length;
  const activeShipments = orders
    .map(o => ({ row: o, status: dbStatusToOrderStatus(o.status) }))
    .filter(({ row, status }) => !!row.trackingNumber && (status === 'ready_to_ship' || status === 'shipped'))
    .slice(0, 10);

  function shipmentBadge(status: string) {
    if (status === 'Delivered') return 'success';
    if (status === 'Out for Delivery') return 'info';
    if (status === 'In Transit') return 'gold';
    return 'default';
  }

  function returnBadge(status: string) {
    const s = status?.toLowerCase();
    if (s === 'approved') return 'success';
    if (s === 'rejected' || s === 'denied') return 'error';
    return 'warning';
  }

  // ── Ship-from country ────────────────────────────────────────────────────

  async function saveShipFrom() {
    const code = shipFromDraft.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) {
      Alert.alert('Invalid country', 'Enter a 2-letter country code, like US, GB, or CA.');
      return;
    }
    setSavingShipFrom(true);
    try {
      await api.shippingZones.updateSettings(code);
      setShipFromCountry(code);
      setShipFromEditing(false);
    } catch {
      Alert.alert('Couldn’t save', 'Check your connection and try again.');
    } finally {
      setSavingShipFrom(false);
    }
  }

  // ── Zone editor ───────────────────────────────────────────────────────────

  function openNewZone(zoneType: ZoneType = 'country') {
    setZoneForm(emptyZoneForm(zoneType));
    setZoneSheetVisible(true);
  }

  function openEditZone(zone: ShippingZone) {
    setZoneForm({
      id: zone.id,
      name: zone.name,
      zoneType: zone.zoneType,
      countriesText: (zone.countries ?? []).join(', '),
      pricingModel: zone.pricingModel,
      flatRate: (zone.flatRateCents / 100).toFixed(2),
      freeAbove: zone.freeAboveCents != null ? (zone.freeAboveCents / 100).toFixed(2) : '',
      processingDays: String(zone.processingDays ?? 2),
      carrierLabel: zone.carrierLabel ?? '',
      shipsInternationally: zone.shipsInternationally,
      dutiesHandling: zone.dutiesHandling,
      weightTiers: zone.weightTiers?.length
        ? zone.weightTiers.map(t => ({ ...t }))
        : [{ minWeightGrams: 0, maxWeightGrams: null, rateCents: 0 }],
    });
    setZoneSheetVisible(true);
  }

  function updateTier(index: number, patch: Partial<WeightTier>) {
    setZoneForm(f => ({
      ...f,
      weightTiers: f.weightTiers.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    }));
  }

  function addTier() {
    setZoneForm(f => {
      const last = f.weightTiers[f.weightTiers.length - 1];
      const nextMin = last?.maxWeightGrams != null ? last.maxWeightGrams + 1 : (last?.minWeightGrams ?? 0) + 500;
      return { ...f, weightTiers: [...f.weightTiers, { minWeightGrams: nextMin, maxWeightGrams: null, rateCents: 0 }] };
    });
  }

  function removeTier(index: number) {
    setZoneForm(f => ({ ...f, weightTiers: f.weightTiers.filter((_, i) => i !== index) }));
  }

  async function handleSaveZone() {
    const name = zoneForm.name.trim();
    if (!name) return Alert.alert('Name required', 'Give this zone a name.');

    const countries = zoneForm.zoneType === 'country'
      ? zoneForm.countriesText.split(',').map(c => c.trim().toUpperCase()).filter(c => /^[A-Z]{2}$/.test(c))
      : [];
    if (zoneForm.zoneType === 'country' && countries.length === 0) {
      return Alert.alert('Countries required', 'Enter at least one 2-letter country code, separated by commas (e.g. CA, MX).');
    }

    const flatRateCents = parseDecimalToCents(zoneForm.flatRate || '0');
    if (flatRateCents == null) return Alert.alert('Invalid rate', 'Enter a valid flat rate, like 4.99.');

    const freeAboveCents = zoneForm.freeAbove.trim() ? parseDecimalToCents(zoneForm.freeAbove) : null;
    if (zoneForm.freeAbove.trim() && freeAboveCents == null) {
      return Alert.alert('Invalid threshold', 'Enter a valid free-shipping threshold, like 75.00.');
    }

    const processingDays = parseInt(zoneForm.processingDays, 10);
    if (!Number.isInteger(processingDays) || processingDays < 0) {
      return Alert.alert('Invalid processing time', 'Enter a whole number of business days.');
    }

    let tiersPayload: WeightTier[] = [];
    if (zoneForm.pricingModel === 'weight_tiered') {
      for (const t of zoneForm.weightTiers) {
        if (!Number.isInteger(t.minWeightGrams) || t.minWeightGrams < 0 || !Number.isInteger(t.rateCents) || t.rateCents < 0) {
          return Alert.alert('Invalid tier', 'Each weight tier needs a valid starting weight and rate.');
        }
      }
      tiersPayload = zoneForm.weightTiers;
    }

    setZoneSaving(true);
    try {
      const payload = {
        name,
        zoneType: zoneForm.zoneType,
        countries,
        pricingModel: zoneForm.pricingModel,
        flatRateCents,
        freeAboveCents,
        processingDays,
        carrierLabel: zoneForm.carrierLabel.trim() || null,
        shipsInternationally: zoneForm.zoneType === 'domestic' ? true : zoneForm.shipsInternationally,
        dutiesHandling: zoneForm.dutiesHandling,
      };
      let saved: ShippingZone;
      if (zoneForm.id) {
        saved = await completeSetupTaskAfter('shipping_rates', () => api.shippingZones.update(zoneForm.id!, payload));
      } else {
        saved = await completeSetupTaskAfter('shipping_rates', () => api.shippingZones.create(payload));
      }
      if (zoneForm.pricingModel === 'weight_tiered') {
        const tierRes = await api.shippingZones.setWeightTiers(saved.id, tiersPayload);
        saved = { ...saved, weightTiers: tierRes?.weightTiers ?? tiersPayload };
      } else {
        saved = { ...saved, weightTiers: [] };
      }
      setZones(prev => {
        const exists = prev.some(z => z.id === saved.id);
        return exists ? prev.map(z => (z.id === saved.id ? saved : z)) : [...prev, saved];
      });
      setZoneSheetVisible(false);
    } catch {
      Alert.alert('Couldn’t save this zone', 'Check your connection and try again.');
    } finally {
      setZoneSaving(false);
    }
  }

  function handleDeleteZone(zone: ShippingZone) {
    Alert.alert('Delete zone', `Remove "${zone.name}"? This can’t be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await api.shippingZones.delete(zone.id);
            setZones(prev => prev.filter(z => z.id !== zone.id));
          } catch {
            Alert.alert('Couldn’t delete', 'Check your connection and try again.');
          }
        },
      },
    ]);
  }

  async function toggleZoneActive(zone: ShippingZone) {
    const next = !zone.active;
    setZones(prev => prev.map(z => (z.id === zone.id ? { ...z, active: next } : z)));
    try {
      await api.shippingZones.update(zone.id, { active: next });
    } catch {
      setZones(prev => prev.map(z => (z.id === zone.id ? { ...z, active: !next } : z)));
      Alert.alert('Couldn’t update', 'Check your connection and try again.');
    }
  }

  // ── Packaging presets ────────────────────────────────────────────────────

  function openNewPreset() {
    setPresetForm({ id: null, name: '', weightOz: '', lengthIn: '', widthIn: '', heightIn: '' });
    setPresetSheetVisible(true);
  }

  function openEditPreset(preset: PackagePreset) {
    setPresetForm({
      id: preset.id, name: preset.name, weightOz: String(preset.weightOz),
      lengthIn: preset.lengthIn, widthIn: preset.widthIn, heightIn: preset.heightIn,
    });
    setPresetSheetVisible(true);
  }

  async function handleSavePreset() {
    const name = presetForm.name.trim();
    if (!name) return Alert.alert('Name required', 'Give this package a name, like "Small Box".');
    const weightOz = Number(presetForm.weightOz);
    const lengthIn = Number(presetForm.lengthIn);
    const widthIn = Number(presetForm.widthIn);
    const heightIn = Number(presetForm.heightIn);
    if (![weightOz, lengthIn, widthIn, heightIn].every(n => Number.isFinite(n) && n > 0)) {
      return Alert.alert('Invalid dimensions', 'Enter positive numbers for weight and all three dimensions.');
    }
    setPresetSaving(true);
    try {
      const body = { name, weightOz, lengthIn, widthIn, heightIn };
      const res = presetForm.id
        ? await api.packagePresets.update(presetForm.id, body)
        : await api.packagePresets.create(body);
      const preset: PackagePreset = res?.preset;
      setPresets(prev => {
        const exists = prev.some(p => p.id === preset.id);
        return exists ? prev.map(p => (p.id === preset.id ? preset : p)) : [...prev, preset];
      });
      setPresetSheetVisible(false);
    } catch {
      Alert.alert('Couldn’t save this package', 'Check your connection and try again.');
    } finally {
      setPresetSaving(false);
    }
  }

  function handleDeletePreset(preset: PackagePreset) {
    Alert.alert('Delete package', `Remove "${preset.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await api.packagePresets.remove(preset.id);
            setPresets(prev => prev.filter(p => p.id !== preset.id));
          } catch {
            Alert.alert('Couldn’t delete', 'Check your connection and try again.');
          }
        },
      },
    ]);
  }

  const activeZones = [...zones].filter(z => z.active).sort((a, b) => {
    const rank = (t: ZoneType) => (t === 'domestic' ? 0 : t === 'country' ? 1 : 2);
    return rank(a.zoneType) - rank(b.zoneType) || a.sortOrder - b.sortOrder;
  });

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <Header title="Shipping & Fulfillment" onBack={leaveSetupDestination} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { label: 'Pending', value: String(pendingCount), color: colors.warning },
          { label: 'In Transit', value: String(inTransitCount), color: colors.primary },
          { label: 'Delivered', value: String(deliveredCount), color: colors.success },
          { label: 'Returns', value: String(sellerReturns.length), color: colors.destructive },
        ].map((s) => (
          <View key={s.label} style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statVal, { color: s.color }]}>{s.value}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Shipments */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Active Shipments</Text>
      {activeShipments.length === 0 ? (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.emptySection}>
            <Feather name="truck" size={20} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No active shipments</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Buy a label on an order to start tracking.</Text>
          </View>
        </View>
      ) : activeShipments.map(({ row, status }) => (
        <View key={row.id} style={[styles.shipCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.shipHeader}>
            <View>
              <Text style={[styles.shipId, { color: colors.primary }]}>{row.orderNumber ?? row.id}</Text>
              <Text style={[styles.shipCustomer, { color: colors.foreground }]}>{row.customerName ?? 'Customer'}</Text>
              <Text style={[styles.shipCarrier, { color: colors.mutedForeground }]}>
                {row.carrier ?? 'Carrier'}{row.trackingNumber ? ` · ${row.trackingNumber}` : ''}
              </Text>
            </View>
            <Badge label={shipmentStatusLabel(status)} variant={shipmentBadge(shipmentStatusLabel(status)) as any} />
          </View>
          <View style={[styles.progressBar, { backgroundColor: colors.secondary }]}>
            <View style={[styles.progressFill, {
              width: `${shipmentProgress(status)}%`,
              backgroundColor: shipmentProgress(status) === 100 ? colors.success : colors.primary,
            }]} />
          </View>
          <View style={styles.shipSteps}>
            {['Order', 'Label', 'Pickup', 'Transit', 'Delivered'].map((step, i) => {
              const stepPct = (i / 4) * 100;
              const active = shipmentProgress(status) >= stepPct;
              return (
                <View key={step} style={styles.stepItem}>
                  <View style={[styles.stepDot, { backgroundColor: active ? colors.primary : colors.secondary }]} />
                  <Text style={[styles.stepLabel, { color: active ? colors.primary : colors.mutedForeground }]}>{step}</Text>
                </View>
              );
            })}
          </View>
        </View>
      ))}

      {/* Returns */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Returns & Exchanges</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {sellerReturns.length === 0 ? (
          <View style={styles.emptySection}>
            <Feather name="rotate-ccw" size={20} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No return requests</Text>
          </View>
        ) : (
          sellerReturns.map((r, i) => (
            <View key={r.id} style={[styles.returnRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <View style={styles.returnInfo}>
                <Text style={[styles.returnId, { color: colors.primary }]}>
                  {r.id?.slice(0, 8).toUpperCase()} · Buyer {r.buyer_id?.slice(0, 8) ?? '—'}
                </Text>
                <Text style={[styles.returnItem, { color: colors.foreground }]}>{r.reason ?? '—'}</Text>
                <Text style={[styles.returnReason, { color: colors.mutedForeground }]}>{r.notes ?? ''}</Text>
              </View>
              <Badge label={capitalize(r.status)} variant={returnBadge(r.status) as any} />
            </View>
          ))
        )}
      </View>

      {/* Ship-from country */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Ship From</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, padding: 14 }]}>
        <View style={styles.shipFromRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowLabelStrong, { color: colors.foreground }]}>Home country</Text>
            <Text style={[styles.rateSub, { color: colors.mutedForeground }]}>
              Used to decide which zone is "Domestic" for your buyers.
            </Text>
          </View>
          {shipFromEditing ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                value={shipFromDraft}
                onChangeText={t => setShipFromDraft(t.toUpperCase())}
                autoCapitalize="characters"
                maxLength={2}
                placeholder="US"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.countryInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
              <TouchableOpacity onPress={saveShipFrom} disabled={savingShipFrom} style={[styles.smallBtn, { backgroundColor: colors.primary }]}>
                {savingShipFrom ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="check" size={14} color={colors.primaryForeground} />}
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => { setShipFromDraft(shipFromCountry); setShipFromEditing(true); }}
              style={[styles.countryPill, { borderColor: colors.border }]}
            >
              <Text style={[styles.countryPillText, { color: colors.foreground }]}>{shipFromCountry}</Text>
              <Feather name="edit-2" size={12} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Shipping Zones */}
      <View style={styles.sectionTitleRow}>
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Shipping Zones</Text>
        <TouchableOpacity
          onPress={() => openNewZone('country')}
          activeOpacity={0.75}
          style={[styles.addRateBtn, { backgroundColor: colors.primary + '18', borderColor: colors.primary }]}
        >
          <Feather name="plus" size={14} color={colors.primary} />
          <Text style={[styles.addRateBtnText, { color: colors.primary }]}>Add Zone</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
        Domestic, individual countries, and a rest-of-world catch-all — each with its own rate, free-shipping threshold, and processing time.
      </Text>

      {zonesLoading ? (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, padding: 24, alignItems: 'center' }]}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : zones.length === 0 ? (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.emptySection}>
            <Feather name="globe" size={20} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No shipping zones yet</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Add a Domestic zone to start, then Rest of World for everywhere else.</Text>
          </View>
        </View>
      ) : (
        zones.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((zone) => (
          <View key={zone.id} style={[styles.zoneCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: zone.active ? 1 : 0.55 }]}>
            <View style={styles.zoneHeader}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={[styles.zoneName, { color: colors.foreground }]}>{zone.name}</Text>
                  <Badge label={ZONE_TYPE_LABEL[zone.zoneType]} variant="default" />
                  {!zone.active && <Badge label="Inactive" variant="default" />}
                </View>
                {zone.zoneType === 'country' && zone.countries.length > 0 && (
                  <Text style={[styles.rateSub, { color: colors.mutedForeground, marginTop: 4 }]}>
                    {zone.countries.join(', ')}
                  </Text>
                )}
              </View>
              <Text style={[styles.rateAmount, { color: colors.foreground }]}>{zoneRateSummary(zone)}</Text>
            </View>

            <View style={styles.zoneMetaRow}>
              {zone.freeAboveCents != null && (
                <Text style={[styles.zoneMetaText, { color: colors.mutedForeground }]}>
                  Free above {formatCents(zone.freeAboveCents)}
                </Text>
              )}
              <Text style={[styles.zoneMetaText, { color: colors.mutedForeground }]}>
                {zone.processingDays} business day{zone.processingDays === 1 ? '' : 's'} to ship
              </Text>
              {zone.carrierLabel && (
                <Text style={[styles.zoneMetaText, { color: colors.mutedForeground }]}>{zone.carrierLabel}</Text>
              )}
            </View>

            {zone.zoneType !== 'domestic' && (
              <Text style={[styles.zoneMetaText, { color: colors.mutedForeground, marginTop: 2 }]}>
                {zone.shipsInternationally
                  ? `Ships internationally · ${zone.dutiesHandling === 'ddp' ? 'Duties prepaid (DDP)' : 'Buyer pays duties on delivery (DAP)'}`
                  : 'Does not ship to this zone'}
              </Text>
            )}

            <View style={styles.zoneActions}>
              <TouchableOpacity onPress={() => toggleZoneActive(zone)} style={[styles.zoneActionBtn, { borderColor: colors.border }]}>
                <Feather name={zone.active ? 'eye-off' : 'eye'} size={13} color={colors.foreground} />
                <Text style={[styles.zoneActionText, { color: colors.foreground }]}>{zone.active ? 'Deactivate' : 'Activate'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openEditZone(zone)} style={[styles.zoneActionBtn, { borderColor: colors.border }]}>
                <Feather name="edit-2" size={13} color={colors.foreground} />
                <Text style={[styles.zoneActionText, { color: colors.foreground }]}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDeleteZone(zone)} style={[styles.zoneActionBtn, { borderColor: colors.border }]}>
                <Feather name="trash-2" size={13} color={colors.destructive} />
                <Text style={[styles.zoneActionText, { color: colors.destructive }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}

      {/* Rendered rates summary table */}
      {activeZones.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Rates Summary</Text>
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.tableRow, styles.tableHeaderRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.tableHeaderText, { color: colors.mutedForeground, flex: 1.3 }]}>Zone</Text>
              <Text style={[styles.tableHeaderText, { color: colors.mutedForeground, flex: 1 }]}>Rate</Text>
              <Text style={[styles.tableHeaderText, { color: colors.mutedForeground, flex: 1 }]}>Free above</Text>
              <Text style={[styles.tableHeaderText, { color: colors.mutedForeground, flex: 0.9 }]}>Ships in</Text>
            </View>
            {activeZones.map((zone, i) => (
              <View key={zone.id} style={[styles.tableRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                <Text style={[styles.tableCellText, { color: colors.foreground, flex: 1.3 }]} numberOfLines={1}>{zone.name}</Text>
                <Text style={[styles.tableCellText, { color: colors.foreground, flex: 1 }]}>{zoneRateSummary(zone)}</Text>
                <Text style={[styles.tableCellText, { color: colors.mutedForeground, flex: 1 }]}>
                  {zone.freeAboveCents != null ? formatCents(zone.freeAboveCents) : '—'}
                </Text>
                <Text style={[styles.tableCellText, { color: colors.mutedForeground, flex: 0.9 }]}>{zone.processingDays}d</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Legacy flat rate, shown read-only once zones exist */}
      {zones.length > 0 && legacyRates.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Legacy Flat Rate</Text>
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.emptySection}>
              <Feather name="info" size={16} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Your Shipping Zones above are now used at checkout instead of this old flat rate.
              </Text>
            </View>
          </View>
        </>
      )}

      {/* Packaging presets */}
      <View style={styles.sectionTitleRow}>
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Packaging Presets</Text>
        <TouchableOpacity
          onPress={openNewPreset}
          activeOpacity={0.75}
          style={[styles.addRateBtn, { backgroundColor: colors.primary + '18', borderColor: colors.primary }]}
        >
          <Feather name="plus" size={14} color={colors.primary} />
          <Text style={[styles.addRateBtnText, { color: colors.primary }]}>Add Package</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
        Saved box sizes you can reuse when buying a label or setting a product's default package.
      </Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 24 }]}>
        {presets.length === 0 ? (
          <View style={styles.emptySection}>
            <Feather name="package" size={20} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No saved packages yet</Text>
          </View>
        ) : (
          presets.map((preset, i) => (
            <View key={preset.id} style={[styles.presetRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rateName, { color: colors.foreground }]}>{preset.name}</Text>
                <Text style={[styles.rateSub, { color: colors.mutedForeground }]}>
                  {preset.lengthIn}″ × {preset.widthIn}″ × {preset.heightIn}″ · {preset.weightOz} oz
                </Text>
              </View>
              <TouchableOpacity onPress={() => openEditPreset(preset)} style={styles.presetIconBtn}>
                <Feather name="edit-2" size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDeletePreset(preset)} style={styles.presetIconBtn}>
                <Feather name="trash-2" size={14} color={colors.destructive} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>
    </ScrollView>

    {/* ── Zone editor sheet ────────────────────────────────────────────────── */}
    {zoneSheetVisible && (
      <View style={styles.sheetBackdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setZoneSheetVisible(false)} />
        <ScrollView
          style={[styles.sheetScroll, { backgroundColor: colors.card, borderColor: colors.border }]}
          contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{zoneForm.id ? 'Edit zone' : 'Add shipping zone'}</Text>

          <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>Zone type</Text>
          <View style={styles.segmentRow}>
            {(['domestic', 'country', 'rest_of_world'] as ZoneType[]).map(t => (
              <TouchableOpacity
                key={t}
                onPress={() => setZoneForm(f => ({ ...f, zoneType: t, shipsInternationally: t !== 'domestic' }))}
                style={[styles.segment, { borderColor: colors.border }, zoneForm.zoneType === t && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              >
                <Text style={[styles.segmentText, { color: zoneForm.zoneType === t ? colors.primaryForeground : colors.foreground }]}>
                  {ZONE_TYPE_LABEL[t]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>Name</Text>
          <TextInput
            value={zoneForm.name}
            onChangeText={t => setZoneForm(f => ({ ...f, name: t }))}
            placeholder="e.g. Canada, EU, Domestic"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.sheetInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />

          {zoneForm.zoneType === 'country' && (
            <>
              <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>Countries (comma-separated ISO codes)</Text>
              <TextInput
                value={zoneForm.countriesText}
                onChangeText={t => setZoneForm(f => ({ ...f, countriesText: t }))}
                placeholder="CA, MX"
                autoCapitalize="characters"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.sheetInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
            </>
          )}

          <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>Pricing</Text>
          <View style={styles.segmentRow}>
            {(['flat', 'weight_tiered'] as PricingModel[]).map(m => (
              <TouchableOpacity
                key={m}
                onPress={() => setZoneForm(f => ({ ...f, pricingModel: m }))}
                style={[styles.segment, { borderColor: colors.border }, zoneForm.pricingModel === m && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              >
                <Text style={[styles.segmentText, { color: zoneForm.pricingModel === m ? colors.primaryForeground : colors.foreground }]}>
                  {m === 'flat' ? 'Flat rate' : 'Weight-based'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {zoneForm.pricingModel === 'flat' ? (
            <>
              <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>Flat rate</Text>
              <TextInput
                value={zoneForm.flatRate}
                onChangeText={t => setZoneForm(f => ({ ...f, flatRate: t }))}
                placeholder="$5.99"
                keyboardType="decimal-pad"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.sheetInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
            </>
          ) : (
            <View style={{ marginTop: 4 }}>
              {zoneForm.weightTiers.map((tier, i) => (
                <View key={i} style={[styles.tierRow, { borderColor: colors.border }]}>
                  <View style={styles.tierField}>
                    <Text style={[styles.tierLabel, { color: colors.mutedForeground }]}>Min (g)</Text>
                    <TextInput
                      value={String(tier.minWeightGrams)}
                      onChangeText={t => updateTier(i, { minWeightGrams: parseInt(t, 10) || 0 })}
                      keyboardType="number-pad"
                      style={[styles.tierInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                    />
                  </View>
                  <View style={styles.tierField}>
                    <Text style={[styles.tierLabel, { color: colors.mutedForeground }]}>Max (g)</Text>
                    <TextInput
                      value={tier.maxWeightGrams != null ? String(tier.maxWeightGrams) : ''}
                      onChangeText={t => updateTier(i, { maxWeightGrams: t.trim() ? (parseInt(t, 10) || 0) : null })}
                      placeholder="∞"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="number-pad"
                      style={[styles.tierInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                    />
                  </View>
                  <View style={styles.tierField}>
                    <Text style={[styles.tierLabel, { color: colors.mutedForeground }]}>Rate</Text>
                    <TextInput
                      value={tier.rateCents ? (tier.rateCents / 100).toFixed(2) : ''}
                      onChangeText={t => updateTier(i, { rateCents: parseDecimalToCents(t || '0') ?? 0 })}
                      placeholder="$0.00"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="decimal-pad"
                      style={[styles.tierInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                    />
                  </View>
                  <TouchableOpacity onPress={() => removeTier(i)} disabled={zoneForm.weightTiers.length <= 1} style={styles.tierRemoveBtn}>
                    <Feather name="x" size={16} color={zoneForm.weightTiers.length <= 1 ? colors.border : colors.destructive} />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity onPress={addTier} style={[styles.addTierBtn, { borderColor: colors.border }]}>
                <Feather name="plus" size={13} color={colors.foreground} />
                <Text style={[styles.zoneActionText, { color: colors.foreground }]}>Add tier</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>Free shipping above (optional)</Text>
          <TextInput
            value={zoneForm.freeAbove}
            onChangeText={t => setZoneForm(f => ({ ...f, freeAbove: t }))}
            placeholder="$75.00"
            keyboardType="decimal-pad"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.sheetInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />

          <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>Processing time (business days)</Text>
          <TextInput
            value={zoneForm.processingDays}
            onChangeText={t => setZoneForm(f => ({ ...f, processingDays: t.replace(/[^0-9]/g, '') }))}
            placeholder="2"
            keyboardType="number-pad"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.sheetInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />

          <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>Carrier / service (label only)</Text>
          <TextInput
            value={zoneForm.carrierLabel}
            onChangeText={t => setZoneForm(f => ({ ...f, carrierLabel: t }))}
            placeholder="e.g. USPS Priority"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.sheetInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          <View style={styles.chipRow}>
            {CARRIER_SUGGESTIONS.map(c => (
              <TouchableOpacity
                key={c}
                onPress={() => setZoneForm(f => ({ ...f, carrierLabel: c }))}
                style={[styles.suggestionChip, { borderColor: colors.border }]}
              >
                <Text style={[styles.suggestionChipText, { color: colors.foreground }]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {zoneForm.zoneType !== 'domestic' && (
            <>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabelStrong, { color: colors.foreground }]}>Ships internationally</Text>
                  <Text style={[styles.rateSub, { color: colors.mutedForeground }]}>Turn off if you don’t ship to this zone at all.</Text>
                </View>
                <HapticSwitch
                  value={zoneForm.shipsInternationally}
                  onValueChange={v => setZoneForm(f => ({ ...f, shipsInternationally: v }))}
                />
              </View>

              {zoneForm.shipsInternationally && (
                <>
                  <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>Duties & customs</Text>
                  <View style={styles.segmentRow}>
                    {(['dap', 'ddp'] as Duties[]).map(d => (
                      <TouchableOpacity
                        key={d}
                        onPress={() => setZoneForm(f => ({ ...f, dutiesHandling: d }))}
                        style={[styles.segment, { borderColor: colors.border }, zoneForm.dutiesHandling === d && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                      >
                        <Text style={[styles.segmentText, { color: zoneForm.dutiesHandling === d ? colors.primaryForeground : colors.foreground }]}>
                          {d === 'dap' ? 'Buyer pays (DAP)' : 'Prepaid (DDP)'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={[styles.rateSub, { color: colors.mutedForeground, marginTop: 4 }]}>
                    DAP: the buyer pays duties/customs on delivery. DDP: duties are prepaid at checkout. Informational only — no live customs calculation.
                  </Text>
                </>
              )}
            </>
          )}

          <View style={styles.sheetActions}>
            <TouchableOpacity onPress={() => setZoneSheetVisible(false)} style={[styles.sheetBtn, { borderColor: colors.border }]}>
              <Text style={[styles.sheetBtnText, { color: colors.foreground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSaveZone}
              disabled={zoneSaving}
              style={[styles.sheetBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
            >
              <Text style={[styles.sheetBtnText, { color: colors.primaryForeground }]}>{zoneSaving ? 'Saving…' : 'Save zone'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    )}

    {/* ── Packaging preset sheet ───────────────────────────────────────────── */}
    {presetSheetVisible && (
      <View style={styles.sheetBackdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setPresetSheetVisible(false)} />
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 20 }]}>
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{presetForm.id ? 'Edit package' : 'Add package preset'}</Text>
          <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>Name</Text>
          <TextInput
            value={presetForm.name}
            onChangeText={t => setPresetForm(f => ({ ...f, name: t }))}
            placeholder="Small Box"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.sheetInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          <View style={styles.dimsRow}>
            {(['lengthIn', 'widthIn', 'heightIn'] as const).map((key, i) => (
              <View key={key} style={{ flex: 1 }}>
                <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>{['L', 'W', 'H'][i]} (in)</Text>
                <TextInput
                  value={presetForm[key]}
                  onChangeText={t => setPresetForm(f => ({ ...f, [key]: t }))}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.sheetInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                />
              </View>
            ))}
          </View>
          <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>Weight (oz)</Text>
          <TextInput
            value={presetForm.weightOz}
            onChangeText={t => setPresetForm(f => ({ ...f, weightOz: t }))}
            placeholder="8"
            keyboardType="decimal-pad"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.sheetInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          <View style={styles.sheetActions}>
            <TouchableOpacity onPress={() => setPresetSheetVisible(false)} style={[styles.sheetBtn, { borderColor: colors.border }]}>
              <Text style={[styles.sheetBtnText, { color: colors.foreground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSavePreset}
              disabled={presetSaving}
              style={[styles.sheetBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
            >
              <Text style={[styles.sheetBtnText, { color: colors.primaryForeground }]}>{presetSaving ? 'Saving…' : 'Save package'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sheetBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', // theme-exempt: modal scrim over the whole screen
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SP.md,
    gap: SP.xs,
  },
  sheetScroll: {
    maxHeight: '86%',
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: 1,
  },
  sheetTitle: { fontSize: FS.lg, fontWeight: '700', marginBottom: SP.sm },
  sheetLabel: { fontSize: FS.xs, fontWeight: '500', marginTop: SP.sm },
  sheetInput: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.sm,
    paddingVertical: 12,
    fontSize: FS.md,
    marginTop: 4,
  },
  sheetActions: { flexDirection: 'row', gap: SP.sm, marginTop: SP.md },
  sheetBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sheetBtnText: { fontSize: FS.md, fontWeight: '600' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  backText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  pageTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 20 },
  statsRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  stat: { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1, alignItems: 'center', gap: 3 },
  statVal: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: FS.xs, fontFamily: 'Inter_400Regular' },
  actionsRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  action: { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1, alignItems: 'center', gap: 6 },
  actionLabel: { fontSize: FS.xs, fontFamily: 'Inter_500Medium' },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  sectionSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: -6, marginBottom: 12, lineHeight: 17 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 0 },
  addRateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  addRateBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  emptySection: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, flexWrap: 'wrap' },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  shipCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 10 },
  shipHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  shipId: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  shipCustomer: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginTop: 2 },
  shipCarrier: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  progressBar: { height: 4, borderRadius: 2, overflow: 'hidden', marginBottom: 10 },
  progressFill: { height: '100%', borderRadius: 2 },
  shipSteps: { flexDirection: 'row', justifyContent: 'space-between' },
  stepItem: { alignItems: 'center', gap: 4 },
  stepDot: { width: 8, height: 8, borderRadius: 4 },
  stepLabel: { fontSize: FS.xs, fontFamily: 'Inter_500Medium' },
  returnRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  returnInfo: { flex: 1, gap: 2 },
  returnId: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  returnItem: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  returnReason: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  rateName: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  rateSub: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  rateAmount: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  shipFromRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowLabelStrong: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  countryPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  countryPillText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  countryInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, width: 60, fontSize: 13, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  smallBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  zoneCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  zoneHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  zoneName: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  zoneMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  zoneMetaText: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  zoneActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  zoneActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  zoneActionText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  tableHeaderRow: { borderBottomWidth: 1 },
  tableHeaderText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.4 },
  tableCellText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  presetRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 8 },
  presetIconBtn: { padding: 6 },
  segmentRow: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  segment: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  segmentText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  tierRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 8, borderBottomWidth: 1, paddingBottom: 8 },
  tierField: { flex: 1 },
  tierLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', marginBottom: 4 },
  tierInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, fontSize: 12 },
  tierRemoveBtn: { padding: 8 },
  addTierBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 8, alignSelf: 'flex-start' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  suggestionChip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  suggestionChipText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: SP.sm },
  dimsRow: { flexDirection: 'row', gap: 8 },
  warehouseCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 10 },
  warehouseHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  warehouseName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  warehouseLoc: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  warehouseStock: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  capacityBar: { height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  capacityFill: { height: '100%', borderRadius: 3 },
  capacityLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
});
