/**
 * Buyer Loyalty / Rewards Points
 * Route: /loyalty
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator, FlatList,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';
import {
  GOLD, FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { Header } from '@/components/layout';

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
  const sourceMeta: Record<string, { icon: string; label: string; color: string }> = {
    purchase: { icon: 'shopping-bag', label: 'Purchase', color: theme.accentLight },
    order_earn: { icon: 'shopping-bag', label: 'Purchase', color: theme.accentLight },
    referral: { icon: 'users', label: 'Referral', color: theme.secondary },
    signup: { icon: 'gift', label: 'Welcome', color: GOLD },
    bonus: { icon: 'star', label: 'Bonus', color: GOLD },
    redemption: { icon: 'tag', label: 'Redeemed', color: theme.warning },
    purchase_reversal: { icon: 'corner-up-left', label: 'Purchase refunded', color: theme.warning },
  };

  const [loading,    setLoading]    = useState(true);
  const [balance,    setBalance]    = useState(0);
  const [history,    setHistory]    = useState<PointEntry[]>([]);
  const [redeemPts,  setRedeemPts]  = useState('');
  const [redeeming,  setRedeeming]  = useState(false);

  const valueCents = Math.floor(balance);   // 100 pts = $1.00 = 100 cents

  useFocusEffect(useCallback(() => {
    setLoading(true);
    (api as any).loyalty?.get?.()
      .then((d: any) => {
        setBalance(Number(d?.balance ?? 0));
        setHistory(d?.history ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api]));

  async function handleRedeem() {
    const pts = parseInt(redeemPts, 10);
    if (!pts || pts < 100) {
      Alert.alert('Minimum 100 Points', 'You need at least 100 points to redeem ($1.00 off).'); return;
    }
    if (pts > balance) {
      Alert.alert('Insufficient Points', `You only have ${balance.toLocaleString()} points.`); return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Redemptions are deliberately created in the cart, where they are
    // persisted with the checkout session and applied to Stripe immediately.
    // Never mint a detached code here: it could be lost before checkout.
    router.push('/(buyer)/cart' as never);
  }

  const previewDiscount = parseInt(redeemPts, 10) || 0;

  if (loading) {
    return (
      <View style={[s.root, { alignItems: 'center', justifyContent: 'center', paddingTop: insets.top }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <Header title="Rewards" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>

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
          { icon: '🛍', title: '1 point per $1 spent',        sub: 'Automatically earned on every completed purchase' },
          { icon: '👋', title: '500 pts per referral',         sub: 'When a new friend joins using your invite link or code' },
          { icon: '🎁', title: '100 pts on sign-up',           sub: 'One-time welcome bonus for new members' },
        ].map((item, i) => (
          <View key={i} style={s.earnCard}>
            <Text style={s.earnIcon}>{item.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.earnTitle}>{item.title}</Text>
              <Text style={s.earnSub}>{item.sub}</Text>
            </View>
          </View>
        ))}

        {/* Redeem */}
        <Text style={[s.sectionLabel, { marginTop: SP.lg }]}>REDEEM POINTS</Text>
        <View style={s.redeemCard}>
          <Text style={s.redeemLabel}>Points to redeem (min 100)</Text>
          <View style={s.redeemRow}>
            <TextInput
              style={s.redeemInput}
              value={redeemPts}
              onChangeText={setRedeemPts}
              placeholder="100"
              placeholderTextColor={theme.muted}
              keyboardType="number-pad"
            />
            {previewDiscount >= 100 && (
              <View style={s.discountPreview}>
                <Text style={s.discountPreviewText}>= {formatCents(previewDiscount)} off</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={[s.redeemBtn, { backgroundColor: theme.accent }, (redeeming || balance < 100) && { opacity: 0.5 }]}
            onPress={handleRedeem}
            disabled={redeeming || balance < 100}
            activeOpacity={0.85}
          >
             {redeeming
               ? <ActivityIndicator color={theme.onAccent} size="small" />
               : <Text style={[s.redeemBtnText, { color: theme.onAccent }]}>Use points in Cart</Text>
            }
          </TouchableOpacity>
          <Text style={s.redeemDisabledNote}>Choose your points in Cart when you’re ready to check out.</Text>
          {balance < 100 && (
            <Text style={s.redeemDisabledNote}>You need at least 100 points to redeem.</Text>
          )}
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
                    <Feather name={meta.icon as any} size={14} color={meta.color} />
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
            <Feather name="star" size={32} color={theme.border} />
            <Text style={[s.sectionLabel, { marginTop: SP.md, textAlign: 'center', letterSpacing: 0 }]}>No points yet</Text>
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center', lineHeight: 18 }}>
              Make a purchase or refer a friend to start earning rewards.
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
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerBack: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle:{ fontSize: FS.md, fontFamily: FONT.bold, color: FG },

  heroCard:       { margin: SP.md, padding: SP.xl, borderWidth: 1, borderRadius: RADIUS.xl, alignItems: 'center' },
  heroLabel:      { fontSize: FS.xs, fontFamily: FONT.semibold, letterSpacing: 2, textTransform: 'uppercase', marginBottom: SP.xs },
  heroBalance:    { fontSize: 64, fontFamily: FONT.bold, color: FG, lineHeight: 72 },
  heroUnit:       { fontSize: FS.base, fontFamily: FONT.medium, marginBottom: SP.sm },
  heroValuePill:  { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginTop: SP.xs },
  heroValueText:  { fontSize: FS.sm, fontFamily: FONT.semibold },
  heroEmpty:      { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 18 },

  sectionLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, letterSpacing: 1, textTransform: 'uppercase', marginHorizontal: SP.md, marginTop: SP.xs, marginBottom: SP.xs },

  earnCard: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: SP.md, marginBottom: SP.xs, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, padding: SP.md },
  earnIcon: { fontSize: 24, lineHeight: 28 },
  earnTitle:{ fontSize: FS.base, fontFamily: FONT.semibold, color: FG, marginBottom: 2 },
  earnSub:  { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 17 },

  redeemCard:         { marginHorizontal: SP.md, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, padding: SP.md },
  redeemLabel:        { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SP.xs },
  redeemRow:          { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  redeemInput:        { flex: 1, backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 12, color: FG, fontFamily: FONT.regular, fontSize: FS.base },
  discountPreview:    { backgroundColor: SUCCESS_DIM, borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 8 },
  discountPreviewText:{ fontSize: FS.sm, fontFamily: FONT.bold, color: SUCCESS },
  redeemBtn:          { borderRadius: RADIUS.sm, alignItems: 'center', paddingVertical: 14 },
   redeemBtnText:      { fontSize: FS.base, fontFamily: FONT.bold },
  redeemDisabledNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: SP.xs },

  historyRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginHorizontal: SP.md, marginBottom: SP.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, padding: SP.md },
  historyIcon:  { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  historyLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: 1 },
  historyNote:  { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginBottom: 2 },
  historyDate:  { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  historyPoints:{ fontSize: FS.sm, fontFamily: FONT.bold, marginTop: 2 },
  });
};
