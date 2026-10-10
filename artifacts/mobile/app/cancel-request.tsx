/**
 * Seller asks the manufacturer to cancel a paid sample/bulk order before
 * production starts. Pushed from the order tracker (production-detail).
 * Modelled 1:1 on eBay's "Cancel this order" flow: order row, a free-text
 * note for the seller-side counterpart, one Submit button; the tracker then
 * shows the request as pending. If the manufacturer approves, the order is
 * refunded in full to the original payment method.
 */
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatMoney, orderTypeLabel } from '@workspace/manufacturer-flow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { BORDER, CREATE_CANVAS, FONT, MUTED, RED, SP, SUBTLE } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { getOrderTimeline, requestOrderCancellation, type OrderTimeline } from '@/services/manufacturerOrderFlow';
import { goBackOr } from '@/lib/navigation/goBackOr';

const MAX_REASON = 500;

export default function CancelRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const text = { color: colors.foreground };
  const [data, setData] = useState<OrderTimeline | null>(null);
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    getOrderTimeline(id).then(setData).catch(() => setError('This order couldn\'t be loaded. Go back and try again.'));
  }, [id]);

  const order = data?.order;
  const submit = async () => {
    if (!id || sending) return;
    setSending(true); setError('');
    try {
      await requestOrderCancellation(id, reason);
      goBackOr(router, { pathname: '/production-detail', params: { id } } as never);
    } catch (e: any) {
      setError(e?.message ?? 'The request couldn\'t be sent. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Cancel order" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {order ? (
            <View style={styles.orderRow} testID="cancel-request-order">
              <View style={{ flex: 1 }}>
                <Text style={[styles.orderTitle, text]} numberOfLines={2}>{order.title}</Text>
                <Text style={styles.orderMeta}>{orderTypeLabel(order.orderType)}, {order.quantity.toLocaleString('en-US')} {order.quantity === 1 ? 'piece' : 'pieces'}</Text>
              </View>
              <Text style={[styles.orderPrice, text]}>{formatMoney(order.priceCents, order.currency)}</Text>
            </View>
          ) : null}

          <Text style={[styles.heading, text]}>Give {data?.manufacturer?.businessName ?? 'the manufacturer'} more information on why you want to cancel</Text>
          <TextInput
            value={reason}
            onChangeText={(text) => setReason(text.slice(0, MAX_REASON))}
            placeholder="Optional"
            placeholderTextColor={SUBTLE}
            multiline
            style={[styles.input, text]}
            testID="cancel-request-reason"
            accessibilityLabel="Reason for cancelling"
          />
          <Text style={styles.counter}>{reason.length}/{MAX_REASON}</Text>
          <Text style={styles.footnote}>The manufacturer approves or declines. If they approve, you're refunded in full to your original payment method.</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + SP.md }]}>
          <Button label="Submit" onPress={() => void submit()} loading={sending} disabled={sending || !order} fullWidth testID="cancel-request-submit" />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: SP.md, gap: SP.md },
  orderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.md, paddingBottom: SP.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  orderTitle: { fontSize: 17, fontFamily: FONT.semibold },
  orderMeta: { fontSize: 15, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  orderPrice: { fontSize: 17, fontFamily: FONT.semibold, fontVariant: ['tabular-nums'] },
  heading: { fontSize: 17, fontFamily: FONT.semibold, marginTop: SP.sm },
  input: {
    minHeight: 120, borderRadius: 12, backgroundColor: CREATE_CANVAS.surface, padding: SP.md,
    fontSize: 17, fontFamily: FONT.regular, textAlignVertical: 'top',
  },
  counter: { fontSize: 13, fontFamily: FONT.regular, color: SUBTLE, alignSelf: 'flex-end', marginTop: -SP.sm, fontVariant: ['tabular-nums'] },
  footnote: { fontSize: 13, fontFamily: FONT.regular, color: MUTED, lineHeight: 18 },
  error: { fontSize: 15, fontFamily: FONT.medium, color: RED },
  footer: { paddingHorizontal: SP.md, paddingTop: SP.sm },
});
