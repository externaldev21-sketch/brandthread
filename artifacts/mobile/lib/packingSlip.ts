/**
 * Packing slip — renders an HTML packing slip, then prints it (system print
 * dialog, AirPrint) or saves it as a PDF and opens the share sheet.
 *
 * Used from the fulfillment wizard (app/fulfill-order.tsx), the seller order
 * screen's print action (app/order-detail.tsx) and bulk fulfillment
 * (app/fulfill-batch.tsx, one page per order) through PackingSlipSheet.
 *
 * - Lists only the items in this parcel: the `itemIds` being fulfilled, or
 *   else the items not shipped or refunded yet (all non-refunded items once
 *   everything has shipped, for a reprint).
 * - Each line shows the variant and SKU.
 * - `hidePrices` (gift) leaves every price off the slip.
 */
import { Order, OrderLineItem } from '@/services/orderTypes';
import { formatCents } from '@/lib/money';

export interface PackingSlipOptions {
  /** order_items ids in this parcel; omit for the whole open order. */
  itemIds?: string[];
  /** Gift: leave every price off the slip. */
  hidePrices?: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The lines that go in this parcel. */
export function packingSlipItems(order: Order, itemIds?: string[]): OrderLineItem[] {
  if (itemIds && itemIds.length > 0) {
    const wanted = new Set(itemIds);
    return order.lineItems.filter(li => wanted.has(li.id));
  }
  const notRefunded = order.lineItems.filter(li => !li.refundedAt);
  const open = notRefunded.filter(li => !li.trackingNumber);
  return open.length > 0 ? open : notRefunded;
}

const SLIP_STYLE = `
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 32px; color: #111; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .muted { color: #666; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  th, td { padding: 8px 4px; border-bottom: 1px solid #ddd; font-size: 13px; text-align: left; vertical-align: top; }
  .meta { color: #666; font-size: 12px; margin-top: 2px; }
  .note { margin-top: 24px; padding: 12px; background: #f4f4f4; border-radius: 6px; font-size: 13px; }
  .section { margin-top: 20px; }
  .slip + .slip { page-break-before: always; break-before: page; }
`;

function slipBody(order: Order, options: PackingSlipOptions): string {
  const addr = order.customer.shippingAddress;
  const gift = order.gift ?? null;
  const showPrices = !options.hidePrices && !gift;
  const rows = packingSlipItems(order, options.itemIds).map(li => {
    const meta = [li.variant ? escapeHtml(li.variant) : '', li.sku ? `SKU ${escapeHtml(li.sku)}` : '']
      .filter(Boolean).join(' · ');
    return `
    <tr>
      <td>${escapeHtml(li.productName)}${meta ? `<div class="meta">${meta}</div>` : ''}</td>
      <td style="text-align:center;">${li.quantity}</td>
      ${showPrices ? `<td style="text-align:right;">${formatCents(li.unitPriceCents)}</td>` : ''}
    </tr>`;
  }).join('');

  const buyerNote = (order.notes ?? []).find(n => n.type === 'customer')?.content;

  return `
    <div class="slip">
      <h1>${gift ? 'Gift receipt' : escapeHtml(order.sellerName ?? 'Packing Slip')}</h1>
      <p class="muted">${gift && order.sellerName ? `${escapeHtml(order.sellerName)} · ` : ''}Order #${escapeHtml(order.orderNumber)}</p>
      ${gift ? giftNoteHtml(gift) : ''}

      <div class="section">
        <strong>Ship to</strong><br/>
        ${escapeHtml(addr.name)}<br/>
        ${escapeHtml(addr.line1)}${addr.line2 ? `, ${escapeHtml(addr.line2)}` : ''}<br/>
        ${escapeHtml(addr.city)}, ${escapeHtml(addr.state)} ${escapeHtml(addr.zip)}<br/>
        ${escapeHtml(addr.country)}
      </div>

      <table>
        <thead>
          <tr><th>Item</th><th style="text-align:center;">Qty</th>${showPrices ? '<th style="text-align:right;">Price</th>' : ''}</tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>

      ${buyerNote ? `<div class="note"><strong>Note from buyer:</strong><br/>${escapeHtml(buyerNote)}</div>` : ''}
    </div>`;
}

function giftNoteHtml(gift: NonNullable<Order['gift']>): string {
  const lines = [
    gift.to ? `<strong>To:</strong> ${escapeHtml(gift.to)}` : '',
    gift.message ? `<span class="gift-message">${escapeHtml(gift.message).replace(/\n/g, '<br/>')}</span>` : '',
    gift.from ? `<strong>From:</strong> ${escapeHtml(gift.from)}` : '',
  ].filter(Boolean);
  return lines.length ? `<div class="note gift">${lines.join('<br/>')}</div>` : '';
}

/** One slip per order, each on its own page. */
export function buildPackingSlipsHtml(orders: Order[], options: PackingSlipOptions = {}): string {
  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>${SLIP_STYLE}</style>
      </head>
      <body>
        ${orders.map(order => slipBody(order, options)).join('')}
      </body>
    </html>
  `;
}

export function buildPackingSlipHtml(order: Order, options: PackingSlipOptions = {}): string {
  return buildPackingSlipsHtml([order], options);
}

/** Open the system print dialog (AirPrint on iOS) for these slips. */
export async function printPackingSlips(orders: Order[], options: PackingSlipOptions = {}): Promise<void> {
  // Native print/share modules load on first use, so screens that only show
  // the entry point (and their tests) don't pull them in.
  const Print = await import('expo-print');
  await Print.printAsync({ html: buildPackingSlipsHtml(orders, options) });
}

/** Render these slips to one PDF and open the native share sheet. */
export async function sharePackingSlips(orders: Order[], options: PackingSlipOptions = {}): Promise<void> {
  const [Print, Sharing] = await Promise.all([import('expo-print'), import('expo-sharing')]);
  const { uri } = await Print.printToFileAsync({ html: buildPackingSlipsHtml(orders, options) });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  }
}

/** Render a packing slip to PDF and open the native share sheet. */
export async function sharePackingSlip(order: Order, options: PackingSlipOptions = {}): Promise<void> {
  await sharePackingSlips([order], options);
}
