/**
 * Manufacturer product/service catalog (quantity price tiers), sourced from
 * the public manufacturer directory — sellers only ever browse this; catalog
 * management is a manufacturer-portal (web) concern, not this app's.
 */
import { serviceRequest } from '../lib/serviceConfig';

export interface ManufacturerProductPriceTier {
  id: string;
  minQuantity: number;
  maxQuantity: number | null;
  unitPriceCents: number;
}

export type ManufacturerProductStatus = 'draft' | 'active' | 'archived';

export interface ManufacturerProduct {
  id: string;
  manufacturerId: string;
  name: string;
  description: string;
  category: string;
  images: string[];
  moq: number;
  leadTimeDays: number;
  samplePriceCents: number;
  samplePriceLabel: string | null;
  customizationOptions: string[];
  status: ManufacturerProductStatus;
  priceTiers: ManufacturerProductPriceTier[];
  createdAt: string;
  updatedAt: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertCanonicalId(id: string): void {
  if (!UUID_RE.test(id)) {
    throw new Error('Choose a manufacturer from the live directory before continuing.');
  }
}

function mapTier(row: any): ManufacturerProductPriceTier {
  return {
    id: row.id,
    minQuantity: Number(row.minQuantity ?? 0),
    maxQuantity: row.maxQuantity === null || row.maxQuantity === undefined ? null : Number(row.maxQuantity),
    unitPriceCents: Number(row.unitPriceCents ?? 0),
  };
}

function mapProduct(row: any): ManufacturerProduct {
  return {
    id: row.id,
    manufacturerId: row.manufacturerId,
    name: row.name ?? '',
    description: row.description ?? '',
    category: row.category ?? '',
    images: Array.isArray(row.images) ? row.images : [],
    moq: Number(row.moq ?? 1),
    leadTimeDays: Number(row.leadTimeDays ?? 0),
    samplePriceCents: Number(row.samplePriceCents ?? 0),
    samplePriceLabel: row.samplePriceLabel ?? null,
    customizationOptions: Array.isArray(row.customizationOptions) ? row.customizationOptions : [],
    status: row.status ?? 'active',
    priceTiers: Array.isArray(row.priceTiers) ? row.priceTiers.map(mapTier) : [],
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}

/** Browsable catalog for one manufacturer's ACTIVE products, tiers included. */
export async function getManufacturerProducts(manufacturerId: string): Promise<ManufacturerProduct[]> {
  assertCanonicalId(manufacturerId);
  const rows = await serviceRequest<any[]>(`/api/manufacturers/public/${encodeURIComponent(manufacturerId)}/products`);
  if (!Array.isArray(rows)) throw new Error('Manufacturer catalog returned an invalid response.');
  return rows.map(mapProduct);
}

/** Single catalog product with its full tier table. */
export async function getManufacturerProduct(manufacturerId: string, productId: string): Promise<ManufacturerProduct | undefined> {
  assertCanonicalId(manufacturerId);
  assertCanonicalId(productId);
  const row = await serviceRequest<any>(
    `/api/manufacturers/public/${encodeURIComponent(manufacturerId)}/products/${encodeURIComponent(productId)}`,
    {}, false,
  );
  return row?.id ? mapProduct(row) : undefined;
}

/** Lowest active price-tier unit price for a product, or undefined if none. */
export function lowestTierPriceCents(product: ManufacturerProduct): number | undefined {
  if (product.priceTiers.length === 0) return undefined;
  return product.priceTiers.reduce((min, tier) => Math.min(min, tier.unitPriceCents), product.priceTiers[0].unitPriceCents);
}

/** The price tier that applies to a given order quantity, if any. */
export function tierForQuantity(product: ManufacturerProduct, quantity: number): ManufacturerProductPriceTier | undefined {
  return product.priceTiers.find((tier) => quantity >= tier.minQuantity && (tier.maxQuantity === null || quantity <= tier.maxQuantity));
}
