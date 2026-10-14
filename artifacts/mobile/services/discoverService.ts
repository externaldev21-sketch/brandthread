/**
 * Public "browse brands" endpoint client. Used by buyer onboarding's
 * Brands-to-follow step. Mirrors the typing/fetch pattern used by the rest
 * of services/ (serviceRequest + a small typed DTO), the same pattern the
 * public search endpoint's client callers use.
 */
import { serviceRequest } from '@/lib/serviceConfig';

export interface DiscoverBrand {
  id: string;
  sellerId: string;
  /** @handle; absent from older servers. */
  handle?: string | null;
  name: string;
  brandType: string | null;
  logoUrl: string | null;
  verified: boolean;
  /** Active listings; absent from older servers. */
  productCount?: number;
  /** Up to three of the brand's newest listing photos; absent from older servers. */
  productImages?: string[];
}

export async function discoverBrands(limit = 24): Promise<DiscoverBrand[]> {
  const res = await serviceRequest<{ brands: DiscoverBrand[] }>(
    `/api/public/brands/discover?limit=${encodeURIComponent(String(limit))}`,
  );
  return res.brands ?? [];
}
