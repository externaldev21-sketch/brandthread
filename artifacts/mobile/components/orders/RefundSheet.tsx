/**
 * "Refund" sheet — Shopify iOS refund screen in the same full sheet as
 * "Fulfill item": the amount (prefilled with what is left, editable for a
 * partial refund), a reason, an optional note and "Refund $X".
 *
 * One request id per opening: a retry after a failure reuses it, so the
 * server never refunds the same attempt twice (lib/sellerRefund.ts).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Button, OptionSheet } from '@/components/ui';
import { FullSheet, SheetSection, SHEET_FIELD_BG } from '@/components/orders/FullSheet';
import { TYPE_SCALE } from '@/constants/typography';
import { FONT, SP, RADIUS, ICON } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { orderTitle } from '@/lib/orderFulfillment';
import {
  SELLER_REFUND_REASONS, newRefundRequestId, parseRefundAmount, refundErrorMessage,
  type SellerRefundReason, type SellerRefundRequest,
} from '@/lib/sellerRefund';

export interface RefundSheetProps {
  visible: boolean;
  orderNumber: string;
  /** What can still be refunded, in cents; null while it loads. */
  refundableCents: number | null;
  onCancel: () => void;
  /** Sends the refund; reject to show the server's reason under the form. */
  onSubmit: (request: SellerRefundRequest) => Promise<void>;
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function RefundSheet({ visible, orderNumber, refundableCents, onCancel, onSubmit }: RefundSheetProps) {
  const { theme } = useAppTheme();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<SellerRefundReason | null>(null);
  const [note, setNote] = useState('');
  const [reasonOpen, setReasonOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef<string>('');

  useEffect(() => {
    if (!visible) return;
    requestIdRef.current = newRefundRequestId();
    setReason(null);
    setNote('');
    setError(null);
    setBusy(false);
  }, [visible]);

  // Prefill with everything that is left once it is known.
  useEffect(() => {
    if (visible && refundableCents !== null) setAmount(centsToInput(refundableCents));
  }, [visible, refundableCents]);

  const parsed = refundableCents === null ? null : parseRefundAmount(amount, refundableCents);
  const amountError = parsed && !parsed.ok && amount.trim() ? parsed.error : null;
  const cents = parsed && parsed.ok ? parsed.cents : 0;
  const reasonLabel = SELLER_REFUND_REASONS.find(r => r.key === reason)?.label;

  async function confirm() {
    if (busy || !parsed || !parsed.ok) return;
    if (!reason) { setError('Choose a reason.'); return; }
    setError(null);
    setBusy(true);
    try {
      await onSubmit({ amountCents: parsed.cents, reason, ...(note.trim() ? { note: note.trim() } : {}), requestId: requestIdRef.current });
    } catch (e: unknown) {
      setError(refundErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FullSheet
      visible={visible}
      title="Refund"
      subtitle={orderTitle(orderNumber)}
      onCancel={onCancel}
      testID="refund-sheet"
      footer={(
        <>
          {error ? <Text style={[TYPE_SCALE.footnote, { color: theme.error }]} accessibilityLiveRegion="polite">{error}</Text> : null}
          <Button
            label={cents > 0 ? `Refund ${formatCents(cents)}` : 'Refund'}
            onPress={confirm}
            loading={busy}
            disabled={!parsed || !parsed.ok}
            fullWidth
            testID="refund-sheet-confirm"
          />
        </>
      )}
    >
      <SheetSection title="Refund amount">
        <View style={[s.field, { backgroundColor: SHEET_FIELD_BG, borderColor: amountError ? theme.error : theme.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.fieldLabel, { color: theme.muted }]}>Amount</Text>
            <View style={s.amountRow}>
              <Text style={[s.fieldInput, { color: theme.text }]}>$</Text>
              <TextInput
                value={amount}
                onChangeText={t => setAmount(t.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad"
                editable={refundableCents !== null && refundableCents > 0}
                style={[s.fieldInput, { color: theme.text, flex: 1 }]}
                accessibilityLabel="Refund amount"
                testID="refund-amount"
              />
            </View>
          </View>
        </View>
        <Text style={[TYPE_SCALE.footnote, { color: amountError ? theme.error : theme.muted }]}>
          {amountError ?? (refundableCents === null ? ' ' : `${formatCents(refundableCents)} available for refund`)}
        </Text>
      </SheetSection>

      <SheetSection title="Reason for refund" last>
        <Pressable
          onPress={() => setReasonOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Reason, ${reasonLabel ?? 'not selected'}`}
          style={[s.field, { backgroundColor: SHEET_FIELD_BG, borderColor: theme.border }]}
          testID="refund-reason"
        >
          <View style={{ flex: 1 }}>
            <Text style={[s.fieldLabel, { color: theme.muted }]}>Reason</Text>
            <Text style={[s.fieldInput, { color: reasonLabel ? theme.text : theme.subtle }]}>{reasonLabel ?? 'Select a reason'}</Text>
          </View>
          <Feather name="chevron-right" size={ICON.md} color={theme.muted} />
        </Pressable>
        <View style={[s.field, s.noteField, { backgroundColor: SHEET_FIELD_BG, borderColor: theme.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.fieldLabel, { color: theme.muted }]}>Note (optional)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={500}
              style={[s.fieldInput, s.noteInput, { color: theme.text }]}
              accessibilityLabel="Refund note"
              testID="refund-note"
            />
          </View>
        </View>
      </SheetSection>

      <OptionSheet
        visible={reasonOpen}
        onClose={() => setReasonOpen(false)}
        title="Reason for refund"
        options={SELLER_REFUND_REASONS.map(r => ({ id: r.key, label: r.label }))}
        selectedId={reason ?? ''}
        onSelect={id => { setReason(id as SellerRefundReason); setReasonOpen(false); }}
        testID="refund-reason-sheet"
      />
    </FullSheet>
  );
}

const s = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SP.md, paddingVertical: SP.sm, marginBottom: SP.sm, minHeight: 60 },
  noteField: { alignItems: 'flex-start' },
  fieldLabel: { fontSize: 12, lineHeight: 16, fontFamily: FONT.regular },
  fieldInput: { fontSize: 17, lineHeight: 22, fontFamily: FONT.regular, paddingVertical: 2 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  noteInput: { minHeight: 66, textAlignVertical: 'top' },
});
