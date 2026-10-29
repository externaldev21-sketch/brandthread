import * as Haptics from 'expo-haptics';
import { ScreenExplainer } from '@/components/first-run-tips/ScreenExplainer';
import { radius as ControlRadius } from '@/constants/radii';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAgeStatus } from '@/lib/ageGate';

import { AgeRestrictedScreen } from '@/components/age/AgeNotices';

import { AppState, View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Platform } from 'react-native';

import { Icon } from '@/components/ui/Icon';

import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';

import { haptics, haptic } from '@/lib/haptics';

import { showToast } from '@/lib/toast';


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

import { isSellerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';

import { buildPreviewPayouts } from '@/lib/previewPayouts';

import { isManagerRole, hasPayoutsAccess, parseRoleError } from '@/lib/roleError';

import { RoleLockedView } from '@/components/RoleLockedView';

import { type ConnectStatus, normalizeConnectStatus } from '@/lib/stripeConnectStatus';
import { resolveSignedOutPreviewGet } from '@/lib/previewApiSession';
import {
  PAYOUT_JOURNEY_STATES,
  fixtureJourneyStatus,
  normalizePayoutJourney,
  showsManagePage,
  type PayoutJourney,
  type PayoutJourneyState,
} from '@/lib/payoutJourney';
import { formatDeadline } from '@/lib/payoutSetupSteps';
import { PayoutSetupJourney } from '@/components/payouts/PayoutSetupJourney';
import { useTeamRole } from '@/hooks/useTeamRole';

import { isSellerSetupOrigin, leaveSetupFlow } from '@/lib/setupNavigation';

import { completeSetupTaskWhen } from '@/lib/setupCompletion';

import { scheduleLabel, taxInfoConfig } from '@/lib/payoutSetup';

import { STUDIO_MENU_ORIGIN, returnToStudioMenu } from '@/lib/navigation/studioMenuReturn';

import { SellerThreadCashCard } from '@/components/thread-cash/SellerThreadCashCard';

import { CashOutSheet } from '@/components/thread-cash/CashOutSheet';

import { useSellerThreadCashBalance } from '@/hooks/useSellerThreadCash';

import { formatCents } from '@/lib/money';
import { HelpLink } from '@/components/help/HelpLink';

import { signedBalance, pausedRowCaption } from '@/lib/recoveries';

import { HeldForDeliverySection } from '@/components/payouts/HeldForDeliveryRow';

type PayoutStatus = 'paid' | 'pending' | 'in_transit' | 'failed';

interface PayoutRecord {
  id: string;
  date: string;
  amount: string;
  status: PayoutStatus;
  bankLast4: string;
  ordersCount: number | null;
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

// Shopify payout list pattern: status is quiet silver text under the date; only a
// failed payout stands out (white), so nothing outside the palette is used.
function statusConfig(status: PayoutStatus, theme: AppThemePreset) {
  return {
    paid:       { label: 'Paid',       color: theme.muted },
    pending:    { label: 'Pending',    color: theme.muted },
    in_transit: { label: 'In transit', color: theme.muted },
    failed:     { label: 'Failed',     color: theme.text },
  }[status];
}

export default function PayoutsScreen() {
  const age = useAgeStatus();
  if (age.status !== 'ok') return <AgeRestrictedScreen title="Payouts" status={age.status} onResolved={age.setBand} />;
  return <><PayoutsScreenContent /><ScreenExplainer id="explain-payouts" /></>;
}

// Stripe sends the in-app browser here when the seller finishes or leaves
// (api-server lib/connectOnboarding.ts APP_RETURN_DEEP_LINK).
const PAYOUTS_RETURN_DEEP_LINK = 'brandthread://payouts';

type JourneyLoad =
  | { kind: 'loading' }
  | { kind: 'ready'; journey: PayoutJourney }
  // Connect is owner-only on the server; staff see payouts but cannot run setup.
  | { kind: 'owner_only' }
  | { kind: 'error' };

function PayoutsScreenContent() {
  const tabBarMetrics = useTabBarMetrics();
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const params = useLocalSearchParams();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  // No API call without a loaded, signed-in session, and none at all in the
  // seller web preview (lib/api.ts rejects every request there, signed in or
  // not — which used to land a signed-in preview on "Owner access required").
  const isPreviewMode = isSellerDevPreview();
  const isPreview = isPreviewMode || (!authLoaded || !isSignedIn);
  const launchedFromSellerSetup = isSellerSetupOrigin(params.from);
  const api    = useApi();
  // ?bt_preview=seller with no real signed-in account: no token to fetch
  // real payout data with — resolve straight to the honest empty/no-history
  // state (same convention as the isPreviewMode guard in app/(tabs)/orders.tsx).
  const { currentRole, isLoadingRole, roleError, retryRole } = useTeamRole();
  const isReadOnly = isManagerRole(currentRole);
  // Web dev session only (never a native route param): pin one journey state
  // so each screen can be reviewed, e.g. &payoutState=action_needed.
  const forcedState: PayoutJourneyState | null = isPreviewMode && isPreviewDemoMode()
    && PAYOUT_JOURNEY_STATES.includes(params.payoutState as PayoutJourneyState)
    ? params.payoutState as PayoutJourneyState
    : null;
  const [activeTab, setActiveTab] = useState<'payouts' | 'settings'>('payouts');
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [balance,   setBalance]   = useState<any>(null);
  const [payouts,   setPayouts]   = useState<PayoutRecord[]>([]);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [journeyLoad, setJourneyLoad] = useState<JourneyLoad>({ kind: 'loading' });
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const connectRequestRef = useRef(false);
  const onboardingOpenRef = useRef(false);
  const threadCash = useSellerThreadCashBalance();
  const [cashOutVisible, setCashOutVisible] = useState(false);
  // The first payout of a new seller waits for identity verification (server: lib/money/firstPayoutGate.ts).
  const [identityRequired, setIdentityRequired] = useState(false);

  function leaveSetupDestination() {
    if (params.from === STUDIO_MENU_ORIGIN) {
      returnToStudioMenu(router);
      return;
    }
    // Pop to the exact screen underneath (dashboard / setup checklist / tab);
    // only a cold deep link with no history falls back to the `from` origin.
    leaveSetupFlow(router, params.from, '/(tabs)/more');
  }

  const applyStatus = useCallback((data: unknown) => {
    const journey = normalizePayoutJourney(data);
    setConnectStatus(normalizeConnectStatus(data));
    setJourneyLoad(journey ? { kind: 'ready', journey } : { kind: 'error' });
    return journey;
  }, []);

  const refreshConnectStatus = useCallback(async () => {
    if (isPreview) {
      // The local preview data layer answers this endpoint (a new seller: not
      // started), or a pinned state for review. Never the network.
      const hit = forcedState ? null : resolveSignedOutPreviewGet('/api/seller/connect/status');
      applyStatus(hit?.data ?? fixtureJourneyStatus(forcedState ?? 'not_started'));
      return;
    }
    if (connectRequestRef.current) return;
    connectRequestRef.current = true;
    setRefreshingStatus(true);
    try {
      const data = await api.seller.connect.status();
      const normalized = applyStatus(data);
      // Only a live account with nothing due completes the setup task.
      await completeSetupTaskWhen('connect_payments', normalized?.state === 'active').catch(() => undefined);
    } catch (err: any) {
      const ownerOnly = err?.status === 403 || parseRoleError(err) !== null;
      // A failed re-check (focus, app resume) keeps the last known answer on screen.
      setJourneyLoad((prev) => (prev.kind === 'ready' && !ownerOnly ? prev : ownerOnly ? { kind: 'owner_only' } : { kind: 'error' }));
      if (ownerOnly) setConnectStatus(null);
    } finally {
      connectRequestRef.current = false;
      setRefreshingStatus(false);
    }
  }, [api, isPreview, forcedState, applyStatus]);

  const load = useCallback(async () => {
    if (isPreview) {
      // Fresh: zero balance, no history. With demo=1: local illustration only.
      // Only the current web URL may enable demo data, never a native route param.
      const preview = buildPreviewPayouts(isPreviewDemoMode());
      setBalance(preview);
      setPayouts(preview.payouts.map((p): PayoutRecord => ({
        id: p.id,
        date: fmtDate(p.arrivalDate),
        amount: formatCents(p.amountCents),
        status: p.status,
        bankLast4: p.bankLast4,
        ordersCount: 0,
      })));
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
        ordersCount: typeof p.ordersCount === 'number' ? p.ordersCount : null,
      })));
    } catch {
      setLoadError(true);
    }
    setLoading(false);
    void refreshConnectStatus();
  }, [api, isPreview, params.demo, refreshConnectStatus]);


  function handleCashedOut(result: { threadCashCents: number; payoutCents: number; feeCents: number }) {
    setCashOutVisible(false);
    void threadCash.reload();
    void load(); // the cash-out is a real Stripe transfer — refresh the payout balance too
    showToast('Cashed out', `${formatCents(result.threadCashCents)} Thread Cash moved to your payout balance as ${formatCents(result.payoutCents)}.`);
  }

  // Load on every focus (first mount included): the balance and history are
  // fresh whenever the seller comes back, the way Thread Cash above refreshes.
  // Coming back from Stripe (?returned=1) lands here too and re-reads status.
  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  useFocusEffect(useCallback(() => {
    if (isPreview) return;
    let active = true;
    api.finance.firstPayout()
      .then((r) => { if (active) setIdentityRequired(r.identityRequired); })
      .catch(() => {});
    return () => { active = false; };
  }, [api, isPreview]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshConnectStatus();
    });
    return () => subscription.remove();
  }, [refreshConnectStatus]);

  /** Mint a hosted Stripe link. On web, Stripe returns the seller to this page. */
  const requestOnboardingLink = useCallback(async (onWeb: boolean) => {
    if (!onWeb) return api.seller.connect.onboard();
    const here = `${window.location.origin}/payouts`;
    try {
      return await api.seller.connect.onboard({ returnUrl: `${here}?returned=1`, refreshUrl: `${here}?refresh=1` });
    } catch (err: any) {
      // This web origin is not on the server allow-list: use the default return.
      if (err?.status === 400) return api.seller.connect.onboard();
      throw err;
    }
  }, [api]);

  const openConnectOnboarding = useCallback(async () => {
    if (isPreview) return;
    if (onboardingOpenRef.current) return;
    onboardingOpenRef.current = true;
    setIsConnecting(true);
    const onWeb = Platform.OS === 'web' && typeof window !== 'undefined';
    try {
      const data = await requestOnboardingLink(onWeb);
      if (!data || typeof data.url !== 'string' || !/^https:\/\//i.test(data.url)) {
        throw new Error('Stripe did not provide a valid onboarding link.');
      }
      if (onWeb) {
        // Same tab, like Shopify: Stripe sends the seller back to /payouts?returned=1.
        window.location.assign(data.url);
        return;
      }
      // The auth session closes itself when Stripe redirects to brandthread://payouts.
      await WebBrowser.openAuthSessionAsync(data.url, PAYOUTS_RETURN_DEEP_LINK);
      await refreshConnectStatus();
    } catch {
      Alert.alert("Couldn't open Stripe", 'Check your connection and try again.');
    } finally {
      onboardingOpenRef.current = false;
      setIsConnecting(false);
    }
  }, [isPreview, requestOnboardingLink, refreshConnectStatus]);

  /** Every "go to Stripe" button on this screen. Signed out, it says what to do instead. */
  function startStripe() {
    if (isPreview) {
      showToast('Sign in to set up payouts', 'Stripe setup opens from your signed-in store.');
      return;
    }
    haptic('select');
    void openConnectOnboarding();
  }

  // Stripe sends an expired or reused link back with ?refresh=1: open a fresh one.
  const autoResumedRef = useRef(false);
  useEffect(() => {
    if (params.refresh !== '1' || autoResumedRef.current || isPreview || journeyLoad.kind !== 'ready') return;
    if (showsManagePage(journeyLoad.journey) && journeyLoad.journey.state === 'active') return;
    autoResumedRef.current = true;
    void openConnectOnboarding();
  }, [params.refresh, isPreview, journeyLoad, openConnectOnboarding]);


  // A lost chargeback still being recovered: the balance is shown net of it
  // (it can be negative) and every cash-out is paused until it is covered.
  const payoutsPaused = balance?.payoutsPaused === true;
  const availFmt   = payoutsPaused && balance?.balanceAfterRecovery
    ? signedBalance(balance.balanceAfterRecovery.amount)
    : balance?.available?.formatted ?? '$0.00';
  const pendFmt    = balance?.pending?.formatted   ?? '$0.00';
  // Never a bare dash placeholder: say plainly when nothing is scheduled.
  const nextPayoutLabel = balance?.nextPayout?.arrivalDate
    ? `Next payout ${fmtDate(balance.nextPayout.arrivalDate)}`
    : balance?.nextPayoutEstimate?.date
      ? `Estimated payout ${fmtDate(balance.nextPayoutEstimate.date)}`
      : 'No payout scheduled';

  if (!isPreview && isLoadingRole) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Payouts" onBack={() => { leaveSetupDestination(); }} />
        <View style={{ padding: SP.md, gap: SP.sm }}>
          <LoadingSkeleton height={140} />
          <LoadingSkeleton height={44} />
        </View>
      </View>
    );
  }

  // A failed role lookup is not "no access": offer a retry instead of the
  // owner-only lock, so an owner on a flaky request is not told they are locked out.
  if (!isPreview && roleError) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Payouts" onBack={() => { leaveSetupDestination(); }} />
        <View style={{ padding: SP.md }}>
          <RetryRow label="Couldn't load payouts" onRetry={retryRole} />
        </View>
      </View>
    );
  }

  if (!isPreview && !hasPayoutsAccess(currentRole) && !isReadOnly) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Payouts" onBack={() => { leaveSetupDestination(); }} />
        <RoleLockedView screenTitle="payouts" currentRole={currentRole ?? undefined} />
      </View>
    );
  }

  const header = (
    <ScreenHeader
      title="Payouts"
      onBack={() => { leaveSetupDestination(); }}
      actions={[{
        icon: 'help-circle',
        onPress: () => { router.push('/help' as never); },
        accessibilityLabel: 'Payouts help',
      }]}
    />
  );

  // Until Stripe answers, nothing claims payouts are (or are not) set up.
  const staffWithoutSetup = journeyLoad.kind === 'owner_only' && balance?.connected === false;
  if (journeyLoad.kind === 'loading' || (journeyLoad.kind === 'owner_only' && loading)) {
    return (
      <View style={styles.root}>
        {header}
        <View style={{ padding: SP.md, gap: SP.sm }} testID="payouts-status-loading">
          <LoadingSkeleton height={32} style={{ width: 220 }} />
          <LoadingSkeleton height={44} />
          <LoadingSkeleton height={168} />
        </View>
      </View>
    );
  }

  if (journeyLoad.kind === 'error') {
    return (
      <View style={styles.root}>
        {header}
        <View style={{ padding: SP.md }}>
          <RetryRow label="Couldn't check your payout status with Stripe" onRetry={() => { void refreshConnectStatus(); }} />
        </View>
      </View>
    );
  }

  const journey = journeyLoad.kind === 'ready' ? journeyLoad.journey : null;
  if ((journey && journey.state && !showsManagePage(journey)) || staffWithoutSetup) {
    const view = journey && journey.state && journey.state !== 'active'
      ? { ...journey, state: journey.state }
      : { ...normalizePayoutJourney(fixtureJourneyStatus('not_started'))!, state: 'not_started' as const };
    const waitingCents = !isPreview && !loading && !loadError
      ? (balance?.available?.amount ?? 0) + (balance?.pending?.amount ?? 0)
      : null;
    return (
      <View style={styles.root}>
        {header}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: tabBarMetrics.occupiedHeight + SP.md }}
          showsVerticalScrollIndicator={false}
          testID="seller-payouts-scroll"
        >
          <PayoutSetupJourney
            journey={view}
            ownerOnly={isReadOnly || journeyLoad.kind === 'owner_only'}
            busy={isConnecting}
            refreshing={refreshingStatus}
            waitingCents={waitingCents}
            onRefresh={() => { void refreshConnectStatus(); }}
            onPrimary={() => {
              if (view.state === 'action_needed' && view.rejected) { router.push('/help' as never); return; }
              startStripe();
            }}
          />
        </ScrollView>
      </View>
    );
  }
  // A null state means the server could not read the Stripe account.
  if (journey && !journey.state) {
    return (
      <View style={styles.root}>
        {header}
        <View style={{ padding: SP.md }}>
          <RetryRow label="Couldn't check your payout status with Stripe" onRetry={() => { void refreshConnectStatus(); }} />
        </View>
      </View>
    );
  }

  // Active (or live with something due): the manage page.
  const dueBy = journey?.state === 'action_needed' ? formatDeadline(journey.deadline) : null;
  return (
    <View style={styles.root}>
      {header}

      {/* One scroll for the whole page (Shopify payouts): the balance, tabs
          and list move together, so nothing is squeezed above the tab bar. */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: tabBarMetrics.occupiedHeight + SP.md }}
        showsVerticalScrollIndicator={false}
        testID="seller-payouts-scroll"
      >
      {journey?.state === 'action_needed' && (
        <TouchableOpacity
          style={styles.actionBanner}
          onPress={isReadOnly ? undefined : startStripe}
          disabled={isReadOnly || isConnecting}
          accessibilityRole="button"
          accessibilityLabel="Stripe needs more info. Update it on Stripe."
          testID="seller-payouts-action-needed"
        >
          <Icon name="alert-circle" size={20} color={theme.text} />
          <View style={{ flex: 1 }}>
            <Text style={styles.actionBannerTitle}>Stripe needs more info</Text>
            <Text style={styles.bankSub}>
              {journey.actionItems.map((i) => i.detail || i.label).join(', ') || 'Update your details on Stripe'}
              {dueBy ? `. Due by ${dueBy} to keep payouts on.` : '.'}
            </Text>
          </View>
          {!isReadOnly && <Icon name="chevron-right" size={16} color={theme.muted} />}
        </TouchableOpacity>
      )}
      <SellerThreadCashCard
        balanceCents={threadCash.balanceCents}
        cashableCents={threadCash.cashableCents}
        promoCents={threadCash.promoCents}
        paused={payoutsPaused}
        loading={threadCash.loading}
        error={threadCash.error}
        onReload={threadCash.reload}
        onCashOutPress={() => setCashOutVisible(true)}
      />
      <CashOutSheet
        visible={cashOutVisible}
        balanceCents={threadCash.cashableCents ?? 0}
        promoCents={threadCash.promoCents ?? 0}
        onClose={() => setCashOutVisible(false)}
        onCashedOut={handleCashedOut}
      />

      {/* Balance hero */}
      <View style={styles.balanceHero}>
        <Text style={styles.balanceHeroLabel}>{payoutsPaused ? 'Balance' : 'Payout balance'}</Text>
        {loading ? (
          <LoadingSkeleton height={44} style={{ width: 160, marginTop: 6, marginBottom: 6 }} />
        ) : loadError ? (
          <View style={{ marginTop: 6, marginBottom: 6 }}>
            <RetryRow label="Couldn't load balance" onRetry={() => { void load(); }} />
          </View>
        ) : (
          <Text style={styles.balanceHeroAmount}>{availFmt}</Text>
        )}
        {!loadError && !loading && <Text style={styles.balanceHeroSub} testID="seller-payouts-next">{payoutsPaused ? 'Payouts paused' : nextPayoutLabel}</Text>}
        <HelpLink article="payouts" style={{ marginTop: SP.xs }} />
        <View style={styles.balancePendingRow}>
          <Text style={styles.balancePendingLabel}>Pending</Text>
          <Text style={styles.balancePendingAmount}>{loadError ? '—' : pendFmt}</Text>
        </View>
        {payoutsPaused && !loadError && (
          <TouchableOpacity
            style={styles.pausedRow}
            onPress={() => { router.push('/recoveries' as never); }}
            accessibilityRole="button"
            accessibilityLabel={`Payouts paused. ${pausedRowCaption(balance?.recoveryOwedCents ?? 0)}`}
            testID="payouts-paused-row"
          >
            <Icon name="pause-circle" size={14} color={theme.muted} />
            <Text style={styles.pausedRowText} numberOfLines={2}>{pausedRowCaption(balance?.recoveryOwedCents ?? 0)}</Text>
            <Icon name="chevron-right" size={14} color={theme.muted} />
          </TouchableOpacity>
        )}
        {!loadError && balance?.inTransit?.formatted ? (
          <View style={styles.balancePendingRow}>
            <Text style={styles.balancePendingLabel}>In transit</Text>
            <Text style={styles.balancePendingAmount}>{balance.inTransit.formatted}</Text>
          </View>
        ) : null}
      </View>
      <HeldForDeliverySection />

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['payouts', 'settings'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            testID={`seller-payouts-tab-${t}`}
            style={[styles.tab, activeTab === t && styles.tabActive]}
            onPress={() => { haptic('select'); setActiveTab(t); }}
          >
            <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>
              {t === 'payouts' ? 'Payout history' : 'Bank account'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'payouts' ? (
        <View style={[styles.list, payouts.length === 0 && { paddingTop: SP.lg }]}>
          {loading && !isPreview ? (
            <View style={{ gap: SP.sm }}>
              {[0, 1, 2].map(i => <LoadingSkeleton key={i} height={56} />)}
            </View>
          ) : loadError ? (
            <ErrorState message="Couldn't load your payouts." onRetry={() => { void load(); }} />
          ) : payouts.length === 0 ? (
            <View style={{ alignItems: 'center' }}>
              <EmptyState icon="inbox" title="No payouts yet" message="" compact />
              <Text style={styles.payoutsEmptyMessage}>Payouts show up here once your available balance clears.</Text>
            </View>
          ) : (
            payouts.map((p) => {
              const cfg = statusConfig(p.status, theme);
              return (
                <TouchableOpacity
                  key={p.id}
                  style={styles.payoutRow}
                  onPress={() => { router.push({ pathname: '/payout-detail', params: { id: p.id } } as never); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Payout ${p.amount}, ${cfg.label}`}
                >
                  <View style={styles.payoutLeft}>
                    <Text style={styles.payoutDate}>{p.date}</Text>
                    <Text style={[styles.payoutSub, { color: cfg.color }]}>{cfg.label} · ···{p.bankLast4}</Text>
                  </View>
                  <Text style={styles.payoutAmount}>{p.amount}</Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      ) : (
        <View style={styles.list}>
           <View style={styles.bankCard}>
             <Icon name="credit-card" size={20} color={theme.accent} />
            <View style={{ flex: 1, marginLeft: SP.md }}>
                <Text style={styles.bankLabel}>
                  {connectStatus?.bankLast4 ? `Bank account ···${connectStatus.bankLast4}` : 'Bank account'}
               </Text>
               <Text style={styles.bankSub}>
                  {connectStatus ? 'Default payout account' : 'Managed by the store owner on Stripe'}
               </Text>
            </View>
              {connectStatus?.verified && (
               <View style={[styles.statusPill, { borderWidth: 1, borderColor: theme.border }]}>
                 <Text style={[styles.statusText, { color: theme.text }]}>Verified</Text>
               </View>
             )}
          </View>

           {!isPreview && !isReadOnly && identityRequired && (
             <TouchableOpacity
               testID="seller-payouts-verify-identity"
               style={[styles.settingsRow, { borderTopWidth: 0, marginBottom: SP.sm }]}
               onPress={() => { router.push('/seller-verification' as never); }}
               accessibilityRole="button"
               accessibilityLabel="Verify your identity to get your first payout"
             >
               <View style={{ flex: 1 }}>
                 <Text style={styles.settingsValue}>Verify your identity</Text>
                 <Text style={styles.bankSub}>Your first payout is sent once you verify with a photo ID.</Text>
               </View>
               <Icon name="chevron-right" size={16} color={theme.muted} />
             </TouchableOpacity>
           )}

           {!isReadOnly && connectStatus && (
             <TouchableOpacity
                testID="seller-payouts-bank-account"
               style={styles.addBankBtn}
                onPress={startStripe}
               disabled={isConnecting}
               accessibilityRole="button"
               accessibilityLabel="Change bank account on Stripe"
             >
                <Icon name="edit-2" size={16} color={theme.accent} />
                <Text style={styles.addBankText}>{isConnecting ? 'Opening Stripe…' : 'Change bank account'}</Text>
             </TouchableOpacity>
           )}

           {/* Payout method + schedule */}
           <View style={styles.settingsSection} testID="seller-payouts-schedule">
             <Text style={styles.sectionTitle}>Payout method &amp; schedule</Text>
             <View style={styles.settingsRow}>
               <Text style={styles.settingsLabel}>Method</Text>
               <Text style={styles.settingsValue}>
                  {connectStatus?.bankLast4 ? `Bank transfer ···${connectStatus.bankLast4}` : 'Bank transfer'}
               </Text>
             </View>
             <TouchableOpacity
               style={styles.settingsRow}
               testID="seller-payouts-schedule-row"
               onPress={() => { router.push('/payout-schedule' as never); }}
               accessibilityRole="button"
               accessibilityLabel="Payout schedule"
             >
               <Text style={styles.settingsLabel}>Schedule</Text>
               <Text style={styles.settingsValue}>
                  {connectStatus?.payoutSchedule ? scheduleLabel(connectStatus.payoutSchedule) : 'Stripe default'}
               </Text>
             </TouchableOpacity>
           </View>

           {/* Fees & payments */}
           <TouchableOpacity
             style={[styles.settingsSection, styles.feesLinkRow]}
             testID="seller-payouts-fees-link"
             accessibilityRole="button"
             accessibilityLabel="Fees and payments"
             onPress={() => { router.push('/fees' as never); }}
           >
             <Text style={styles.feesLinkLabel}>Fees &amp; payments</Text>
             <Icon name="chevron-right" size={18} color={theme.muted} />
           </TouchableOpacity>

           {/* Tax info status */}
            {connectStatus?.connected && connectStatus.providerConfigured && (() => {
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
        </View>
      )}
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => {
  const { accent, text, muted, subtle, card, border } = theme;
  return StyleSheet.create({
  root:         { flex: 1, backgroundColor: 'transparent' },
  accessLoading:{ flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  backBtn:      { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle:  { flex: 1, textAlign: 'center', color: text, fontSize: FS.lg, fontFamily: FONT.semibold },
  balanceHero:  { marginHorizontal: SP.md, marginTop: SP.md, marginBottom: SP.lg },
  balanceHeroLabel: { color: muted, fontSize: FS.sm, fontFamily: FONT.medium },
  balanceHeroAmount: { fontVariant: ['tabular-nums'],  color: text, fontSize: 40, fontFamily: FONT.bold, letterSpacing: -0.5, marginTop: 6, marginBottom: 2 },
  balanceHeroSub: { color: muted, fontSize: FS.sm, fontFamily: FONT.regular },
  balanceDivider: { alignSelf: 'stretch', height: 1, backgroundColor: border, marginVertical: SP.md },
  balancePendingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  balancePendingLabel: { color: muted, fontSize: FS.xs, fontFamily: FONT.medium },
  balancePendingAmount: { fontVariant: ['tabular-nums'],  color: muted, fontSize: FS.sm, fontFamily: FONT.semibold },
  pausedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SP.sm, paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: ControlRadius.md, borderWidth: 1, borderColor: border },
  pausedRowText: { color: text, fontSize: FS.xs, fontFamily: FONT.medium, flexShrink: 1 },
  balanceLabel: { color: muted, fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: 4 },
  balanceAmount:{ color: text, fontSize: FS.xl, fontFamily: FONT.semibold, marginBottom: 2, fontVariant: ['tabular-nums'] },
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
  payoutLeft:   { flex: 1, minWidth: 0 },
  payoutRight:  { alignItems: 'flex-end', gap: 4 },
  payoutDate:   { color: text, fontSize: FS.base, fontFamily: FONT.medium },
  payoutSub:    { color: muted, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  payoutAmount: { fontVariant: ['tabular-nums'],  color: text, fontSize: FS.base, fontFamily: FONT.semibold },
  statusPill:   { borderRadius: 16, paddingHorizontal: 8, paddingVertical: 2 },
  statusText:   { fontSize: FS.xs, fontFamily: FONT.medium },
  totalRow:     { flexDirection: 'row', justifyContent: 'space-between', marginTop: SP.lg, paddingTop: SP.md, borderTopWidth: 1, borderTopColor: border },
  totalLabel:   { color: muted, fontSize: FS.sm, fontFamily: FONT.medium },
  totalAmount:  { color: text, fontSize: FS.base, fontFamily: FONT.semibold, fontVariant: ['tabular-nums'] },
  bankCard:     { flexDirection: 'row', alignItems: 'center', backgroundColor: card, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: border, marginBottom: SP.md },
  bankLabel:    { color: text, fontSize: FS.base, fontFamily: FONT.medium },
  bankSub:      { color: muted, fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 2 },
  settingsSection:{ backgroundColor: card, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: border, marginBottom: SP.md },
  sectionTitle: { color: muted, fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: SP.sm },
  settingsRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SP.sm, borderTopWidth: 1, borderTopColor: border },
  settingsLabel:{ color: muted, fontSize: FS.sm, fontFamily: FONT.regular },
  settingsValue:{ color: text, fontSize: FS.sm, fontFamily: FONT.medium },
   addBankBtn:   { flexDirection: 'row', alignItems: 'center', gap: SP.sm, justifyContent: 'center', padding: SP.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: accent, borderStyle: 'dashed' },
   feesLinkRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
   feesLinkLabel:{ color: text, fontSize: FS.base, fontFamily: FONT.medium },
   addBankText:  { color: accent, fontSize: FS.sm, fontFamily: FONT.medium },
  actionBanner: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginHorizontal: SP.md, marginTop: SP.md, paddingVertical: SP.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border },
  actionBannerTitle: { color: text, fontSize: FS.base, fontFamily: FONT.semibold },
  });
};
