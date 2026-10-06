/**
 * Bridges lib/api.ts's signed-out guard to the preview data layer. Kept out of
 * lib/api.ts's static imports (lib/devPreview.ts pulls in react-native) and
 * only loaded in a browser with no session.
 */
import { isBuyerDevPreview, isPreviewDemoMode, isSellerDevPreview } from './devPreview';
import { resolvePreviewApiResponse, type PreviewApiHit } from './previewApiData';
import { getPreviewSellerProducts } from './previewSellerProducts';

/** True in the dev web preview (`?bt_preview=…`). */
export function isWebPreviewSession(): boolean {
  return isSellerDevPreview() || isBuyerDevPreview();
}

/** The preview's local answer to a protected GET, or null outside the preview / for unknown paths. */
export function resolveSignedOutPreviewGet(resolvedPath: string): PreviewApiHit | null {
  const role = isSellerDevPreview() ? 'seller' : isBuyerDevPreview() ? 'buyer' : null;
  if (!role) return null;
  return resolvePreviewApiResponse(resolvedPath, { role, demo: isPreviewDemoMode(), demoProducts });
}

/** The demo catalog (the Products tab's seed) as GET /api/products rows. */
function demoProducts(): unknown[] {
  return getPreviewSellerProducts().map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    status: p.status,
    images: p.media.map((m) => m.uri).filter(Boolean),
    tags: p.tags,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    variantCount: p.variants.length,
    totalStock: p.variants.length > 0
      ? p.variants.reduce((sum, v) => sum + (v.inventoryQuantity ?? 0), 0)
      : p.inventory.totalStock,
    lowStockCount: p.variants.filter((v) => (v.inventoryQuantity ?? 0) <= p.inventory.lowStockThreshold).length,
  }));
}
