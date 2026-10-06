/**
 * Reorder resolver (buyer "Reorder" from order history).
 *
 * Pure: takes the lines of a past order plus the CURRENT catalogue rows for the
 * products involved, and decides per line what can go back into the cart.
 * Nothing here touches the database, so every branch is unit-testable.
 *
 * Money is integer cents throughout.
 */

export type ReorderUnavailableReason = "out_of_stock" | "discontinued" | "variant_removed";

export interface ReorderLine {
  /** order_items.variant_id — null once the purchased variant was deleted. */
  variantId: string | null;
  productName: string;
  /** "M / Black" style label stored on the order line. */
  variantLabel: string | null;
  /** Optional SKU of the purchased variant, when known. */
  sku?: string | null;
  quantity: number;
  /** Price paid at the time of the order. */
  priceCents: number;
}

export interface ReorderCatalogVariant {
  id: string;
  size: string | null;
  color: string | null;
  sku: string;
  priceCents: number;
  stock: number;
}

export interface ReorderCatalogProduct {
  id: string;
  name: string;
  /** 'draft' | 'active' | 'archived' */
  status: string;
  deletedAt: Date | string | null;
  isPreOrder: boolean;
  variants: ReorderCatalogVariant[];
}

export interface ReorderAddable {
  productId: string;
  variantId: string;
  /** Clamped to current stock. */
  quantity: number;
  requestedQuantity: number;
  quantityClamped: boolean;
  currentPriceCents: number;
  priceChanged: boolean;
  previousPriceCents: number;
}

export interface ReorderUnavailable {
  productId: string | null;
  title: string;
  reason: ReorderUnavailableReason;
}

export interface ReorderResolution {
  addable: ReorderAddable[];
  unavailable: ReorderUnavailable[];
}

const norm = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** "M / Black" -> ["m", "black"]; tolerant of " - " and "," separators. */
export function parseVariantLabel(label: string | null | undefined): string[] {
  return norm(label)
    .split(/\s*(?:\/|,|\s-\s)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function variantParts(v: ReorderCatalogVariant): string[] {
  return [norm(v.size), norm(v.color)].filter(Boolean);
}

function matchVariantByLabel(
  variants: ReorderCatalogVariant[],
  label: string | null | undefined,
): ReorderCatalogVariant | null {
  const wanted = parseVariantLabel(label);
  if (wanted.length === 0) {
    // A line with no label belongs to a single-variant product.
    return variants.length === 1 ? variants[0]! : null;
  }
  const key = [...wanted].sort().join("|");
  return variants.find((v) => [...variantParts(v)].sort().join("|") === key) ?? null;
}

function isProductLive(p: ReorderCatalogProduct): boolean {
  return p.status === "active" && !p.deletedAt;
}

/** Find the variant a line refers to today: by id, then sku, then size+color. */
function locate(
  line: ReorderLine,
  products: ReorderCatalogProduct[],
): { product: ReorderCatalogProduct; variant: ReorderCatalogVariant | null } | null {
  if (line.variantId) {
    for (const product of products) {
      const variant = product.variants.find((v) => v.id === line.variantId);
      if (variant) return { product, variant };
    }
  }
  const nameKey = norm(line.productName);
  const sku = norm(line.sku);
  if (sku) {
    for (const product of products) {
      const variant = product.variants.find((v) => norm(v.sku) === sku);
      if (variant) return { product, variant };
    }
  }
  // The variant row is gone: fall back to the product with the same title.
  const sameName = products.filter((p) => norm(p.name) === nameKey);
  const live = sameName.filter(isProductLive);
  const pool = live.length > 0 ? live : sameName;
  for (const product of pool) {
    const variant = matchVariantByLabel(product.variants, line.variantLabel);
    if (variant) return { product, variant };
  }
  const product = pool[0];
  return product ? { product, variant: null } : null;
}

export function resolveReorder(
  lines: ReorderLine[],
  products: ReorderCatalogProduct[],
): ReorderResolution {
  const addable: ReorderAddable[] = [];
  const unavailable: ReorderUnavailable[] = [];
  const byVariant = new Map<string, number>(); // variantId -> index in addable

  for (const line of lines) {
    const requested = Math.max(1, Math.floor(Number(line.quantity) || 1));
    const found = locate(line, products);
    if (!found) {
      unavailable.push({ productId: null, title: line.productName, reason: "discontinued" });
      continue;
    }
    const { product, variant } = found;
    if (!isProductLive(product)) {
      unavailable.push({ productId: product.id, title: line.productName, reason: "discontinued" });
      continue;
    }
    if (!variant) {
      unavailable.push({ productId: product.id, title: line.productName, reason: "variant_removed" });
      continue;
    }
    const stock = Math.max(0, Math.floor(variant.stock));
    // Pre-orders are sold against a drop, not shelf stock.
    if (stock <= 0 && !product.isPreOrder) {
      unavailable.push({ productId: product.id, title: line.productName, reason: "out_of_stock" });
      continue;
    }

    const existingIdx = byVariant.get(variant.id);
    if (existingIdx !== undefined) {
      // Same variant on two lines: one cart line, clamped together.
      const existing = addable[existingIdx]!;
      const combined = existing.requestedQuantity + requested;
      existing.requestedQuantity = combined;
      existing.quantity = product.isPreOrder ? combined : Math.min(combined, stock);
      existing.quantityClamped = existing.quantity < combined;
      continue;
    }

    const quantity = product.isPreOrder ? requested : Math.min(requested, stock);
    byVariant.set(variant.id, addable.length);
    addable.push({
      productId: product.id,
      variantId: variant.id,
      quantity,
      requestedQuantity: requested,
      quantityClamped: quantity < requested,
      currentPriceCents: variant.priceCents,
      priceChanged: variant.priceCents !== line.priceCents,
      previousPriceCents: line.priceCents,
    });
  }

  return { addable, unavailable };
}
