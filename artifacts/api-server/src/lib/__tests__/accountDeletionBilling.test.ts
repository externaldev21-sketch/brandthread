import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, sellerSubscriptionEntitlements: {}, users: {} }));
vi.mock("../stripe", () => ({ stripe: null }));

import {
  DELETION_CANCEL_FLAG,
  cancelSubscriptionAtPurge,
  classifyDeletionSubscription,
  deletionSubscriptionCopy,
  resumeRenewalAfterRestore,
  stopRenewalForDeletion,
} from "../accountDeletionBilling";

function subs(sub: Record<string, unknown>) {
  return {
    retrieve: vi.fn(async () => sub),
    update: vi.fn(async () => sub),
    cancel: vi.fn(async () => sub),
  } as any;
}

describe("deletion and the seller subscription (QA-0073)", () => {
  it("classifies the subscription deletion must handle", () => {
    expect(classifyDeletionSubscription({ stripeSubscriptionId: "sub_1", stripeStatus: "active", hasLiveStoreEntitlement: false }))
      .toEqual({ provider: "stripe", subscriptionId: "sub_1" });
    expect(classifyDeletionSubscription({ stripeSubscriptionId: "sub_1", stripeStatus: "canceled", hasLiveStoreEntitlement: false }))
      .toBeNull();
    expect(classifyDeletionSubscription({ stripeSubscriptionId: null, stripeStatus: null, hasLiveStoreEntitlement: true }))
      .toEqual({ provider: "store" });
    expect(classifyDeletionSubscription({ stripeSubscriptionId: null, stripeStatus: null, hasLiveStoreEntitlement: false }))
      .toBeNull();
  });

  it("tells store subscribers to cancel in the store and Stripe subscribers it stops", () => {
    expect(deletionSubscriptionCopy({ provider: "store" }).notice?.title).toMatch(/App Store or Google Play/);
    expect(deletionSubscriptionCopy({ provider: "stripe", subscriptionId: "s" }).willDelete[0]).toMatch(/no further charges/);
    expect(deletionSubscriptionCopy(null)).toEqual({ willDelete: [], notice: null });
  });

  it("stops renewal when deletion is scheduled, tagged so a restore can undo it", async () => {
    const api = subs({ status: "active", cancel_at_period_end: false });
    expect(await stopRenewalForDeletion("sub_1", api)).toBe("stopped");
    expect(api.update).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true, metadata: { [DELETION_CANCEL_FLAG]: "1" } });
  });

  it("leaves a subscription the person already cancelled alone", async () => {
    const api = subs({ status: "active", cancel_at_period_end: true });
    expect(await stopRenewalForDeletion("sub_1", api)).toBe("already_ending");
    expect(api.update).not.toHaveBeenCalled();
  });

  it("surfaces Stripe failures so deletion is not half-done", async () => {
    const api = subs({});
    api.retrieve.mockRejectedValueOnce(Object.assign(new Error("boom"), { statusCode: 500 }));
    await expect(stopRenewalForDeletion("sub_1", api)).rejects.toThrow("boom");
  });

  it("resumes renewal on restore only when deletion stopped it", async () => {
    const ours = subs({ status: "active", metadata: { [DELETION_CANCEL_FLAG]: "1" } });
    expect(await resumeRenewalAfterRestore("sub_1", ours)).toBe(true);
    expect(ours.update).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: false, metadata: { [DELETION_CANCEL_FLAG]: "" } });
    const theirs = subs({ status: "active", metadata: {} });
    expect(await resumeRenewalAfterRestore("sub_1", theirs)).toBe(false);
    expect(theirs.update).not.toHaveBeenCalled();
  });

  it("cancels at purge and tolerates an already-cancelled subscription", async () => {
    const api = subs({});
    await cancelSubscriptionAtPurge("sub_1", api);
    expect(api.cancel).toHaveBeenCalledWith("sub_1");
    api.cancel.mockRejectedValueOnce(Object.assign(new Error("No such subscription"), { code: "resource_missing" }));
    await expect(cancelSubscriptionAtPurge("sub_1", api)).resolves.toBeUndefined();
    api.cancel.mockRejectedValueOnce(Object.assign(new Error("down"), { statusCode: 503 }));
    await expect(cancelSubscriptionAtPurge("sub_1", api)).rejects.toThrow("down");
  });
});
