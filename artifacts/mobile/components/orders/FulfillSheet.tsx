/**
 * "Fulfill item" sheet — Shopify iOS "Marking order as fulfilled", 1:1 in
 * Brandthread's black/white/silver: Cancel + title + order number, the
 * shipping address, items with a quantity stepper, tracking information
 * (number with barcode scan, carrier picker), "Send notification to
 * customer", then "Fulfill N items" and "Print packing slip".
 *
 * The sheet only builds the request (lib/orderFulfillment.ts); the caller
 * sends it, so order detail and batch ship share one form and one set of
 * server rules.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { Button, OptionSheet, QuantityStepper } from '@/components/ui';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { FullSheet, SheetSection, SHEET_FIELD_BG } from '@/components/orders/FullSheet';
import { TYPE_SCALE } from '@/constants/typography';
import { FONT, SP, RADIUS, ICON } from '@/lib/theme';
import { hapticSuccessAction } from '@/lib/haptics';
import { sharePackingSlip } from '@/lib/packingSlip';
import {
  SHIPPING_CARRIERS, buildFulfillRequest, initialSelection, linesToFulfill, orderTitle,
  selectedCount, stepSelection, type FulfillRequest,
} from '@/lib/orderFulfillment';
import type { Order } from '@/services/orderTypes';

export interface FulfillSheetProps {
  visible: boolean;
  order: Order | null;
  onCancel: () => void;
  /** Sends the request; reject with an Error whose message is shown under the form. */
  onSubmit: (request: FulfillRequest) => Promise<void>;
  /** Batch ship: "Fulfill 1 of 3" with Skip in the header. */
  batch?: { index: number; total: number; onSkip: () => void };
}

