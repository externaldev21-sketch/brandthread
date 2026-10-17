import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, products: {}, productVariants: {} }));

import {
  buildPublicBuilderData, isLive, publicCollections, publicPages, renderBuilderHtml,
  selectCollectionProducts, type CatalogProduct,
} from "../storefrontBuilderPublic";

const NOW = new Date("2026-10-17T12:00:00Z");

function product(over: Partial<CatalogProduct>): CatalogProduct {
  return {
    id: "00000000-0000-4000-8000-000000000001", name: "Tee", image: null, priceCents: 2000,
    variantId: "v1", inStock: true, totalStock: 5, category: "apparel", tags: [],
    isPreOrder: false, createdAt: new Date("2026-10-01T00:00:00Z"), ...over,
  };
}

const A = product({ id: "00000000-0000-4000-8000-00000000000a", name: "Alpha Hoodie", priceCents: 9000, tags: ["winter"] });
const B = product({ id: "00000000-0000-4000-8000-00000000000b", name: "Beta Tee", priceCents: 3000, category: "tops" });
const C = product({ id: "00000000-0000-4000-8000-00000000000c", name: "Gamma Cap", priceCents: 1500, createdAt: new Date("2026-10-16T00:00:00Z") });
const CATALOG = [A, B, C];

describe("isLive", () => {
  it("accepts the live status and past schedules only", () => {
    expect(isLive({ status: "active" }, "active", NOW)).toBe(true);
    expect(isLive({ status: "draft" }, "active", NOW)).toBe(false);
    expect(isLive({ status: "hidden" }, "active", NOW)).toBe(false);
    expect(isLive({ status: "scheduled", scheduledAt: "Jul 21, 2026" }, "active", NOW)).toBe(true);
    expect(isLive({ status: "scheduled", scheduledAt: "2027-01-01" }, "active", NOW)).toBe(false);
    expect(isLive({ status: "scheduled", scheduledAt: "soon" }, "active", NOW)).toBe(false);
  });
});

describe("collections", () => {
  it("manual collections keep only the seller's own products, in manual order", () => {
    const col = { type: "manual", productIds: [C.id, "not-mine", A.id], productOrder: "manual" };
    expect(selectCollectionProducts(col, CATALOG, NOW).map((p) => p.name)).toEqual(["Gamma Cap", "Alpha Hoodie"]);
  });

  it("automated collections evaluate conditions (all / any)", () => {
    const all = { type: "automated", conditionMatch: "all", conditions: [
      { field: "price", operator: "greater_than", value: "20" },
      { field: "tag", operator: "equals", value: "winter" },
    ] };
    expect(selectCollectionProducts(all, CATALOG, NOW).map((p) => p.id)).toEqual([A.id]);
    const any = { type: "automated", conditionMatch: "any", productOrder: "price_asc", conditions: [
      { field: "category", operator: "equals", value: "tops" },
      { field: "new_products", operator: "is_set", value: "7" },
    ] };
    expect(selectCollectionProducts(any, CATALOG, NOW).map((p) => p.id)).toEqual([C.id, B.id]);
    expect(selectCollectionProducts({ type: "automated", conditions: [] }, CATALOG, NOW)).toEqual([]);
    expect(selectCollectionProducts({ type: "automated", conditions: [{ field: "vendor", operator: "equals", value: "x" }] }, CATALOG, NOW)).toEqual([]);
  });

  it("only active collections are public, sanitized", () => {
    const out = publicCollections([
      { id: "c1", name: "Winter", status: "active", type: "manual", productIds: [A.id], handle: "Winter Edit", coverImageUri: "javascript:alert(1)" },
      { id: "c2", name: "Draft", status: "draft", productIds: [B.id] },
      { id: "c3", name: "", status: "active" },
      "junk",
    ], CATALOG, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "c1", name: "Winter", handle: "winter-edit", coverImageUrl: null });
    expect(out[0].products.map((p) => p.id)).toEqual([A.id]);
  });
});

describe("pages", () => {
  it("only published pages are public", () => {
    const out = publicPages([
      { id: "p1", title: "About", slug: "about", content: "Hi", status: "published" },
      { id: "p2", title: "Secret", slug: "secret", content: "x", status: "draft" },
    ], NOW);
    expect(out.map((p) => p.slug)).toEqual(["about"]);
  });
});

describe("navigation + html", () => {
  const sf = {
    collections: [{ id: "c1", name: "Winter", status: "active", type: "manual", productIds: [A.id], handle: "winter" }],
    pages: [
      { id: "p1", title: "About", slug: "about", content: "Line one\n\n<script>x</script>", status: "published" },
      { id: "p2", title: "Draft", slug: "draft", content: "", status: "draft" },
    ],
    navigation: [
      { type: "main", name: "Main", items: [
        { id: "1", label: "Winter", target: "collection", targetId: "winter", visible: true, order: 0, children: [] },
        { id: "2", label: "About us", target: "page", targetId: "About", visible: true, order: 1, children: [] },
        { id: "3", label: "Hidden", target: "page", targetId: "about", visible: false, order: 2, children: [] },
        { id: "4", label: "Draft", target: "page", targetId: "draft", visible: true, order: 3, children: [] },
        { id: "5", label: "Bad", target: "external", url: "javascript:alert(1)", visible: true, order: 4, children: [] },
        { id: "6", label: "Hoodie", target: "product", targetId: "alpha hoodie", visible: true, order: 5, children: [] },
      ] },
      { type: "footer", name: "Footer", items: [] },
    ],
  };

  it("resolves menu items to published targets and drops the rest", () => {
    const data = buildPublicBuilderData(sf, CATALOG, NOW);
    expect(data.navigation).toHaveLength(1);
    expect(data.navigation[0].items.map((i) => [i.label, i.href])).toEqual([
      ["Winter", "#collection-winter"],
      ["About us", "#page-about"],
      ["Hoodie", `https://brandthread.app/store/product/${A.id}`],
    ]);
  });

  it("renders escaped collection, page and nav markup", () => {
    const html = renderBuilderHtml(buildPublicBuilderData(sf, CATALOG, NOW));
    expect(html.navLinks).toContain('href="#collection-winter"');
    expect(html.footerLinks).toBeNull();
    expect(html.collectionsHtml).toContain('id="collection-winter"');
    expect(html.collectionsHtml).toContain("Alpha Hoodie");
    expect(html.collectionsHtml).toContain(`data-product-id="${A.id}"`);
    expect(html.pagesHtml).toContain('id="page-about"');
    expect(html.pagesHtml).toContain("&lt;script&gt;");
    expect(html.pagesHtml).not.toContain("<script>");
    expect(html.pagesHtml).not.toContain("page-draft");
  });

  it("returns null nav when no menu has usable items", () => {
    const html = renderBuilderHtml(buildPublicBuilderData({ navigation: [{ type: "main", items: [] }] }, [], NOW));
    expect(html.navLinks).toBeNull();
    expect(html.collectionsHtml).toBe("");
  });
});
