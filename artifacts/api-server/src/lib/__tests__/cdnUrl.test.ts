import { describe, expect, it } from "vitest";
import { resolveCdnBase, rewriteToCdn } from "../cdnUrl";

describe("resolveCdnBase", () => {
  it("is off when unset, blank or invalid", () => {
    expect(resolveCdnBase({})).toBeNull();
    expect(resolveCdnBase({ CDN_BASE_URL: "  " })).toBeNull();
    expect(resolveCdnBase({ CDN_BASE_URL: "not a url" })).toBeNull();
    expect(resolveCdnBase({ CDN_BASE_URL: "ftp://cdn.test" })).toBeNull();
  });

  it("reads CDN_BASE_URL first, then ASSET_CDN_URL, and trims trailing slashes", () => {
    expect(resolveCdnBase({ CDN_BASE_URL: "https://cdn.test/", ASSET_CDN_URL: "https://other.test" })).toBe("https://cdn.test");
    expect(resolveCdnBase({ ASSET_CDN_URL: "https://assets.test/img//" })).toBe("https://assets.test/img");
  });
});

describe("rewriteToCdn", () => {
  const signed = "https://storage.googleapis.com/bucket/.private/uploads/abc?X-Goog-Signature=1&X-Goog-Expires=900";

  it("returns the url unchanged when no CDN is configured", () => {
    expect(rewriteToCdn(signed, null)).toBe(signed);
  });

  it("swaps only the origin and keeps path and signature", () => {
    expect(rewriteToCdn(signed, "https://cdn.test")).toBe("https://cdn.test/bucket/.private/uploads/abc?X-Goog-Signature=1&X-Goog-Expires=900");
    expect(rewriteToCdn(signed, "https://cdn.test/img")).toBe("https://cdn.test/img/bucket/.private/uploads/abc?X-Goog-Signature=1&X-Goog-Expires=900");
  });

  it("leaves foreign hosts, relative paths and junk alone", () => {
    expect(rewriteToCdn("https://images.shopify.com/a.jpg", "https://cdn.test")).toBe("https://images.shopify.com/a.jpg");
    expect(rewriteToCdn("/objects/uploads/abc", "https://cdn.test")).toBe("/objects/uploads/abc");
    expect(rewriteToCdn("", "https://cdn.test")).toBe("");
  });
});
