import { describe, expect, it } from "vitest";
import { deriveLaunchChecklist, LAUNCH_STEP_IDS, type LaunchChecklistInput } from "./launchChecklist";

const empty: LaunchChecklistInput = {
  brandName: null,
  username: null,
  logoUrl: null,
  bannerUrl: null,
  storeAccentColor: null,
  socialLinks: {},
  productCount: 0,
  shippingConfigured: false,
  storePreviewedAt: null,
  storePublished: false,
  stripeAccountStatus: null,
};

const doneIds = (input: LaunchChecklistInput) =>
  deriveLaunchChecklist(input).steps.filter((s) => s.done).map((s) => s.id);

describe("deriveLaunchChecklist", () => {
  it("returns the nine steps in order, all open for a brand-new seller", () => {
    const result = deriveLaunchChecklist(empty);
    expect(result.steps.map((s) => s.id)).toEqual([...LAUNCH_STEP_IDS]);
    expect(result.total).toBe(9);
    expect(result.doneCount).toBe(0);
    expect(result.complete).toBe(false);
  });

  it("needs both a store name and a handle", () => {
    expect(doneIds({ ...empty, brandName: "Atelier" })).toEqual([]);
    expect(doneIds({ ...empty, username: "atelier" })).toEqual([]);
    expect(doneIds({ ...empty, brandName: "  ", username: "atelier" })).toEqual([]);
    expect(doneIds({ ...empty, brandName: "Atelier", username: "atelier" })).toEqual(["name_handle"]);
  });

  it("needs both a logo and a banner", () => {
    expect(doneIds({ ...empty, logoUrl: "/objects/logo" })).toEqual([]);
    expect(doneIds({ ...empty, logoUrl: "/objects/logo", bannerUrl: "/objects/banner" })).toEqual(["logo_banner"]);
  });

  it("marks the accent once a colour is chosen", () => {
    expect(doneIds({ ...empty, storeAccentColor: "#111111" })).toEqual(["accent"]);
  });

  it("accepts an instagram or tiktok link, but not other keys or blanks", () => {
    expect(doneIds({ ...empty, socialLinks: { instagram: "atelier" } })).toEqual(["socials"]);
    expect(doneIds({ ...empty, socialLinks: { tiktok: "atelier" } })).toEqual(["socials"]);
    expect(doneIds({ ...empty, socialLinks: { twitter: "atelier" } })).toEqual([]);
    expect(doneIds({ ...empty, socialLinks: { instagram: "" } })).toEqual([]);
    expect(doneIds({ ...empty, socialLinks: null })).toEqual([]);
  });

  it("tracks product, preview, publish and payouts from their own state", () => {
    expect(doneIds({ ...empty, productCount: 1 })).toEqual(["first_product"]);
    expect(doneIds({ ...empty, shippingConfigured: true })).toEqual(["shipping"]);
    expect(doneIds({ ...empty, storePreviewedAt: new Date() })).toEqual(["preview"]);
    expect(doneIds({ ...empty, storePublished: true })).toEqual(["publish"]);
    expect(doneIds({ ...empty, stripeAccountStatus: "active" })).toEqual(["payouts"]);
    expect(doneIds({ ...empty, stripeAccountStatus: "pending" })).toEqual([]);
    expect(doneIds({ ...empty, stripeAccountStatus: "restricted" })).toEqual([]);
  });

  it("is complete only when every step is done", () => {
    const full: LaunchChecklistInput = {
      brandName: "Atelier",
      username: "atelier",
      logoUrl: "/objects/logo",
      bannerUrl: "/objects/banner",
      storeAccentColor: "#111111",
      socialLinks: { instagram: "atelier" },
      productCount: 3,
      shippingConfigured: true,
      storePreviewedAt: new Date(),
      storePublished: true,
      stripeAccountStatus: "active",
    };
    const result = deriveLaunchChecklist(full);
    expect(result.doneCount).toBe(9);
    expect(result.complete).toBe(true);
    expect(deriveLaunchChecklist({ ...full, storePublished: false }).complete).toBe(false);
  });
});

describe("payouts come after the first product, never first", () => {
  it("orders first product and shipping before payouts", () => {
    const ids = [...LAUNCH_STEP_IDS];
    expect(ids.indexOf("first_product")).toBeLessThan(ids.indexOf("payouts"));
    expect(ids.indexOf("shipping")).toBeLessThan(ids.indexOf("payouts"));
  });
});
