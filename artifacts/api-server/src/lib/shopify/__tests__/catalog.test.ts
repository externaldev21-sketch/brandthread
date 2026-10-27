import { afterEach, describe, expect, it, vi } from "vitest";
import { ShopifyCatalogClient, SHOPIFY_GRAPHQL_API_VERSION, toRestShape } from "../catalog";

afterEach(() => vi.restoreAllMocks());

const node = {
  legacyResourceId: "101",
  title: "Rib Tank",
  descriptionHtml: "<p>Soft rib.</p>",
  productType: "Tops",
  tags: ["rib"],
  // Shopify lists options by position; the API may return them in any order.
  options: [{ name: "Color", position: 2 }, { name: "Size", position: 1 }],
  media: { nodes: [{ image: { url: "https://cdn.shopify.com/a.jpg" } }, {}] },
  variants: { nodes: [{
    legacyResourceId: "1011", sku: "TANK-S-BLK", price: "24.00", inventoryQuantity: 7,
    selectedOptions: [{ name: "Color", value: "Black" }, { name: "Size", value: "S" }],
  }] },
};

describe("Shopify GraphQL catalog client", () => {
  it("maps a GraphQL product onto the REST shape by option position", () => {
    expect(toRestShape(node)).toEqual({
      id: "101", title: "Rib Tank", body_html: "<p>Soft rib.</p>", product_type: "Tops", tags: ["rib"],
      options: [{ name: "Size" }, { name: "Color" }],
      images: [{ src: "https://cdn.shopify.com/a.jpg" }],
      variants: [{ id: "1011", sku: "TANK-S-BLK", price: "24.00", inventory_quantity: 7, option1: "S", option2: "Black", option3: null }],
    });
  });

  it("pages through products with the read-only token and backs off when throttled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }))
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(Response.json({ data: { products: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [node] } } }));
    const client = new ShopifyCatalogClient("demo.myshopify.com", "shpat_token", { retryDelayMs: 1 });
    const page = await client.productsPage(null);
    expect(page.nextCursor).toBe("c1");
    expect(page.products[0].title).toBe("Rib Tank");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe(`https://demo.myshopify.com/admin/api/${SHOPIFY_GRAPHQL_API_VERSION}/graphql.json`);
    expect((init.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("shpat_token");
    expect(JSON.parse(String(init.body)).variables).toMatchObject({ after: null, query: "status:active OR status:draft" });
  });

  it("surfaces a revoked token as a 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Invalid API key or access token", { status: 401 }));
    const client = new ShopifyCatalogClient("demo.myshopify.com", "revoked", { retryDelayMs: 1 });
    await expect(client.countProducts()).rejects.toMatchObject({ status: 401 });
  });
});
