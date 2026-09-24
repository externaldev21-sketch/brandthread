import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, SUCCESS, RED, ORANGE, FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { isManagerRole } from '@/lib/roleError';
import { RoleLockedView } from '@/components/RoleLockedView';
import StripeConnectWarning, { ConnectStatus, normalizeConnectStatus } from '@/components/StripeConnectWarning';
import { useTeamRole } from '@/hooks/useTeamRole';
import { isSellerSetupOrigin, SELLER_HOME_ROUTE } from '@/lib/setupNavigation';
import { completeSetupTaskWhen } from '@/lib/setupCompletion';

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

function statusConfig(status: PayoutStatus, theme: { secondary: string; secondaryDim: string }) {
  return {
    paid:       { label: 'Paid',       color: SUCCESS,        bg: `${SUCCESS}20` },
    pending:    { label: 'Pending',    color: ORANGE,         bg: `${ORANGE}20` },
    in_transit: { label: 'In transit', color: theme.secondary, bg: theme.secondaryDim },
    failed:     { label: 'Failed',     color: RED,            bg: `${RED}20` },
  }[status];
}

export default function PayoutsScreen() {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const launchedFromSellerSetup = isSellerSetupOrigin(params.from);
  const api    = useApi();
  const { currentRole, isLoadingRole } = useTeamRole();
  const isReadOnly = isManagerRole(currentRole);
  const [activeTab, setActiveTab] = useState<'payouts' | 'settings'>('payouts');
  const [loading,   setLoading]   = useState(true);
  const [balance,   setBalance]   = useState<any>(null);
  const [payouts,   setPayouts]   = useState<PayoutRecord[]>([]);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [connectLoading, setConnectLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const connectRequestRef = useRef(false);
  const onboardingOpenRef = useRef(false);

  function leaveSetupDestination() {
    if (launchedFromSellerSetup) {
      router.replace(SELLER_HOME_ROUTE as never);
      return;
    }
    router.back();
  }

  const refreshConnectStatus = useCallback(async () => {
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
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
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
      // Keep the empty state when payout data is unavailable.
    }
    setLoading(false);
    void refreshConnectStatus();
  }, [api, refreshConnectStatus]);

  useEffect(() => { load(); }, [load]);

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
  }, [api, refreshConnectStatus]);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const availFmt   = balance?.available?.formatted ?? '$0.00';
  const pendFmt    = balance?.pending?.formatted   ?? '$0.00';
  const nextDate   = balance?.nextPayout
    ? fmtDate(balance.nextPayout.arrivalDate)
    : '—';

  if (isLoadingRole) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { haptic(); leaveSetupDestination(); }} style={styles.backBtn}>
            <Feather name="chevron-left" size={24} color={FG} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Payouts</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.accessLoading}>
            <ActivityIndicator color={theme.accent} />
        </View>
      </View>
    );
  }

  if (currentRole !== 'owner' && !isReadOnly) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { haptic(); leaveSetupDestination(); }} style={styles.backBtn}>
            <Feather name="chevron-left" size={24} color={FG} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Payouts</Text>
          <View style={styles.backBtn} />
        </View>
        <RoleLockedView screenTitle="payouts" currentRole={currentRole ?? undefined} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { haptic(); leaveSetupDestination(); }} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={FG} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payouts</Text>
        <TouchableOpacity style={styles.backBtn}>
          <Feather name="help-circle" size={20} color={MUTED} />
        </TouchableOpacity>
      </View>

      {/* Balance cards */}
      <View style={styles.balanceRow}>
        <View style={[styles.balanceCard, { flex: 1, marginRight: SP.sm }]}>
          <Text style={styles.balanceLabel}>Available</Text>
          <Text style={styles.balanceAmount}>{availFmt}</Text>
          <Text style={styles.balanceSub}>Next: {nextDate}</Text>
        </View>
        <View style={[styles.balanceCard, { flex: 1 }]}>
          <Text style={styles.balanceLabel}>Pending</Text>
          <Text style={[styles.balanceAmount, { color: MUTED }]}>{pendFmt}</Text>
        </View>
      </View>

       <StripeConnectWarning
         connectStatus={connectStatus}
         onConnect={openConnectOnboarding}
         isConnecting={isConnecting}
       />

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
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + SP.xl }]}>
          {loading ? (
            <ActivityIndicator color={theme.accent} style={{ marginTop: 40 }} />
          ) : payouts.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Feather name="inbox" size={28} color={MUTED} />
              <Text style={{ color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 10 }}>
                {balance?.connected === false ? 'Connect Stripe to receive payouts' : 'No payouts yet'}
              </Text>
            </View>
          ) : (
            payouts.map((p) => {
              const cfg = statusConfig(p.status, theme);
              return (
                <View key={p.id} style={styles.payoutRow}>
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
                </View>
              );
            })
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + SP.xl }]}>
           <View style={styles.bankCard}>
             <Feather name="credit-card" size={20} color={theme.accent} />
            <View style={{ flex: 1, marginLeft: SP.md }}>
               <Text style={styles.bankLabel}>
                 {connectStatus?.bankLast4 ? `Bank account ···${connectStatus.bankLast4}` : 'No bank account connected'}
               </Text>
               <Text style={styles.bankSub}>
                 {connectLoading
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
             {!connectLoading && connectStatus && (
               <View style={[styles.statusPill, {
                 backgroundColor: connectStatus.verified ? `${SUCCESS}20` : `${ORANGE}20`,
               }]}>
                 <Text style={[styles.statusText, {
                   color: connectStatus.verified ? SUCCESS : ORANGE,
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
               disabled={isConnecting}
               accessibilityRole="button"
               accessibilityLabel="Add bank account with Stripe"
             >
                <Feather name="plus" size={16} color={theme.accent} />
                <Text style={styles.addBankText}>
                  {isConnecting ? 'Opening Stripe…' : connectStatus?.connected ? 'Update bank account' : 'Add bank account'}
                </Text>
             </TouchableOpacity>
           )}
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (theme: { accent: string; accentLight: string; accentDim: string; secondary: string; secondaryDim: string }) => {
  const { accent } = theme;
  return StyleSheet.create({
  root:         { flex: 1, backgroundColor: 'transparent' },
  accessLoading:{ flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  backBtn:      { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle:  { flex: 1, textAlign: 'center', color: FG, fontSize: FS.lg, fontFamily: FONT.semibold },
  devBanner:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${ORANGE}15`, paddingHorizontal: SP.md, paddingVertical: 8 },
  devBannerText:{ color: ORANGE, fontSize: FS.xs, fontFamily: FONT.medium },
  balanceRow:   { flexDirection: 'row', padding: SP.md },
  balanceCard:  { backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER },
  balanceLabel: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: 4 },
  balanceAmount:{ color: FG, fontSize: FS.xl, fontFamily: FONT.semibold, marginBottom: 2 },
  balanceSub:   { color: SUBTLE, fontSize: FS.xs, fontFamily: FONT.regular },
  tabRow:       { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, marginHorizontal: SP.md },
  tab:          { flex: 1, paddingVertical: SP.sm, alignItems: 'center' },
   tabActive:    { borderBottomWidth: 2, borderBottomColor: accent },
  tabText:      { color: MUTED, fontSize: FS.sm, fontFamily: FONT.medium },
   tabTextActive:{ color: accent },
  list:         { padding: SP.md },
  payoutRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  payoutLeft:   {},
  payoutRight:  { alignItems: 'flex-end', gap: 4 },
  payoutDate:   { color: FG, fontSize: FS.base, fontFamily: FONT.medium },
  payoutSub:    { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  payoutAmount: { color: FG, fontSize: FS.base, fontFamily: FONT.semibold },
  statusPill:   { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  statusText:   { fontSize: FS.xs, fontFamily: FONT.medium },
  totalRow:     { flexDirection: 'row', justifyContent: 'space-between', marginTop: SP.lg, paddingTop: SP.md, borderTopWidth: 1, borderTopColor: BORDER },
  totalLabel:   { color: MUTED, fontSize: FS.sm, fontFamily: FONT.medium },
  totalAmount:  { color: FG, fontSize: FS.base, fontFamily: FONT.semibold },
  bankCard:     { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER, marginBottom: SP.md },
  bankLabel:    { color: FG, fontSize: FS.base, fontFamily: FONT.medium },
  bankSub:      { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  settingsSection:{ backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER, marginBottom: SP.md },
  sectionTitle: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: SP.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  settingsRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SP.sm, borderTopWidth: 1, borderTopColor: BORDER },
  settingsLabel:{ color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular },
  settingsValue:{ color: FG, fontSize: FS.sm, fontFamily: FONT.medium },
   addBankBtn:   { flexDirection: 'row', alignItems: 'center', gap: SP.sm, justifyContent: 'center', padding: SP.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: accent, borderStyle: 'dashed' },
   addBankText:  { color: accent, fontSize: FS.sm, fontFamily: FONT.medium },
  });
};
