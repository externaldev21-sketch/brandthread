/**
 * Post listing / Save changes against the real products API.
 *
 * Create: POST /api/products (status active, one variant per size) → the
 * listing is live on the seller's store and in buyer search. Edit: PUT the
 * product fields, then PATCH/POST variants so price and per-size stock follow
 * the form. The optional video uploads after, against the product id.
 */
import type { BrandthreadApi } from '@/lib/api';
import { completeSetupTaskAfter } from '@/lib/setupCompletion';
import { createPayload, updatePayload, variantPayloads } from './listingPersistence';
import type { ListingForm } from './listingStore';

export interface PublishResult {
  productId: string;
  kind: 'created' | 'updated';
  /** Set when the listing posted but its video did not upload. */
  videoFailed?: boolean;
}

async function syncVideo(api: BrandthreadApi, productId: string, form: ListingForm): Promise<boolean> {
  if (!form.video || form.video.existing) return true;
  try {
    await api.productVideos.upload(productId, form.video.uri, form.video.mimeType);
    return true;
  } catch {
    return false;
  }
}

export async function publishListing(api: BrandthreadApi, form: ListingForm, priceCents: number): Promise<PublishResult> {
  if (form.editProductId) {
    const id = form.editProductId;
    await api.products.update(id, updatePayload(form));
    for (const v of variantPayloads(form, priceCents)) {
      const existingId = form.variantIdsBySize[v.size ?? ''] ?? (form.sizes.length <= 1 ? form.variantIdsBySize[''] : undefined);
      if (existingId) await api.products.updateVariant(id, existingId, { priceCents: v.priceCents, stock: v.stock });
      else await api.products.addVariant(id, v);
    }
    // Sizes the seller removed stop selling (stock 0); order history keeps the variant.
    const kept = new Set(form.sizes.map(s => s.size));
    for (const [size, variantId] of Object.entries(form.variantIdsBySize)) {
      if (size && !kept.has(size)) await api.products.updateVariant(id, variantId, { stock: 0 });
    }
    const videoOk = await syncVideo(api, id, form);
    return { productId: id, kind: 'updated', videoFailed: !videoOk };
  }

  const serverCreatePayload = createPayload(form, priceCents);
  const created = await completeSetupTaskAfter(
    'first_product',
    () => api.products.create(serverCreatePayload),
  ) as { id: string };
  const videoOk = await syncVideo(api, created.id, form);
  return { productId: created.id, kind: 'created', videoFailed: !videoOk };
}
