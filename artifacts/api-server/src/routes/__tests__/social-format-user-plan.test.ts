import { describe, expect, it, vi } from "vitest";

// formatUser is a pure projection; the route module only needs a URL to
// build its (lazy, never-connected) pool at import time.
vi.hoisted(() => { process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/unused"; });

import { PRIVATE_PROFILE_KEYS } from "../../lib/publicProfile";
import { formatUser } from "../social";

// Followers, following, search, suggested, contacts and the social profile
// all select the whole users row and rely on formatUser to pick public
// fields. A seller's plan is owner-only, so it must never survive that pick.
describe("formatUser keeps a seller's plan private", () => {
  it("drops subscription and every other private profile key", () => {
    const row = {
      ...Object.fromEntries(PRIVATE_PROFILE_KEYS.map((k) => [k, `secret-${k}`])),
      clerkId: "user_seller",
      name: "Seller",
      displayName: "Atelier Noire",
      username: "atelier_noire",
      bio: "bio",
      accountType: "seller",
      subscriptionPlanId: "pro",
      subscriptionStatus: "active",
      subscriptionId: "sub_123",
      subscriptionPeriodEnd: new Date(0),
      subscriptionTrialEndsAt: new Date(0),
    } as unknown as Parameters<typeof formatUser>[0];

    const out = formatUser(row) as Record<string, unknown>;
    for (const key of Object.keys(out)) {
      expect(key.toLowerCase()).not.toContain("subscription");
      expect(key.toLowerCase()).not.toContain("plan");
    }
    for (const key of PRIVATE_PROFILE_KEYS) expect(out).not.toHaveProperty(key);
    expect(JSON.stringify(out)).not.toMatch(/secret-|sub_123|"pro"|"active"/);
  });
});
