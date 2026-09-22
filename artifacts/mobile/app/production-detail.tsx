/**
 * Read-only seller view of a shared bulk order.
 * Manufacturers own production-stage and tracking transitions.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandthreadCard, BrandthreadHeader, GradientCard, SecondaryButton, StatusBadge } from '@/components/BrandthreadUI';
import { getProductionOrder, getOrCreateConversation } from '@/services/manufacturerService';
import { getBulkWalletOptions, payBulkOrderFromWallet, BulkWalletOption } from '@/services/manufacturerService';
import { ProductionOrder, PRODUCTION_STAGES } from '@/services/manufacturerTypes';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { useAppTheme } from '@/contexts/AppThemeContext';

function fmtDate(value?: string) {
  return value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

export default function ProductionDetailScreen() {
  const { theme } = useAppTheme();
  const { text: FG, border: BORDER, muted: MUTED, subtle: SUBTLE, accent: PURPLE,
    accentLight: PURPLE_LIGHT, success: SUCCESS, onAccent: ON_DARK } = theme;
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [order, setOrder] = useState<ProductionOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [wallets, setWallets] = useState<BulkWalletOption[]>([]);
  const [requiredCents, setRequiredCents] = useState(0);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState('');
  const [paying, setPaying] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (!id) return;
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      setOrder((await getProductionOrder(id)) ?? null);
    } catch {
      setOrder(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  const loadWallets = useCallback(async () => {
    if (!id) return;
    setPaymentError('');
    try {
      const options = await getBulkWalletOptions(id);
      setWallets(options.wallets);
      setRequiredCents(options.requiredCents);
      setSelectedWalletId(current => current && options.wallets.some(wallet => wallet.id === current && wallet.eligible)
        ? current : options.wallets.find(wallet => wallet.eligible)?.id ?? null);
    } catch (err: any) {
      setWallets([]);
      setPaymentError('Wallet payment options are unavailable right now.');
    }
  }, [id]);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), 15_000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (order?.status === 'pending' && order.manufacturerPayoutReady === true) void loadWallets();
  }, [order?.status, order?.manufacturerPayoutReady, loadWallets]);

  const payFromWallet = async () => {
    if (!id || !selectedWalletId || paying || order?.manufacturerPayoutReady !== true) return;
    setPaying(true);
    setPaymentError('');
    try {
      await payBulkOrderFromWallet(id, selectedWalletId);
      await load(true);
    } catch (err: any) {
      const message = String(err?.message ?? '');
      setPaymentError(
        message.includes('payouts are not ready')
          ? 'The manufacturer must finish Stripe verification before this wallet payment can be released. Message them, then retry.'
          : 'Wallet payment could not be completed. Please retry.',
      );
    } finally {
      setPaying(false);
    }
  };

  const openThread = async () => {
    if (!order) return;
    const threadId = order.threadId ?? (await getOrCreateConversation(order.manufacturerId, {
      productionId: order.id,
      contextLabel: `Bulk order: ${order.productName}`,
    })).id;
    router.push({ pathname: '/manufacturer-messages', params: { threadId } } as never);
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={PURPLE} /></View>;
  }

  if (!order) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <BrandthreadHeader title="Production" onBack={() => router.back()} />
        <View style={styles.center}>
        </View>
      </View>
    );
  }

  const currentIndex = PRODUCTION_STAGES.findIndex(stage => stage.key === order.currentStage);
  const progress = Math.max(0, Math.round((currentIndex / (PRODUCTION_STAGES.length - 1)) * 100));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <BrandthreadHeader
        title="Production"
        subtitle={order.manufacturerName ?? 'Manufacturer'}
        onBack={() => router.back()}
        rightElement={<StatusBadge label={order.status.replace(/_/g, ' ')} variant={order.status === 'completed' ? 'success' : 'purple'} />}
      />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={PURPLE} />}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + SP.xl }]}
      >
        <GradientCard>
          <Text style={styles.title}>{order.productName}</Text>
          <Text style={styles.meta}>{order.quantity} units · {formatCents(order.totalCostCents)}</Text>
          <View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View>
          <Text style={styles.stage}>{PRODUCTION_STAGES[currentIndex]?.label ?? order.currentStage} · {progress}%</Text>
        </GradientCard>

        {order.status === 'pending' && (
          <BrandthreadCard>
            <Text style={styles.heading}>Pay from a drop wallet</Text>
            <Text style={styles.walletHelp}>
              {order.manufacturerPayoutReady !== true
                ? 'Payment is unavailable until the manufacturer connects and verifies their Stripe payout account. Message them, then refresh this order.'
                : `This bulk order requires ${formatCents(requiredCents || order.totalCostCents)}. Wallet payments may take a moment to reconcile.`}
            </Text>
            {order.walletPaymentState === 'processing' ? (
              <Text style={styles.processing}>Payment is processing. This tracker will refresh automatically.</Text>
            ) : wallets.length === 0 ? (
              <Text style={styles.walletError}>{paymentError || 'No eligible drop wallet is available for this order.'}</Text>
            ) : (
              wallets.map(wallet => (
                <TouchableOpacity key={wallet.id} disabled={!wallet.eligible || paying} onPress={() => setSelectedWalletId(wallet.id)}
                  style={[styles.wallet, selectedWalletId === wallet.id && styles.walletSelected, !wallet.eligible && styles.walletDisabled]}>
                  <View><Text style={styles.value}>Drop wallet</Text><Text style={styles.label}>{wallet.dropId}</Text></View>
                  <Text style={[styles.value, !wallet.eligible && styles.walletError]}>{formatCents(wallet.availableCents)}</Text>
                </TouchableOpacity>
              ))
            )}
            {!!paymentError && wallets.length > 0 && <Text style={styles.walletError}>{paymentError}</Text>}
            <SecondaryButton label={paying ? 'Processing payment…' : 'Pay from selected wallet'} icon="lock" onPress={payFromWallet}
              disabled={!selectedWalletId || paying || order.walletPaymentState === 'processing' || order.manufacturerPayoutReady !== true} />
            {(!!paymentError || wallets.length === 0) && order.manufacturerPayoutReady === true && <TouchableOpacity onPress={loadWallets}><Text style={styles.retryLink}>Retry wallet options</Text></TouchableOpacity>}
            {order.manufacturerPayoutReady !== true && (
              <TouchableOpacity onPress={openThread}>
                <Text style={styles.retryLink}>Message manufacturer about payout setup</Text>
              </TouchableOpacity>
            )}
          </BrandthreadCard>
        )}

        <BrandthreadCard>
          <Text style={styles.heading}>Order details</Text>
          <View style={styles.row}><Text style={styles.label}>Manufacturer</Text><Text style={styles.value}>{order.manufacturerName ?? 'Manufacturer'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Created</Text><Text style={styles.value}>{fmtDate(order.createdAt)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Last updated</Text><Text style={styles.value}>{fmtDate(order.updatedAt)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Total</Text><Text style={styles.value}>{formatCents(order.totalCostCents)}</Text></View>
          {!!order.trackingNumber && <View style={styles.row}><Text style={styles.label}>Tracking</Text><Text style={styles.value}>{order.trackingCarrier ? `${order.trackingCarrier} · ` : ''}{order.trackingNumber}</Text></View>}
        </BrandthreadCard>

        <BrandthreadCard>
          <Text style={styles.heading}>Production progress</Text>
          {PRODUCTION_STAGES.map((stage, index) => {
            const complete = index < currentIndex;
            const current = index === currentIndex;
            return (
              <View key={stage.key} style={styles.stageRow}>
                <View style={[styles.dot, complete && styles.dotDone, current && styles.dotCurrent]}>
                  {complete && <Feather name="check" size={10} color={ON_DARK} />}
                </View>
                <Text style={[styles.stageName, current && styles.currentName]}>{stage.label}</Text>
              </View>
            );
          })}
          <Text style={styles.readOnly}>Production updates are managed by the manufacturer and refresh automatically.</Text>
        </BrandthreadCard>

        <SecondaryButton label="Message Manufacturer" icon="message-circle" onPress={openThread} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { border: BORDER, text: FG, muted: MUTED, subtle: SUBTLE, accent: PURPLE,
    accentLight: PURPLE_LIGHT, success: SUCCESS } = theme;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', padding: SP.lg },
  scroll: { padding: SP.md, gap: SP.md },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.lg },
  meta: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, marginTop: SP.xs },
  track: { height: 6, backgroundColor: BORDER, borderRadius: RADIUS.pill, overflow: 'hidden', marginTop: SP.md },
  fill: { height: '100%', backgroundColor: SUCCESS },
  stage: { color: PURPLE_LIGHT, fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: SP.sm },
  heading: { color: FG, fontFamily: FONT.bold, fontSize: FS.base, marginBottom: SP.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: SP.md, paddingVertical: SP.xs },
  label: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm },
  value: { color: FG, fontFamily: FONT.medium, fontSize: FS.sm, flex: 1, textAlign: 'right' },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 5 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  dotDone: { borderColor: SUCCESS, backgroundColor: SUCCESS },
  dotCurrent: { borderColor: PURPLE, backgroundColor: PURPLE },
  stageName: { color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.sm },
  currentName: { color: PURPLE_LIGHT, fontFamily: FONT.semibold },
  readOnly: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: SP.md },
  walletHelp: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, marginBottom: SP.sm },
  wallet: { borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, padding: SP.sm, marginBottom: SP.xs, flexDirection: 'row', justifyContent: 'space-between' },
  walletSelected: { borderColor: PURPLE, backgroundColor: 'rgba(14,165,233,0.12)' },
  walletDisabled: { opacity: 0.5 },
  walletError: { color: '#F97316', fontFamily: FONT.medium, fontSize: FS.sm, marginBottom: SP.sm },
  processing: { color: PURPLE_LIGHT, fontFamily: FONT.medium, fontSize: FS.sm, marginBottom: SP.sm },
  retryLink: { color: PURPLE_LIGHT, fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: SP.sm, textAlign: 'center' },
  });
};