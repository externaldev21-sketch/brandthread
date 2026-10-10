/**
 * "Refund" sheet — Shopify iOS refund screen in the same full sheet as
 * "Fulfill item": the amount (prefilled with what is left, editable for a
 * partial refund), a reason, an optional note and "Refund $X".
 *
 * One request id per opening: a retry after a failure reuses it, so the
 * server never refunds the same attempt twice (lib/sellerRefund.ts).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Button, Input, OptionSheet } from '@/components/ui';
import { FullSheet, SheetSection, SheetPickerField } from '@/components/orders/FullSheet';
import { TYPE_SCALE } from '@/constants/typography';
import { SP } from '@/lib/theme';
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
        <Input
          label="Amount"
          value={amount ? `$${amount}` : ''}
          onChangeText={t => setAmount(t.replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad"
          editable={refundableCents !== null && refundableCents > 0}
          error={amountError}
          testID="refund-amount"
          accessibilityLabel="Refund amount"
        />
        {!amountError ? (
          <Text style={[TYPE_SCALE.footnote, { color: theme.muted, marginTop: SP.xs }]}>
            {refundableCents === null ? ' ' : `${formatCents(refundableCents)} available for refund`}
          </Text>
        ) : null}
      </SheetSection>

      <SheetSection title="Reason for refund" last>
        <SheetPickerField
          label="Reason"
          value={reasonLabel}
          placeholder="Select a reason"
          onPress={() => setReasonOpen(true)}
          testID="refund-reason"
        />
        <Input
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={500}
          testID="refund-note"
          accessibilityLabel="Refund note"
        />
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
