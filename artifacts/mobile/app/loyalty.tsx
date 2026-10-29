/**
 * Buyer Loyalty / Rewards Points
 * Route: /loyalty
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/hooks/useApi';
import {
  FONT, FS, SP, RADIUS, FILL_ELEVATED, TEXT_DISABLED,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { formatMoney } from '@/lib/format';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RetryRow } from '@/components/ui/RetryRow';
import { isBuyerDevPreview, isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { REFERRAL_GET_CENTS, REFERRAL_JOIN_POINTS, REFERRAL_MIN_ORDER_CENTS } from '@/lib/referralCopy';
import {
  LOYALTY_MIN_REDEEM_POINTS, LOYALTY_SIGNUP_POINTS, checkRedeemPoints, loyaltyPointsToCents,
} from '@/lib/loyaltyTerms';

type PointEntry = {
  id: string;
  points: number;
  source: string;
  referenceId?: string;
  note?: string;
  createdAt: string;
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function LoyaltyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api    = useApi();
  const { theme } = useAppTheme();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  // Monochrome-only: no gold/brand accent for "special" entries (signup/bonus)
  // — pure black/white/silver everywhere on this screen except the shared
  // success/warning status colors already used app-wide for +/- point rows.
  const sourceMeta: Record<string, { icon: string; label: string; color: string }> = {
    purchase: { icon: 'shopping-bag', label: 'Purchase', color: theme.accentLight },
    order_earn: { icon: 'shopping-bag', label: 'Purchase', color: theme.accentLight },
    referral: { icon: 'users', label: 'Referral', color: theme.secondary },
    signup: { icon: 'gift', label: 'Welcome', color: theme.text },
    bonus: { icon: 'star', label: 'Bonus', color: theme.text },
    redemption: { icon: 'tag', label: 'Redeemed', color: theme.warning },
    purchase_reversal: { icon: 'corner-up-left', label: 'Purchase refunded', color: theme.warning },
  };

  const [loading,     setLoading]     = useState(true);
  const [balance,     setBalance]     = useState(0);
  const [history,     setHistory]     = useState<PointEntry[]>([]);
  const [redeemPts,   setRedeemPts]   = useState('');
  // A failed fetch must never render as a genuine "0 points" balance — track
  // it separately so a real outage shows a retry row instead of a fake zero.
  const [loadError,   setLoadError]   = useState(false);

  const valueCents = loyaltyPointsToCents(balance);   // 100 pts = $1.00 (lib/loyaltyTerms.ts)

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    // Dev web preview only: no real signed-in Clerk user behind this preview
    // session, so skip the network round-trip and show clearly fresh/demo
    // data instead — same convention as thread-cash.tsx. Never reachable
    // outside __DEV__ web preview.
    if (isBuyerDevPreview() || isSellerDevPreview()) {
      Promise.resolve().then(() => {
        if (isPreviewDemoMode()) {
          setBalance(1240);
          setHistory([
            { id: 'preview-1', points: 500, source: 'referral', createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
            { id: 'preview-2', points: 240, source: 'order_earn', createdAt: new Date(Date.now() - 6 * 86400000).toISOString() },
            { id: 'preview-3', points: 100, source: 'signup', createdAt: new Date(Date.now() - 30 * 86400000).toISOString() },
          ]);
        } else {
          setBalance(0);
          setHistory([]);
        }
        setLoading(false);
      });
      return;
    }
    (api as any).loyalty?.get?.()
      .then((d: any) => {
        setBalance(Number(d?.balance ?? 0));
        setHistory(d?.history ?? []);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [api]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // The entered points drive everything below: the "= $X off" preview, the
  // button's enabled state, the helper line, and the points handed to the cart.
  const redeemCheck = checkRedeemPoints(redeemPts, balance);
  const canRedeem = redeemCheck.ok;

  function handleRedeem() {
    if (!redeemCheck.ok) return;
    // Redemptions are deliberately created in the cart, where they are
    // persisted with the checkout session and applied to Stripe immediately.
    // Never mint a detached code here: it could be lost before checkout.
    // The cart prefills its points field with this number.
    router.navigate({ pathname: '/(buyer)/cart', params: { redeemPoints: String(redeemCheck.points) } } as never);
  }

  if (loading) {
    return (
      <View style={s.root}>
        <ScreenHeader title="Rewards" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={s.root}>
        <ScreenHeader title="Rewards" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xl }}>
          <RetryRow label="Couldn't load your rewards" onRetry={load} />
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <ScreenHeader title="Rewards" />

      <ScrollView showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + SP.xl }}>

        {/* Balance hero */}
        <View style={[s.heroCard, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}>
          <Text style={[s.heroLabel, { color: theme.accentLight }]}>YOUR BALANCE</Text>
          <Text style={s.heroBalance}>{balance.toLocaleString()}</Text>
          <Text style={[s.heroUnit, { color: theme.accentLight }]}>points</Text>
          {balance > 0 && (
            <View style={[s.heroValuePill, { backgroundColor: theme.accentDim }]}>
              <Text style={[s.heroValueText, { color: theme.accentLight }]}>≈ {formatCents(valueCents)} off your next order</Text>
            </View>
          )}
          {balance === 0 && (
            <Text style={s.heroEmpty}>Earn your first points by making a purchase or referring a friend.</Text>
          )}
        </View>

        {/* How to earn */}
        <Text style={s.sectionLabel}>HOW TO EARN</Text>
        {[
          { icon: 'shopping-bag' as const, title: '1 point per $1 spent',  sub: 'Automatically earned on every completed purchase' },
          { icon: 'users'        as const, title: `${REFERRAL_JOIN_POINTS} pts per referral`,  sub: `When a friend joins with your invite. You also get ${formatMoney(REFERRAL_GET_CENTS)} Thread Cash after their first order of ${formatMoney(REFERRAL_MIN_ORDER_CENTS)} or more` },
          { icon: 'gift'         as const, title: `${LOYALTY_SIGNUP_POINTS} pts on sign-up`,    sub: 'One-time welcome bonus for new members' },
        ].map((item, i) => (
          <View key={i} style={s.earnCard}>
            <View style={[s.earnIconWrap, { backgroundColor: theme.accentDim }]}>
              <Icon name={item.icon} size={18} color={theme.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.earnTitle}>{item.title}</Text>
              <Text style={s.earnSub}>{item.sub}</Text>
            </View>
          </View>
        ))}

        {/* Redeem */}
        <Text style={[s.sectionLabel, { marginTop: SP.lg }]}>REDEEM POINTS</Text>
        <View style={s.redeemCard}>
          <Text style={s.redeemLabel}>Points to redeem (min {LOYALTY_MIN_REDEEM_POINTS})</Text>
          <View style={s.redeemRow}>
            <TextInput returnKeyType="done"
              style={s.redeemInput}
              value={redeemPts}
              onChangeText={(v) => setRedeemPts(v.replace(/\D/g, '').slice(0, 7))}
              placeholder={String(LOYALTY_MIN_REDEEM_POINTS)}
              placeholderTextColor={theme.muted}
              keyboardType="number-pad"
              maxLength={7}
              accessibilityLabel="Points to redeem"
            />
            {redeemCheck.ok && (
              <View style={s.discountPreview}>
                <Text style={s.discountPreviewText} testID="loyalty-redeem-preview">= {formatCents(redeemCheck.discountCents)} off</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={[s.redeemBtn, { backgroundColor: theme.accent }, !canRedeem && { backgroundColor: FILL_ELEVATED }]}
            onPress={handleRedeem}
            disabled={!canRedeem}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={redeemCheck.ok ? `Use ${redeemCheck.points.toLocaleString()} points in cart` : 'Use points in cart'}
            accessibilityState={{ disabled: !canRedeem }}
            testID="loyalty-redeem-button"
          >
            <Text style={[s.redeemBtnText, { color: theme.onAccent }, !canRedeem && { color: TEXT_DISABLED }]}>Use points in Cart</Text>
          </TouchableOpacity>
          <Text style={s.redeemDisabledNote} testID="loyalty-redeem-helper">
            {redeemCheck.ok
              ? `${redeemCheck.points.toLocaleString()} points will be ready to apply in your cart.`
              : redeemCheck.message ?? `Enter at least ${LOYALTY_MIN_REDEEM_POINTS} points to use in your cart.`}
          </Text>
        </View>

        {/* History */}
        {history.length > 0 && (
          <>
            <Text style={[s.sectionLabel, { marginTop: SP.lg }]}>POINTS HISTORY</Text>
            {history.map(entry => {
              const meta = sourceMeta[entry.source] ?? { icon: 'circle', label: entry.source, color: theme.muted };
              const isPositive = entry.points > 0;
              return (
                <View key={entry.id} style={s.historyRow}>
                  <View style={[s.historyIcon, { backgroundColor: isPositive ? theme.accentDim : `${theme.warning}1A` }]}>
                    <Icon name={meta.icon as any} size={14} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.historyLabel}>{meta.label}</Text>
                    {entry.note ? <Text style={s.historyNote}>{entry.note}</Text> : null}
                    <Text style={s.historyDate}>{fmtDate(entry.createdAt)}</Text>
                  </View>
                  <Text style={[s.historyPoints, { color: isPositive ? theme.success : theme.warning }]}>
                    {isPositive ? '+' : ''}{entry.points.toLocaleString()} pts
                  </Text>
                </View>
              );
            })}
          </>
        )}

        {history.length === 0 && !loading && (
          <View style={{ alignItems: 'center', paddingVertical: SP.xl, paddingHorizontal: SP.xl }}>
            <Icon name="star" size={32} color={theme.border} />
            <Text style={[s.sectionLabel, { marginTop: SP.md, textAlign: 'center', letterSpacing: 0 }]}>No activity yet</Text>
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center', lineHeight: 18 }}>
              Points you earn and redeem show up here.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { text: FG, muted: MUTED, subtle: SUBTLE, card: CARD, cardElevated: CARD_ELEVATED, border: BORDER, success: SUCCESS } = theme;
  const SUCCESS_DIM = `${SUCCESS}20`;
  return StyleSheet.create({
  root:       { flex: 1, backgroundColor: 'transparent' },
  heroCard:       { margin: SP.md, padding: SP.xl, borderWidth: 1, borderRadius: RADIUS.xl, alignItems: 'center' },
  heroLabel:      { fontSize: FS.xs, fontFamily: FONT.semibold, marginBottom: SP.xs },
  heroBalance:    { fontVariant: ['tabular-nums'],  fontSize: FS.h1, fontFamily: FONT.bold, color: FG, lineHeight: 42 },
  heroUnit:       { fontSize: FS.base, fontFamily: FONT.medium, marginBottom: SP.sm },
  heroValuePill:  { borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 6, marginTop: SP.xs },
  heroValueText:  { fontSize: FS.sm, fontFamily: FONT.semibold },
  heroEmpty:      { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 18 },

  sectionLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, marginHorizontal: SP.md, marginTop: SP.xs, marginBottom: SP.xs },

  earnCard: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: SP.md, marginBottom: SP.xs, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, padding: SP.md },
  earnIconWrap: { width: 36, height: 36, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  earnTitle:{ fontSize: FS.base, fontFamily: FONT.semibold, color: FG, marginBottom: 2 },
  earnSub:  { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 18 },

  redeemCard:         { marginHorizontal: SP.md, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, padding: SP.md },
  redeemLabel:        { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: SP.xs },
  redeemRow:          { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.md },
  redeemInput:        { flex: 1, backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 12, color: FG, fontFamily: FONT.regular, fontSize: FS.base },
  discountPreview:    { backgroundColor: SUCCESS_DIM, borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 8, flexShrink: 0 },
  discountPreviewText:{ fontSize: FS.sm, fontFamily: FONT.bold, color: SUCCESS },
  redeemBtn:          { borderRadius: RADIUS.sm, alignItems: 'center', paddingVertical: 14, minHeight: 48 },
  redeemBtnText:      { fontSize: FS.base, fontFamily: FONT.bold },
  redeemDisabledNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: SP.xs },

  historyRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginHorizontal: SP.md, marginBottom: SP.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, padding: SP.md },
  historyIcon:  { width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  historyLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: 1 },
  historyNote:  { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginBottom: 2 },
  historyDate:  { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  historyPoints:{ fontSize: FS.sm, fontFamily: FONT.bold, marginTop: 2 },
  });
};
