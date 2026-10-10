/**
 * Publish many products at once through /api/product-bulk/status (200 per
 * request, the server's limit). "Add your first product" is ticked once at
 * least one product went live.
 */
import { completeSetupTaskWhen } from '@/lib/setupCompletion';

export const BULK_PUBLISH_CHUNK = 200;

type BulkStatusApi = {
  productBulk: {
    status: (body: { productIds: string[]; status: 'active' | 'draft' | 'archived' }) => Promise<{ updated: string[]; unchanged: string[] }>;
  };
};

export async function publishProducts(api: BulkStatusApi, productIds: string[]): Promise<{ published: number; alreadyLive: number }> {
  const ids = [...new Set(productIds.filter(Boolean))];
  let published = 0;
  let alreadyLive = 0;
  for (let i = 0; i < ids.length; i += BULK_PUBLISH_CHUNK) {
    const res = await api.productBulk.status({ productIds: ids.slice(i, i + BULK_PUBLISH_CHUNK), status: 'active' });
    published += res.updated.length;
    alreadyLive += res.unchanged.length;
  }
  await completeSetupTaskWhen('first_product', published + alreadyLive > 0);
  return { published, alreadyLive };
}

/** Products a finished import created (they arrive as drafts). */
export function createdProductIds(results: ReadonlyArray<{ action: string; productId?: string | null }>): string[] {
  return results.filter((r) => r.action === 'created' && r.productId).map((r) => r.productId as string);
}