export function FulfillSheet({ visible, order, onCancel, onSubmit, batch }: FulfillSheetProps) {
  const { theme } = useAppTheme();
  const top = useHeaderTopInset();
  const lines = useMemo(() => (order ? linesToFulfill(order) : []), [order]);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [trackingNumber, setTrackingNumber] = useState('');
  const [carrier, setCarrier] = useState('');
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [carrierOpen, setCarrierOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  // Fresh form for every order the sheet opens on (batch moves through several).
  const orderId = order?.id;
  useEffect(() => {
    if (!visible || !order) return;
    setSelection(initialSelection(linesToFulfill(order)));
    setTrackingNumber('');
    setCarrier('');
    setNotifyCustomer(true);
    setError(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, orderId]);

  const count = selectedCount(lines, selection);

  async function confirm() {
    if (!order || busy) return;
    const built = buildFulfillRequest(order, selection, { trackingNumber, carrier, notifyCustomer });
    if (!built.ok) { setError(built.error); return; }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(built.request);
      hapticSuccessAction();
    } catch (e: unknown) {
      setError(e instanceof Error && e.message ? e.message : 'Couldn’t fulfill. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function openScanner() {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Camera access needed', 'Allow camera access to scan a tracking barcode.');
        return;
      }
    }
    setScanning(true);
  }

  const addr = order?.customer.shippingAddress;
  const addrLines = addr
    ? [addr.name, addr.line1, addr.line2, [addr.city, [addr.state, addr.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), addr.country]
      .filter((l): l is string => !!l && !!l.trim())
    : [];

  const title = batch ? `Fulfill ${batch.index + 1} of ${batch.total}` : lines.length > 1 ? 'Fulfill items' : 'Fulfill item';
  const s = styles;

  const scanner = scanning ? (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['code128', 'code39', 'ean13', 'ean8', 'upc_a', 'upc_e', 'qr'] }}
        onBarcodeScanned={({ data }) => { setScanning(false); hapticSuccessAction(); setTrackingNumber(String(data).trim()); }}
      />
      <View style={[s.scannerTop, { top: top + SP.sm }]}>
        <Button label="Cancel" variant="secondary" size="compact" onPress={() => setScanning(false)} />
      </View>
    </View>
  ) : null;

  return (
    <FullSheet
      visible={visible}
      title={title}
      subtitle={order ? orderTitle(order.orderNumber) : undefined}
      onCancel={onCancel}
      right={batch ? <Button label="Skip" variant="tertiary" size="compact" onPress={batch.onSkip} disabled={busy} testID="fulfill-sheet-skip" /> : null}
      testID="fulfill-sheet"
      overlay={scanner}
      footer={(
        <>
          {error ? <Text style={[TYPE_SCALE.footnote, { color: theme.error }]} accessibilityLiveRegion="polite">{error}</Text> : null}
          <Button
            label={`Fulfill ${count} item${count === 1 ? '' : 's'}`}
            onPress={confirm}
            loading={busy}
            disabled={count === 0}
            fullWidth
            testID="fulfill-sheet-confirm"
          />
          {order ? (
            <Button
              label="Print packing slip"
              variant="secondary"
              onPress={() => { sharePackingSlip(order).catch(() => Alert.alert('Couldn’t create the packing slip', 'Try again.')); }}
              fullWidth
            />
          ) : null}
        </>
      )}
    >
      {addrLines.length > 0 ? (
        <SheetSection title="Shipping address">
          {addrLines.map((l, i) => <Text key={i} style={[TYPE_SCALE.body, { color: theme.text, lineHeight: 22 }]}>{l}</Text>)}
        </SheetSection>
      ) : null}

      <SheetSection title="Items">
        {lines.map(li => {
          const value = selection[li.id] ?? 0;
          return (
            <View key={li.id} style={s.itemRow}>
              <View style={s.thumbWrap}>
                <View style={[s.thumb, { borderColor: theme.border }]}>
                  {li.imageUri ? <Image source={{ uri: li.imageUri }} style={s.thumbImg} /> : <Feather name="package" size={ICON.sm} color={theme.muted} />}
                </View>
                <View style={[s.badge, { backgroundColor: theme.text, borderColor: theme.background }]}>
                  <Text style={[s.badgeText, { color: theme.background }]}>{li.quantity}</Text>
                </View>
              </View>
              <View style={s.itemBody}>
                <Text style={[TYPE_SCALE.body, { color: theme.text }]} numberOfLines={2}>{li.productName}</Text>
                {li.variant ? <Text style={[TYPE_SCALE.footnote, { color: theme.muted }]} numberOfLines={1}>{li.variant}</Text> : null}
              </View>
              <QuantityStepper
                value={value}
                min={0}
                max={li.quantity}
                size="sm"
                onChange={next => setSelection(prev => ({ ...prev, [li.id]: stepSelection(value, next, li.quantity) }))}
                testID={`fulfill-qty-${li.id}`}
              />
            </View>
          );
        })}
      </SheetSection>

      <SheetSection title="Tracking information" last>
        <View style={[s.field, { backgroundColor: SHEET_FIELD_BG, borderColor: theme.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.fieldLabel, { color: theme.muted }]}>Tracking number</Text>
            <TextInput
              value={trackingNumber}
              onChangeText={setTrackingNumber}
              autoCapitalize="characters"
              autoCorrect={false}
              style={[s.fieldInput, { color: theme.text }]}
              accessibilityLabel="Tracking number"
              testID="fulfill-tracking-number"
            />
          </View>
          {Platform.OS !== 'web' ? (
            <Pressable onPress={openScanner} hitSlop={8} accessibilityRole="button" accessibilityLabel="Scan tracking barcode" style={s.fieldIcon}>
              <Feather name="maximize" size={ICON.md} color={theme.text} />
            </Pressable>
          ) : null}
        </View>

        <Pressable
          onPress={() => setCarrierOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Shipping carrier, ${carrier || 'not selected'}`}
          style={[s.field, { backgroundColor: SHEET_FIELD_BG, borderColor: theme.border }]}
          testID="fulfill-carrier"
        >
          <View style={{ flex: 1 }}>
            <Text style={[s.fieldLabel, { color: theme.muted }]}>Shipping carrier</Text>
            <Text style={[s.fieldInput, { color: carrier ? theme.text : theme.subtle }]}>{carrier || 'Select a carrier'}</Text>
          </View>
          <Feather name="chevron-right" size={ICON.md} color={theme.muted} />
        </Pressable>

        <View style={s.notifyRow}>
          <Text style={[TYPE_SCALE.body, { color: theme.text, flex: 1 }]}>Send notification to customer</Text>
          <HapticSwitch value={notifyCustomer} onValueChange={setNotifyCustomer} accessibilityLabel="Send notification to customer" testID="fulfill-notify" />
        </View>
      </SheetSection>

      <OptionSheet
        visible={carrierOpen}
        onClose={() => setCarrierOpen(false)}
        title="Shipping carrier"
        options={SHIPPING_CARRIERS.map(c => ({ id: c, label: c }))}
        selectedId={carrier}
        onSelect={id => { setCarrier(id); setCarrierOpen(false); }}
        testID="fulfill-carrier-sheet"
      />
    </FullSheet>
  );
}

const styles = StyleSheet.create({
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm },
  thumbWrap: { width: 48, height: 48 },
  thumb: { width: 44, height: 44, marginTop: 4, borderRadius: RADIUS.sm, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: SHEET_FIELD_BG },
  thumbImg: { width: '100%', height: '100%' },
  badge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { fontSize: 11, lineHeight: 13, fontFamily: FONT.semibold },
  itemBody: { flex: 1, minWidth: 0 },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SP.md, paddingVertical: SP.sm, marginBottom: SP.sm, minHeight: 60 },
  fieldLabel: { fontSize: 12, lineHeight: 16, fontFamily: FONT.regular },
  fieldInput: { fontSize: 17, lineHeight: 22, fontFamily: FONT.regular, paddingVertical: 2 },
  fieldIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -SP.sm },
  notifyRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingTop: SP.sm, minHeight: 48 },
  scannerTop: { position: 'absolute', left: SP.md },
});
