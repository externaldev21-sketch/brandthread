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

/** A brand featured at the top of onboarding's Brands-to-follow step, with its own real product photos. */
export interface FeaturedBrand {
  id: string;
  sellerId: string;
  handle: string;
  name: string;
  logoUrl: string | null;
  verified: boolean;
  productCount: number;
  productImages: string[];
}

/** Dev's featured brands (server env ONBOARDING_FEATURED_SELLER_HANDLES); [] when none are set. */
export async function featuredBrands(): Promise<FeaturedBrand[]> {
  const res = await serviceRequest<{ brands: FeaturedBrand[] }>('/api/public/brands/featured');
  return (res.brands ?? []).filter((brand) => brand.productImages?.length > 0);
}
