import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  orderRows: [] as unknown[],
}));

vi.mock("drizzle-orm", () => ({
  inArray: (...values: unknown[]) => values,
}));

vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({ name }, {
    get: (target, key) => (key in target ? target[key as keyof typeof target] : String(key)),
  });
  const orders = table("orders");
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(state.orderRows),
        }),
      }),
    },
    orders,
  };
});

import {
  applyOrderAttachmentInfo,
  enrichOrderAttachments,
  fetchOrderAttachmentInfo,
} from "../orderAttachmentInfo";

describe("fetchOrderAttachmentInfo", () => {
  it("returns live status/tracking for a shipped order", async () => {
    state.orderRows = [{
      id: "o1", orderNumber: "BT-10234", status: "shipped",
      trackingNumber: "1Z999AA10123456784", carrier: "UPS", trackingStatus: "in_transit",
      estimatedDelivery: "2026-10-02",
    }];
    const map = await fetchOrderAttachmentInfo(["o1"]);
    expect(map.get("o1")).toEqual({
      orderNumber: "BT-10234", status: "shipped",
      trackingNumber: "1Z999AA10123456784", carrier: "UPS", trackingStatus: "in_transit",
      estimatedDelivery: "2026-10-02",
    });
  });

  it("nulls out missing tracking fields rather than leaving them undefined", async () => {
    state.orderRows = [{
      id: "o2", orderNumber: "BT-10235", status: "pending",
      trackingNumber: null, carrier: null, trackingStatus: null, estimatedDelivery: null,
    }];
    const map = await fetchOrderAttachmentInfo(["o2"]);
    expect(map.get("o2")?.trackingNumber).toBeNull();
    expect(map.get("o2")?.carrier).toBeNull();
  });

  it("returns an empty map without querying for an empty id list", async () => {
    const map = await fetchOrderAttachmentInfo([]);
    expect(map.size).toBe(0);
  });
});

describe("applyOrderAttachmentInfo", () => {
  it("refreshes title and fills status/tracking meta from live data", () => {
    const attachment: any = {
      type: "order", title: "Order #BT-10234", subtitle: "Processing (stale)",
      meta: { orderId: "o1" },
    };
    const info = new Map([["o1", {
      orderNumber: "BT-10234", status: "shipped",
      trackingNumber: "1Z999AA10123456784", carrier: "UPS", trackingStatus: "in_transit",
      estimatedDelivery: "2026-10-02",
    }]]);
    applyOrderAttachmentInfo(attachment, info);
    expect(attachment.title).toBe("Order #BT-10234");
    expect(attachment.meta.status).toBe("shipped");
    expect(attachment.meta.trackingNumber).toBe("1Z999AA10123456784");
    expect(attachment.meta.carrier).toBe("UPS");
    expect(attachment.meta.estimatedDelivery).toBe("2026-10-02");
  });

  it("reflects a cancellation honestly instead of leaving a stale 'processing' status", () => {
    const attachment: any = {
      type: "order", title: "Order #BT-10240", subtitle: "Processing (stale)",
      meta: { orderId: "o3", status: "processing" },
    };
    const info = new Map([["o3", {
      orderNumber: "BT-10240", status: "cancelled",
      trackingNumber: null, carrier: null, trackingStatus: null, estimatedDelivery: null,
    }]]);
    applyOrderAttachmentInfo(attachment, info);
    expect(attachment.meta.status).toBe("cancelled");
    expect(attachment.meta.trackingNumber).toBeUndefined();
  });

  it("drops stale status/tracking meta when the order can no longer be resolved", () => {
    const attachment: any = {
      type: "order", title: "Order #BT-99999",
      meta: { orderId: "gone", status: "shipped", trackingNumber: "abc" },
    };
    applyOrderAttachmentInfo(attachment, new Map());
    expect(attachment.title).toBe("Order #BT-99999");
    expect(attachment.meta.status).toBeUndefined();
    expect(attachment.meta.trackingNumber).toBeUndefined();
  });

  it("ignores non-order attachments and attachments with no orderId", () => {
    const product: any = { type: "product", title: "A product" };
    applyOrderAttachmentInfo(product, new Map());
    expect(product).toEqual({ type: "product", title: "A product" });

    const noId: any = { type: "order", title: "x", meta: {} };
    applyOrderAttachmentInfo(noId, new Map());
    expect(noId.title).toBe("x");
    expect(noId.meta.status).toBeUndefined();
  });
});

describe("enrichOrderAttachments", () => {
  it("enriches both the primary attachment and the attachments array, across multiple messages, with one query", async () => {
    state.orderRows = [{
      id: "o1", orderNumber: "BT-10234", status: "delivered",
      trackingNumber: "1Z1", carrier: "UPS", trackingStatus: "delivered", estimatedDelivery: null,
    }];
    const messages = [
      { attachment: { type: "order", title: "stale", meta: { orderId: "o1" } } },
      { attachments: [{ type: "order", title: "stale2", meta: { orderId: "o1" } }] },
      { attachment: { type: "voice", title: "voice msg" } }, // untouched
    ];
    await enrichOrderAttachments(messages as any);
    expect(messages[0].attachment?.meta?.status).toBe("delivered");
    expect((messages[1].attachments as any)[0].meta.status).toBe("delivered");
    expect(messages[2].attachment?.title).toBe("voice msg");
  });

  it("is a no-op (no db call) when nothing has an order attachment", async () => {
    const messages = [{ attachment: { type: "image", uri: "x.jpg" } }];
    await expect(enrichOrderAttachments(messages as any)).resolves.toBeUndefined();
  });
});
