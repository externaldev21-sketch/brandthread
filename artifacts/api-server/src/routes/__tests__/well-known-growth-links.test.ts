import { describe, expect, it } from "vitest";
import { DEEP_LINK_PATHS } from "../wellKnown";

// BT-311: growth links must open the app, not Safari. Each path has an in-app
// route (mobile app/invite/[code], community-join, live/[streamId], g/[code]).
describe("apple-app-site-association growth paths", () => {
  it("claims referral invites, community invites, live streams and giveaways", () => {
    for (const p of ["/invite/*", "/community-join*", "/live/*", "/g/*"]) {
      expect(DEEP_LINK_PATHS).toContain(p);
    }
  });

  it("keeps every path unique", () => {
    expect(new Set(DEEP_LINK_PATHS).size).toBe(DEEP_LINK_PATHS.length);
  });
});
