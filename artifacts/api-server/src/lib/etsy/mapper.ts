import type { ImportProduct, ImportVariant, Issue } from "../productImport/types";
import { MAX_VARIANTS_PER_PRODUCT } from "../productImport/types";
import { cleanTags, foldAxes, sanitizeImages, stripHtml } from "../productImport/util";
import type { EtsyListing, EtsyMoney } from "./client";

function cents(m: EtsyMoney | undefined): number | null {
  if (!m || !Number.isFinite(m.amount) || !m.divisor) return null;
  return Math.round((m.amount / m.divisor) * 100);
}

/** Maps Etsy Open API listings (with Images + Inventory included) to import products. */
export function mapEtsyListings(listings: EtsyListing[]): { products: ImportProduct[]; issues: Issue[] } {
  const products: ImportProduct[] = [];
  const issues: Issue[] = [];
  listings.forEach((listing, index) => {
    const name = String(listing.title ?? "").trim();
    const label = name || `Listing ${listing.listing_id}`;
    if (!listing.listing_id || !name) {
      issues.push({ severity: "error", line: index + 1, product: label, field: "title", message: "Listing has no title." });
      return;
    }
    const currency = listing.price?.currency_code;
    if (currency && currency !== "USD") {
      issues.push({ severity: "warning", line: index + 1, product: name, field: "price", message: `Prices are in ${currency}; they were imported as-is without conversion.` });
    }
    const fallbackPrice = cents(listing.price);
    const variants: ImportVariant[] = [];
    const inventory = (listing.inventory?.products ?? []).filter((p) => !p.is_deleted);
    for (const item of inventory) {
      const offering = (item.offerings ?? []).find((o) => !o.is_deleted && o.is_enabled !== false);
      if (!offering) continue;
      const price = cents(offering.price) ?? fallbackPrice;
      if (price === null) continue;
      const axes = (item.property_values ?? []).map((pv) => ({ label: pv.property_name ?? "", value: (pv.values ?? []).join(" ") }));
      const { size, color } = foldAxes(axes);
      variants.push({
        sku: (item.sku ?? "").trim(), size, color, priceCents: price, compareAtCents: null,
        stock: Math.max(0, Math.floor(offering.quantity ?? 0)), weightGrams: null,
      });
    }
    if (!variants.length) {
      if (fallbackPrice === null) {
        issues.push({ severity: "error", line: index + 1, product: name, field: "price", message: "Listing has no price." });
        return;
      }
      variants.push({
        sku: (listing.sku?.[0] ?? "").trim(), size: null, color: null, priceCents: fallbackPrice, compareAtCents: null,
        stock: Math.max(0, Math.floor(listing.quantity ?? 0)), weightGrams: null,
      });
    }
    if (variants.length > MAX_VARIANTS_PER_PRODUCT) {
      issues.push({ severity: "warning", line: index + 1, product: name, field: "variants", message: `${variants.length} variations found; only the first ${MAX_VARIANTS_PER_PRODUCT} were kept.` });
      variants.length = MAX_VARIANTS_PER_PRODUCT;
    }
    const ranked = [...(listing.images ?? [])].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    const { images, rejected } = sanitizeImages(ranked.map((img) => img.url_fullxfull ?? img.url_570xN ?? ""));
    if (rejected > 0) issues.push({ severity: "warning", line: index + 1, product: name, field: "images", message: `${rejected} image link(s) skipped.` });
    products.push({
      externalKey: `listing:${listing.listing_id}`, name: name.slice(0, 200), description: stripHtml(listing.description),
      category: "apparel", tags: cleanTags(listing.tags ?? []), images, vendor: null, seoTitle: null, seoDescription: null,
      sourceStatus: null, variants, lines: [index + 1],
    });
  });
  return { products, issues };
}
