import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@clerk/expo';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useAppTheme, AppThemePreset } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { RetryRow } from '@/components/ui/RetryRow';
import { LoadingSkeleton } from '@/components/BrandthreadUI';
import { EmptyState } from '@/components/layout';
import { useApi } from '@/lib/api';
import { isSellerDevPreview } from '@/lib/devPreview';
import { isManagerRole, hasPayoutsAccess } from '@/lib/roleError';
import { RoleLockedView } from '@/components/RoleLockedView';
import StripeConnectWarning, { ConnectStatus, normalizeConnectStatus } from '@/components/StripeConnectWarning';
import { useTeamRole } from '@/hooks/useTeamRole';
import { isSellerSetupOrigin, SELLER_HOME_ROUTE } from '@/lib/setupNavigation';
import { completeSetupTaskWhen } from '@/lib/setupCompletion';
import { scheduleLabel, requirementLabel, taxInfoConfig } from '@/lib/payoutSetup';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { SellerThreadCashCard } from '@/components/thread-cash/SellerThreadCashCard';
import { CashOutSheet } from '@/components/thread-cash/CashOutSheet';
import { useSellerThreadCashBalance } from '@/hooks/useSellerThreadCash';
import { formatCents } from '@/lib/money';

type PayoutStatus = 'paid' | 'pending' | 'in_transit' | 'failed';

interface PayoutRecord {
  id: string;
  date: string;
  amount: string;
  status: PayoutStatus;
  bankLast4: string;
  ordersCount: number;
}

