/**
 * Express matches routes case-insensitively and ignores trailing / doubled
 * slashes, so a kill switch must match the same canonical path, or a variant
 * spelling walks past a paused switch and still reaches the handler.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: {} }));

import { switchFor } from "../killSwitches";

describe("switchFor path variants (audit)", () => {
  it("guards case and slash variants of a paused entry point", () => {
    expect(switchFor("POST", "/Buyer/Checkout/Session")).toBe("paymentsEnabled");
    expect(switchFor("POST", "/buyer//checkout/session")).toBe("paymentsEnabled");
    expect(switchFor("POST", "/GIFT-CARDS/purchase//")).toBe("paymentsEnabled");
    expect(switchFor("POST", "/Live/Start")).toBe("liveEnabled");
    expect(switchFor("POST", "/LOGO/generate")).toBe("aiEnabled");
  });

  it("keeps the AI credit-pack exemption and unguarded paths unchanged", () => {
    expect(switchFor("POST", "/AI/Credits/purchase")).toBeNull();
    expect(switchFor("POST", "/live/abc/end")).toBeNull();
    expect(switchFor("GET", "/Buyer/Checkout/Session")).toBeNull();
  });
});
