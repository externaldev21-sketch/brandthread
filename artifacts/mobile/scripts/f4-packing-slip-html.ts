/**
 * Writes sample packing slip HTML (normal, gift, partial parcel, bulk) for the
 * f4-fulfillment screenshots: `pnpm exec tsx scripts/f4-packing-slip-html.ts <outDir>`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildPackingSlipHtml, buildPackingSlipsHtml } from '../lib/packingSlip';
import type { Order } from '../services/orderTypes';

const out = path.resolve(process.argv[2] ?? '.');
mkdirSync(out, { recursive: true });

function order(id: string, number: string, name: string): Order {
  return {
    id, orderNumber: number, sellerName: 'Northline Studio',
    customer: { name, shippingAddress: { name, line1: '129 Ember Court', city: 'Portland', state: 'OR', zip: '97205', country: 'US' } },
    notes: [{ id: 'n1', type: 'customer', content: 'It’s a birthday gift, please no receipt in the box.' }],
    lineItems: [
      { id: `${id}-1`, productId: 'p1', productName: 'Heavyweight Hoodie', variant: 'Charcoal / M', sku: 'NS-HW-CHR-M', quantity: 1, unitPriceCents: 9800, discountAmountCents: 0, taxAmountCents: 0, totalCents: 9800, fulfillmentSource: 'seller', isPreOrder: false },
      { id: `${id}-2`, productId: 'p2', productName: 'Field Shell Jacket', variant: 'Olive / L', sku: 'NS-FS-OLV-L', quantity: 1, unitPriceCents: 18400, discountAmountCents: 0, taxAmountCents: 0, totalCents: 18400, fulfillmentSource: 'seller', isPreOrder: false },
    ],
  } as unknown as Order;
}

const a = order('ord_f4', 'NS-1046', 'Amara Chen');
const b = order('ord_f5', 'NS-1045', 'Diego Santos');
writeFileSync(path.join(out, 'slip-normal.html'), buildPackingSlipHtml(a));
writeFileSync(path.join(out, 'slip-gift.html'), buildPackingSlipHtml(a, { hidePrices: true }));
writeFileSync(path.join(out, 'slip-partial.html'), buildPackingSlipHtml(a, { itemIds: ['ord_f4-1'] }));
writeFileSync(path.join(out, 'slip-bulk.html'), buildPackingSlipsHtml([a, b]));
console.log('wrote slips to', out);
