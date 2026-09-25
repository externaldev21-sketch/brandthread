/**
 * Fulfill Order — single-order fulfillment wizard
 *
 * Four in-screen steps: packing checklist → package → shipping label
 * (with a manual-tracking fallback) → confirm & mark shipped.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, Animated, Linking, Image, Share,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, SectionHeader } from '@/components/BrandthreadUI';
import { Header } from '@/components/layout';
import { useApi } from '@/lib/api';
import { adaptApiOrder } from '@/app/order-detail';
import { formatCents } from '@/lib/money';
import { Order, ShippingRate, ShippingLabel } from '@/services/orderTypes';
import {
  getShippingRates, purchaseShippingLabel, voidShippingLabel, addTracking as addTrackingService,
  getPackagePresets, createPackagePreset, deletePackagePreset,
  updateFulfillmentChecklist, PackagePreset,
} from '@/services/orderService';
import { sharePackingSlip } from '@/lib/packingSlip';

const LAST_PACKAGE_KEY = '@brandthread/fulfill-last-package:v1';
const CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL', 'Other'] as const;

type Step = 1 | 2 | 3 | 4;

type PackageChoice =
  | { kind: 'preset'; presetId: string }
  | { kind: 'custom'; weight: string; length: string; width: string; height: string };

function ozToLb(oz: number): string {
  return (oz / 16).toFixed(2);
}

export default function FulfillOrderScreen() {
  const { theme } = useAppTheme();
  const {
    background: BG, card: CARD, border: BORDER, text: FG, muted: MUTED, subtle: SUBTLE,
    accent: ACCENT, accentDim: ACCENT_DIM, success: SUCCESS, warning: WARNING, error: ERROR,
    onAccent: ON_ACCENT,
  } = theme;
  const s = useMemo(() => createStyles(theme), [theme]);
  const { orderId, step: stepParam } = useLocalSearchParams<{ orderId: string; step?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  // Deep-linkable step (e.g. order-detail's "Buy Label" jumps straight to
  // step 3 instead of opening a separate shipping-label screen) — this is
  // the single consolidated fulfillment flow for a seller-fulfilled order.
  const initialStep = (() => {
    const n = Number(stepParam);
    return n === 2 || n === 3 || n === 4 ? (n as Step) : 1;
  })();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>(initialStep);

  // Step 1 — checklist
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [savingChecklist, setSavingChecklist] = useState(false);

  // Step 2 — package
  const [presets, setPresets] = useState<PackagePreset[]>([]);
  const [packageChoice, setPackageChoice] = useState<PackageChoice | null>(null);
  const [addingPreset, setAddingPreset] = useState(false);
  const [newPreset, setNewPreset] = useState({ name: '', weightOz: '', lengthIn: '', widthIn: '', heightIn: '' });

  // Step 3 — shipping label / manual tracking
  const [loadingRates, setLoadingRates] = useState(false);
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [label, setLabel] = useState<ShippingLabel | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualCarrier, setManualCarrier] = useState<string>('USPS');
  const [manualTracking, setManualTracking] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  // Step 4 — confirm
  const [marking, setMarking] = useState(false);
  const [done, setDone] = useState(false);
  const successScale = useRef(new Animated.Value(0)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;

  const purchaseKey = useMemo(() => `fulfill-${orderId}`, [orderId]);
  // A voided label is no longer usable proof of shipment — treat it the same
  // as "no label yet" for gating Continue / Mark as Shipped.
  const hasValidLabel = !!label && label.status !== 'voided';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [raw, presetList] = await Promise.all([
        api.orders.get(orderId),
        getPackagePresets().catch(() => []),
      ]);
      const adapted = raw ? adaptApiOrder(raw) : null;
      setOrder(adapted);
      setPresets(presetList);
      if (adapted) {
        setChecked(Object.fromEntries(adapted.lineItems.map(li => [li.id, adapted.fulfillment.isPicked])));
      }
      try {
        const savedRaw = await AsyncStorage.getItem(LAST_PACKAGE_KEY);
        if (savedRaw) {
          const saved = JSON.parse(savedRaw) as PackageChoice;
          if (saved.kind === 'preset' && presetList.some(p => p.id === saved.presetId)) {
            setPackageChoice(saved);
          } else if (saved.kind === 'custom') {
            setPackageChoice(saved);
          }
        }
      } catch {
        // Ignore malformed/unavailable local storage.
      }
    } catch (err) {
      if (__DEV__) console.warn('[fulfill-order] failed to load', err);
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [api, orderId]);

  useEffect(() => { load(); }, [load]);

  const allChecked = order ? order.lineItems.length > 0 && order.lineItems.every(li => checked[li.id]) : false;

  function toggleItem(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleContinueFromChecklist() {
    if (!allChecked || !orderId) return;
    setSavingChecklist(true);
    try {
      await updateFulfillmentChecklist(orderId, { isPicked: true });
    } catch (err) {
      if (__DEV__) console.warn('[fulfill-order] checklist save failed', err);
      // Non-fatal — the seller can still proceed and retry later.
    } finally {
      setSavingChecklist(false);
    }
    setStep(2);
  }

  async function handleContinueFromPackage() {
    if (!packageChoice) {
      Alert.alert('Choose a package', 'Select a saved box or enter custom dimensions.');
      return;
    }
    try {
      await AsyncStorage.setItem(LAST_PACKAGE_KEY, JSON.stringify(packageChoice));
    } catch {
      // Non-fatal.
    }
    if (orderId) {
      updateFulfillmentChecklist(orderId, { isPacked: true }).catch(() => {});
    }
    setStep(3);
  }

  async function handleAddPreset() {
    const weightOz = Number(newPreset.weightOz);
    const lengthIn = Number(newPreset.lengthIn);
    const widthIn = Number(newPreset.widthIn);
    const heightIn = Number(newPreset.heightIn);
    if (!newPreset.name.trim() || !weightOz || !lengthIn || !widthIn || !heightIn) {
      Alert.alert('Fill out all fields', 'Name, weight, and all three dimensions are required.');
      return;
    }
    try {
      const created = await createPackagePreset({ name: newPreset.name.trim(), weightOz, lengthIn, widthIn, heightIn });
      setPresets(prev => [created, ...prev]);
      setPackageChoice({ kind: 'preset', presetId: created.id });
      setAddingPreset(false);
      setNewPreset({ name: '', weightOz: '', lengthIn: '', widthIn: '', heightIn: '' });
    } catch (err: any) {
      Alert.alert('Could not save preset', err?.message ?? 'Please try again.');
    }
  }

  async function handleDeletePreset(id: string) {
    try {
      await deletePackagePreset(id);
      setPresets(prev => prev.filter(p => p.id !== id));
      setPackageChoice(prev => (prev?.kind === 'preset' && prev.presetId === id ? null : prev));
    } catch (err: any) {
      Alert.alert('Could not delete preset', err?.message ?? 'Please try again.');
    }
  }

  const parcelDims = useMemo(() => {
    if (!packageChoice) return null;
    if (packageChoice.kind === 'custom') {
      const { weight, length, width, height } = packageChoice;
      if (!weight || !length || !width || !height) return null;
      return { weight, length, width, height };
    }
    const preset = presets.find(p => p.id === packageChoice.presetId);
    if (!preset) return null;
    return { weight: ozToLb(preset.weightOz), length: preset.lengthIn, width: preset.widthIn, height: preset.heightIn };
  }, [packageChoice, presets]);

  const handleLoadRates = useCallback(async () => {
    if (!order || !parcelDims || !orderId) return;
    setLoadingRates(true);
    setRatesError(null);
    try {
      const fromAddress = order.fulfillment.fromAddress ?? order.customer.shippingAddress;
      const nextRates = await getShippingRates(orderId, { fromAddress, ...parcelDims });
      const sorted = [...nextRates].sort((a, b) => a.priceCents - b.priceCents);
      setRates(sorted);
      if (sorted.length === 0) {
        setRatesError('No carrier rates were returned for this package.');
        setManualMode(true);
      }
    } catch (err: any) {
      setRatesError(err?.message ?? 'Could not load carrier rates.');
      setManualMode(true);
    } finally {
      setLoadingRates(false);
    }
  }, [order, parcelDims, orderId]);

  useEffect(() => {
    if (step === 3 && !hasValidLabel && rates.length === 0 && !loadingRates && !manualMode) {
      handleLoadRates();
    }
  }, [step, label, rates.length, loadingRates, manualMode, handleLoadRates]);

  async function handleBuyLabel(rate: ShippingRate) {
    if (!orderId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    setBuying(true);
    try {
      const lbl = await purchaseShippingLabel(orderId, rate, purchaseKey);
      setLabel(lbl);
    } catch (err: any) {
      Alert.alert(
        'Label not purchased',
        err?.message ?? 'Could not purchase this label. You can enter tracking manually instead.',
      );
      setManualMode(true);
    } finally {
      setBuying(false);
    }
  }

  async function handleScanBarcode({ data }: { data: string }) {
    setShowScanner(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setManualTracking(data);
  }

  async function openScanner() {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Camera access needed', 'Allow camera access to scan a tracking barcode.');
        return;
      }
    }
    setShowScanner(true);
  }

  function playSuccessAnimation(onDone: () => void) {
    Animated.parallel([
      Animated.spring(successScale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 80 }),
      Animated.timing(successOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setTimeout(onDone, 700);
    });
  }

  async function handleMarkShipped() {
    if (!orderId) return;
    if (!hasValidLabel && !manualTracking.trim()) {
      Alert.alert('Add tracking', 'Purchase a label or enter a tracking number before marking this order shipped.');
      return;
    }
    setMarking(true);
    try {
      if (!hasValidLabel && manualTracking.trim()) {
        await addTrackingService(orderId, manualCarrier, manualTracking.trim());
      }
      await api.orders.updateStatus(orderId, 'shipped');
      setDone(true);
      playSuccessAnimation(() => {
        router.replace('/(tabs)/orders');
      });
    } catch (err: any) {
      Alert.alert('Could not mark shipped', err?.message ?? 'Please try again.');
    } finally {
      setMarking(false);
    }
  }

  async function handlePackingSlip() {
    if (!order) return;
    try {
      await sharePackingSlip(order);
    } catch (err: any) {
      Alert.alert('Could not create packing slip', err?.message ?? 'Please try again.');
    }
  }

  async function handleOpenLabel() {
    if (!label?.labelUrl) {
      Alert.alert('Label unavailable', 'The carrier did not return a downloadable label.');
      return;
    }
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(label.labelUrl);
      } else {
        await Linking.openURL(label.labelUrl);
      }
    } catch {
      Linking.openURL(label.labelUrl).catch(() => {});
    }
  }

  async function handleShareLabel() {
    if (!label?.labelUrl) {
      Alert.alert('Label unavailable', 'The carrier did not return a shareable label.');
      return;
    }
    try {
      await Share.share({ title: `Shipping label ${order?.orderNumber ?? ''}`, message: label.labelUrl });
    } catch {
      // User cancelled the share sheet — nothing to do.
    }
  }

  function handleCopyTracking() {
    if (!label?.trackingNumber) return;
    Alert.alert('Tracking number', label.trackingNumber);
  }

  function handleVoidLabel() {
    if (!label) return;
    Alert.alert(
      'Void label',
      'Are you sure you want to void this label? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Void label',
          style: 'destructive',
          onPress: async () => {
            if (!orderId) return;
            try {
              const updated = await voidShippingLabel(orderId, label.id);
              setLabel(updated);
              if (updated.refundPending) Alert.alert('Void requested', 'The carrier is processing the label refund.');
            } catch (err: any) {
              Alert.alert('Could not void label', err?.message ?? 'Try again later.');
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator color={ACCENT} size="large" />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={s.root}>
        <Header title="Fulfill Order" />
        <View style={s.centered}>
          <Text style={s.errorText}>Couldn't load this order.</Text>
        </View>
      </View>
    );
  }

  if (showScanner) {
    return (
      <View style={s.scannerRoot}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['code128', 'code39', 'ean13', 'ean8', 'upc_a', 'upc_e', 'qr'] }}
          onBarcodeScanned={handleScanBarcode}
        />
        <TouchableOpacity
          style={[s.scannerClose, { top: insets.top + SP.md }]}
          onPress={() => setShowScanner(false)}
          accessibilityRole="button"
          accessibilityLabel="Close scanner"
        >
          <Feather name="x" size={ICON.lg} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={s.scannerHint}>
          <Text style={s.scannerHintText}>Align the barcode within the frame</Text>
        </View>
      </View>
    );
  }

  if (done) {
    return (
      <View style={[s.root, s.centered]}>
        <Animated.View style={{ transform: [{ scale: successScale }], opacity: successOpacity, alignItems: 'center', gap: SP.md }}>
          <View style={[s.successCircle, { backgroundColor: `${SUCCESS}26` }]}>
            <Feather name="check" size={48} color={SUCCESS} />
          </View>
          <Text style={s.successText}>Order shipped!</Text>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <Header title="Fulfill Order" />

      {/* Stepper */}
      <View style={s.stepperRow}>
        {([1, 2, 3, 4] as Step[]).map((n, idx) => (
          <React.Fragment key={n}>
            <View style={[s.stepDot, step >= n && { backgroundColor: ACCENT }]}>
              {step > n ? (
                <Feather name="check" size={12} color={ON_ACCENT} />
              ) : (
                <Text style={[s.stepDotText, step >= n && { color: ON_ACCENT }]}>{n}</Text>
              )}
            </View>
            {idx < 3 && <View style={[s.stepLine, step > n && { backgroundColor: ACCENT }]} />}
          </React.Fragment>
        ))}
      </View>
      <Text style={s.stepLabel}>
        {step === 1 ? 'Pack the order' : step === 2 ? 'Choose a package' : step === 3 ? 'Ship it' : 'Confirm'}
      </Text>

      <ScrollView
        style={s.content}
        contentContainerStyle={{ padding: SP.md, gap: SP.md, paddingBottom: insets.bottom + SP.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        {step === 1 && (
          <>
            <SectionHeader title={`Order #${order.orderNumber}`} action={{ label: 'Packing slip', onPress: handlePackingSlip }} />
            {order.lineItems.map(li => (
              <TouchableOpacity key={li.id} onPress={() => toggleItem(li.id)} activeOpacity={0.8}>
                <BrandthreadCard style={s.itemCard}>
                  {li.imageUri ? (
                    <Image source={{ uri: li.imageUri }} style={s.itemThumb} />
                  ) : (
                    <View style={[s.itemThumb, s.itemThumbPlaceholder]}>
                      <Feather name="image" size={ICON.md} color={SUBTLE} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={s.itemName}>{li.productName}</Text>
                    <Text style={s.itemVariant}>{li.variant}{li.variant ? ' · ' : ''}Qty {li.quantity}</Text>
                  </View>
                  <Feather
                    name={checked[li.id] ? 'check-square' : 'square'}
                    size={ICON.lg}
                    color={checked[li.id] ? SUCCESS : MUTED}
                  />
                </BrandthreadCard>
              </TouchableOpacity>
            ))}
            <PrimaryButton label="Continue" onPress={handleContinueFromChecklist} disabled={!allChecked} loading={savingChecklist} icon="arrow-right" />
          </>
        )}

        {step === 2 && (
          <>
            <SectionHeader title="Saved packages" />
            <View style={s.chipRow}>
              {presets.map(p => {
                const active = packageChoice?.kind === 'preset' && packageChoice.presetId === p.id;
                return (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => { Haptics.selectionAsync().catch(() => {}); setPackageChoice({ kind: 'preset', presetId: p.id }); }}
                    onLongPress={() => Alert.alert('Delete preset', `Remove "${p.name}"?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => handleDeletePreset(p.id) },
                    ])}
                    style={[s.presetChip, active && { borderColor: ACCENT, backgroundColor: ACCENT_DIM }]}
                  >
                    <Text style={[s.presetChipText, active && { color: FG, fontFamily: FONT.semibold }]}>{p.name}</Text>
                    <Text style={s.presetChipSub}>{ozToLb(p.weightOz)}lb · {p.lengthIn}×{p.widthIn}×{p.heightIn}in</Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                onPress={() => { Haptics.selectionAsync().catch(() => {}); setPackageChoice({ kind: 'custom', weight: '', length: '', width: '', height: '' }); }}
                style={[s.presetChip, packageChoice?.kind === 'custom' && { borderColor: ACCENT, backgroundColor: ACCENT_DIM }]}
              >
                <Text style={[s.presetChipText, packageChoice?.kind === 'custom' && { color: FG, fontFamily: FONT.semibold }]}>Custom</Text>
              </TouchableOpacity>
            </View>

            {packageChoice?.kind === 'custom' && (
              <BrandthreadCard style={{ gap: SP.sm }}>
                <Text style={s.fieldLabel}>Weight (lb)</Text>
                <TextInput
                  style={s.input}
                  value={packageChoice.weight}
                  onChangeText={v => setPackageChoice({ ...packageChoice, weight: v })}
                  keyboardType="decimal-pad"
                  placeholder="0.0"
                  placeholderTextColor={SUBTLE}
                />
                <Text style={s.fieldLabel}>Dimensions (in)</Text>
                <View style={s.dimRow}>
                  <TextInput style={[s.input, { flex: 1 }]} value={packageChoice.length} onChangeText={v => setPackageChoice({ ...packageChoice, length: v })} keyboardType="decimal-pad" placeholder="L" placeholderTextColor={SUBTLE} />
                  <TextInput style={[s.input, { flex: 1 }]} value={packageChoice.width} onChangeText={v => setPackageChoice({ ...packageChoice, width: v })} keyboardType="decimal-pad" placeholder="W" placeholderTextColor={SUBTLE} />
                  <TextInput style={[s.input, { flex: 1 }]} value={packageChoice.height} onChangeText={v => setPackageChoice({ ...packageChoice, height: v })} keyboardType="decimal-pad" placeholder="H" placeholderTextColor={SUBTLE} />
                </View>
              </BrandthreadCard>
            )}

            {!addingPreset ? (
              <SecondaryButton label="Save current as a preset" icon="plus" small onPress={() => setAddingPreset(true)} />
            ) : (
              <BrandthreadCard style={{ gap: SP.sm }}>
                <TextInput style={s.input} value={newPreset.name} onChangeText={v => setNewPreset({ ...newPreset, name: v })} placeholder="Preset name" placeholderTextColor={SUBTLE} />
                <TextInput style={s.input} value={newPreset.weightOz} onChangeText={v => setNewPreset({ ...newPreset, weightOz: v })} keyboardType="decimal-pad" placeholder="Weight (oz)" placeholderTextColor={SUBTLE} />
                <View style={s.dimRow}>
                  <TextInput style={[s.input, { flex: 1 }]} value={newPreset.lengthIn} onChangeText={v => setNewPreset({ ...newPreset, lengthIn: v })} keyboardType="decimal-pad" placeholder="L (in)" placeholderTextColor={SUBTLE} />
                  <TextInput style={[s.input, { flex: 1 }]} value={newPreset.widthIn} onChangeText={v => setNewPreset({ ...newPreset, widthIn: v })} keyboardType="decimal-pad" placeholder="W (in)" placeholderTextColor={SUBTLE} />
                  <TextInput style={[s.input, { flex: 1 }]} value={newPreset.heightIn} onChangeText={v => setNewPreset({ ...newPreset, heightIn: v })} keyboardType="decimal-pad" placeholder="H (in)" placeholderTextColor={SUBTLE} />
                </View>
                <View style={s.dimRow}>
                  <SecondaryButton label="Cancel" small onPress={() => setAddingPreset(false)} style={{ flex: 1 }} />
                  <PrimaryButton label="Save preset" small onPress={handleAddPreset} style={{ flex: 1 }} />
                </View>
              </BrandthreadCard>
            )}

            <PrimaryButton label="Continue" onPress={handleContinueFromPackage} disabled={!parcelDims} icon="arrow-right" />
          </>
        )}

        {step === 3 && (
          <>
            {!label && !manualMode && !parcelDims && (
              <BrandthreadCard style={{ gap: SP.sm }}>
                <Text style={s.mutedText}>Choose a package before loading shipping rates.</Text>
                <SecondaryButton label="Choose a package" icon="package" small onPress={() => setStep(2)} />
                <SecondaryButton label="Enter tracking manually instead" icon="edit-3" small onPress={() => setManualMode(true)} />
              </BrandthreadCard>
            )}

            {!label && !manualMode && parcelDims && (
              <>
                <SectionHeader title="Shipping rates" />
                {loadingRates ? (
                  <View style={s.centeredInline}>
                    <ActivityIndicator color={ACCENT} />
                    <Text style={s.mutedText}>Fetching rates…</Text>
                  </View>
                ) : ratesError ? (
                  <BrandthreadCard style={{ gap: SP.sm }}>
                    <Text style={[s.mutedText, { color: ERROR }]}>{ratesError}</Text>
                    <SecondaryButton label="Retry" icon="refresh-cw" small onPress={handleLoadRates} />
                  </BrandthreadCard>
                ) : (
                  rates.map(rate => (
                    <TouchableOpacity key={rate.id} onPress={() => handleBuyLabel(rate)} disabled={buying} activeOpacity={0.85}>
                      <BrandthreadCard style={s.rateCard}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.rateCarrier}>{rate.carrier} · {rate.service}</Text>
                          <Text style={s.mutedText}>Est. {rate.estimatedDelivery} · {rate.estimatedDays}d</Text>
                        </View>
                        <Text style={s.ratePrice}>{formatCents(rate.priceCents)}</Text>
                        {buying && <ActivityIndicator color={ACCENT} style={{ marginLeft: SP.sm }} />}
                      </BrandthreadCard>
                    </TouchableOpacity>
                  ))
                )}
                <SecondaryButton label="Enter tracking manually instead" icon="edit-3" small onPress={() => setManualMode(true)} />
              </>
            )}

            {label && label.status !== 'voided' && (
              <GradientCard colors={[`${SUCCESS}26`, `${SUCCESS}08`]} style={{ borderColor: `${SUCCESS}55` }}>
                <View style={{ alignItems: 'center', gap: SP.sm }}>
                  <Feather name="check-circle" size={ICON.xxl} color={SUCCESS} />
                  <Text style={s.successTitle}>Label purchased</Text>
                  <Text style={s.mutedText}>{label.carrier} {label.service} · {formatCents(label.priceCents)}</Text>
                  <Text style={s.mutedText}>Tracking: {label.trackingNumber}</Text>
                </View>
                <View style={s.dimRow}>
                  <SecondaryButton label="Open label" icon="external-link" small onPress={handleOpenLabel} style={{ flex: 1 }} />
                  <SecondaryButton label="Share" icon="share-2" small onPress={handleShareLabel} style={{ flex: 1 }} />
                </View>
                <View style={s.dimRow}>
                  <SecondaryButton label="Copy tracking #" icon="copy" small onPress={handleCopyTracking} style={{ flex: 1 }} />
                  <SecondaryButton label="Void label" icon="slash" small accent={ERROR} onPress={handleVoidLabel} style={{ flex: 1 }} />
                </View>
              </GradientCard>
            )}

            {label && label.status === 'voided' && (
              <BrandthreadCard style={{ alignItems: 'center', gap: SP.sm, borderColor: `${ERROR}55` }}>
                <Feather name="slash" size={ICON.xxl} color={ERROR} />
                <Text style={[s.successTitle, { color: ERROR }]}>Label voided</Text>
                <Text style={s.mutedText}>This label can no longer be used. Buy a new one or enter tracking manually.</Text>
                <View style={s.dimRow}>
                  <SecondaryButton label="Buy new label" icon="refresh-cw" small onPress={() => { setLabel(null); setRates([]); handleLoadRates(); }} style={{ flex: 1 }} />
                  <SecondaryButton label="Enter tracking manually" icon="edit-3" small onPress={() => { setLabel(null); setManualMode(true); }} style={{ flex: 1 }} />
                </View>
              </BrandthreadCard>
            )}

            {manualMode && !label && (
              <BrandthreadCard style={{ gap: SP.sm }}>
                <Text style={s.fieldLabel}>Carrier</Text>
                <View style={s.chipRow}>
                  {CARRIERS.map(c => (
                    <TouchableOpacity
                      key={c}
                      onPress={() => { Haptics.selectionAsync().catch(() => {}); setManualCarrier(c); }}
                      style={[s.carrierChip, manualCarrier === c && { borderColor: ACCENT, backgroundColor: ACCENT_DIM }]}
                    >
                      <Text style={[s.presetChipText, manualCarrier === c && { color: FG, fontFamily: FONT.semibold }]}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={s.fieldLabel}>Tracking number</Text>
                <View style={s.dimRow}>
                  <TextInput
                    style={[s.input, { flex: 1 }]}
                    value={manualTracking}
                    onChangeText={setManualTracking}
                    placeholder="Tracking number"
                    placeholderTextColor={SUBTLE}
                    autoCapitalize="characters"
                  />
                  <SecondaryButton label="Scan" icon="camera" small onPress={openScanner} />
                </View>
              </BrandthreadCard>
            )}

            <PrimaryButton
              label="Continue"
              onPress={() => setStep(4)}
              disabled={!hasValidLabel && !manualTracking.trim()}
              icon="arrow-right"
            />
          </>
        )}

        {step === 4 && (
          <>
            <SectionHeader title="Confirm & ship" />
            <BrandthreadCard style={{ gap: SP.sm }}>
              <Row label="Order" value={`#${order.orderNumber}`} />
              <Row label="Customer" value={order.customer.name} />
              <Row label="Items" value={String(order.lineItems.reduce((sum, li) => sum + li.quantity, 0))} />
              {label ? (
                <>
                  <Row label="Carrier" value={`${label.carrier} ${label.service}`} />
                  <Row label="Tracking" value={label.trackingNumber} />
                </>
              ) : (
                <>
                  <Row label="Carrier" value={manualCarrier} />
                  <Row label="Tracking" value={manualTracking} />
                </>
              )}
            </BrandthreadCard>
            <SecondaryButton label="Print packing slip" icon="file-text" onPress={handlePackingSlip} />
            <PrimaryButton label="Mark as Shipped" onPress={handleMarkShipped} loading={marking} icon="send" />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: '#8A8A93' }}>{label}</Text>
      <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: '#F7F7FA' }}>{value}</Text>
    </View>
  );
}

const createStyles = (theme: { background: string; card: string; border: string; text: string; muted: string; subtle: string; accent: string; accentDim: string; success: string; warning: string; error: string; onAccent: string }) => {
  const { card: CARD, border: BORDER, text: FG, muted: MUTED, subtle: SUBTLE, accent: ACCENT, success: SUCCESS } = theme;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    centeredInline: { alignItems: 'center', gap: SP.sm, paddingVertical: SP.lg },
    errorText: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED },
    content: { flex: 1 },
    mutedText: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
    linkText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: ACCENT },

    stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingTop: SP.sm, paddingHorizontal: SP.xl },
    stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
    stepDotText: { fontSize: FS.xs, fontFamily: FONT.bold, color: MUTED },
    stepLine: { width: 28, height: 2, backgroundColor: BORDER },
    stepLabel: { textAlign: 'center', fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED, paddingTop: SP.xs, paddingBottom: SP.xs },

    itemCard: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
    itemThumb: { width: 48, height: 48, borderRadius: RADIUS.sm },
    itemThumbPlaceholder: { backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
    itemName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
    itemVariant: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },

    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
    presetChip: { paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: RADIUS.md, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, gap: 2 },
    presetChipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
    presetChipSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
    carrierChip: { paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },

    fieldLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
    input: { backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, paddingVertical: SP.sm, color: FG, fontSize: FS.base, fontFamily: FONT.regular },
    dimRow: { flexDirection: 'row', gap: SP.sm },

    rateCard: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
    rateCarrier: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
    ratePrice: { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },

    successTitle: { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
    successCircle: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
    successText: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },

    scannerRoot: { flex: 1, backgroundColor: '#000' },
    scannerClose: { position: 'absolute', left: SP.md, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
    scannerHint: { position: 'absolute', bottom: SP.xxl, left: 0, right: 0, alignItems: 'center' },
    scannerHintText: { color: '#FFFFFF', fontSize: FS.sm, fontFamily: FONT.medium },
  });
};
