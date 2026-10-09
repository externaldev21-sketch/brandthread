/**
 * Customers in the seller web preview (`?bt_preview=seller`, which can't call
 * the API — lib/api.ts rejects every request there).
 *
 * Fresh (default): no customers. `&demo=1`: the customers behind the demo
 * Orders tab (lib/previewSellerOrders.ts), aggregated from those same orders
 * so "2 orders" on a customer row is the 2 orders on their detail screen and
 * in the Orders tab. Local illustration only, never sent anywhere.
 */
import { previewSellerOrders, type PreviewSellerOrder } from './previewSellerOrders';
import type { SellerCustomer } from './sellerCustomers';

const ORDER_LIMIT = 400; // same window the demo Orders tab lists

export function previewCustomerId(email: string): string {
  return `preview-customer-${email.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function paidOrders(now: Date): PreviewSellerOrder[] {
  return previewSellerOrders(now, ORDER_LIMIT).filter((o) => o.status !== 'cancelled');
}

export function buildPreviewCustomers(demo: boolean, now: Date = new Date()): SellerCustomer[] {
  if (!demo) return [];
  const byEmail = new Map<string, SellerCustomer>();
  for (const order of paidOrders(now)) {
    const id = previewCustomerId(order.customerEmail);
    const existing = byEmail.get(id);
    if (existing) {
      existing.orderCount = (existing.orderCount ?? 0) + 1;
      existing.totalSpentCents = (existing.totalSpentCents ?? 0) + order.totalCents;
      if (order.createdAt < existing.createdAt) existing.createdAt = order.createdAt;
      continue;
    }
    byEmail.set(id, {
      id,
      name: order.customerName,
      email: order.customerEmail,
      address: { city: order.shippingAddress.city, state: order.shippingAddress.state, country: order.shippingAddress.country },
      orderCount: 1,
      totalSpentCents: order.totalCents,
      createdAt: order.createdAt,
    });
  }
  return [...byEmail.values()];
}

export interface PreviewCustomerDetail {
  customer: SellerCustomer;
  orders: Array<{ id: string; orderNumber: string; status: string; totalCents: number; itemCount: number; createdAt: string; trackingNumber?: string; carrier?: string }>;
}

export function getPreviewCustomerDetail(id: string, demo: boolean, now: Date = new Date()): PreviewCustomerDetail | null {
  const customer = buildPreviewCustomers(demo, now).find((c) => c.id === id);
  if (!customer) return null;
  const orders = paidOrders(now)
    .filter((o) => previewCustomerId(o.customerEmail) === id)
    .map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      totalCents: o.totalCents,
      itemCount: o.itemCount,
      createdAt: o.createdAt,
      trackingNumber: o.trackingNumber ?? undefined,
      carrier: o.carrier ?? undefined,
    }));
  return { customer, orders };
}
