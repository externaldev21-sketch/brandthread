/**
 * Sample-request details on a seller → manufacturer quote request:
 * which of the manufacturer's catalog products the sample is for, the sizes
 * and catalog customization options asked for, and where the sample ships.
 *
 * No seller email / phone is accepted here: manufacturers reply inside the
 * quote request and its conversation, and contact details are only exchanged
 * after a first paid order.
 */
import { db, manufacturerProducts, sellerQuoteRequests } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TEXT = 160;
const MAX_LIST = 20;
const MAX_LIST_ITEM = 60;

export type SampleShipTo = NonNullable<typeof sellerQuoteRequests.$inferInsert["shipTo"]>;

export type SampleRequestColumns = {
  catalogProductId: string | null;
  sizes: string | null;
  sampleOptions: string[] | null;
  shipTo: SampleShipTo | null;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function fail<T>(error: string): Result<T> {
  return { ok: false, error };
}

function cleanText(value: unknown, field: string, required: boolean): Result<string | null> {
  if (value === undefined || value === null || value === "") {
    return required ? fail(`${field} is required`) : { ok: true, value: null };
  }
  if (typeof value !== "string") return fail(`${field} must be a string`);
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) return required ? fail(`${field} is required`) : { ok: true, value: null };
  if (cleaned.length > MAX_TEXT) return fail(`${field} is too long`);
  return { ok: true, value: cleaned };
}

/** Normalises a ship-to address; null when absent. Unknown keys (e.g. phone) are dropped. */
export function parseShipTo(value: unknown): Result<SampleShipTo | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "object" || Array.isArray(value)) return fail("shipTo must be an address object");
  const input = value as Record<string, unknown>;
  const recipientName = cleanText(input.recipientName, "shipTo.recipientName", true);
  if (!recipientName.ok) return recipientName;
  const street = cleanText(input.street, "shipTo.street", true);
  if (!street.ok) return street;
  const line2 = cleanText(input.line2, "shipTo.line2", false);
  if (!line2.ok) return line2;
  const city = cleanText(input.city, "shipTo.city", true);
  if (!city.ok) return city;
  const state = cleanText(input.state, "shipTo.state", false);
  if (!state.ok) return state;
  const postal = cleanText(input.postalCode, "shipTo.postalCode", true);
  if (!postal.ok) return postal;
  const postalCode = postal.value!.toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 -]{1,15}$/.test(postalCode)) return fail("shipTo.postalCode is invalid");
  const countryRaw = cleanText(input.country, "shipTo.country", true);
  if (!countryRaw.ok) return countryRaw;
  const country = countryRaw.value!.toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return fail("shipTo.country must be a 2-letter ISO country code");
  return {
    ok: true,
    value: {
      recipientName: recipientName.value!,
      street: street.value!,
      line2: line2.value,
      city: city.value!,
      state: state.value,
      postalCode,
      country,
    },
  };
}

/** Accepts a string array (or a comma-separated string for sizes); de-duplicated, trimmed. */
export function parseStringList(value: unknown, field: string): Result<string[] | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  const raw = typeof value === "string" ? value.split(",") : value;
  if (!Array.isArray(raw)) return fail(`${field} must be a list of strings`);
  if (raw.length > MAX_LIST) return fail(`${field} has too many entries`);
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") return fail(`${field} must be a list of strings`);
    const cleaned = item.trim().replace(/\s+/g, " ");
    if (!cleaned) continue;
    if (cleaned.length > MAX_LIST_ITEM) return fail(`${field} entries are too long`);
    if (!out.includes(cleaned)) out.push(cleaned);
  }
  return { ok: true, value: out.length ? out : null };
}

/**
 * Validates the sample-request fields of a POST /seller-hub/quote-requests
 * body. A productId must be an active catalog product of `manufacturerId`;
 * options must be ones that product offers.
 */
export async function resolveSampleRequestFields(
  manufacturerId: string,
  body: Record<string, unknown>,
): Promise<Result<SampleRequestColumns>> {
  const shipTo = parseShipTo(body.shipTo);
  if (!shipTo.ok) return shipTo;
  const sizes = parseStringList(body.sizes, "sizes");
  if (!sizes.ok) return sizes;
  const options = parseStringList(body.options, "options");
  if (!options.ok) return options;

  let catalogProductId: string | null = null;
  if (body.productId !== undefined && body.productId !== null) {
    if (typeof body.productId !== "string" || !UUID_RE.test(body.productId)) {
      return fail("productId must be a catalog product id");
    }
    const [product] = await db
      .select({ id: manufacturerProducts.id, customizationOptions: manufacturerProducts.customizationOptions })
      .from(manufacturerProducts)
      .where(and(
        eq(manufacturerProducts.id, body.productId),
        eq(manufacturerProducts.manufacturerId, manufacturerId),
        eq(manufacturerProducts.status, "active"),
      ));
    if (!product) return fail("productId must be an active product from this manufacturer");
    catalogProductId = product.id;
    const offered = new Set(product.customizationOptions ?? []);
    const unknown = (options.value ?? []).find((option) => !offered.has(option));
    if (unknown) return fail(`"${unknown}" is not an option on this product`);
  } else if (options.value) {
    return fail("options need a catalog productId");
  }

  return {
    ok: true,
    value: {
      catalogProductId,
      sizes: sizes.value ? sizes.value.join(", ") : null,
      sampleOptions: options.value,
      shipTo: shipTo.value,
    },
  };
}

export type CatalogProductSummary = {
  id: string;
  name: string;
  imageUrl: string | null;
  samplePriceCents: number;
  samplePriceLabel: string | null;
};

/**
 * Adds `catalogProduct` (name, first photo, sample price) to quote requests
 * that point at a catalog product, for the manufacturer portal. Only products
 * of the same manufacturer are joined.
 */
export async function withCatalogProducts<T extends { manufacturerId: string; catalogProductId?: string | null }>(
  rows: T[],
): Promise<Array<T & { catalogProduct: CatalogProductSummary | null }>> {
  const ids = [...new Set(rows.map((row) => row.catalogProductId).filter((id): id is string => !!id))];
  const products = ids.length
    ? await db.select({
      id: manufacturerProducts.id,
      manufacturerId: manufacturerProducts.manufacturerId,
      name: manufacturerProducts.name,
      images: manufacturerProducts.images,
      samplePriceCents: manufacturerProducts.samplePriceCents,
      samplePriceLabel: manufacturerProducts.samplePriceLabel,
    }).from(manufacturerProducts).where(inArray(manufacturerProducts.id, ids))
    : [];
  const byId = new Map(products.map((product) => [product.id, product]));
  return rows.map((row) => {
    const product = row.catalogProductId ? byId.get(row.catalogProductId) : undefined;
    return {
      ...row,
      catalogProduct: product && product.manufacturerId === row.manufacturerId
        ? {
          id: product.id,
          name: product.name,
          imageUrl: product.images?.[0] ?? null,
          samplePriceCents: product.samplePriceCents,
          samplePriceLabel: product.samplePriceLabel,
        }
        : null,
    };
  });
}
