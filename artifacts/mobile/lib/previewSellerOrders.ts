/**
 * The demo seller's orders (`?bt_preview=seller&demo=1`) - ONE deterministic
 * order set that the dashboard numbers, the Orders tab and order detail all
 * read, so "32 orders" on the dashboard is 32 rows on the Orders tab.
 *
 * Before this, the dashboard chart invented per-bucket order counts from its
 * own random stream while the Orders tab (no account, no API) rendered "No
 * orders yet". Now `ordersForDay()` is the single source: the chart
 * (lib/previewSellerChartData.ts) sums it per bucket, and the Orders tab /
 * order detail list the same rows.
 *
 * Pure and deterministic (seeded by calendar day, no Math.random); orders are
 * never dated in the future relative to `now`. Never reached by real accounts:
 * callers gate on isPreviewDemoMode().
 */

const DAY_MS = 86_400_000;

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATALOG = [
  { id: 'preview-product-1', name: 'Classic Crew Tee', priceCents: 3800 },
  { id: 'preview-product-2', name: 'Heavyweight Hoodie', priceCents: 7800 },
  { id: 'preview-product-3', name: 'Wool Overcoat', priceCents: 24000 },
  { id: 'preview-product-4', name: 'Relaxed Denim', priceCents: 9200 },
  { id: 'preview-product-5', name: 'Studio Sweatpants', priceCents: 5600 },
] as const;
const VARIANTS = ['Black / S', 'Black / M', 'Black / L', 'Bone / M', 'Bone / L', 'Graphite / M'];
const CUSTOMERS = [
  ['Jordan Reyes', 'New York', 'NY', '10012'], ['Maya Chen', 'Los Angeles', 'CA', '90028'], ['Sam Okafor', 'Chicago', 'IL', '60614'],
  ['Priya Nair', 'Austin', 'TX', '78702'], ['Leo Martin', 'Portland', 'OR', '97209'], ['Ava Rossi', 'Brooklyn', 'NY', '11211'],
  ['Noah Kim', 'Seattle', 'WA', '98103'], ['Zoe Adams', 'Miami', 'FL', '33137'],
] as const;

export interface PreviewSellerOrder {
  id: string;
  orderNumber: string;
  /** DB status column value (see lib/orderStatusAdapter.ts). */
  status: 'pending' | 'processing' | 'fulfilled' | 'shipped' | 'delivered' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  totalCents: number;
  subtotalCents: number;
  shippingCents: number;
  itemCount: number;
  customerName: string;
  customerEmail: string;
  shippingAddress: { name: string; street: string; city: string; state: string; zip: string; country: string };
  items: Array<{ id: string; productId: string; productName: string; variantLabel: string; quantity: number; priceCents: number }>;
  trackingNumber: string | null;
  carrier: string | null;
  shippedAt: string | null;
  /** Orders a session can acknowledge (list-only flag mirrors the API's `visitors` for the chart). */
  visitors: number;
}

export function isGeneratedSellerOrderId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('preview-demo-order-');
}

/** Whole local calendar days since an arbitrary fixed epoch; the seed and the order numbering both hang off it. */
function dayIndex(y: number, m: number, d: number): number {
  return Math.round(Date.UTC(y, m, d) / DAY_MS);
}
const EPOCH_DAY = Math.round(Date.UTC(2022, 0, 1) / DAY_MS);
const HISTORY_DAYS = 1460;

function statusFor(ageMs: number, rand: number): PreviewSellerOrder['status'] {
  if (rand < 0.04 && ageMs > DAY_MS) return 'cancelled';
  if (ageMs < 0.75 * DAY_MS) return 'pending';
  if (ageMs < 2 * DAY_MS) return 'processing';
  if (ageMs < 3 * DAY_MS) return 'fulfilled';
  if (ageMs < 7 * DAY_MS) return 'shipped';
  return 'delivered';
}

/**
 * The seeded delivery-guarantee orders (lib/previewOrders.ts, demo only). They belong to the same demo
 * store, so they are part of the set the dashboard sums and the Orders tab lists - not a second list.
 */
function seededOrders(): PreviewSellerOrder[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rows = (require('./previewOrders') as typeof import('./previewOrders')).getPreviewSellerOrders();
    return rows.map((row) => ({ visitors: 8, ...(row as object) }) as unknown as PreviewSellerOrder);
  } catch {
    return [];
  }
}

