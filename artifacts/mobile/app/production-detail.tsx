/**
 * Seller's live tracker for a sample or bulk order.
 *
 * Six stages (payment received → processing → cut & sew → packing → shipped →
 * delivered) with the time each was reached, carrier tracking all the way to
 * delivery, and the seller's actions: pay the card (card / Apple Pay / Google
 * Pay via Stripe, or a drop wallet for bulk), decline it, or confirm receipt.
 * Manufacturers own production-stage transitions.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deriveCardState, formatMoney, formatTimestamp, localTimeLabel, orderStatusLabel, orderTypeLabel } from '@workspace/manufacturer-flow';
import { BrandthreadHeader, EmptyState, SecondaryButton } from '@/components/BrandthreadUI';
import ProductionTimeline from '@/components/manufacturer/ProductionTimeline';
import { useOrderCardPayment } from '@/components/manufacturer/useOrderCardPayment';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BORDER, CARD, CARD_ELEVATED, FG, FONT, FS, MUTED, ORANGE, RADIUS, RED, SP, SUBTLE, SUCCESS } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { getBulkWalletOptions, getOrCreateConversation, getProductionOrder, payBulkOrderFromWallet, BulkWalletOption } from '@/services/manufacturerService';
import { confirmOrderDelivery, declineOrderCard, getOrderTimeline, type OrderTimeline } from '@/services/manufacturerOrderFlow';

export default function ProductionDetailScreen() {
  const { theme } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<OrderTimeline | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [walletState, setWalletState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<'not_found' | 'failed' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [wallets, setWallets] = useState<BulkWalletOption[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [walletError, setWalletError] = useState('');
  const [walletPaying, setWalletPaying] = useState(false);
  const [busy, setBusy] = useState<'decline' | 'confirm' | null>(null);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (!id) return;
    if (refresh) setRefreshing(true);
    try {
      const [timeline, order] = await Promise.all([getOrderTimeline(id), getProductionOrder(id).catch(() => undefined)]);
      setData(timeline);
      setThreadId(order?.threadId ?? null);
      setWalletState(order?.walletPaymentState ?? null);
      setLoadError(null);
    } catch (error: any) {
      setLoadError(error?.status === 404 ? 'not_found' : 'failed');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  const { pay, payingId, outcome } = useOrderCardPayment(() => void load(true));

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const order = data?.order;
  const isBulkAwaiting = order?.orderType === 'bulk' && order.status === 'pending_payment' && order.manufacturerPayoutReady;
  useEffect(() => {
    if (!isBulkAwaiting || !id) return;
    getBulkWalletOptions(id).then((options) => {
      setWallets(options.wallets);
      setSelectedWalletId((current) => current ?? options.wallets.find((wallet) => wallet.eligible)?.id ?? null);
    }).catch(() => setWallets([]));
  }, [isBulkAwaiting, id]);

  const payFromWallet = async () => {
    if (!id || !selectedWalletId || walletPaying) return;
    setWalletPaying(true); setWalletError('');
    try { await payBulkOrderFromWallet(id, selectedWalletId); await load(true); }
    catch { setWalletError('Wallet payment could not be completed. Try again or pay by card.'); }
    finally { setWalletPaying(false); }
  };

  const openThread = async () => {
    if (!data?.manufacturer) return;
    const target = threadId ?? (await getOrCreateConversation(data.manufacturer.id, {
      productionId: data.order.id, contextLabel: `${orderTypeLabel(data.order.orderType)}: ${data.order.title}`,
    })).id;
    router.push({ pathname: '/manufacturer-messages', params: { threadId: target } } as never);
  };

  const decline = () => {
    if (!order) return;
    Alert.alert('Decline this card?', 'The manufacturer will be told you passed. They can send a new card with a different price.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Decline', style: 'destructive', onPress: async () => {
        setBusy('decline'); setActionError('');
        try { await declineOrderCard(order.id); await load(true); } catch (e: any) { setActionError(e?.message ?? 'Could not decline. Try again.'); } finally { setBusy(null); }
      } },
    ]);
  };

  const confirmReceived = () => {
    if (!order) return;
    Alert.alert('Mark as received?', 'Confirm the order arrived. The manufacturer is notified.', [
      { text: 'Not yet', style: 'cancel' },
      { text: 'It arrived', onPress: async () => {
        setBusy('confirm'); setActionError('');
        try { await confirmOrderDelivery(order.id); await load(true); } catch (e: any) { setActionError(e?.message ?? 'Could not confirm delivery. Try again.'); } finally { setBusy(null); }
      } },
    ]);
  };

  const header = <BrandthreadHeader title={order ? orderTypeLabel(order.orderType) : 'Order'} subtitle={order ? 'Live production tracker' : undefined} onBack={() => router.back()} />;

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {header}
        <View style={styles.center} testID="tracker-loading"><ActivityIndicator color={FG} /><Text style={styles.muted}>Loading tracker…</Text></View>
      </View>
    );
  }

  if (!data || !order) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {header}
        <View style={styles.center}>
          <EmptyState
            icon={loadError === 'not_found' ? 'package' : 'wifi-off'}
            title={loadError === 'not_found' ? 'Order not found' : 'Tracker unavailable'}
            description={loadError === 'not_found' ? 'This order may have been removed, or it belongs to another account.' : 'Check your connection and try again.'}
          />
          {loadError !== 'not_found' && <SecondaryButton label="Try again" onPress={() => { setLoading(true); void load(); }} />}
        </View>
      </View>
    );
  }

  const state = deriveCardState(order, 'seller');
  const localTime = localTimeLabel(data.manufacturer?.timeZone);
  const paying = payingId === order.id;
  const payMessage = outcome?.orderId === order.id && outcome.result.status !== 'paid' ? outcome.result.message : '';
  const delivered = order.status === 'delivered';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {header}
      <ScrollView
        contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + SP.xl, gap: SP.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={FG} />}
      >
        <View style={styles.card} testID="tracker-summary">
          <View style={styles.summaryTop}>
            <View style={styles.icon}><Feather name={order.orderType === 'bulk' ? 'package' : 'scissors'} size={20} color={FG} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{order.title}</Text>
              <Text style={styles.muted}>{data.manufacturer?.businessName ?? 'Manufacturer'} · {order.quantity.toLocaleString('en-US')} {order.quantity === 1 ? 'piece' : 'pieces'}</Text>
            </View>
          </View>
          <View style={styles.statsRow}>
            <View style={{ flex: 1 }}><Text style={styles.statLabel}>Total</Text><Text style={styles.statValue}>{formatMoney(order.priceCents, order.currency)}</Text></View>
            <View style={{ flex: 1 }}><Text style={styles.statLabel}>Status</Text><Text style={[styles.statValue, { color: order.status === 'pending_payment' ? ORANGE : delivered ? SUCCESS : FG }]} testID="tracker-status">{orderStatusLabel(order.status)}</Text></View>
          </View>
          <Text style={styles.muted}>{data.paidAt ? `Paid ${formatTimestamp(data.paidAt)}` : `Sent ${formatTimestamp(data.createdAt)}`}</Text>
          {order.description ? <Text style={styles.description}>{order.description}</Text> : null}
        </View>

        {order.status === 'pending_payment' && (
          <View style={styles.card} testID="tracker-payment">
            <Text style={styles.section}>Payment</Text>
            <Text style={styles.muted}>{state.detail}</Text>
            {state.actions.some((action) => action.kind === 'pay') && (
              <TouchableOpacity style={[styles.primary, { backgroundColor: theme.accent }]} onPress={() => void pay(order)} disabled={paying} testID="tracker-pay">
                {paying ? <ActivityIndicator size="small" color={theme.onAccent} /> : <Feather name="lock" size={15} color={theme.onAccent} />}
                <Text style={[styles.primaryText, { color: theme.onAccent }]}>{paying ? 'Opening secure checkout…' : `Pay ${formatMoney(order.priceCents, order.currency)}`}</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.small}>Card, Apple Pay or Google Pay · processed by Stripe. The manufacturer is paid out after Brandthread's platform fee.</Text>
            {payMessage ? <Text style={styles.warn}>{payMessage}</Text> : null}
            {isBulkAwaiting && wallets.length > 0 && (
              <View style={styles.walletBox}>
                <Text style={styles.walletTitle}>Or pay from a drop wallet</Text>
                {walletState === 'processing' ? <Text style={styles.muted}>Wallet payment is processing…</Text> : wallets.map((wallet) => (
                  <TouchableOpacity key={wallet.id} disabled={!wallet.eligible || walletPaying} onPress={() => setSelectedWalletId(wallet.id)}
                    style={[styles.wallet, selectedWalletId === wallet.id && { borderColor: FG }, !wallet.eligible && { opacity: 0.45 }]}>
                    <Text style={styles.walletLabel}>Drop wallet</Text>
                    <Text style={styles.walletLabel}>{formatCents(wallet.availableCents)} available</Text>
                  </TouchableOpacity>
                ))}
                {walletError ? <Text style={styles.warn}>{walletError}</Text> : null}
                <SecondaryButton label={walletPaying ? 'Processing…' : 'Pay from wallet'} icon="credit-card" onPress={payFromWallet} disabled={!selectedWalletId || walletPaying || walletState === 'processing'} />
              </View>
            )}
            <TouchableOpacity onPress={decline} disabled={busy !== null || paying} style={styles.textBtn} testID="tracker-decline">
              {busy === 'decline' ? <ActivityIndicator size="small" color={MUTED} /> : <Text style={styles.textBtnLabel}>Decline this card</Text>}
            </TouchableOpacity>
          </View>
        )}

        {order.status === 'cancelled' && (
          <View style={styles.card}><Text style={styles.section}>Closed</Text><Text style={styles.muted}>This card was withdrawn or declined before payment. Nothing was charged.</Text></View>
        )}

        {(data.tracking.trackingNumber || order.status === 'shipped') && (
          <View style={styles.card} testID="tracker-shipment">
            <Text style={styles.section}>Shipment</Text>
            <Text style={styles.title}>{data.tracking.carrierName ?? 'Carrier'}</Text>
            <Text style={styles.muted}>{data.tracking.trackingNumber}</Text>
            <View style={{ flexDirection: 'row', gap: SP.sm, flexWrap: 'wrap', marginTop: SP.xs }}>
              {data.tracking.url && (
                <TouchableOpacity style={styles.secondary} onPress={() => void Linking.openURL(data.tracking.url!)} testID="tracker-track">
                  <Feather name="external-link" size={14} color={FG} /><Text style={styles.secondaryText}>Track with carrier</Text>
                </TouchableOpacity>
              )}
              {order.status === 'shipped' && (
                <TouchableOpacity style={[styles.primarySmall, { backgroundColor: theme.accent }]} onPress={confirmReceived} disabled={busy !== null} testID="tracker-received">
                  {busy === 'confirm' ? <ActivityIndicator size="small" color={theme.onAccent} /> : <Feather name="check" size={14} color={theme.onAccent} />}
                  <Text style={[styles.primaryText, { color: theme.onAccent }]}>I received it</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
        {actionError ? <Text style={[styles.warn, { color: RED }]}>{actionError}</Text> : null}

        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={styles.section}>Production</Text>
            <Text style={styles.small}>{state.completedStages}/6 complete</Text>
          </View>
          <ProductionTimeline steps={data.steps} awaitingPayment={order.status === 'pending_payment'} cancelled={order.status === 'cancelled'} />
          <Text style={styles.small}>Times shown in your time zone.{localTime ? ` It's ${localTime} for the factory.` : ''}</Text>
        </View>

        {delivered && order.orderType === 'sample' && (
          <SecondaryButton label="Review the sample" icon="star" onPress={() => router.push({ pathname: '/sample-detail', params: { id: order.id } } as never)} />
        )}
        <SecondaryButton label={`Message ${data.manufacturer?.businessName ?? 'manufacturer'}`} icon="message-circle" onPress={() => void openThread()} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SP.md, padding: SP.lg },
  card: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md, gap: SP.sm },
  summaryTop: { flexDirection: 'row', gap: SP.sm + 4, alignItems: 'center' },
  icon: { width: 44, height: 44, borderRadius: RADIUS.md, backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  muted: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 19 },
  small: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, lineHeight: 16 },
  description: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 19, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: SP.sm },
  statsRow: { flexDirection: 'row', gap: SP.md, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: SP.sm },
  statLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: SUBTLE },
  statValue: { fontSize: FS.md, fontFamily: FONT.bold, color: FG, marginTop: 2 },
  section: { fontSize: FS.xs, fontFamily: FONT.semibold, color: SUBTLE, letterSpacing: 1, textTransform: 'uppercase' },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, borderRadius: RADIUS.md, marginTop: SP.xs },
  primarySmall: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: RADIUS.md },
  primaryText: { fontSize: FS.base, fontFamily: FONT.bold },
  secondary: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_ELEVATED },
  secondaryText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  warn: { fontSize: FS.sm, fontFamily: FONT.medium, color: ORANGE, lineHeight: 19 },
  walletBox: { gap: SP.xs, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: SP.sm, marginTop: SP.xs },
  walletTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  wallet: { flexDirection: 'row', justifyContent: 'space-between', padding: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER },
  walletLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  textBtn: { alignSelf: 'center', paddingVertical: SP.sm, paddingHorizontal: SP.md },
  textBtnLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
});
