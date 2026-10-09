/**
 * Reorder from order history.
 *
 * The server (POST /api/buyer/orders/:id/reorder) re-resolves every line of the
 * buyer's past order against today's catalogue. This module then puts the
 * addable lines in the cart through the one existing entry point, addToCart(),
 * and reports what happened. A product that has since been deleted never
 * throws: it just lands in `unavailable`.
 */
import { addToCart, getBuyerProduct } from '@/services/cartService';
import type { BuyerProduct } from '@/services/cartTypes';
import { getPreviewBuyerOrder, isPreviewOrderId } from '@/lib/previewOrders';
import { getPreviewBuyerProduct } from '@/lib/previewProducts';
import type {
  ReorderAddable, ReorderOutcome, ReorderResolution, ReorderUnavailable,
} from '@/lib/reorderSummary';

type ApiLike = { buyer: { orders: { reorder: (id: string) => Promise<ReorderResolution> } } };

/** A product by id; preview orders read the seeded catalogue (no protected/network request). */
async function loadProduct(productId: string, preview: boolean): Promise<BuyerProduct | null> {
  if (preview) return getPreviewBuyerProduct(productId);
  try { return await getBuyerProduct(productId); } catch { return null; }
}

/** Dev-web preview orders have no server row: resolve them against the preview catalogue. */
async function resolvePreviewOrder(orderId: string): Promise<ReorderResolution | null> {
  const order = getPreviewBuyerOrder(orderId) as { items?: Array<Record<string, any>> } | null;
  if (!order?.items) return null;
  const addable: ReorderAddable[] = [];
  const unavailable: ReorderUnavailable[] = [];
  for (const item of order.items) {
    const product = item.productId ? await loadProduct(String(item.productId), true) : null;
    if (!product || !product.isActive) {
      unavailable.push({ productId: item.productId ?? null, title: item.productName, reason: 'discontinued' });
      continue;
    }
    const parts = String(item.variantLabel ?? '').toLowerCase().split('/').map((p: string) => p.trim());
    const variant = product.variants.find(v => parts.includes(v.title.toLowerCase()));
    if (!variant) {
      unavailable.push({ productId: product.id, title: item.productName, reason: 'variant_removed' });
      continue;
    }
    if (!variant.isAvailable) {
      unavailable.push({ productId: product.id, title: item.productName, reason: 'out_of_stock' });
      continue;
    }
    addable.push({
      productId: product.id,
      variantId: variant.id,
      quantity: Math.max(1, Number(item.quantity) || 1),
      currentPriceCents: variant.priceCents,
      priceChanged: variant.priceCents !== item.priceCents,
      previousPriceCents: Number(item.priceCents) || 0,
    });
  }
  return { addable, unavailable };
}

export async function reorderFromOrder(orderId: string, api: ApiLike): Promise<ReorderOutcome> {
  // Preview orders never hit the protected endpoint (no account in the dev-web preview).
  const resolution: ReorderResolution = isPreviewOrderId(orderId)
    ? (await resolvePreviewOrder(orderId)) ?? { addable: [], unavailable: [] }
    : await api.buyer.orders.reorder(orderId);

  const outcome: ReorderOutcome = {
    addedUnits: 0, addedLines: 0, unavailable: [...resolution.unavailable], priceChanges: [], reducedQuantityTitles: [],
  };

  const preview = isPreviewOrderId(orderId);
  const products = await Promise.all(resolution.addable.map(line => loadProduct(line.productId, preview)));

  for (const [index, line] of resolution.addable.entries()) {
    const product = products[index] ?? null;
    const variant = product?.variants.find(v => v.id === line.variantId);
    if (!product || !variant) {
      outcome.unavailable.push({ productId: line.productId, title: product?.name ?? 'Item', reason: product ? 'variant_removed' : 'discontinued' });
      continue;
    }
    const result = await addToCart({ product, variant, quantity: line.quantity });
    if (!result.success) {
      outcome.unavailable.push({ productId: product.id, title: product.name, reason: 'out_of_stock' });
      continue;
    }
    outcome.addedUnits += line.quantity;
    outcome.addedLines += 1;
    if (line.priceChanged) {
      outcome.priceChanges.push({
        title: product.name, previousPriceCents: line.previousPriceCents, currentPriceCents: line.currentPriceCents,
      });
    }
    if (line.quantityClamped) outcome.reducedQuantityTitles.push(product.name);
  }
  return outcome;
}