function fixturesForDay(y: number, m: number, d: number, now: Date): PreviewSellerOrder[] {
  return seededOrders().filter((o) => {
    const at = new Date(o.createdAt);
    return at.getTime() <= now.getTime() && at.getFullYear() === y && at.getMonth() === m && at.getDate() === d;
  });
}

/** Every demo order placed on one local calendar day, never later than `now`. */
export function ordersForDay(y: number, m: number, d: number, now: Date): PreviewSellerOrder[] {
  return [...generatedOrdersForDay(y, m, d, now), ...fixturesForDay(y, m, d, now)];
}

function generatedOrdersForDay(y: number, m: number, d: number, now: Date): PreviewSellerOrder[] {
  const idx = dayIndex(y, m, d);
  const age = (now.getTime() - new Date(y, m, d).getTime()) / DAY_MS; // days before now
  if (age < 0 || age > HISTORY_DAYS) return [];
  const rand = mulberry32(idx * 2654435761);
  const dow = new Date(y, m, d).getDay();
  const growth = 0.3 + 0.7 * (1 - Math.min(1, age / HISTORY_DAYS)); // the store keeps growing
  const weekend = dow === 0 || dow === 6 ? 1.3 : 0.9;
  const count = Math.max(0, Math.round((2.2 + rand() * 4.4) * growth * weekend * 1.6));
  const out: PreviewSellerOrder[] = [];
  for (let i = 0; i < count; i += 1) {
    // Busy late morning and evening; nothing overnight.
    const hour = Math.min(23, Math.floor(8 + Math.pow(rand(), 0.8) * 16));
    const created = new Date(y, m, d, hour, Math.floor(rand() * 60), Math.floor(rand() * 60));
    if (created.getTime() > now.getTime()) continue;
    const ageMs = now.getTime() - created.getTime();
    const itemCount = rand() < 0.22 ? 2 : 1;
    const items = Array.from({ length: itemCount }, (_, k) => {
      const product = CATALOG[Math.floor(rand() * CATALOG.length)];
      return {
        id: `preview-seller-item-${idx}-${i}-${k}`, productId: product.id, productName: product.name,
        variantLabel: VARIANTS[Math.floor(rand() * VARIANTS.length)], quantity: 1, priceCents: product.priceCents,
      };
    });
    const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
    const shippingCents = subtotalCents >= 10_000 ? 0 : 600;
    const status = statusFor(ageMs, rand());
    const customer = CUSTOMERS[Math.floor(rand() * CUSTOMERS.length)];
    const createdIso = created.toISOString();
    const shipped = status === 'shipped' || status === 'delivered';
    out.push({
      id: `preview-demo-order-${idx}-${i}`,
      orderNumber: `BT-${(idx - EPOCH_DAY) * 10 + i + 1000}`,
      status, createdAt: createdIso, updatedAt: createdIso,
      paidAt: status === 'cancelled' ? null : createdIso,
      totalCents: subtotalCents + shippingCents, subtotalCents, shippingCents, itemCount,
      customerName: customer[0], customerEmail: `${customer[0].toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
      shippingAddress: { name: customer[0], street: `${100 + Math.floor(rand() * 800)} Mercer Street`, city: customer[1], state: customer[2], zip: customer[3], country: 'US' },
      items,
      trackingNumber: shipped ? `1Z999AA1${String(idx % 100000).padStart(5, '0')}${String(i).padStart(2, '0')}` : null,
      carrier: shipped ? 'UPS' : null,
      shippedAt: shipped ? new Date(created.getTime() + 1.5 * DAY_MS).toISOString() : null,
      visitors: Math.round(6 + rand() * 6),
    });
  }
  return out;
}

/** The order list the Orders tab shows: the newest `limit` demo orders, newest first. */
export function previewSellerOrders(now: Date = new Date(), limit = 400): PreviewSellerOrder[] {
  const out: PreviewSellerOrder[] = [];
  for (let back = 0; back < HISTORY_DAYS && out.length < limit; back += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    out.push(...ordersForDay(day.getFullYear(), day.getMonth(), day.getDate(), now).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  return out.slice(0, limit);
}

/** What the Orders tab and the dashboard both read: generated demo orders plus the seeded fixtures, newest first. */
export const allPreviewSellerOrders = previewSellerOrders;

export function getGeneratedSellerOrder(id: string, now: Date = new Date()): PreviewSellerOrder | null {
  const m = /^preview-demo-order-(-?\d+)-(\d+)$/.exec(id);
  if (!m) return null;
  const date = new Date(Number(m[1]) * DAY_MS);
  return generatedOrdersForDay(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), now).find((o) => o.id === id) ?? null;
}
