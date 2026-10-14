/**
 * Digital Closet — the buyer's delivered pieces and saved outfits.
 * Server: artifacts/api-server/src/routes/closet.ts (GET/POST /api/buyer/closet/*).
 *
 * Dev web preview: the populated demo (`&demo=1`) shows a few pieces from the
 * shared preview catalog; the default fresh preview is an empty closet. No
 * preview data is ever returned for a real account.
 */
import { serviceRequest } from '@/lib/serviceConfig';
import type { PieceEdition } from '@/lib/editions';
import { isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { NAVIGATION_ISOLATION_TEST } from '@/lib/buildFlags';

export interface ClosetPiece {
  /** order_items.id */
  id: string;
  orderId: string;
  productId: string | null;
  name: string;
  brand: string | null;
  sellerId: string;
  size: string | null;
  priceCents: number;
  imageUrl: string | null;
  orderedAt: string;
  deliveredAt: string;
  /** Set when the product is a limited numbered run (shown in the Closet only). */
  edition?: PieceEdition | null;
}

export interface ClosetOutfit {
  id: string;
  createdAt: string;
  pieces: ClosetPiece[];
}

/** Matches the server's MAX_OUTFIT_PIECES. */
export const MAX_OUTFIT_PIECES = 8;

let previewOutfits: ClosetOutfit[] = [];

function previewPieces(): ClosetPiece[] {
  if (!isPreviewDemoMode()) return [];
  let catalog: typeof import('@/lib/previewCatalog');
  try {
    // Lazy: the catalog pulls in bundled preview assets (dev builds only).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    catalog = require('../lib/previewCatalog') as typeof import('@/lib/previewCatalog');
  } catch {
    return [];
  }
  if (!catalog.isPreviewCatalogEnabled()) return [];
  const day = 24 * 60 * 60_000;
  const now = Date.now();
  return catalog.getPreviewCatalog().filter((p) => p.images.length > 0).slice(0, 7).map((p, i) => ({
    id: `preview-piece-${i + 1}`,
    orderId: `preview-order-closet-${i + 1}`,
    productId: p.productId,
    name: p.name,
    brand: p.sellerDisplayName,
    sellerId: p.sellerId,
    size: p.sizes[Math.min(1, p.sizes.length - 1)] ?? null,
    priceCents: p.currentPriceCents,
    imageUrl: p.images[0] ?? null,
    orderedAt: new Date(now - (i * 9 + 6) * day).toISOString(),
    deliveredAt: new Date(now - (i * 9 + 2) * day).toISOString(),
  }));
}

/**
 * Preview: the screenshot build (its API is mocked) and the `demo=1` preview
 * ask the API first; the fresh dev preview has no backend and stays empty.
 * Demo falls back to the preview-catalog pieces above when nothing answers.
 */
async function previewOr<T>(request: () => Promise<T>, fallback: () => T): Promise<T> {
  if (!NAVIGATION_ISOLATION_TEST && !isPreviewDemoMode()) return fallback();
  try { return await request(); } catch { return fallback(); }
}

const fetchPieces = async () => (await serviceRequest<{ pieces: ClosetPiece[] }>('/api/buyer/closet/pieces', {}, false)).pieces ?? [];
const fetchOutfits = async () => (await serviceRequest<{ outfits: ClosetOutfit[] }>('/api/buyer/closet/outfits', {}, false)).outfits ?? [];
const postOutfit = async (pieceIds: string[]) => (await serviceRequest<{ outfit: ClosetOutfit }>('/api/buyer/closet/outfits', {
  method: 'POST', body: JSON.stringify({ pieceIds }),
})).outfit;

function savePreviewOutfit(pieceIds: string[], pool: ClosetPiece[]): ClosetOutfit {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const outfit: ClosetOutfit = {
    id: `preview-outfit-${previewOutfits.length + 1}`,
    createdAt: new Date().toISOString(),
    pieces: pieceIds.map((id) => byId.get(id)).filter((p): p is ClosetPiece => !!p),
  };
  previewOutfits = [outfit, ...previewOutfits];
  return outfit;
}

export async function getClosetPieces(): Promise<ClosetPiece[]> {
  if (isBuyerDevPreview()) return previewOr(fetchPieces, previewPieces);
  return fetchPieces();
}

export async function getClosetOutfits(): Promise<ClosetOutfit[]> {
  if (isBuyerDevPreview()) return previewOr(fetchOutfits, () => previewOutfits);
  return fetchOutfits();
}

export async function saveClosetOutfit(pieceIds: string[]): Promise<ClosetOutfit> {
  if (isBuyerDevPreview()) return previewOr(() => postOutfit(pieceIds), () => savePreviewOutfit(pieceIds, previewPieces()));
  return postOutfit(pieceIds);
}

export interface Unboxing { orderId: string; pieces: ClosetPiece[] }

/** The delivery waiting for its unboxing moment, if any (never in the fresh preview). */
export async function getUnboxing(): Promise<Unboxing | null> {
  const fetchIt = async () => (await serviceRequest<{ unboxing: Unboxing | null }>('/api/buyer/closet/unboxing', {}, false)).unboxing ?? null;
  if (isBuyerDevPreview()) return previewOr(fetchIt, () => null);
  return fetchIt();
}

export async function markUnboxingSeen(): Promise<void> {
  if (isBuyerDevPreview() && !NAVIGATION_ISOLATION_TEST && !isPreviewDemoMode()) return;
  await serviceRequest('/api/buyer/closet/unboxing/seen', { method: 'POST', body: '{}' }, false);
}

export async function deleteClosetOutfit(id: string): Promise<void> {
  if (isBuyerDevPreview()) {
    previewOutfits = previewOutfits.filter((o) => o.id !== id);
    if (NAVIGATION_ISOLATION_TEST || isPreviewDemoMode()) await serviceRequest(`/api/buyer/closet/outfits/${encodeURIComponent(id)}`, { method: 'DELETE' }, false).catch(() => {});
    return;
  }
  await serviceRequest(`/api/buyer/closet/outfits/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
