import { describe, expect, it } from "vitest";
import { isValidHandle, resolveProductSeo, slugifyHandle, suggestUniqueHandle } from "./productSeo";

const product = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Heavyweight Hoodie",
  description: "<p>Boxy   fit, 450gsm fleece.</p>",
  images: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
};

describe("handles", () => {
  it("slugifies names", () => {
    expect(slugifyHandle("  Café Crème — Tee #1! ")).toBe("cafe-creme-tee-1");
    expect(slugifyHandle("!!!")).toBe("");
    expect(slugifyHandle("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });
  it("validates handle rules", () => {
    expect(isValidHandle("heavyweight-hoodie")).toBe(true);
    for (const bad of ["", "Hoodie", "a--b", "-a", "a-", "a b", "a_b", "a".repeat(81)]) {
      expect(isValidHandle(bad)).toBe(false);
    }
  });
  it("suggests the first free handle", () => {
    expect(suggestUniqueHandle("Heavyweight Hoodie", [])).toBe("heavyweight-hoodie");
    expect(suggestUniqueHandle("Heavyweight Hoodie", ["heavyweight-hoodie", "Heavyweight-Hoodie-2"])).toBe("heavyweight-hoodie-3");
    expect(suggestUniqueHandle("!!!", [], "product")).toBe("product");
  });
});

describe("resolveProductSeo", () => {
  const defaults = { storeName: "Nova Studio", titleTemplate: "{{product}} – {{store}}", descriptionTemplate: "{{description}}" };

  it("falls back to the store templates", () => {
    const r = resolveProductSeo(product, null, defaults);
    expect(r.title).toBe("Heavyweight Hoodie – Nova Studio");
    expect(r.description).toBe("Boxy fit, 450gsm fleece.");
    expect(r.handle).toBe("heavyweight-hoodie");
    expect(r.noIndex).toBe(false);
    expect(r.image).toBe("https://cdn.example.com/a.jpg");
    expect(r.titleSource).toBe("template");
  });

  it("product fields win over templates", () => {
    const r = resolveProductSeo(product, {
      seoTitle: "Best hoodie", seoDescription: "Buy it.", urlHandle: "best-hoodie", noIndex: true, socialImageUrl: "https://x.test/og.png",
    }, defaults);
    expect(r).toMatchObject({
      title: "Best hoodie", description: "Buy it.", handle: "best-hoodie", noIndex: true,
      image: "https://x.test/og.png", titleSource: "product", descriptionSource: "product",
    });
  });

  it("uses built-in templates when the store has none", () => {
    const r = resolveProductSeo(product, {}, { storeName: "Nova Studio" });
    expect(r.title).toBe("Heavyweight Hoodie – Nova Studio");
  });

  it("drops the dangling separator when the store has no name", () => {
    expect(resolveProductSeo(product, {}, { storeName: "" }).title).toBe("Heavyweight Hoodie");
  });

  it("honours custom templates and truncates long generated descriptions", () => {
    const long = { ...product, description: "word ".repeat(100) };
    const r = resolveProductSeo(long, {}, { storeName: "S", titleTemplate: "Shop {{product}} | {{store}}" });
    expect(r.title).toBe("Shop Heavyweight Hoodie | S");
    expect(r.description.length).toBeLessThanOrEqual(160);
    expect(r.description.endsWith("…")).toBe(true);
  });

  it("ignores an invalid stored handle and falls back to the name, then the id", () => {
    expect(resolveProductSeo(product, { urlHandle: "Bad Handle" }, defaults).handle).toBe("heavyweight-hoodie");
    expect(resolveProductSeo({ ...product, name: "!!!" }, null, defaults).handle).toBe(product.id);
  });

  it("has no image when the product has none", () => {
    expect(resolveProductSeo({ ...product, images: [] }, null, defaults).image).toBeNull();
  });
});
