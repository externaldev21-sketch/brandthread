/**
 * Track shipment (item 109): what My Orders' "Track Shipment" button opens.
 * It used to open the same page as "View Order Details"; this screen is only
 * the shipment — carrier, tracking number, status, estimated / actual
 * delivery, the carrier's scan history and a button that opens the carrier's
 * tracking page. Data: GET /api/buyer/orders/:id (buyer-scoped), mapped by
 * lib/orderTracking.ts. Inline errors (RN-web Alert is a no-op).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandthreadCard, BrandthreadScreen, EmptyState } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/hooks/useApi';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { buildOrderTracking, trackingStatusText, type OrderTrackingView, type TrackingShipmentView } from '@/lib/orderTracking';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export default function BuyerOrderTrackingScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [view, setView] = useState<OrderTrackingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<'network' | 'not_found' | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) { setLoadError('not_found'); setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    try {
      const row = await api.buyer.orders.get(id);
      setView(buildOrderTracking(row));
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      setLoadError(status === 404 || status === 403 ? 'not_found' : 'network');
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function copyNumber(shipment: TrackingShipmentView) {
    try {
      await Clipboard.setStringAsync(shipment.trackingNumber);
      setCopied(shipment.trackingNumber);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  async function openCarrier(shipment: TrackingShipmentView) {
    setOpenError(null);
    try {
      await Linking.openURL(shipment.url);
    } catch {
      setOpenError(`Couldn't open ${shipment.carrier} tracking. Copy the number and track it on the carrier's site.`);
    }
  }

  const header = (
    <ScreenHeader
      title={view?.orderNumber ? `Track · #${view.orderNumber}` : 'Track shipment'}
      onBack={() => goBackOr(router, '/(buyer)/orders')}
    />
  );

  if (loading && !view) {
    return (
      <BrandthreadScreen noSafeTop>
        {header}
        <View style={s.centered}><ActivityIndicator color={theme.text} size="large" /></View>
      </BrandthreadScreen>
    );
  }

  if (!view) {
    return (
      <BrandthreadScreen noSafeTop>
        {header}
        {loadError === 'network' ? (
          <EmptyState
            icon="wifi-off"
            title="Couldn't load tracking"
            description="Check your connection and try again."
            action={{ label: 'Try again', onPress: () => { void load(); } }}
          />
        ) : (
          <EmptyState icon="package" title="Order not found" description="This order isn't on your account." />
        )}
      </BrandthreadScreen>
    );
  }

  const delivered = !!view.deliveredAt || view.shipments.some(sh => sh.status === 'delivered');

  return (
    <BrandthreadScreen noSafeTop>
      {header}
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + SP.xl }]} showsVerticalScrollIndicator={false}>
        {loadError === 'network' && (
          <Text style={s.inlineError} accessibilityRole="alert">Couldn't refresh tracking. Showing the last update.</Text>
        )}

        {view.shipments.length === 0 ? (
          <EmptyState
            icon="truck"
            title="Not shipped yet"
            description="The seller hasn't added tracking for this order. You'll see the carrier and tracking number here as soon as it ships."
            action={{ label: 'View order details', onPress: () => router.replace(('/buyer-order-detail?id=' + encodeURIComponent(view.orderId)) as never) }}
          />
        ) : (
          <>
            <Text style={s.headline}>
              {delivered
                ? `Delivered${view.deliveredAt ? ` ${fmtDate(view.deliveredAt)}` : ''}`
                : view.estimatedDelivery ? `Arriving ${fmtDate(view.estimatedDelivery)}` : trackingStatusText(view.shipments[0].status)}
            </Text>

            {view.shipments.map((shipment, index) => (
              <BrandthreadCard key={shipment.trackingNumber} style={s.card}>
                {view.shipments.length > 1 && (
                  <Text style={s.label}>Package {index + 1} of {view.shipments.length}</Text>
                )}
                <View style={s.row}>
                  <Feather name="truck" size={ICON.sm} color={theme.text} />
                  <Text style={s.carrier}>{shipment.carrier}</Text>
                  <View style={s.statusPill}>
                    <Text style={s.statusText}>{shipment.statusLabel}</Text>
                  </View>
                </View>
                <Text style={s.label}>Tracking number</Text>
                <Text style={s.number} selectable testID="tracking-number">{shipment.trackingNumber}</Text>
                <View style={s.actions}>
                  <Button
                    label={copied === shipment.trackingNumber ? 'Copied' : 'Copy number'}
                    icon={copied === shipment.trackingNumber ? 'check' : 'copy'}
                    variant="secondary"
                    size="small"
                    onPress={() => { void copyNumber(shipment); }}
                    style={{ flex: 1 }}
                  />
                  <Button
                    label={`Open ${shipment.carrier === 'Carrier' ? 'carrier' : shipment.carrier} tracking`}
                    icon="external-link"
                    size="small"
                    onPress={() => { void openCarrier(shipment); }}
                    style={{ flex: 1 }}
                    testID="tracking-open-carrier"
                  />
                </View>
              </BrandthreadCard>
            ))}

            {openError && <Text style={s.inlineError} accessibilityRole="alert">{openError}</Text>}

            <Text style={[s.label, { marginTop: SP.lg }]}>Tracking history</Text>
            {view.events.length === 0 ? (
              <Text style={s.muted}>No carrier scans yet. Updates appear here as the carrier scans your package.</Text>
            ) : (
              <BrandthreadCard style={s.card}>
                {view.events.map((event, i) => (
                  <View key={`${event.at}-${i}`} style={s.eventRow}>
                    <View style={[s.dot, i === 0 && s.dotCurrent]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.eventTitle}>{event.description || trackingStatusText(event.status)}</Text>
                      <Text style={s.muted}>
                        {fmtDateTime(event.at)}{event.location ? ` · ${event.location}` : ''}
                      </Text>
                    </View>
                  </View>
                ))}
              </BrandthreadCard>
            )}
          </>
        )}
      </ScrollView>
    </BrandthreadScreen>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content: { paddingHorizontal: SP.md, paddingTop: SP.md, gap: SP.sm },
    headline: { fontFamily: FONT.bold, fontSize: FS.xl, color: theme.text, marginBottom: SP.xs },
    card: { gap: SP.sm },
    row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
    carrier: { flex: 1, fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text },
    statusPill: { borderRadius: RADIUS.pill, borderWidth: 1, borderColor: theme.border, paddingHorizontal: SP.sm, paddingVertical: 3 },
    statusText: { fontFamily: FONT.semibold, fontSize: FS.xs, color: theme.text },
    label: { fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 0.8, textTransform: 'uppercase', color: theme.muted },
    number: { fontFamily: FONT.semibold, fontSize: FS.md, color: theme.text, letterSpacing: 0.5 },
    actions: { flexDirection: 'row', gap: SP.sm, marginTop: SP.xs },
    eventRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start', paddingVertical: SP.xs },
    dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: theme.border },
    dotCurrent: { backgroundColor: theme.text },
    eventTitle: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.text },
    muted: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18, color: theme.muted },
    inlineError: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.text },
  });
}
