import { describe, expect, it } from "vitest";
import { absoluteImages, buildFeedItems, feedCsv, formatFeedPrice, googleCategoryFor, META_COLUMNS, TIKTOK_COLUMNS } from "../feed";

const origin = "https://brandthread.app";
const product = {
  id: "p1", name: "Box Logo Hoodie", description: "Heavyweight\n\nfleece", category: "hoodies", tags: [],
  images: ["https://cdn.example.com/a.jpg", "/api/storage/b.jpg", "data:image/png;base64,xx", "https://cdn.example.com/c.jpg"],
  isPreOrder: false,
};

describe("feed price format", () => {
  it("formats integer cents as '12.00 USD' without floats", () => {
    expect(formatFeedPrice(1200)).toBe("12.00 USD");
    expect(formatFeedPrice(1999)).toBe("19.99 USD");
    expect(formatFeedPrice(5)).toBe("0.05 USD");
    expect(formatFeedPrice(-1)).toBe("0.00 USD");
  });
});

describe("feed items", () => {
  it("builds one row per variant grouped by product id, with sale price from a higher compare-at", () => {
    const items = buildFeedItems({
      products: [product],
      variants: [
        { id: "v1", productId: "p1", size: "M", color: "Black", priceCents: 6000, compareAtPriceCents: 8000, stock: 3 },
        { id: "v2", productId: "p1", size: "L", color: "Black", priceCents: 6000, compareAtPriceCents: null, stock: 0 },
      ],
      brand: "Northline",
      origin,
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "v1", itemGroupId: "p1", title: "Box Logo Hoodie", description: "Heavyweight fleece",
      availability: "in stock", condition: "new", price: "80.00 USD", salePrice: "60.00 USD",
      link: "https://brandthread.app/store/product/p1", imageLink: "https://cdn.example.com/a.jpg",
      additionalImageLink: "https://brandthread.app/api/storage/b.jpg,https://cdn.example.com/c.jpg",
      brand: "Northline", size: "M", color: "Black",
      googleProductCategory: "Apparel & Accessories > Clothing > Shirts & Tops",
    });
    expect(items[1]).toMatchObject({ id: "v2", availability: "out of stock", price: "60.00 USD", salePrice: "" });
  });

  it("marks pre-orders and skips products with no image, no variants or no price", () => {
    const items = buildFeedItems({
      products: [
        { ...product, id: "pre", isPreOrder: true },
        { ...product, id: "noimg", images: [] },
        { ...product, id: "novariant" },
      ],
      variants: [
        { id: "a", productId: "pre", size: null, color: null, priceCents: 1000, compareAtPriceCents: null, stock: 0 },
        { id: "b", productId: "noimg", size: null, color: null, priceCents: 1000, compareAtPriceCents: null, stock: 1 },
        { id: "c", productId: "pre", size: null, color: null, priceCents: 0, compareAtPriceCents: null, stock: 1 },
      ],
      brand: "",
      origin,
    });
    expect(items.map((i) => i.id)).toEqual(["a"]);
    expect(items[0]).toMatchObject({ availability: "preorder", brand: "Brandthread" });
  });

  it("falls back to the title when there is no description and truncates long titles", () => {
    const [item] = buildFeedItems({
      products: [{ ...product, name: "x".repeat(400), description: null }],
      variants: [{ id: "v", productId: "p1", size: null, color: null, priceCents: 100, compareAtPriceCents: null, stock: 1 }],
      brand: "B",
      origin,
    });
    expect(item.title.length).toBe(150);
    expect(item.description).toBe(item.title);
  });

  it("maps categories to Google taxonomy paths with an apparel default", () => {
    expect(googleCategoryFor({ category: "apparel", name: "Selvedge jeans", tags: [] })).toBe("Apparel & Accessories > Clothing > Pants");
    expect(googleCategoryFor({ category: "apparel", name: "Logo piece", tags: [] })).toBe("Apparel & Accessories > Clothing");
  });

  it("only keeps http(s) and site-relative images", () => {
    expect(absoluteImages(["ftp://x", "//evil.com/a.jpg", "/a.jpg", 3, "https://x/y.png"], origin))
      .toEqual(["https://brandthread.app/a.jpg", "https://x/y.png"]);
  });
});

describe("feed CSV", () => {
  const items = buildFeedItems({
    products: [{ ...product, name: '=HYPERLINK("http://evil")', description: 'Says "hi", twice' }],
    variants: [{ id: "v1", productId: "p1", size: "M", color: null, priceCents: 1200, compareAtPriceCents: null, stock: 1 }],
    brand: "Northline",
    origin,
  });

  it("uses the Meta header row with id first", () => {
    const [header, row] = feedCsv("meta", items).trimEnd().split("\n");
    expect(header).toBe(META_COLUMNS.join(","));
    expect(header.startsWith("id,title,description,availability,condition,price,link,image_link,brand")).toBe(true);
    expect(row.startsWith("v1,")).toBe(true);
    expect(row).toContain("12.00 USD");
  });

  it("uses the TikTok catalog header row with sku_id first", () => {
    const [header] = feedCsv("tiktok", items).split("\n");
    expect(header).toBe(TIKTOK_COLUMNS.join(","));
    expect(header.startsWith("sku_id,title,description,availability,condition,price,link,image_link,brand")).toBe(true);
  });

  it("neutralises spreadsheet formulas and quotes commas and quotes", () => {
    const csv = feedCsv("meta", items);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(`"Says ""hi"", twice"`);
  });

  it("an empty catalog is a header-only file", () => {
    expect(feedCsv("meta", [])).toBe(`${META_COLUMNS.join(",")}\n`);
  });
});
