/**
 * Invoice PDF — same approach as lib/packingSlip.ts (HTML -> expo-print ->
 * share sheet). Both the seller's order detail and the buyer's order detail
 * produce the same document from their own order shape via a small adapter.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { Order } from '@/services/orderTypes';
import { formatCents } from '@/lib/money';

export type InvoiceInput = {
  orderNumber: string;
  issuedAt: string;
  sellerName: string;
  billTo: string[];
  shipTo: string[];
  items: Array<{ name: string; variant?: string; quantity: number; unitPriceCents: number }>;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  refundedCents: number;
  currency: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function addressLines(a: { name?: string; line1?: string; line2?: string; city?: string; state?: string; zip?: string; country?: string }): string[] {
  return [
    a.name,
    [a.line1, a.line2].filter(Boolean).join(', '),
    [a.city, a.state, a.zip].filter(Boolean).join(' ').replace(/^(.+?) (\S+) (\S+)$/, '$1, $2 $3'),
    a.country,
  ].filter((line): line is string => !!line && line.trim().length > 0);
}

export function invoiceFromSellerOrder(order: Order): InvoiceInput {
  const a = order.customer.shippingAddress;
  return {
    orderNumber: order.orderNumber,
    issuedAt: order.createdAt,
    sellerName: order.sellerName,
    billTo: [order.customer.name, ...(order.customer.email ? [order.customer.email] : [])].filter(Boolean),
    shipTo: addressLines(a),
    items: order.lineItems.map(li => ({ name: li.productName, variant: li.variant || undefined, quantity: li.quantity, unitPriceCents: li.unitPriceCents })),
    subtotalCents: order.payment.subtotalCents,
    discountCents: order.payment.discountTotalCents,
    shippingCents: order.payment.shippingTotalCents,
    taxCents: order.payment.taxTotalCents,
    totalCents: order.payment.totalCents,
    paidCents: order.payment.amountPaidCents,
    refundedCents: order.payment.amountRefundedCents,
    currency: order.currency || 'USD',
  };
}

export function invoiceFromBuyerOrder(order: {
  orderNumber: string; createdAt: string; sellerName: string;
  lineItems: Array<{ productName: string; variant?: string; quantity: number; unitPriceCents: number }>;
  shippingAddress: Parameters<typeof addressLines>[0];
  payment: { subtotalCents: number; shippingTotalCents: number; taxTotalCents?: number; totalCents: number; discountCents?: number; threadCashCents?: number };
  paidAt?: string;
}): InvoiceInput {
  const p = order.payment;
  const discount = (p.discountCents ?? 0) + (p.threadCashCents ?? 0);
  return {
    orderNumber: order.orderNumber,
    issuedAt: order.createdAt,
    sellerName: order.sellerName,
    billTo: [order.shippingAddress.name ?? ''].filter(Boolean),
    shipTo: addressLines(order.shippingAddress),
    items: order.lineItems.map(li => ({ name: li.productName, variant: li.variant || undefined, quantity: li.quantity, unitPriceCents: li.unitPriceCents })),
    subtotalCents: p.subtotalCents,
    discountCents: discount,
    shippingCents: p.shippingTotalCents,
    taxCents: p.taxTotalCents ?? 0,
    totalCents: p.totalCents,
    paidCents: order.paidAt ? p.totalCents : 0,
    refundedCents: 0,
    currency: 'USD',
  };
}

export function buildInvoiceHtml(input: InvoiceInput): string {
  const money = (cents: number) => formatCents(cents, input.currency);
  const date = new Date(input.issuedAt);
  const issued = Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  const rows = input.items.map(item => `
    <tr>
      <td>${escapeHtml(item.name)}${item.variant ? ` — ${escapeHtml(item.variant)}` : ''}</td>
      <td class="num">${item.quantity}</td>
      <td class="num">${money(item.unitPriceCents)}</td>
      <td class="num">${money(item.unitPriceCents * item.quantity)}</td>
    </tr>`).join('');
  const line = (label: string, cents: number, strong = false) =>
    `<tr${strong ? ' class="strong"' : ''}><td colspan="3" class="num">${label}</td><td class="num">${money(cents)}</td></tr>`;
  const block = (title: string, lines: string[]) =>
    `<div class="block"><strong>${title}</strong><br/>${lines.map(escapeHtml).join('<br/>')}</div>`;

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 32px; color: #111; }
          h1 { font-size: 22px; margin: 0 0 4px; }
          .muted { color: #666; font-size: 13px; }
          .cols { display: flex; gap: 32px; margin-top: 24px; }
          .block { font-size: 13px; line-height: 1.5; }
          table { width: 100%; border-collapse: collapse; margin-top: 24px; }
          th, td { padding: 8px 4px; border-bottom: 1px solid #ddd; font-size: 13px; text-align: left; }
          .num { text-align: right; }
          .strong td { font-weight: 700; border-bottom: 2px solid #111; }
        </style>
      </head>
      <body>
        <h1>Invoice</h1>
        <p class="muted">Order #${escapeHtml(input.orderNumber)}${issued ? ` · ${issued}` : ''}<br/>Sold by ${escapeHtml(input.sellerName)}</p>
        <div class="cols">
          ${input.billTo.length ? block('Billed to', input.billTo) : ''}
          ${input.shipTo.length ? block('Ship to', input.shipTo) : ''}
        </div>
        <table>
          <thead>
            <tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr>
          </thead>
          <tbody>
            ${rows}
            ${line('Subtotal', input.subtotalCents)}
            ${input.discountCents > 0 ? line('Discounts', -input.discountCents) : ''}
            ${line('Shipping', input.shippingCents)}
            ${input.taxCents > 0 ? line('Tax', input.taxCents) : ''}
            ${line('Total', input.totalCents, true)}
            ${input.paidCents > 0 ? line('Paid', input.paidCents) : ''}
            ${input.refundedCents > 0 ? line('Refunded', -input.refundedCents) : ''}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

/** Render the invoice to PDF and open the share sheet. */
export async function shareInvoice(input: InvoiceInput): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: buildInvoiceHtml(input) });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri);
  }
}
