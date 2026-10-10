import { describe, expect, it } from "vitest";
import { normalizeStoreSlug, storeHostingFlags, storeLiveUrl } from "./storeAddress";

describe("store address (BT-307/316/317/318)", () => {
  it("validates subdomains and strips a pasted .brandthread.app (no doubled domain)", () => {
    expect(normalizeStoreSlug("Northline")).toEqual({ ok: true, slug: "northline" });
    expect(normalizeStoreSlug("northline.brandthread.app")).toEqual({ ok: true, slug: "northline" });
    for (const bad of ["ab", "-north", "north-", "no--rth", "nor th", "www", "api", "x".repeat(41), 5, null]) {
      expect(normalizeStoreSlug(bad).ok).toBe(false);
    }
  });

  it("is honest about what is switched on", () => {
    expect(storeHostingFlags({})).toEqual({ subdomainsLive: false, customDomainsLive: false, cnameTarget: null });
    // Custom domains need a CNAME target to point at, or they stay off.
    expect(storeHostingFlags({ CUSTOM_DOMAINS_ENABLED: "true" }).customDomainsLive).toBe(false);
    expect(storeHostingFlags({ CUSTOM_DOMAINS_ENABLED: "true", CUSTOM_DOMAIN_CNAME_TARGET: "Stores.Brandthread.app" }))
      .toEqual({ subdomainsLive: false, customDomainsLive: true, cnameTarget: "stores.brandthread.app" });
  });

  it("shares the subdomain only once it serves the store, else the link that works", () => {
    const off = storeHostingFlags({});
    const on = storeHostingFlags({ STORE_SUBDOMAINS_ENABLED: "true" });
    expect(storeLiveUrl({ slug: "northline", username: "NorthLine" }, off, "https://brandthread.app")).toBe("https://brandthread.app/store/northline");
    expect(storeLiveUrl({ slug: "northline", username: null }, off, "https://brandthread.app")).toBe("https://brandthread.app/api/store/site/northline");
    expect(storeLiveUrl({ slug: "northline", username: "x" }, on)).toBe("https://northline.brandthread.app");
  });
});
