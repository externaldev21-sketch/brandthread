/**
 * Barcode / SKU lookup for the seller's inventory scanner.
 *
 * A scanned code matches a variant when it equals the variant's barcode, or
 * its SKU ignoring case. Phone cameras report a 12-digit UPC-A as the 13-digit
 * EAN-13 with a leading 0 (and some printed labels are the other way round),
 * so both forms are tried.
 */
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, products, productVariants } from "@workspace/db";
import { productThumbnail } from "./activityEvents";

export const MAX_CODE_LENGTH = 64;

/** Normalises a scanned / typed code. Returns null when it can't be a code. */
export function normalizeScanCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim();
  if (code.length === 0 || code.length > MAX_CODE_LENGTH) return null;
  if (/[\u0000-\u001f]/.test(code)) return null;
  return code;
}

/** Barcode forms that identify the same item (UPC-A ⇄ EAN-13). */
export function barcodeCandidates(code: string): string[] {
  const out = new Set([code]);
  if (/^\d{12}$/.test(code)) out.add(`0${code}`);
  if (/^0\d{12}$/.test(code)) out.add(code.slice(1));
  return [...out];
}

export function stockStatus(stock: number, threshold: number): "out_of_stock" | "low_stock" | "in_stock" {
  if (stock === 0) return "out_of_stock";
  if (stock <= threshold) return "low_stock";
  return "in_stock";
}

export interface LookupMatch {
  variantId: string;
  productId: string;
  productName: string;
  productStatus: string;
  variantLabel: string;
  size: string | null;
  color: string | null;
  sku: string;
  barcode: string | null;
  stock: number;
  lowStockThreshold: number;
  priceCents: number;
  imageUrl: string | null;
  status: "out_of_stock" | "low_stock" | "in_stock";
  matchedOn: "barcode" | "sku";
}

/** Every live variant of `ownerId` whose barcode or SKU is `code`. Barcode matches come first. */
export async function lookupInventoryCode(ownerId: string, code: string): Promise<LookupMatch[]> {
  const candidates = barcodeCandidates(code);
  const rows = await db
    .select({
      variantId: productVariants.id, size: productVariants.size, color: productVariants.color,
      sku: productVariants.sku, barcode: productVariants.barcode, stock: productVariants.stock,
      lowStockThreshold: productVariants.lowStockThreshold, priceCents: productVariants.priceCents,
      productId: products.id, productName: products.name, productStatus: products.status, images: products.images,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(
      eq(products.ownerId, ownerId),
      isNull(products.deletedAt),
      or(inArray(productVariants.barcode, candidates), sql`lower(${productVariants.sku}) = lower(${code})`),
    ))
    .orderBy(asc(products.name), asc(productVariants.sku))
    .limit(20);

  return rows
    .map((r): LookupMatch => ({
      variantId: r.variantId, productId: r.productId, productName: r.productName, productStatus: r.productStatus,
      variantLabel: [r.size, r.color].filter(Boolean).join(" / "),
      size: r.size, color: r.color, sku: r.sku, barcode: r.barcode, stock: r.stock,
      lowStockThreshold: r.lowStockThreshold, priceCents: r.priceCents, imageUrl: productThumbnail(r.images),
      status: stockStatus(r.stock, r.lowStockThreshold),
      matchedOn: r.barcode !== null && candidates.includes(r.barcode) ? "barcode" : "sku",
    }))
    .sort((a, b) => (a.matchedOn === b.matchedOn ? 0 : a.matchedOn === "barcode" ? -1 : 1));
}
