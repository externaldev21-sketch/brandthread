import { describe, expect, it } from "vitest";
import {
  deriveProductLaunchChecklist, PRODUCT_LAUNCH_CHECK_IDS, type ProductLaunchChecklistInput,
} from "./productLaunchChecklist";

const now = new Date("2026-10-13T12:00:00Z");
const ready: ProductLaunchChecklistInput = {
  imageCount: 4,
  variants: [{ priceCents: 4500, stock: 3, size: "M", color: null }],
  isPreOrder: false,
  description: "Heavyweight cotton tee.",
  hasShipping: true,
  stripeAccountStatus: "active",
  launchAt: new Date("2026-10-14T19:00:00Z"),
  notifyFollowers: true,
  followerCount: 120,
  now,
};
const open = (input: ProductLaunchChecklistInput) =>
  deriveProductLaunchChecklist(input).items.filter((i) => !i.done).map((i) => i.id);

describe("deriveProductLaunchChecklist", () => {
  it("is fully ready with every check done, in a fixed order", () => {
    const c = deriveProductLaunchChecklist(ready);
    expect(c.items.map((i) => i.id)).toEqual([...PRODUCT_LAUNCH_CHECK_IDS]);
    expect(c.readyCount).toBe(c.total);
    expect(c.total).toBe(9);
    expect(c.canSchedule).toBe(true);
    expect(c.blockers).toEqual([]);
    expect(c.followerCount).toBe(120);
  });

  it("blocks on no photos, no price and payouts off — and only those", () => {
    const c = deriveProductLaunchChecklist({
      ...ready, imageCount: 0, variants: [{ priceCents: 0, stock: 0, size: null, color: null }],
      description: "  ", hasShipping: false, stripeAccountStatus: "pending", launchAt: null, notifyFollowers: false,
    });
    expect(c.readyCount).toBe(0);
    expect(c.blockers).toEqual(["photos", "price", "payouts"]);
    expect(c.canSchedule).toBe(false);
    for (const item of c.items) expect(item.blocking).toBe(["photos", "price", "payouts"].includes(item.id));
  });

  it("one or two photos is a warning, not a blocker", () => {
    const c = deriveProductLaunchChecklist({ ...ready, imageCount: 2 });
    expect(open({ ...ready, imageCount: 2 })).toEqual(["photos"]);
    expect(c.canSchedule).toBe(true);
    expect(c.imageCount).toBe(2);
  });

  it("no variants at all means no price (blocker) and no sizes", () => {
    const c = deriveProductLaunchChecklist({ ...ready, variants: [] });
    expect(c.blockers).toEqual(["price"]);
    expect(open({ ...ready, variants: [] })).toEqual(["price", "stock", "variants"]);
  });

  it("stock is satisfied by any variant in stock or by pre-order", () => {
    const soldOut = [{ priceCents: 4500, stock: 0, size: "S", color: null }, { priceCents: 4500, stock: 0, size: "M", color: null }];
    expect(open({ ...ready, variants: soldOut })).toEqual(["stock"]);
    expect(open({ ...ready, variants: soldOut, isPreOrder: true })).toEqual([]);
    expect(open({ ...ready, variants: [...soldOut, { priceCents: 4500, stock: 1, size: "L", color: null }] })).toEqual([]);
  });

  it("sizes/colors count when any variant has one", () => {
    expect(open({ ...ready, variants: [{ priceCents: 4500, stock: 3, size: null, color: "Black" }] })).toEqual([]);
    expect(open({ ...ready, variants: [{ priceCents: 4500, stock: 3, size: "", color: null }] })).toEqual(["variants"]);
  });

  it("launch time must be in the future; followers follow the toggle", () => {
    expect(open({ ...ready, launchAt: new Date(now.getTime() - 1000) })).toEqual(["launch_time"]);
    expect(open({ ...ready, launchAt: now })).toEqual(["launch_time"]);
    expect(open({ ...ready, notifyFollowers: false })).toEqual(["followers"]);
    expect(deriveProductLaunchChecklist({ ...ready, launchAt: null, notifyFollowers: false }).canSchedule).toBe(true);
  });

  it("payouts reuse the store checklist rule (active only)", () => {
    for (const status of [null, "pending", "restricted"]) {
      expect(deriveProductLaunchChecklist({ ...ready, stripeAccountStatus: status }).blockers).toEqual(["payouts"]);
    }
  });
});
