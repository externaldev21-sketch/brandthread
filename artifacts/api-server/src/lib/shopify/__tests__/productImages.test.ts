import { afterEach, describe, expect, it, vi } from "vitest";
import { mirrorShopifyImages } from "../productImages";

afterEach(() => vi.restoreAllMocks());

describe("Shopify image copy", () => {
  it("stores Shopify CDN photos, reuses known copies and never fetches other hosts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(Buffer.from([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } }));
    const store = { store: vi.fn(async () => "/objects/uploads/new-copy") };
    const result = await mirrorShopifyImages({
      ownerId: "seller-1",
      urls: [
        "https://cdn.shopify.com/s/files/known.jpg?v=2",
        "https://cdn.shopify.com/s/files/new.jpg?v=1",
        "https://169.254.169.254/latest/meta-data.jpg",
      ],
      existingMap: { "https://cdn.shopify.com/s/files/known.jpg": "/objects/uploads/old-copy" },
      store,
    });
    expect(result.images).toEqual([
      "/objects/uploads/old-copy",
      "/objects/uploads/new-copy",
      "https://169.254.169.254/latest/meta-data.jpg",
    ]);
    expect(result).toMatchObject({ stored: 1, linked: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://cdn.shopify.com/s/files/new.jpg?v=1");
    expect(store.store).toHaveBeenCalledWith(expect.any(Buffer), "image/jpeg", "seller-1");
  });

  it("keeps the Shopify link when the copy fails instead of dropping the photo", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    const result = await mirrorShopifyImages({
      ownerId: "seller-1",
      urls: ["https://cdn.shopify.com/s/files/a.jpg"],
      store: { store: vi.fn() },
    });
    expect(result).toEqual({ images: ["https://cdn.shopify.com/s/files/a.jpg"], imageMap: {}, stored: 0, linked: 1 });
  });
});
