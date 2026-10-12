/**
 * My Store's product blocks — /api/store-blocks (seller-scoped). A product
 * made right in the editor goes through /api/products first (plan limits,
 * listing validation), then becomes a block. In the signed-out dev web
 * preview it uses lib/previewStoreBlocks.ts and never calls the API.
 */
import type { BrandthreadApi } from '@/lib/api';
import { serviceRequest } from '@/lib/serviceConfig';
import { isSellerDevPreview } from '@/lib/devPreview';
import { previewStoreBlocks } from '@/lib/previewStoreBlocks';
import type { BlockKind, CatalogProduct, StoreBlock } from '@/lib/storeBlocks';

const pv = () => isSellerDevPreview();
const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export async function listBlocks(): Promise<StoreBlock[]> {
  if (pv()) return previewStoreBlocks.list();
  return (await serviceRequest<{ blocks: StoreBlock[] }>('/api/store-blocks')).blocks;
}

export async function listCatalog(): Promise<CatalogProduct[]> {
  if (pv()) return previewStoreBlocks.catalog();
  return (await serviceRequest<{ products: CatalogProduct[] }>('/api/store-blocks/catalog')).products;
}

export async function addBlock(productId: string): Promise<StoreBlock> {
  if (pv()) return previewStoreBlocks.add(productId);
  return serviceRequest('/api/store-blocks', { method: 'POST', ...json({ productId }) });
}

export async function patchBlock(id: string, patch: Record<string, unknown>): Promise<StoreBlock> {
  if (pv()) return previewStoreBlocks.patch(id, patch);
  return serviceRequest(`/api/store-blocks/${encodeURIComponent(id)}`, { method: 'PATCH', ...json(patch) });
}

export async function publishBlock(id: string): Promise<StoreBlock> {
  if (pv()) return previewStoreBlocks.publish(id);
  return serviceRequest(`/api/store-blocks/${encodeURIComponent(id)}/publish`, { method: 'POST', ...json({}) });
}

export async function removeBlock(id: string): Promise<void> {
  if (pv()) return previewStoreBlocks.remove(id);
  try {
    await serviceRequest(`/api/store-blocks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    if (e instanceof SyntaxError) return; // empty 204 body
    throw e;
  }
}

export async function reorderBlocks(ids: string[]): Promise<StoreBlock[]> {
  if (pv()) return previewStoreBlocks.reorder(ids);
  return (await serviceRequest<{ blocks: StoreBlock[] }>('/api/store-blocks/order', { method: 'PUT', ...json({ ids }) })).blocks;
}

/** A photo picked in the editor → the stored path to save on the block. */
export async function uploadBlockImage(api: BrandthreadApi, uri: string, mimeType?: string | null): Promise<string> {
  if (pv()) return uri;
  const { objectPath } = await api.products.uploadImage({ uri, mimeType });
  return objectPath;
}

/**
 * "Create it right there": a draft product with one option, then its block.
 * The block is published (and the product goes live) from the editor.
 */
export async function createProductBlock(api: BrandthreadApi, input: {
  kind: BlockKind;
  title: string;
  description: string;
  imagePath: string | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  stock: number;
  shipBy: string | null;
}): Promise<StoreBlock> {
  if (pv()) return previewStoreBlocks.create(input);
  const product = await api.products.create({
    name: input.title,
    description: input.description || undefined,
    status: 'draft',
    images: input.imagePath ? [input.imagePath] : [],
    ...(input.kind === 'preorder' ? { isPreOrder: true, preOrderEstShipDate: input.shipBy } : {}),
    variants: [{
      sku: `STORE-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      priceCents: input.priceCents,
      compareAtPriceCents: input.compareAtPriceCents,
      // A pre-order's stock is set from its cap when it opens.
      stock: input.kind === 'preorder' ? 0 : input.stock,
    }],
  }) as { id: string };
  return addBlock(product.id);
}
