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
  BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, SUCCESS, SUCCESS_DIM,
  ORANGE, RED, GOLD, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';

type PointEntry = {
  id: string;
  points: number;
  source: string;
  referenceId?: string;
  note?: string;
  createdAt: string;
};

const SOURCE_META: Record<string, { icon: string; label: string; color: string }> = {
  purchase:   { icon: 'shopping-bag', label: 'Purchase',  color: PURPLE_LIGHT },
  order_earn: { icon: 'shopping-bag', label: 'Purchase',  color: PURPLE_LIGHT },
  referral:   { icon: 'users',        label: 'Referral',  color: CYAN         },
  signup:     { icon: 'gift',         label: 'Welcome',   color: GOLD         },
  bonus:      { icon: 'star',         label: 'Bonus',     color: GOLD         },
  redemption: { icon: 'tag',          label: 'Redeemed',  color: ORANGE       },
  purchase_reversal: { icon: 'corner-up-left', label: 'Purchase refunded', color: ORANGE },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function LoyaltyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api    = useApi();

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
    setRedeeming(true);
    try {
      const result = await (api as any).loyalty?.redeem?.({ points: pts });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBalance(prev => prev - pts);
      setRedeemPts('');
      setHistory(prev => [{
        id: Date.now().toString(), points: -pts, source: 'redemption',
        referenceId: result?.token, note: result?.token ? `Discount code: ${result.token}` : null,
        createdAt: new Date().toISOString(),
      } as any, ...prev]);
      Alert.alert(
        '🎉 Points Redeemed!',
        `You got $${(result.discountCents / 100).toFixed(2)} off your next order.\n\nDiscount code: ${result.token}\n\nApply this at checkout.`,
        [{ text: 'Got it!' }],
      );
    } catch (e: any) {
      Alert.alert('Could not redeem', e?.message ?? 'Please try again.');
    } finally {
      setRedeeming(false);
    }
  }

  const previewDiscount = parseInt(redeemPts, 10) || 0;

  if (loading) {
    return (
      <View style={[s.root, { alignItems: 'center', justifyContent: 'center', paddingTop: insets.top }]}>
        <ActivityIndicator color={PURPLE} />
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Rewards</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>

        {/* Balance hero */}
        <View style={s.heroCard}>
          <Text style={s.heroLabel}>YOUR BALANCE</Text>
          <Text style={s.heroBalance}>{balance.toLocaleString()}</Text>
          <Text style={s.heroUnit}>points</Text>
          {balance > 0 && (
            <View style={s.heroValuePill}>
              <Text style={s.heroValueText}>≈ ${(valueCents / 100).toFixed(2)} off your next order</Text>
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
          { icon: '👋', title: '500 pts per referral',         sub: 'When a friend joins via your invite link and places their first order' },
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
              placeholderTextColor={MUTED}
              keyboardType="number-pad"
            />
            {previewDiscount >= 100 && (
              <View style={s.discountPreview}>
                <Text style={s.discountPreviewText}>= ${(previewDiscount / 100).toFixed(2)} off</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={[s.redeemBtn, (redeeming || balance < 100) && { opacity: 0.5 }]}
            onPress={handleRedeem}
            disabled={redeeming || balance < 100}
            activeOpacity={0.85}
          >
            {redeeming
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.redeemBtnText}>Redeem at Checkout</Text>
            }
          </TouchableOpacity>
          {balance < 100 && (
            <Text style={s.redeemDisabledNote}>You need at least 100 points to redeem.</Text>
          )}
        </View>

        {/* History */}
        {history.length > 0 && (
          <>
            <Text style={[s.sectionLabel, { marginTop: SP.lg }]}>POINTS HISTORY</Text>
            {history.map(entry => {
              const meta = SOURCE_META[entry.source] ?? { icon: 'circle', label: entry.source, color: MUTED };
              const isPositive = entry.points > 0;
              return (
                <View key={entry.id} style={s.historyRow}>
                  <View style={[s.historyIcon, { backgroundColor: isPositive ? PURPLE_DIM : 'rgba(249,115,22,0.1)' }]}>
                    <Feather name={meta.icon as any} size={14} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.historyLabel}>{meta.label}</Text>
                    {entry.note ? <Text style={s.historyNote}>{entry.note}</Text> : null}
                    <Text style={s.historyDate}>{fmtDate(entry.createdAt)}</Text>
                  </View>
                  <Text style={[s.historyPoints, { color: isPositive ? SUCCESS : ORANGE }]}>
                    {isPositive ? '+' : ''}{entry.points.toLocaleString()} pts
                  </Text>
                </View>
              );
            })}
          </>
        )}

        {history.length === 0 && !loading && (
          <View style={{ alignItems: 'center', paddingVertical: SP.xl, paddingHorizontal: SP.xl }}>
            <Feather name="star" size={32} color={BORDER} />
            <Text style={[s.sectionLabel, { marginTop: SP.md, textAlign: 'center', letterSpacing: 0 }]}>No points yet</Text>
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 18 }}>
              Make a purchase or refer a friend to start earning rewards.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: BG },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerBack: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle:{ fontSize: FS.md, fontFamily: FONT.bold, color: FG },

  heroCard:       { margin: SP.md, padding: SP.xl, backgroundColor: PURPLE_DIM, borderWidth: 1, borderColor: PURPLE, borderRadius: RADIUS.xl, alignItems: 'center' },
  heroLabel:      { fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE_LIGHT, letterSpacing: 2, textTransform: 'uppercase', marginBottom: SP.xs },
  heroBalance:    { fontSize: 64, fontFamily: FONT.bold, color: FG, lineHeight: 72 },
  heroUnit:       { fontSize: FS.base, fontFamily: FONT.medium, color: PURPLE_LIGHT, marginBottom: SP.sm },
  heroValuePill:  { backgroundColor: 'rgba(139,92,246,0.2)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginTop: SP.xs },
  heroValueText:  { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
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
  redeemBtn:          { backgroundColor: PURPLE, borderRadius: RADIUS.sm, alignItems: 'center', paddingVertical: 14 },
  redeemBtnText:      { fontSize: FS.base, fontFamily: FONT.bold, color: '#fff' },
  redeemDisabledNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: SP.xs },

  historyRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginHorizontal: SP.md, marginBottom: SP.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, padding: SP.md },
  historyIcon:  { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  historyLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: 1 },
  historyNote:  { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginBottom: 2 },
  historyDate:  { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  historyPoints:{ fontSize: FS.sm, fontFamily: FONT.bold, marginTop: 2 },
});