// Status label fallback for Stripe statuses not in our union
function stripeStatusToLocal(s: string): PayoutStatus {
  if (s === 'paid') return 'paid';
  if (s === 'in_transit') return 'in_transit';
  if (s === 'pending') return 'pending';
  if (s === 'failed' || s === 'canceled') return 'failed';
  return 'pending';
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusConfig(status: PayoutStatus, theme: AppThemePreset) {
  return {
    paid:       { label: 'Paid',       color: theme.success,   bg: `${theme.success}20` },
    pending:    { label: 'Pending',    color: theme.warning,   bg: `${theme.warning}20` },
    in_transit: { label: 'In transit', color: theme.secondary, bg: theme.secondaryDim },
    failed:     { label: 'Failed',     color: theme.error,     bg: `${theme.error}20` },
  }[status];
}

export default function PayoutsScreen() {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const tabBarMetrics = useTabBarMetrics(2); // seller bar: Studio + AI side circles
  const router = useRouter();
  const params = useLocalSearchParams();
  const { isLoaded: authLoaded, isSignedIn, userId } = useAuth();
  const isPreviewMode = isSellerDevPreview();
  const isPreview = (isPreviewMode && !userId) || (isPreviewMode && (!authLoaded || !isSignedIn));
  const launchedFromSellerSetup = isSellerSetupOrigin(params.from);
  const api    = useApi();
  // ?bt_preview=seller with no real signed-in account: no token to fetch
  // real payout data with — resolve straight to the honest empty/no-history
  // state (same convention as app/(tabs)/orders.tsx's isPreviewMode guard).
  const { currentRole, isLoadingRole } = useTeamRole();
  const isReadOnly = isManagerRole(currentRole);
  const [activeTab, setActiveTab] = useState<'payouts' | 'settings'>('payouts');
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [balance,   setBalance]   = useState<any>(null);
  const [payouts,   setPayouts]   = useState<PayoutRecord[]>([]);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [connectLoading, setConnectLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const connectRequestRef = useRef(false);
  const onboardingOpenRef = useRef(false);
  const threadCash = useSellerThreadCashBalance();
  const [cashOutVisible, setCashOutVisible] = useState(false);

  function leaveSetupDestination() {
    if (launchedFromSellerSetup) {
      router.replace(SELLER_HOME_ROUTE as never);
      return;
    }
    goBackOr(router, '/(tabs)/more');
  }

  const refreshConnectStatus = useCallback(async () => {
    if (isPreview) {
      setConnectStatus(null);
      setConnectLoading(false);
      return;
    }
    if (connectRequestRef.current) return;
    connectRequestRef.current = true;
    try {
      const data = await api.seller.connect.status();
      const normalized = normalizeConnectStatus(data);
      setConnectStatus(normalized);
      await completeSetupTaskWhen(
        'connect_payments',
        Boolean(normalized?.connected && normalized.chargesEnabled && normalized.payoutsEnabled),
      );
    } catch {
      setConnectStatus(null);
    } finally {
      connectRequestRef.current = false;
      setConnectLoading(false);
    }
  }, [api, isPreview]);

  const load = useCallback(async () => {
    if (isPreview) {
      setBalance({ available: { amount: 0, currency: 'usd', formatted: '$0.00' }, pending: { amount: 0, currency: 'usd', formatted: '$0.00' }, connected: false });
      setPayouts([]);
      setLoadError(false);
      setLoading(false);
      void refreshConnectStatus();
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const [bal, po] = await Promise.all([
        api.finance.balance(),
        api.finance.payouts(20),
      ]);
      setBalance(bal);
      setPayouts((po.payouts ?? []).map((p: any): PayoutRecord => ({
        id:         p.id,
        date:       fmtDate(p.arrivalDate),
        amount:     p.formatted,
        status:     stripeStatusToLocal(p.status),
        bankLast4:  p.destination?.last4 ?? '····',
        ordersCount: 0,
      })));
    } catch {
      setLoadError(true);
    }
    setLoading(false);
    void refreshConnectStatus();
  }, [api, isPreview, refreshConnectStatus]);

  useEffect(() => { load(); }, [load]);

  function handleCashedOut(result: { threadCashCents: number; payoutCents: number; feeCents: number }) {
    setCashOutVisible(false);
    void threadCash.reload();
    void load(); // the cash-out is a real Stripe transfer — refresh the payout balance too
    Alert.alert('Cashed out', `${formatCents(result.threadCashCents)} Thread Cash moved to your payout balance as ${formatCents(result.payoutCents)}.`);
  }

  useFocusEffect(useCallback(() => {
    void refreshConnectStatus();
  }, [refreshConnectStatus]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshConnectStatus();
    });
    return () => subscription.remove();
  }, [refreshConnectStatus]);

  const openConnectOnboarding = useCallback(async () => {
    if (isPreview) return;
    if (onboardingOpenRef.current) return;
    onboardingOpenRef.current = true;
    setIsConnecting(true);
    try {
      const data = await api.seller.connect.onboard();
      if (!data || typeof data.url !== 'string' || !/^https:\/\//i.test(data.url)) {
        throw new Error('Stripe did not provide a valid onboarding link.');
      }
      await WebBrowser.openBrowserAsync(data.url);
      await refreshConnectStatus();
    } catch (error: any) {
      const message = typeof error?.message === 'string' && error.message
        ? error.message
        : 'Could not open Stripe onboarding. Please try again.';
      Alert.alert('Onboarding unavailable', message);
    } finally {
      onboardingOpenRef.current = false;
      setIsConnecting(false);
    }
  }, [api, isPreview, refreshConnectStatus]);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const availFmt   = balance?.available?.formatted ?? '$0.00';
  const pendFmt    = balance?.pending?.formatted   ?? '$0.00';
  const nextDate   = balance?.nextPayout
    ? fmtDate(balance.nextPayout.arrivalDate)
    : balance?.nextPayoutEstimate?.date
      ? fmtDate(balance.nextPayoutEstimate.date)
      : '—';

  if (!isPreview && isLoadingRole) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Payouts" onBack={() => { haptic(); leaveSetupDestination(); }} />
        <View style={{ padding: SP.md, gap: SP.sm }}>
          <LoadingSkeleton height={140} />
          <LoadingSkeleton height={44} />
        </View>
      </View>
    );
  }

  if (!isPreview && !hasPayoutsAccess(currentRole) && !isReadOnly) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Payouts" onBack={() => { haptic(); leaveSetupDestination(); }} />
        <RoleLockedView screenTitle="payouts" currentRole={currentRole ?? undefined} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Payouts"
        onBack={() => { haptic(); leaveSetupDestination(); }}
        actions={[{
          icon: 'help-circle',
          onPress: () => { haptic(); router.push('/help' as never); },
          accessibilityLabel: 'Payouts help',
        }]}
      />

      <SellerThreadCashCard
        balanceCents={threadCash.balanceCents}
        loading={threadCash.loading}
        error={threadCash.error}
        onReload={threadCash.reload}
        onCashOutPress={() => setCashOutVisible(true)}
      />
      <CashOutSheet
        visible={cashOutVisible}
        balanceCents={threadCash.balanceCents ?? 0}
        onClose={() => setCashOutVisible(false)}
        onCashedOut={handleCashedOut}
      />

      {/* Balance hero */}
      <View style={styles.balanceHero}>
        <Text style={styles.balanceHeroLabel}>Available balance</Text>
        {loading ? (
          <LoadingSkeleton height={44} style={{ width: 160, marginTop: 6, marginBottom: 6 }} />
        ) : loadError ? (
          <View style={{ marginTop: 6, marginBottom: 6 }}>
            <RetryRow label="Couldn't load balance" onRetry={() => { haptic(); void load(); }} />
          </View>
        ) : (
          <Text style={styles.balanceHeroAmount}>{availFmt}</Text>
        )}
        <Text style={styles.balanceHeroSub}>{loadError ? '—' : `Next payout ${nextDate}`}</Text>
        <View style={styles.balanceDivider} />
        <View style={styles.balancePendingRow}>
          <Text style={styles.balancePendingLabel}>Pending</Text>
          <Text style={styles.balancePendingAmount}>{loadError ? '—' : pendFmt}</Text>
        </View>
      </View>

      {!isPreview && (
        <StripeConnectWarning
          connectStatus={connectStatus}
          onConnect={openConnectOnboarding}
          isConnecting={isConnecting}
        />
      )}

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['payouts', 'settings'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            testID={`seller-payouts-tab-${t}`}
            style={[styles.tab, activeTab === t && styles.tabActive]}
            onPress={() => { haptic(); setActiveTab(t); }}
          >
            <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>
              {t === 'payouts' ? 'Payout history' : 'Bank account'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'payouts' ? (
        <ScrollView
          style={{ marginBottom: tabBarMetrics.occupiedHeight }}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: SP.md },
            payouts.length === 0 && { flexGrow: 1, justifyContent: 'center' },
          ]}
        >
          {loading && !isPreview ? (
            <View style={{ gap: 10 }}>
              {[0, 1, 2].map(i => <LoadingSkeleton key={i} height={56} />)}
            </View>
          ) : loadError ? (
            <ErrorState message="Couldn't load your payouts." onRetry={() => { haptic(); void load(); }} />
          ) : payouts.length === 0 ? (
            <View style={{ alignItems: 'center' }}>
              <EmptyState
                icon="inbox"
                title={!isPreview && balance?.connected === false ? 'Connect Stripe to get paid' : 'No payouts yet'}
                message=""
                compact
              />
              <Text style={styles.payoutsEmptyMessage}>
                {!isPreview && balance?.connected === false
                  ? 'Add a bank account under Bank account to start receiving payouts.'
                  : 'Payouts show up here once your available balance clears.'}
              </Text>
            </View>
          ) : (
            payouts.map((p) => {
              const cfg = statusConfig(p.status, theme);
              return (
                <TouchableOpacity
                  key={p.id}
                  style={styles.payoutRow}
                  onPress={() => { haptic(); router.push({ pathname: '/payout-detail', params: { id: p.id } } as never); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Payout ${p.amount}, ${cfg.label}`}
                >
                  <View style={styles.payoutLeft}>
                    <Text style={styles.payoutDate}>{p.date}</Text>
                    <Text style={styles.payoutSub}>···{p.bankLast4}</Text>
                  </View>
                  <View style={styles.payoutRight}>
                    <Text style={styles.payoutAmount}>{p.amount}</Text>
                    <View style={[styles.statusPill, { backgroundColor: cfg.bg }]}>
                      <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      ) : (
        <ScrollView
          style={{ marginBottom: tabBarMetrics.occupiedHeight }}
          contentContainerStyle={[styles.list, { paddingBottom: SP.md }]}
        >
           <View style={styles.bankCard}>
             <Feather name="credit-card" size={20} color={theme.accent} />
            <View style={{ flex: 1, marginLeft: SP.md }}>
                <Text style={styles.bankLabel}>
                  {isPreview
                    ? 'Bank account details are not loaded'
                    : connectStatus?.bankLast4 ? `Bank account ···${connectStatus.bankLast4}` : 'No bank account connected'}
               </Text>
               <Text style={styles.bankSub}>
                  {isPreview
                    ? 'Account information unavailable'
                    : connectLoading
                   ? 'Checking Stripe account status…'
                   : connectStatus?.verified
                      ? connectStatus.chargesEnabled
                        ? 'Default payout account'
                        : 'Payouts enabled; payments are still restricted'
                     : connectStatus?.connected
                       ? 'Complete Stripe verification to receive payouts'
                       : 'Connect Stripe to receive payouts'}
               </Text>
            </View>
              {!isPreview && !connectLoading && connectStatus && (
               <View style={[styles.statusPill, {
                 backgroundColor: connectStatus.verified ? `${theme.success}20` : `${theme.warning}20`,
               }]}>
                 <Text style={[styles.statusText, {
                   color: connectStatus.verified ? theme.success : theme.warning,
                 }]}>
                   {connectStatus.verified
                     ? 'Verified'
                      : connectStatus.status === 'restricted'
                        ? 'Restricted'
                     : connectStatus.connected
                       ? 'Pending verification'
                       : 'Not connected'}
                 </Text>
               </View>
             )}
          </View>

           {!isReadOnly && (
             <TouchableOpacity
                testID="seller-payouts-bank-account"
               style={styles.addBankBtn}
                onPress={() => { haptic(); void openConnectOnboarding(); }}
               disabled={isConnecting || isPreview}
               accessibilityRole="button"
               accessibilityLabel="Add bank account with Stripe"
             >
                <Feather name="plus" size={16} color={theme.accent} />
                <Text style={styles.addBankText}>
                  {isPreview
                    ? 'Bank setup unavailable'
                    : isConnecting ? 'Opening Stripe…' : connectStatus?.connected ? 'Update bank account' : 'Add bank account'}
                </Text>
             </TouchableOpacity>
           )}

           {/* Verification status + next steps */}
            {!isPreview && !connectLoading && connectStatus?.connected && !connectStatus.verified && connectStatus.providerConfigured && (
             <View style={styles.settingsSection} testID="seller-payouts-verification-next-steps">
               <Text style={styles.sectionTitle}>Next steps to get verified</Text>
               {connectStatus.requirementsDue.length === 0 ? (
                 <Text style={styles.bankSub}>
                   Stripe is reviewing your account. This usually finishes within a few minutes.
                 </Text>
               ) : (
                 connectStatus.requirementsDue.map((field) => (
                   <View key={field} style={styles.settingsRow}>
                     <Text style={styles.settingsLabel}>{requirementLabel(field)}</Text>
                     <Feather name="alert-circle" size={14} color={theme.warning} />
                   </View>
                 ))
               )}
               {!isReadOnly && (
                 <TouchableOpacity
                   style={[styles.addBankBtn, { marginTop: SP.md }]}
                   onPress={() => { haptic(); void openConnectOnboarding(); }}
                   disabled={isConnecting}
                   accessibilityRole="button"
                   accessibilityLabel="Finish Stripe verification"
                 >
                   <Feather name="arrow-right-circle" size={16} color={theme.accent} />
                   <Text style={styles.addBankText}>Finish verification</Text>
                 </TouchableOpacity>
               )}
             </View>
           )}

           {/* Payout method + schedule */}
           <View style={styles.settingsSection} testID="seller-payouts-schedule">
             <Text style={styles.sectionTitle}>Payout method &amp; schedule</Text>
             <View style={styles.settingsRow}>
               <Text style={styles.settingsLabel}>Method</Text>
               <Text style={styles.settingsValue}>
                  {isPreview
                    ? 'Not loaded'
                    : connectStatus?.bankLast4 ? `Bank transfer ···${connectStatus.bankLast4}` : 'Not set up'}
               </Text>
             </View>
             <TouchableOpacity
               style={styles.settingsRow}
               testID="seller-payouts-schedule-row"
               onPress={() => { haptic(); router.push('/payout-schedule' as never); }}
               accessibilityRole="button"
               accessibilityLabel="Payout schedule"
             >
               <Text style={styles.settingsLabel}>Schedule</Text>
               <Text style={styles.settingsValue}>
                  {isPreview ? 'Not loaded' : connectLoading ? 'Loading…' : scheduleLabel(connectStatus?.payoutSchedule ?? null)}
               </Text>
             </TouchableOpacity>
           </View>

           {/* Tax info status */}
            {!isPreview && connectStatus?.connected && connectStatus.providerConfigured && (() => {
             const cfg = taxInfoConfig(connectStatus.taxInfoStatus, theme);
             return (
               <View style={styles.settingsSection} testID="seller-payouts-tax-info">
                 <Text style={styles.sectionTitle}>Tax information</Text>
                 <View style={styles.settingsRow}>
                   <Text style={styles.settingsLabel}>Status</Text>
                   <View style={[styles.statusPill, { backgroundColor: `${cfg.color}20` }]}>
                     <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
                   </View>
                 </View>
                 {connectStatus.taxInfoStatus === 'needed' && (
                   <Text style={[styles.bankSub, { marginTop: SP.xs }]}>
                     Stripe needs your tax ID to keep paying out without interruption.
                   </Text>
                 )}
               </View>
             );
           })()}
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => {
  const { accent, text, muted, subtle, card, border } = theme;
  return StyleSheet.create({
  root:         { flex: 1, backgroundColor: 'transparent' },
  accessLoading:{ flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: border },
  backBtn:      { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle:  { flex: 1, textAlign: 'center', color: text, fontSize: FS.lg, fontFamily: FONT.semibold },
  balanceHero:  { margin: SP.md, backgroundColor: card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: border, padding: SP.lg, alignItems: 'center' },
  balanceHeroLabel: { color: muted, fontSize: FS.sm, fontFamily: FONT.medium },
  balanceHeroAmount: { color: text, fontSize: 40, fontFamily: FONT.bold, letterSpacing: -0.5, marginTop: 6, marginBottom: 2 },
  balanceHeroSub: { color: subtle, fontSize: FS.xs, fontFamily: FONT.regular },
  balanceDivider: { alignSelf: 'stretch', height: 1, backgroundColor: border, marginVertical: SP.md },
  balancePendingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  balancePendingLabel: { color: muted, fontSize: FS.xs, fontFamily: FONT.medium },
  balancePendingAmount: { color: muted, fontSize: FS.sm, fontFamily: FONT.semibold },
  balanceLabel: { color: muted, fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: 4 },
  balanceAmount:{ color: text, fontSize: FS.xl, fontFamily: FONT.semibold, marginBottom: 2 },
  balanceSub:   { color: subtle, fontSize: FS.xs, fontFamily: FONT.regular },
  tabRow:       { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: border, marginHorizontal: SP.md },
  tab:          { flex: 1, paddingVertical: SP.sm, alignItems: 'center' },
   tabActive:    { borderBottomWidth: 2, borderBottomColor: accent },
  tabText:      { color: muted, fontSize: FS.sm, fontFamily: FONT.medium },
   tabTextActive:{ color: accent },
  list:         { padding: SP.md },
  payoutsEmptyMessage: {
    color: muted, fontSize: FS.sm, fontFamily: FONT.medium, textAlign: 'center',
    maxWidth: 280, marginTop: -4,
  },
  payoutRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SP.md, borderBottomWidth: 1, borderBottomColor: border },
  payoutLeft:   {},
  payoutRight:  { alignItems: 'flex-end', gap: 4 },
  payoutDate:   { color: text, fontSize: FS.base, fontFamily: FONT.medium },
  payoutSub:    { color: muted, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  payoutAmount: { color: text, fontSize: FS.base, fontFamily: FONT.semibold },
  statusPill:   { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  statusText:   { fontSize: FS.xs, fontFamily: FONT.medium },
  totalRow:     { flexDirection: 'row', justifyContent: 'space-between', marginTop: SP.lg, paddingTop: SP.md, borderTopWidth: 1, borderTopColor: border },
  totalLabel:   { color: muted, fontSize: FS.sm, fontFamily: FONT.medium },
  totalAmount:  { color: text, fontSize: FS.base, fontFamily: FONT.semibold },
  bankCard:     { flexDirection: 'row', alignItems: 'center', backgroundColor: card, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: border, marginBottom: SP.md },
  bankLabel:    { color: text, fontSize: FS.base, fontFamily: FONT.medium },
  bankSub:      { color: muted, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  settingsSection:{ backgroundColor: card, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: border, marginBottom: SP.md },
  sectionTitle: { color: muted, fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: SP.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  settingsRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SP.sm, borderTopWidth: 1, borderTopColor: border },
  settingsLabel:{ color: muted, fontSize: FS.sm, fontFamily: FONT.regular },
  settingsValue:{ color: text, fontSize: FS.sm, fontFamily: FONT.medium },
   addBankBtn:   { flexDirection: 'row', alignItems: 'center', gap: SP.sm, justifyContent: 'center', padding: SP.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: accent, borderStyle: 'dashed' },
   addBankText:  { color: accent, fontSize: FS.sm, fontFamily: FONT.medium },
  });
};
