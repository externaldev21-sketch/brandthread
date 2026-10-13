/**
 * Discover > Brands "Rising this week" (GET /api/public/brands/rising).
 * Pure helpers so the visibility rules are unit-testable without React.
 */

export interface RisingBrand {
  rank: number;
  sellerId: string;
  username: string | null;
  brandName: string;
  logoUrl: string | null;
  /** Whole percent: (this week - last week) / max(last week, 1). Never an order count. */
  growthPct: number;
}

export interface RisingBrandsResponse {
  brands: RisingBrand[];
  /** First day of the 7-day window (YYYY-MM-DD). */
  weekOf: string;
}

/** Fewer than this many qualifying brands and the section is hidden entirely. */
export const RISING_MIN_TO_SHOW = 3;
/** Rows shown on Discover before "See all". */
export const RISING_SECTION_ROWS = 5;

/** The brands to render, or [] when the section should not appear. */
export function risingBrandsToShow(brands: readonly RisingBrand[] | null | undefined): RisingBrand[] {
  const list = (brands ?? []).filter((b) => b && b.sellerId && b.growthPct > 0);
  return list.length >= RISING_MIN_TO_SHOW ? list : [];
}

/** The one-line sub under the brand name, e.g. "+42% orders". */
export function risingSubline(growthPct: number): string {
  return `+${Math.round(growthPct).toLocaleString('en-US')}% orders`;
}
