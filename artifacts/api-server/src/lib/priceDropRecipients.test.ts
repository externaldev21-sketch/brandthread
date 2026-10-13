import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async () => ({ ...(await import("@workspace/db/schema")), db: {}, pool: {} }));
vi.mock("../routes/notifications-feed", () => ({ publishNotification: vi.fn() }));

import { priceDropRecipients } from "./stockNotifications";

const row = (userId: string, priceDropAlert: boolean, lastNotifiedPriceCents: number | null) =>
  ({ userId, priceDropAlert, lastNotifiedPriceCents });

describe("priceDropRecipients", () => {
  it("pushes only to buyers who turned the alert on; others get the in-app row", () => {
    expect(priceDropRecipients([row("a", true, 5000), row("b", false, 5000)], 4000)).toEqual([
      { userId: "a", push: true },
      { userId: "b", push: false },
    ]);
  });

  it("skips a drop that isn't below the last price the buyer was told about", () => {
    expect(priceDropRecipients([row("a", true, 4000)], 4000)).toEqual([]);
    expect(priceDropRecipients([row("a", true, 3500)], 4000)).toEqual([]);
  });

  it("notifies when nothing was recorded yet", () => {
    expect(priceDropRecipients([row("a", false, null)], 4000)).toEqual([{ userId: "a", push: false }]);
  });

  it("is empty when nobody saved it", () => {
    expect(priceDropRecipients([], 1000)).toEqual([]);
  });
});
