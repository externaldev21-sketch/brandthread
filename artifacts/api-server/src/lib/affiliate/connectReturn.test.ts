import { describe, expect, it } from "vitest";
import { creatorConnectLanding, CREATOR_CONNECT_REFRESH_PATH, CREATOR_CONNECT_RETURN_PATH } from "./connectReturn";

describe("creator Stripe Connect return (BT-323)", () => {
  it("uses real API paths, not the /api-server/... URL that 404'd", () => {
    expect(CREATOR_CONNECT_RETURN_PATH).toBe("/api/affiliate/connect/return");
    expect(CREATOR_CONNECT_REFRESH_PATH).toBe("/api/affiliate/connect/refresh");
  });

  it("sends phones back to Creator program in the app and desktops to the web page", () => {
    expect(creatorConnectLanding("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)", "returned")).toBe("brandthread://creator-program?payouts=returned");
    expect(creatorConnectLanding("Mozilla/5.0 (Linux; Android 15)", "refresh")).toBe("brandthread://creator-program?payouts=refresh");
    expect(creatorConnectLanding("Mozilla/5.0 (Macintosh)", "returned")).toMatch(/^https:\/\/.+\/creator-program\?payouts=returned$/);
    expect(creatorConnectLanding(undefined, "returned")).toMatch(/^https:\/\//);
  });
});
