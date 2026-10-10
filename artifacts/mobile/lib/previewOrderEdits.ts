/**
 * The seller web preview's demo orders (`?bt_preview=seller&demo=1`) live
 * only on this device and never reach the API. When the demo seller
 * fulfils or refunds one, the change is kept here for the session so the
 * order detail and batch ship show the result instead of regenerating the
 * untouched order on the next poll. Never used for a real order id.
 */
import { getGeneratedSellerOrder, isGeneratedSellerOrderId } from './previewSellerOrders';
import { getPreviewSellerOrder } from './previewOrders';
import { isPreviewSellerOrderId } from './previewDeliveryOrders';

const edits = new Map<string, Record<string, unknown>>();

export function isLocalPreviewSellerOrderId(id: string | null | undefined): boolean {
  return isGeneratedSellerOrderId(id) || isPreviewSellerOrderId(id);
}

/** The demo order as this session last left it, or null for any other id. */
export function loadPreviewSellerOrder(id: string | null | undefined): Record<string, unknown> | null {
  if (!id || !isLocalPreviewSellerOrderId(id)) return null;
  const edited = edits.get(id);
  if (edited) return edited;
  if (isGeneratedSellerOrderId(id)) {
    const generated = getGeneratedSellerOrder(id);
    return generated ? withDemoPhotos(generated as unknown as Record<string, unknown>) : null;
  }
  return getPreviewSellerOrder(id);
}

/** The demo store's product photos on its order lines (the API sends `imageUrl` per item). */
function withDemoPhotos(raw: Record<string, unknown>): Record<string, unknown> {
  let photoFor: (productId: unknown) => string | null = () => null;
  try {
    // Lazy: the demo catalog pulls in bundled image assets.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const products = (require('./previewSellerProducts') as typeof import('./previewSellerProducts')).getPreviewSellerProducts();
    const byId = new Map(products.map(p => [p.id, p.media?.find(m => m.isCover)?.uri ?? p.media?.[0]?.uri ?? null]));
    photoFor = (productId) => (typeof productId === 'string' ? byId.get(productId) ?? null : null);
  } catch { /* no photos: the rows show the placeholder */ }
  const items = Array.isArray(raw.items) ? raw.items as Record<string, unknown>[] : [];
  return { ...raw, items: items.map(item => ({ ...item, imageUrl: item.imageUrl ?? photoFor(item.productId) })) };
}

export function savePreviewSellerOrder(raw: Record<string, unknown> & { id: string }): void {
  if (!isLocalPreviewSellerOrderId(raw.id)) return;
  edits.set(raw.id, raw);
}
