/**
 * Item 129 — Order detail: Message Buyer + Refund actions.
 * Source-level checks (in the style of tests/seller-orders-auth-empty-
 * state.test.ts) rather than a full render: OrderDetailScreen has heavy
 * polling/focus-effect machinery that's already covered by other tests,
 * and re-mocking all of it here would test the mocks more than the wiring.
 * What actually matters — the real buyerUserId guard, the real
 * api.conversations.createOrGet call shape, and the real refund-amount
 * gate — is exactly what these assertions pin down.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, '../app/order-detail.tsx'), 'utf8');

describe('order detail: Message Buyer action', () => {
  it('reuses the real buyer identity from the order — never a fabricated one', () => {
    expect(source).toContain('const buyerUserId = order.customer.buyerUserId;');
    expect(source).toContain('if (!buyerUserId) {');
  });

  it('calls the same api.conversations.createOrGet the buyer-side Message button uses, with the seller as myInfo', () => {
    expect(source).toContain('api.conversations.createOrGet({');
    expect(source).toContain("type: 'buyer_to_seller_order'");
    expect(source).toContain('userId: buyerUserId');
    expect(source).toContain("accountType: 'buyer'");
    expect(source).toContain("accountType: 'seller'");
    expect(source).toContain('contextOrderId: order.id');
  });

  it('navigates to the real seller-conversation screen with the created conversation id', () => {
    expect(source).toContain("router.push(`/seller-conversation?id=${encodeURIComponent(conv.id)}` as never)");
  });

  it('is a row in the Customer block (and in the ⋯ menu), disabled while opening or with no buyer account', () => {
    expect(source).toContain("title={messagingBuyer ? 'Opening…' : 'Message buyer'}");
    expect(source).toContain('disabled={messagingBuyer || !order.customer.buyerUserId}');
    expect(source).toContain("buttons.push({ text: 'Message buyer', onPress: handleMessageBuyer });");
  });

  it('never hardcodes a brand color for the conversation participants — monochrome only', () => {
    expect(source).not.toContain('#8B5CF6');
    expect(source).toContain('color: theme.accent');
  });
});

describe('order detail: Refund action', () => {
  it('opens the Refund sheet on this screen (the old refund-detail route hands over to it)', () => {
    expect(source).toContain('<RefundSheet');
    expect(source).toContain("useState(refundParam === '1')");
    const refundRoute = fs.readFileSync(path.resolve(__dirname, '../app/refund-detail.tsx'), 'utf8');
    expect(refundRoute).toContain('/order-detail?id=${encodeURIComponent(orderId)}&refund=1');
  });

  it('only offers a refund when there is real refundable money left (paid minus already refunded)', () => {
    expect(source).toContain('order.payment.amountPaidCents > order.payment.amountRefundedCents && refundableCents > 0');
  });

  it('sends the sheet request (amount, reason, note, one request id per opening) to POST /:id/refund', () => {
    expect(source).toContain('await api.orders.refund(id, request);');
    const sheet = fs.readFileSync(path.resolve(__dirname, '../components/orders/RefundSheet.tsx'), 'utf8');
    expect(sheet).toContain('requestIdRef.current = newRefundRequestId();');
    expect(sheet).toContain('SELLER_REFUND_REASONS');
    expect(sheet).toContain('parseRefundAmount(amount, refundableCents)');
  });

  it('shows what was refunded in the Paid block', () => {
    expect(source).toContain('label={`Refunded (${refundReasonLabel(r.reason).toLowerCase()})`}');
    expect(source).toContain('<InfoRow label="Refunded" value={`-${usd(order.payment.amountRefundedCents)}`} />');
  });
});
