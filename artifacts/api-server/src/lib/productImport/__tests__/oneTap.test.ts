import { describe, expect, it } from "vitest";
import { mapInstagramMedia, mapShopifyCatalog, nameFromCaption } from "../oneTap";

describe("mapShopifyCatalog", () => {
  const product = {
    id: 42, title: "Boxy Linen Shirt", body_html: "<p>Garment-dyed linen.</p>", product_type: "Shirts", tags: "linen, summer",
    images: [{ src: "https://cdn.shopify.com/s/files/1/shirt.jpg" }, { src: "http://localhost/x.jpg" }],
    options: [{ name: "Size" }],
    variants: [
      { id: 1, sku: "BLS-S", price: "88.00", compare_at_price: "110.00", inventory_quantity: 4, option1: "S" },
      { id: 2, sku: "", price: "88.00", compare_at_price: null, inventory_quantity: 2, option1: "M" },
    ],
  };

  it("maps a product to a draft-ready import keyed by store and product id", () => {
    const { products, issues } = mapShopifyCatalog("https://noir.example.com", [product as any]);
    expect(products).toHaveLength(1);
    const p = products[0]!;
    expect(p.externalKey).toBe("shopify:noir.example.com:42");
    expect(p.name).toBe("Boxy Linen Shirt");
    expect(p.description).toContain("Garment-dyed linen.");
    expect(p.images).toEqual(["https://cdn.shopify.com/s/files/1/shirt.jpg"]);
    expect(p.tags).toEqual(["linen", "summer"]);
    expect(p.variants.map((v) => [v.sku, v.size, v.priceCents, v.compareAtCents, v.stock])).toEqual([
      ["BLS-S", "S", 8800, 11000, 4],
      ["", "M", 8800, null, 2],
    ]);
    expect(issues.some((i) => i.field === "images")).toBe(true);
  });

  it("reports a product it can't read instead of failing the whole import", () => {
    const { products, issues } = mapShopifyCatalog("https://noir.example.com", [{ id: 7, title: "", variants: [] } as any, product as any]);
    expect(products).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", line: 1 });
  });
});

describe("mapInstagramMedia", () => {
  it("turns photo posts and carousels into $0 drafts with a price warning; skips videos", () => {
    const { products, issues } = mapInstagramMedia([
      { id: "a", media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/a.jpg", caption: "Washed hoodie drop 03\n#streetwear #drop", timestamp: "2026-09-01T10:00:00+0000" },
      { id: "b", media_type: "VIDEO", media_url: "https://scontent.cdninstagram.com/b.mp4" },
      { id: "c", media_type: "CAROUSEL_ALBUM", caption: "", timestamp: "2026-09-02T10:00:00+0000", children: { data: [
        { media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/c1.jpg" },
        { media_type: "VIDEO", media_url: "https://scontent.cdninstagram.com/c2.mp4" },
      ] } },
    ]);
    expect(products.map((p) => p.externalKey)).toEqual(["instagram:a", "instagram:c"]);
    expect(products[0]!.name).toBe("Washed hoodie drop 03");
    expect(products[0]!.tags).toEqual(["streetwear", "drop"]);
    expect(products[1]!.name).toBe("Instagram post 2026-09-02");
    expect(products[1]!.images).toEqual(["https://scontent.cdninstagram.com/c1.jpg"]);
    expect(products.every((p) => p.variants[0]!.priceCents === 0)).toBe(true);
    expect(issues.filter((i) => i.field === "price")).toHaveLength(2);
  });
});

describe("nameFromCaption", () => {
  it("drops hashtags and mentions and caps the length", () => {
    expect(nameFromCaption("@noir x #collab Field Jacket #fw26")).toBe("x Field Jacket");
    expect(nameFromCaption("#only #tags")).toBeNull();
    expect(nameFromCaption("a".repeat(100))!.length).toBe(80);
  });
});
