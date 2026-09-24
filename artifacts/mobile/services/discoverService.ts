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
  name: string;
  brandType: string | null;
  logoUrl: string | null;
  verified: boolean;
}

export async function discoverBrands(limit = 24): Promise<DiscoverBrand[]> {
  const res = await serviceRequest<{ brands: DiscoverBrand[] }>(
    `/api/public/brands/discover?limit=${encodeURIComponent(String(limit))}`,
  );
  return res.brands ?? [];
}
