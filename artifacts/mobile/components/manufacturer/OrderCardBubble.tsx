/**
 * A manufacturer's sample / bulk order card inside the seller conversation.
 * Always renders the live order state and the seller's next action: pay
 * (card / Apple Pay via Stripe), decline, track the shipment or confirm
 * delivery. The rules come from @workspace/manufacturer-flow.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { deriveCardState, formatMoney, orderTypeLabel, trackingUrl } from '@workspace/manufacturer-flow';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BORDER, CARD, CARD_ELEVATED, FG, FONT, FS, MUTED, ORANGE, RADIUS, RED, SP, SUBTLE, SUCCESS } from '@/lib/theme';
import { confirmOrderDelivery, declineOrderCard, type OrderCardSnapshot, type PayOutcome } from '@/services/manufacturerOrderFlow';

const PHASE_COLOR: Record<string, string> = {
  awaiting_payment: ORANGE,
  in_production: FG,
  shipped: FG,
  delivered: SUCCESS,
  cancelled: SUBTLE,
  closed: SUBTLE,
};

export default function OrderCardBubble({
  order, fromMe, time, paying, payOutcome, onPay, onChanged, onOpenTracker,
}: {
  order: OrderCardSnapshot;
  fromMe: boolean;
  time: string;
  paying: boolean;
  payOutcome?: PayOutcome | null;
  onPay: (order: OrderCardSnapshot) => void;
  onChanged: () => void;
  onOpenTracker: (order: OrderCardSnapshot) => void;
}) {
  const { theme } = useAppTheme();
  const state = deriveCardState(order, 'seller');
  const [busy, setBusy] = useState<'decline' | 'confirm' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const link = trackingUrl(order.carrier, order.trackingNumber);
  const tone = PHASE_COLOR[state.phase] ?? FG;

  const decline = () => {
    Alert.alert(
      `Decline this ${orderTypeLabel(order.orderType).toLowerCase()}?`,
      'The manufacturer will be told you passed. They can send a new card with a different price.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Decline', style: 'destructive', onPress: async () => {
            setBusy('decline'); setError(null);
            try { await declineOrderCard(order.id); onChanged(); } catch (e: any) { setError(e?.message ?? 'Could not decline. Try again.'); } finally { setBusy(null); }
          },
        },
      ],
    );
  };

  const confirmDelivery = () => {
    Alert.alert('Mark as received?', 'Confirm the order arrived. The manufacturer is notified and the tracker is completed.', [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'It arrived', onPress: async () => {
          setBusy('confirm'); setError(null);
          try { await confirmOrderDelivery(order.id); onChanged(); } catch (e: any) { setError(e?.message ?? 'Could not confirm delivery. Try again.'); } finally { setBusy(null); }
        },
      },
    ]);
  };

  const outcomeMessage = payOutcome && payOutcome.status !== 'paid' ? payOutcome.message : null;

  return (
    <View style={[styles.row, fromMe ? styles.right : styles.left]}>
      <View style={styles.card} testID={`order-card-${order.id}`}>
        <TouchableOpacity activeOpacity={0.8} onPress={() => onOpenTracker(order)} style={styles.head} accessibilityRole="button" accessibilityLabel={`Open tracker for ${order.title}`}>
          <View style={styles.icon}><Feather name={order.orderType === 'bulk' ? 'package' : 'scissors'} size={18} color={FG} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>{orderTypeLabel(order.orderType).toUpperCase()} CARD</Text>
            <Text style={styles.title} numberOfLines={2}>{order.title}</Text>
            <Text style={styles.meta}>{order.quantity.toLocaleString('en-US')} {order.quantity === 1 ? 'piece' : 'pieces'}</Text>
          </View>
          <Text style={styles.price} testID={`order-card-price-${order.id}`}>{formatMoney(order.priceCents, order.currency)}</Text>
        </TouchableOpacity>

        <View style={styles.bodyPad}>
          <View style={styles.statusRow}>
            <View style={[styles.pill, { borderColor: tone }]}>
              <Text style={[styles.pillText, { color: tone }]} testID={`order-card-status-${order.id}`}>{state.headline}</Text>
            </View>
            {state.completedStages > 0 && <Text style={styles.stageCount}>{state.completedStages}/6</Text>}
          </View>
          {state.phase !== 'cancelled' && (
            <View style={styles.segments}>
              {Array.from({ length: 6 }, (_, index) => (
                <View key={index} style={[styles.segment, index < state.completedStages && { backgroundColor: state.phase === 'delivered' ? SUCCESS : FG }]} />
              ))}
            </View>
          )}
          <Text style={styles.detail}>{state.detail}</Text>
          {order.description ? <Text style={styles.description} numberOfLines={3}>{order.description}</Text> : null}
          {(order.status === 'shipped' || order.status === 'delivered') && order.trackingNumber ? (
            <Text style={styles.tracking}>{order.carrier} · {order.trackingNumber}</Text>
          ) : null}
          {outcomeMessage || error ? <Text style={[styles.notice, error ? { color: RED } : null]}>{error ?? outcomeMessage}</Text> : null}

          <View style={styles.actions}>
            {state.actions.map((action) => {
              if (action.kind === 'pay') {
                return (
                  <TouchableOpacity key="pay" style={[styles.primary, { backgroundColor: theme.accent }]} onPress={() => onPay(order)} disabled={paying} testID={`button-pay-${order.id}`} accessibilityRole="button">
                    {paying ? <ActivityIndicator size="small" color={theme.onAccent} /> : <Feather name="lock" size={14} color={theme.onAccent} />}
                    <Text style={[styles.primaryText, { color: theme.onAccent }]}>{paying ? 'Opening checkout…' : `Pay ${formatMoney(order.priceCents, order.currency)}`}</Text>
                  </TouchableOpacity>
                );
              }
              if (action.kind === 'decline') {
                return (
                  <Button key="decline" label="Decline" variant="secondary" size="compact" loading={busy === 'decline'} disabled={busy !== null || paying} onPress={decline} testID={`button-decline-${order.id}`} />
                );
              }
              if (action.kind === 'track' && link) {
                return (
                  <TouchableOpacity key="track" style={styles.secondary} onPress={() => void Linking.openURL(link)} testID={`button-track-${order.id}`}>
                    <Feather name="external-link" size={13} color={FG} />
                    <Text style={styles.secondaryText}>{action.label}</Text>
                  </TouchableOpacity>
                );
              }
              if (action.kind === 'confirm_delivery') {
                return (
                  <TouchableOpacity key="confirm" style={[styles.primary, { backgroundColor: theme.accent }]} onPress={confirmDelivery} disabled={busy !== null} testID={`button-received-${order.id}`}>
                    {busy === 'confirm' ? <ActivityIndicator size="small" color={theme.onAccent} /> : <Feather name="check" size={14} color={theme.onAccent} />}
                    <Text style={[styles.primaryText, { color: theme.onAccent }]}>{action.label}</Text>
                  </TouchableOpacity>
                );
              }
              return null;
            })}
            <TouchableOpacity style={styles.link} onPress={() => onOpenTracker(order)} testID={`button-tracker-${order.id}`}>
              <Text style={styles.linkText}>View tracker</Text>
              <Feather name="chevron-right" size={14} color={MUTED} />
            </TouchableOpacity>
          </View>
          {state.actions.some((action) => action.kind === 'pay') && (
            <Text style={styles.secure}>Card, Apple Pay or Google Pay · processed by Stripe</Text>
          )}
        </View>
      </View>
      <Text style={[styles.time, fromMe && { textAlign: 'right' }]}>{time}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: SP.md, marginVertical: 6 },
  right: { alignItems: 'flex-end' },
  left: { alignItems: 'flex-start' },
  card: { width: '88%', maxWidth: 340, backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  head: { flexDirection: 'row', gap: SP.sm + 2, padding: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER, alignItems: 'flex-start' },
  icon: { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: 10, fontFamily: FONT.semibold, color: SUBTLE, letterSpacing: 1 },
  title: { fontSize: FS.base, fontFamily: FONT.bold, color: FG, marginTop: 1 },
  meta: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },
  price: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  bodyPad: { padding: SP.md, gap: SP.sm },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pill: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  stageCount: { fontSize: FS.xs, fontFamily: FONT.medium, color: SUBTLE },
  segments: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: CARD_ELEVATED },
  detail: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 18 },
  description: { fontSize: FS.sm, fontFamily: FONT.regular, color: SUBTLE, lineHeight: 18 },
  tracking: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  notice: { fontSize: FS.sm, fontFamily: FONT.medium, color: ORANGE, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, alignItems: 'center', marginTop: 2 },
  primary: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 40, borderRadius: RADIUS.md },
  primaryText: { fontSize: FS.sm, fontFamily: FONT.bold },
  secondary: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 40, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_ELEVATED },
  secondaryText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 40, paddingHorizontal: 4 },
  linkText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  secure: { fontSize: 11, fontFamily: FONT.regular, color: SUBTLE },
  time: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 3, paddingHorizontal: 2 },
});
