import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  productRows: [] as unknown[],
  variantRows: [] as unknown[],
}));

vi.mock("drizzle-orm", () => ({
  inArray: (...values: unknown[]) => values,
}));

vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({ name }, {
    get: (target, key) => (key in target ? target[key as keyof typeof target] : String(key)),
  });
  const products = table("products");
  const productVariants = table("productVariants");
  return {
    db: {
      select: () => ({
        from: (t: { name: string }) => ({
          where: () => Promise.resolve(t.name === "products" ? state.productRows : state.variantRows),
        }),
      }),
    },
    products,
    productVariants,
  };
});

vi.mock("../productImageResize", () => ({
  getChatCardImagePath: vi.fn(async (path: string) =>
    (path.startsWith("/objects/") ? `${path}-w720` : path)),
}));

import { getChatCardImagePath } from "../productImageResize";
import {
  applyProductAttachmentInfo,
  enrichProductAttachments,
  fetchProductAttachmentInfo,
} from "../productAttachmentInfo";

describe("fetchProductAttachmentInfo", () => {
  it("returns live name/image/price for an active product", async () => {
    state.productRows = [{ id: "p1", name: "Ivory Column Set", images: ["https://x/p1.jpg"], status: "active", deletedAt: null }];
    state.variantRows = [{ productId: "p1", priceCents: 41000 }, { productId: "p1", priceCents: 38000 }];
    const map = await fetchProductAttachmentInfo(["p1"]);
    expect(map.get("p1")).toEqual({ available: true, name: "Ivory Column Set", image: "https://x/p1.jpg", priceCents: 38000 });
  });

  it("resolves an own-storage image through the chat-card resize helper", async () => {
    state.productRows = [{ id: "p4", name: "Resized Piece", images: ["/objects/uploads/p4"], status: "active", deletedAt: null }];
    state.variantRows = [];
    const map = await fetchProductAttachmentInfo(["p4"]);
    expect(map.get("p4")?.image).toBe("/objects/uploads/p4-w720");
    expect(getChatCardImagePath).toHaveBeenCalledWith("/objects/uploads/p4");
  });

  it("marks an archived product unavailable even though the row still exists", async () => {
    state.productRows = [{ id: "p2", name: "Old Piece", images: [], status: "archived", deletedAt: null }];
    state.variantRows = [];
    const map = await fetchProductAttachmentInfo(["p2"]);
    expect(map.get("p2")?.available).toBe(false);
  });

  it("marks a soft-deleted product unavailable", async () => {
    state.productRows = [{ id: "p3", name: "Deleted Piece", images: [], status: "active", deletedAt: new Date() }];
    state.variantRows = [];
    const map = await fetchProductAttachmentInfo(["p3"]);
    expect(map.get("p3")?.available).toBe(false);
  });

  it("returns an empty map without querying for an empty id list", async () => {
    const map = await fetchProductAttachmentInfo([]);
    expect(map.size).toBe(0);
  });
});

describe("applyProductAttachmentInfo", () => {
  it("refreshes title/subtitle/uri from live data and clears any unavailable flag", () => {
    const attachment: any = {
      type: "product", title: "Stale Name", subtitle: "$1.00 (old)", uri: "old.jpg",
      meta: { productId: "p1", unavailable: "true" },
    };
    const info = new Map([["p1", { available: true, name: "Ivory Column Set", image: "new.jpg", priceCents: 41000 }]]);
    applyProductAttachmentInfo(attachment, info);
    expect(attachment.title).toBe("Ivory Column Set");
    expect(attachment.subtitle).toBe("$410.00");
    expect(attachment.uri).toBe("new.jpg");
    expect(attachment.meta.unavailable).toBeUndefined();
  });

  it("shows an honest 'No longer available' state for a deleted/archived product", () => {
    const attachment: any = {
      type: "product", title: "Draped Satin Slip", subtitle: "$260.00 (stale)", uri: "old.jpg",
      meta: { productId: "gone" },
    };
    // Not present in the info map at all — same as a hard-deleted row.
    applyProductAttachmentInfo(attachment, new Map());
    expect(attachment.subtitle).toBe("No longer available");
    expect(attachment.meta.unavailable).toBe("true");
    // Keeps the last-known name for context rather than blanking it.
    expect(attachment.title).toBe("Draped Satin Slip");
  });

  it("prefers the live (possibly renamed) product name when it exists but is inactive", () => {
    const attachment: any = { type: "product", title: "Old Cached Name", meta: { productId: "p2" } };
    const info = new Map([["p2", { available: false, name: "Renamed Then Archived", image: null, priceCents: null }]]);
    applyProductAttachmentInfo(attachment, info);
    expect(attachment.title).toBe("Renamed Then Archived");
    expect(attachment.subtitle).toBe("No longer available");
    expect(attachment.meta.unavailable).toBe("true");
  });

  it("ignores non-product attachments and attachments with no productId", () => {
    const order: any = { type: "order", title: "Order #1" };
    applyProductAttachmentInfo(order, new Map());
    expect(order).toEqual({ type: "order", title: "Order #1" });

    const noId: any = { type: "product", title: "x", meta: {} };
    applyProductAttachmentInfo(noId, new Map());
    expect(noId.title).toBe("x");
    expect(noId.meta.unavailable).toBeUndefined();
  });
});

describe("enrichProductAttachments", () => {
  it("enriches both the primary attachment and the attachments array, across multiple messages, with one query", async () => {
    state.productRows = [{ id: "p1", name: "Live Name", images: ["img.jpg"], status: "active", deletedAt: null }];
    state.variantRows = [{ productId: "p1", priceCents: 5000 }];
    const messages = [
      { attachment: { type: "product", title: "stale", meta: { productId: "p1" } } },
      { attachments: [{ type: "product", title: "stale2", meta: { productId: "p1" } }] },
      { attachment: { type: "voice", title: "voice msg" } }, // untouched
    ];
    await enrichProductAttachments(messages as any);
    expect(messages[0].attachment?.title).toBe("Live Name");
    expect((messages[1].attachments as any)[0].title).toBe("Live Name");
    expect(messages[2].attachment?.title).toBe("voice msg");
  });

  it("is a no-op (no db call) when nothing has a product attachment", async () => {
    const spy = vi.fn();
    const messages = [{ attachment: { type: "image", uri: "x.jpg" } }];
    await expect(enrichProductAttachments(messages as any)).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
