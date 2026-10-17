import { describe, it, expect, afterEach } from "vitest";
import {
  customDomainRoutingEnabled, hashStorePassword, sanitizeStoreSettingsInput,
  toOwnerStorefront, toPublicStorefront, validateStorePassword, validateStoreSlug,
  verifyStorePassword,
} from "./storeSettingsSecurity";

describe("store password hashing", () => {
  it("hashes with a salt and verifies only the right password", async () => {
    const a = await hashStorePassword("letmein");
    const b = await hashStorePassword("letmein");
    expect(a).not.toContain("letmein");
    expect(a).not.toEqual(b); // per-hash salt
    expect(await verifyStorePassword("letmein", a)).toBe(true);
    expect(await verifyStorePassword("wrong", a)).toBe(false);
    expect(await verifyStorePassword("letmein", null)).toBe(false);
    expect(await verifyStorePassword("letmein", "garbage")).toBe(false);
  });

  it("validates length", () => {
    expect(validateStorePassword("abc")).toMatch(/at least/);
    expect(validateStorePassword("x".repeat(129))).toMatch(/at most/);
    expect(validateStorePassword(42)).toMatch(/string/);
    expect(validateStorePassword("good-pass")).toBeNull();
  });
});

describe("validateStoreSlug", () => {
  it("accepts and normalizes valid slugs", () => {
    expect(validateStoreSlug("  My-Brand1 ")).toEqual({ ok: true, slug: "my-brand1" });
  });
  it.each(["ab", "x".repeat(41), "-abc", "abc-", "a--b", "has space", "under_score", "émoji"])(
    "rejects %s", (slug) => {
      expect(validateStoreSlug(slug).ok).toBe(false);
    },
  );
  it("rejects reserved words", () => {
    const r = validateStoreSlug("admin");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/reserved/);
  });
});

describe("response shaping", () => {
  const row = {
    id: "1", slug: "brand", ownerId: "o",
    storePasswordHash: "scrypt$...",
    sharePreviewTokenHash: "tok",
    sharePreviewRevokedAt: null,
    setupChecklist: { a: true },
    onboarding: {},
    collections: [{ id: "c" }],
    storeSettings: {
      currency: "EUR", language: "fr", contactEmail: "me@x.com", supportEmail: "s@x.com",
      passwordProtected: true, storePassword: "legacy-plain",
    },
  };

  it("owner view drops the hash and any legacy plaintext password", () => {
    const v = toOwnerStorefront(row) as any;
    expect(v.storePasswordHash).toBeUndefined();
    expect(v.hasStorePassword).toBe(true);
    expect(v.storeSettings.storePassword).toBeUndefined();
    expect(v.storeSettings.contactEmail).toBe("me@x.com");
  });

  it("public view exposes only safe settings", () => {
    const v = toPublicStorefront(row) as any;
    expect(v.storePasswordHash).toBeUndefined();
    expect(v.sharePreviewTokenHash).toBeUndefined();
    expect(v.setupChecklist).toBeUndefined();
    expect(v.storeSettings).toEqual({ currency: "EUR", language: "fr" });
    expect(v.collections).toEqual([{ id: "c" }]);
    expect(v.passwordProtected).toBe(true);
    expect(JSON.stringify(v)).not.toContain("me@x.com");
  });

  it("sanitizes storeSettings input", () => {
    expect(sanitizeStoreSettingsInput({ currency: "USD", storePassword: "x", hasStorePassword: true }))
      .toEqual({ currency: "USD" });
  });
});

describe("customDomainRoutingEnabled", () => {
  const prev = process.env.CUSTOM_DOMAIN_ROUTING_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.CUSTOM_DOMAIN_ROUTING_ENABLED;
    else process.env.CUSTOM_DOMAIN_ROUTING_ENABLED = prev;
  });
  it("is off unless explicitly enabled", () => {
    delete process.env.CUSTOM_DOMAIN_ROUTING_ENABLED;
    expect(customDomainRoutingEnabled()).toBe(false);
    process.env.CUSTOM_DOMAIN_ROUTING_ENABLED = "true";
    expect(customDomainRoutingEnabled()).toBe(true);
  });
});
