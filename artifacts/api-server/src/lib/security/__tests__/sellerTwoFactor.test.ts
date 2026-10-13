import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: vi.fn() } } }));
vi.mock("../../threadCash/wallet", () => ({ isFeatureEnabled: async () => false }));

import { requireSellerTwoFactor, sellerTwoFactorSatisfied, TWO_FACTOR_REQUIRED_BODY, type TwoFactorDeps } from "../sellerTwoFactor";

const deps = (flag: boolean, twoFactor: boolean | Error): TwoFactorDeps => ({
  flagEnabled: async () => flag,
  twoFactorEnabled: async () => { if (twoFactor instanceof Error) throw twoFactor; return twoFactor; },
});

function run(d: TwoFactorDeps, userId: string | null = "seller_1") {
  const res: any = { statusCode: 200, body: undefined, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  const next = vi.fn();
  return requireSellerTwoFactor(d)({ clerkUserId: userId ?? undefined } as any, res, next).then(() => ({ res, next }));
}

describe("sellerTwoFactorSatisfied", () => {
  it("lets everyone through while the flag is off", async () => {
    expect(await sellerTwoFactorSatisfied("u", deps(false, false))).toBe(true);
  });
  it("treats an unreadable flag as off", async () => {
    expect(await sellerTwoFactorSatisfied("u", { flagEnabled: async () => { throw new Error("db"); }, twoFactorEnabled: async () => false })).toBe(true);
  });
  it("requires 2FA once the flag is on", async () => {
    expect(await sellerTwoFactorSatisfied("u", deps(true, false))).toBe(false);
    expect(await sellerTwoFactorSatisfied("u", deps(true, true))).toBe(true);
  });
});

describe("requireSellerTwoFactor", () => {
  it("passes a seller with 2FA on", async () => {
    const { res, next } = await run(deps(true, true));
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
  it("refuses a seller without 2FA and points to Login methods", async () => {
    const { res, next } = await run(deps(true, false));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(TWO_FACTOR_REQUIRED_BODY);
    expect(res.body.setupRoute).toBe("/login-methods");
  });
  it("fails closed with 503 when Clerk can't be reached", async () => {
    const { res, next } = await run(deps(true, new Error("clerk down")));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
  });
  it("401 without a user", async () => {
    const { res } = await run(deps(true, true), null);
    expect(res.statusCode).toBe(401);
  });
});
