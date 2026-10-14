/**
 * Monthly Wrapped — server: artifacts/api-server/src/routes/wrapped.ts.
 * The fresh dev preview has no recap; the screenshot build / demo=1 ask the
 * (mocked) API and fall back to nothing.
 */
import { serviceRequest } from '@/lib/serviceConfig';
import { isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { NAVIGATION_ISOLATION_TEST } from '@/lib/buildFlags';

export interface WrappedBrand { sellerId: string; name: string; pieces: number; imageUrl: string | null }
export interface WrappedPiece { productId: string; name: string; brand: string | null; imageUrl: string | null; posts: number }
export interface Wrapped {
  month: string;
  available: boolean;
  totalPieces: number;
  brandCount: number;
  topBrands: WrappedBrand[];
  mostPosted: WrappedPiece | null;
  supporter: { brand: string; topPercent: number } | null;
  coverImageUrl: string | null;
}

export async function getWrapped(month?: string): Promise<Wrapped | null> {
  if (isBuyerDevPreview() && !NAVIGATION_ISOLATION_TEST && !isPreviewDemoMode()) return null;
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  try {
    return await serviceRequest<Wrapped>(`/api/buyer/wrapped${query}`, {}, false);
  } catch {
    return null;
  }
}
