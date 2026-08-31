import dns from "node:dns/promises";
import { describe, expect, it, vi } from "vitest";
import {
  SHOPIFY_IMPORT_CAP,
  ShopifyImportError,
  assertPublicShopifyHost,
  capShopifyProducts,
  classifyShopifyResponse,
  cursorFromLink,
  deterministicSku,
  normalizeShopifyUrl,
  parsePriceCents,
  toBrandthreadProduct,
} from "./shopifyImport";

describe("Shopify public import safety and conversion", () => {
  it.each([
    ["http://shop.example.com", "INVALID_URL"],
    ["https://user:password@shop.example.com", "INVALID_URL"],
    ["https://127.0.0.1", "PRIVATE_URL"],
    ["https://localhost", "PRIVATE_URL"],
    ["https://store.internal", "PRIVATE_URL"],
  ])("rejects unsafe URL %s", (url, code) => {
    expect(() => normalizeShopifyUrl(url)).toThrowError(ShopifyImportError);
    try { normalizeShopifyUrl(url); } catch (error) {
      expect((error as ShopifyImportError).code).toBe(code);
    }
  });

  it("normalizes a seller URL to one HTTPS storefront origin", () => {
    expect(normalizeShopifyUrl(" https://WWW.Example.com/products/tee?x=1 "))
      .toBe("https://www.example.com");
  });

  it("revalidates DNS and rejects rebinding, including IPv4-mapped IPv6", async () => {
    const lookup = vi.spyOn(dns, "lookup")
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }] as any)
      .mockResolvedValueOnce([{ address: "::ffff:127.0.0.1", family: 6 }] as any);
    await expect(assertPublicShopifyHost("https://shop.example")).resolves.toMatchObject({ address: "8.8.8.8" });
    await expect(assertPublicShopifyHost("https://shop.example")).rejects.toMatchObject({ code: "PRIVATE_URL" });
    expect(lookup).toHaveBeenCalledTimes(2);
    lookup.mockRestore();
  });

  it.each(["169.254.169.254", "::ffff:169.254.169.254", "2001:db8::1"])(
    "rejects non-global DNS target %s",
    async (address) => {
      const lookup = vi.spyOn(dns, "lookup").mockResolvedValueOnce([{
        address,
        family: address.includes(":") ? 6 : 4,
      }] as any);
      await expect(assertPublicShopifyHost("https://shop.example")).rejects.toMatchObject({ code: "PRIVATE_URL" });
      lookup.mockRestore();
    },
  );

  it.each([
    [401, "password required", "PASSWORD_PROTECTED"],
    [403, "access denied", "BLOCKED"],
    [404, "", "NOT_SHOPIFY"],
    [429, "", "RATE_LIMITED"],
    [503, "", "UNREACHABLE"],
    [200, '<div class="shopify-section-template--password">', "PASSWORD_PROTECTED"],
    [200, "captcha challenge", "BLOCKED"],
  ])("classifies Shopify response %s as %s", (status, body, expected) => {
    expect(classifyShopifyResponse(status as number, {}, body as string)).toBe(expected);
  });

  it("parses integer cents without floating-point math", () => {
    expect(parsePriceCents("19.95")).toBe(1995);
    expect(parsePriceCents("4")).toBe(400);
    expect(() => parsePriceCents("12.345")).toThrowError(/invalid price/i);
    expect(() => parsePriceCents("-1.00")).toThrowError(/invalid price/i);
  });

  it("converts Shopify options, images, inventory, and generated SKUs", () => {
    const converted = toBrandthreadProduct({
      id: 101,
      title: "Studio Shirt",
      body_html: "<p>Soft &amp; structured.</p>",
      product_type: "",
      tags: "cotton, summer",
      images: [{ src: "https://cdn.shopify.com/shirt.jpg" }],
      options: [{ name: "Size" }, { name: "Color" }, { name: "Material" }],
      variants: [{
        id: 9, sku: "", price: "120.00", inventory_quantity: 7,
        option1: "M", option2: "Black", option3: "Linen",
      }],
    }, "New arrivals");
    expect(converted).toMatchObject({
      sourceProductId: "101",
      category: "new arrivals",
      images: ["https://cdn.shopify.com/shirt.jpg"],
      variants: [{
        size: "M / material: Linen",
        color: "Black",
        priceCents: 12000,
        stock: 7,
      }],
    });
    expect(converted.description).toBe("Soft & structured.");
    expect(converted.variants[0].sku).toBe("SHOPIFY-101-9");
  });

  it("caps each batch and reads the continuation cursor", () => {
    const products = Array.from({ length: SHOPIFY_IMPORT_CAP + 12 }, (_, id) => ({ id }));
    expect(capShopifyProducts(products)).toHaveLength(SHOPIFY_IMPORT_CAP);
    expect(cursorFromLink('<https://shop.example/products.json?limit=250&page_info=next123>; rel="next"'))
      .toBe("next123");
  });

  it("uses stable unique destination SKUs for retries", () => {
    expect(deterministicSku("https://shop.example", "100", "TEE", 0))
      .toBe(deterministicSku("https://shop.example", "100", "TEE", 0));
    expect(deterministicSku("https://shop.example", "100", "TEE", 0))
      .not.toBe(deterministicSku("https://shop.example", "101", "TEE", 0));
  });
});