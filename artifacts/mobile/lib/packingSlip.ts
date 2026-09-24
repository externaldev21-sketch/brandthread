/**
 * Packing slip — renders a simple HTML packing slip to PDF and shares it.
 * Used from the fulfillment wizard (app/fulfill-order.tsx).
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Order } from '@/services/orderTypes';
import { formatCents } from '@/lib/money';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildPackingSlipHtml(order: Order): string {
  const addr = order.customer.shippingAddress;
  const rows = order.lineItems.map(li => `
    <tr>
      <td>${escapeHtml(li.productName)}${li.variant ? ` — ${escapeHtml(li.variant)}` : ''}</td>
      <td style="text-align:center;">${li.quantity}</td>
      <td style="text-align:right;">${formatCents(li.unitPriceCents)}</td>
    </tr>
  `).join('');

  const buyerNote = (order.notes ?? []).find(n => n.type === 'customer')?.content;

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 32px; color: #111; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          .muted { color: #666; font-size: 13px; }
          table { width: 100%; border-collapse: collapse; margin-top: 24px; }
          th, td { padding: 8px 4px; border-bottom: 1px solid #ddd; font-size: 13px; text-align: left; }
          .note { margin-top: 24px; padding: 12px; background: #f4f4f4; border-radius: 6px; font-size: 13px; }
          .section { margin-top: 20px; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(order.sellerName ?? 'Packing Slip')}</h1>
        <p class="muted">Order #${escapeHtml(order.orderNumber)}</p>

        <div class="section">
          <strong>Ship to</strong><br/>
          ${escapeHtml(addr.name)}<br/>
          ${escapeHtml(addr.line1)}${addr.line2 ? `, ${escapeHtml(addr.line2)}` : ''}<br/>
          ${escapeHtml(addr.city)}, ${escapeHtml(addr.state)} ${escapeHtml(addr.zip)}<br/>
          ${escapeHtml(addr.country)}
        </div>

        <table>
          <thead>
            <tr><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th></tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        ${buyerNote ? `<div class="note"><strong>Note from buyer:</strong><br/>${escapeHtml(buyerNote)}</div>` : ''}
      </body>
    </html>
  `;
}

/** Render a packing slip to PDF and open the native share sheet. */
export async function sharePackingSlip(order: Order): Promise<void> {
  const html = buildPackingSlipHtml(order);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri);
  }
}
