/**
 * Ad Campaign Service Tests — Vitest (matches project test conventions)
 *
 * 5-step contract:
 *   Step 1 — validateMediaStage
 *   Step 2 — validateDescriptionStage  (headline only; NO CTA here)
 *   Step 3 — validateCtaStage          (CTA + optional product destination; NO headline)
 *   Step 4 — validateFormatStage       (format selection; NO output count)
 *   Step 5 — validateBudgetStage       (budget + duration sliders; NO format re-check)
 *
 * Legacy aliases (for backward compat):
 *   validateDetailsStage   → headline + CTA + product (deprecated)
 *   validatePlacementStage → formats + budget + duration (deprecated)
 *
 * Additional tests:
 *   - Reach estimate formula (shared with server)
 *   - Video vs photos mutual exclusivity
 *   - CTA allowlist + product-destination requirement
 *   - Aspect-ratio accuracy of AD_FORMAT_OPTIONS
 *   - Budget steps (slider values — whole dollars only)
 *   - snapBudget snaps to nearest valid step
 *   - File validation (MIME, size, duration)
 *   - Checkout return URL generation contract
 *   - No output count exposed (OUTPUT_COUNT, VARIATION_COUNT, count)
 *   - Constants match server constraints
 */

import { describe, it, expect } from "vitest";
import {
  estimateReach,
  validateMediaStage,
  validateDescriptionStage,
  validateCtaStage,
  validateFormatStage,
  validateBudgetStage,
  validateDetailsStage,
  validatePlacementStage,
  validateImageFile,
  validateVideoFile,
  buildAdCampaignReturnUrl,
  CTA_OPTIONS,
  AD_FORMAT_OPTIONS,
  BUDGET_STEPS,
  BUDGET_MIN_CENTS,
  BUDGET_MAX_CENTS,
  DURATION_MIN_DAYS,
  DURATION_MAX_DAYS,
  MAX_PHOTOS,
  MAX_VIDEO_DURATION_SECONDS,
  snapBudget,
} from "../adCampaignService";

// ─── 5-step contract ──────────────────────────────────────────────────────────

describe("5-step flow contract", () => {
  it("exports validateMediaStage for step 1", () => {
    expect(typeof validateMediaStage).toBe("function");
  });

  it("exports validateDescriptionStage for step 2", () => {
    expect(typeof validateDescriptionStage).toBe("function");
  });

  it("exports validateCtaStage for step 3", () => {
    expect(typeof validateCtaStage).toBe("function");
  });

  it("exports validateFormatStage for step 4", () => {
    expect(typeof validateFormatStage).toBe("function");
  });

  it("exports validateBudgetStage for step 5", () => {
    expect(typeof validateBudgetStage).toBe("function");
  });

  it("step 2 (description) does NOT require a CTA", () => {
    // headline only — CTA is step 3, not step 2
    const result = validateDescriptionStage({ headline: "My ad headline" });
    expect(result.valid).toBe(true);
  });

  it("step 2 (description) does NOT check ctaKind at all", () => {
    // Passing headline without ctaKind must pass step 2
    const result = validateDescriptionStage({ headline: "My ad" });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("step 3 (CTA) does NOT require a headline", () => {
    // step 3 only cares about ctaKind (and product for product CTAs)
    const result = validateCtaStage({ ctaKind: "learn_more" as any });
    expect(result.valid).toBe(true);
  });

  it("step 4 (format) does NOT check budget or duration", () => {
    // format only — budget lives in step 5
    const result = validateFormatStage({ formats: ["square_1x1" as any] });
    expect(result.valid).toBe(true);
  });

  it("step 4 (format) does NOT expose output count", async () => {
    // The validator must not rely on any output count field
    const mod = await import("../adCampaignService");
    expect(mod).not.toHaveProperty("OUTPUT_COUNT");
    expect(mod).not.toHaveProperty("VARIATION_COUNT");
  });

  it("step 5 (budget) does NOT require format re-selection", () => {
    // Budget stage only validates budget + duration; formats were handled in step 4
    const result = validateBudgetStage({ budgetCents: 2500, durationDays: 7 });
    expect(result.valid).toBe(true);
  });

  it("step 5 (budget) fails without budget", () => {
    const result = validateBudgetStage({ durationDays: 7 });
    expect(result.valid).toBe(false);
  });

  it("step 5 (budget) fails without duration", () => {
    const result = validateBudgetStage({ budgetCents: 2500 });
    expect(result.valid).toBe(false);
  });
});

// ─── Reach estimate ───────────────────────────────────────────────────────────

describe("estimateReach", () => {
  it("returns low=35 high=65 per dollar ($1 = 100 cents)", () => {
    const { low, high } = estimateReach(100);
    expect(low).toBe(35);
    expect(high).toBe(65);
  });

  it("is consistent with server formula for $5 (minimum budget)", () => {
    const { low, high } = estimateReach(500);
    expect(low).toBe(175);
    expect(high).toBe(325);
  });

  it("low is always less than high for all valid budgets", () => {
    for (const cents of [500, 2500, 10_000, 100_000]) {
      const { low, high } = estimateReach(cents);
      expect(low).toBeLessThan(high);
    }
  });

  it("uses Math.floor, not round ($2.50 → 87 not 88)", () => {
    // 2.5 * 35 = 87.5 → Math.floor = 87
    expect(estimateReach(250).low).toBe(87);
  });

  it("is proportional to budget (doubles with doubled budget)", () => {
    const r1 = estimateReach(1000);
    const r2 = estimateReach(2000);
    expect(r2.low).toBe(r1.low * 2);
    expect(r2.high).toBe(r1.high * 2);
  });
});

// ─── Step 1: Media ────────────────────────────────────────────────────────────

describe("validateMediaStage", () => {
  it("fails with no media", () => {
    const result = validateMediaStage({ mediaObjectPaths: [], mediaKind: "photos" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("passes with 1 photo", () => {
    const result = validateMediaStage({ mediaObjectPaths: ["/p1"], mediaKind: "photos" });
    expect(result.valid).toBe(true);
  });

  it("passes with 5 photos (maximum)", () => {
    const paths = ["/p1", "/p2", "/p3", "/p4", "/p5"];
    expect(validateMediaStage({ mediaObjectPaths: paths, mediaKind: "photos" }).valid).toBe(true);
  });

  it("fails with 2 items as video kind (only 1 allowed)", () => {
    const result = validateMediaStage({ mediaObjectPaths: ["/v1", "/v2"], mediaKind: "video" });
    expect(result.valid).toBe(false);
  });

  it("passes with exactly 1 video", () => {
    const result = validateMediaStage({ mediaObjectPaths: ["/v1.mp4"], mediaKind: "video" });
    expect(result.valid).toBe(true);
  });
});

// ─── Step 2: Description ──────────────────────────────────────────────────────

describe("validateDescriptionStage", () => {
  it("fails with no headline", () => {
    const result = validateDescriptionStage({ headline: "" });
    expect(result.valid).toBe(false);
  });

  it("fails with whitespace-only headline", () => {
    const result = validateDescriptionStage({ headline: "   " });
    expect(result.valid).toBe(false);
  });

  it("passes with a headline — no CTA required", () => {
    const result = validateDescriptionStage({ headline: "My ad" });
    expect(result.valid).toBe(true);
  });

  it("passes with headline + description — no CTA required", () => {
    const result = validateDescriptionStage({ headline: "My ad", description: "Some description" });
    expect(result.valid).toBe(true);
  });

  it("does not require ctaKind (CTA lives in step 3)", () => {
    // No ctaKind provided — must still pass if headline is present
    const result = validateDescriptionStage({ headline: "My ad" });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ─── Step 3: CTA ─────────────────────────────────────────────────────────────

describe("validateCtaStage", () => {
  it("fails with no CTA", () => {
    const result = validateCtaStage({});
    expect(result.valid).toBe(false);
  });

  it("fails shop_now without a product destination", () => {
    const result = validateCtaStage({ ctaKind: "shop_now" as any });
    expect(result.valid).toBe(false);
  });

  it("passes shop_now with a product destination", () => {
    const result = validateCtaStage({ ctaKind: "shop_now" as any, ctaDestinationId: "prod-uuid" });
    expect(result.valid).toBe(true);
  });

  it("passes learn_more without a product (non-product CTA)", () => {
    const result = validateCtaStage({ ctaKind: "learn_more" as any });
    expect(result.valid).toBe(true);
  });

  it("passes sign_up without product", () => {
    const result = validateCtaStage({ ctaKind: "sign_up" as any });
    expect(result.valid).toBe(true);
  });

  it("passes contact_us without product", () => {
    const result = validateCtaStage({ ctaKind: "contact_us" as any });
    expect(result.valid).toBe(true);
  });

  it("fails view_product without a product destination", () => {
    const result = validateCtaStage({ ctaKind: "view_product" as any });
    expect(result.valid).toBe(false);
  });

  it("passes view_product with a product destination", () => {
    const result = validateCtaStage({ ctaKind: "view_product" as any, ctaDestinationId: "prod-uuid" });
    expect(result.valid).toBe(true);
  });

  it("does NOT require headline (that is step 2)", () => {
    // CTA stage should not re-check headline
    const result = validateCtaStage({ ctaKind: "learn_more" as any });
    expect(result.valid).toBe(true);
  });
});

// ─── Step 4: Output format ────────────────────────────────────────────────────

describe("validateFormatStage", () => {
  it("fails with no formats selected", () => {
    const result = validateFormatStage({ formats: [] });
    expect(result.valid).toBe(false);
  });

  it("passes with one format", () => {
    const result = validateFormatStage({ formats: ["story_9x16" as any] });
    expect(result.valid).toBe(true);
  });

  it("passes with multiple formats", () => {
    const result = validateFormatStage({ formats: ["story_9x16" as any, "square_1x1" as any] });
    expect(result.valid).toBe(true);
  });

  it("does NOT check budget (budget is step 5)", () => {
    // No budgetCents provided — must still pass if format is present
    const result = validateFormatStage({ formats: ["portrait_4x5" as any] });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("does NOT expose any output count field", async () => {
    const mod = await import("../adCampaignService");
    expect(mod).not.toHaveProperty("OUTPUT_COUNT");
    expect(mod).not.toHaveProperty("VARIATION_COUNT");
    expect(mod).not.toHaveProperty("count");
  });
});

// ─── Step 5: Budget & duration ────────────────────────────────────────────────

describe("validateBudgetStage", () => {
  it("fails with budget below minimum", () => {
    const result = validateBudgetStage({ budgetCents: 100, durationDays: 7 });
    expect(result.valid).toBe(false);
  });

  it("fails with duration below minimum", () => {
    const result = validateBudgetStage({ budgetCents: 2500, durationDays: 0 });
    expect(result.valid).toBe(false);
  });

  it("passes with valid budget and duration", () => {
    const result = validateBudgetStage({ budgetCents: 5000, durationDays: 14 });
    expect(result.valid).toBe(true);
  });

  it("passes with minimum valid values", () => {
    const result = validateBudgetStage({ budgetCents: BUDGET_MIN_CENTS, durationDays: DURATION_MIN_DAYS });
    expect(result.valid).toBe(true);
  });

  it("does NOT require formats (formats are step 4)", () => {
    // No formats provided — budget stage must not re-check formats
    const result = validateBudgetStage({ budgetCents: 2500, durationDays: 7 });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ─── Legacy alias: validateDetailsStage ──────────────────────────────────────

describe("validateDetailsStage (legacy alias)", () => {
  it("fails with no headline", () => {
    const result = validateDetailsStage({ headline: "", ctaKind: "shop_now" as any, ctaDestinationId: "pid" });
    expect(result.valid).toBe(false);
  });

  it("fails with no CTA", () => {
    const result = validateDetailsStage({ headline: "My ad" });
    expect(result.valid).toBe(false);
  });

  it("fails shop_now without a product destination", () => {
    const result = validateDetailsStage({ headline: "My ad", ctaKind: "shop_now" as any });
    expect(result.valid).toBe(false);
  });

  it("passes shop_now with a product destination", () => {
    const result = validateDetailsStage({ headline: "My ad", ctaKind: "shop_now" as any, ctaDestinationId: "prod-uuid" });
    expect(result.valid).toBe(true);
  });

  it("passes learn_more without a product (non-product CTA)", () => {
    const result = validateDetailsStage({ headline: "My ad", ctaKind: "learn_more" as any });
    expect(result.valid).toBe(true);
  });

  it("passes sign_up without product", () => {
    const result = validateDetailsStage({ headline: "My ad", ctaKind: "sign_up" as any });
    expect(result.valid).toBe(true);
  });

  it("passes contact_us without product", () => {
    const result = validateDetailsStage({ headline: "My ad", ctaKind: "contact_us" as any });
    expect(result.valid).toBe(true);
  });
});

// ─── Legacy alias: validatePlacementStage ────────────────────────────────────

describe("validatePlacementStage (legacy alias)", () => {
  it("fails with no formats selected", () => {
    const result = validatePlacementStage({ formats: [], budgetCents: 2500, durationDays: 7 });
    expect(result.valid).toBe(false);
  });

  it("fails with budget below minimum", () => {
    const result = validatePlacementStage({ formats: ["story_9x16" as any], budgetCents: 100, durationDays: 7 });
    expect(result.valid).toBe(false);
  });

  it("fails with duration below minimum", () => {
    const result = validatePlacementStage({ formats: ["story_9x16" as any], budgetCents: 2500, durationDays: 0 });
    expect(result.valid).toBe(false);
  });

  it("passes with valid values and multiple formats", () => {
    const result = validatePlacementStage({ formats: ["story_9x16" as any, "square_1x1" as any], budgetCents: 5000, durationDays: 14 });
    expect(result.valid).toBe(true);
  });

  it("passes with minimum valid values", () => {
    const result = validatePlacementStage({ formats: ["square_1x1" as any], budgetCents: BUDGET_MIN_CENTS, durationDays: DURATION_MIN_DAYS });
    expect(result.valid).toBe(true);
  });
});

// ─── CTA allowlist ────────────────────────────────────────────────────────────

describe("CTA_OPTIONS", () => {
  it("has exactly 5 options", () => {
    expect(CTA_OPTIONS).toHaveLength(5);
  });

  it("contains only allowed CTA kinds", () => {
    const allowedKinds = ["shop_now", "learn_more", "view_product", "sign_up", "contact_us"];
    for (const opt of CTA_OPTIONS) {
      expect(allowedKinds).toContain(opt.kind);
    }
  });

  it("shop_now and view_product require product selection", () => {
    const productCtas = CTA_OPTIONS.filter((o) => o.requiresProductSelection);
    expect(productCtas.map((o) => o.kind)).toEqual(expect.arrayContaining(["shop_now", "view_product"]));
    expect(productCtas).toHaveLength(2);
  });

  it("learn_more, sign_up, contact_us do NOT require product selection", () => {
    const free = CTA_OPTIONS.filter((o) => !o.requiresProductSelection);
    expect(free.map((o) => o.kind)).toEqual(expect.arrayContaining(["learn_more", "sign_up", "contact_us"]));
  });

  it("all destinations are valid kind values", () => {
    const validDests = ["product", "store", "profile", "contact"];
    for (const opt of CTA_OPTIONS) {
      expect(validDests).toContain(opt.destinationKind);
    }
  });

  it("has a non-empty label for every option", () => {
    for (const opt of CTA_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
});

// ─── Format aspect ratios ─────────────────────────────────────────────────────

describe("AD_FORMAT_OPTIONS aspect ratios", () => {
  it("has exactly 4 formats", () => {
    expect(AD_FORMAT_OPTIONS).toHaveLength(4);
  });

  it("story_9x16: height > width (vertical silhouette)", () => {
    const fmt = AD_FORMAT_OPTIONS.find((f) => f.kind === "story_9x16")!;
    expect(fmt.ratioH).toBeGreaterThan(fmt.ratioW);
    expect(fmt.aspectRatio).toBe("9:16");
  });

  it("square_1x1: ratioW === ratioH", () => {
    const fmt = AD_FORMAT_OPTIONS.find((f) => f.kind === "square_1x1")!;
    expect(fmt.ratioW).toBe(fmt.ratioH);
    expect(fmt.aspectRatio).toBe("1:1");
  });

  it("portrait_4x5: height is 1.25× width", () => {
    const fmt = AD_FORMAT_OPTIONS.find((f) => f.kind === "portrait_4x5")!;
    expect(fmt.ratioH / fmt.ratioW).toBeCloseTo(5 / 4);
    expect(fmt.aspectRatio).toBe("4:5");
  });

  it("landscape_16x9: width > height (horizontal silhouette)", () => {
    const fmt = AD_FORMAT_OPTIONS.find((f) => f.kind === "landscape_16x9")!;
    expect(fmt.ratioW).toBeGreaterThan(fmt.ratioH);
    expect(fmt.aspectRatio).toBe("16:9");
  });

  it("all formats have non-empty labels, dims, and descriptions", () => {
    for (const fmt of AD_FORMAT_OPTIONS) {
      expect(fmt.label.length).toBeGreaterThan(0);
      expect(fmt.dims.length).toBeGreaterThan(0);
      expect(fmt.description.length).toBeGreaterThan(0);
    }
  });

  it("does not include any unsupported formats", () => {
    const allowed = new Set(AD_FORMAT_OPTIONS.map((f) => f.kind));
    expect(allowed.has("story_9x16")).toBe(true);
    expect(allowed.has("square_1x1")).toBe(true);
    expect(allowed.has("portrait_4x5")).toBe(true);
    expect(allowed.has("landscape_16x9")).toBe(true);
    expect(allowed.has("ad_creative" as any)).toBe(false);
    expect(allowed.has("thread_post" as any)).toBe(false);
  });
});

// ─── Budget steps ─────────────────────────────────────────────────────────────

describe("BUDGET_STEPS (slider values)", () => {
  it("starts at $5 (500 cents)", () => {
    expect(BUDGET_STEPS[0]).toBe(500);
  });

  it("ends at $1000 (100_000 cents)", () => {
    expect(BUDGET_STEPS[BUDGET_STEPS.length - 1]).toBe(100_000);
  });

  it("all steps are integer cents", () => {
    for (const s of BUDGET_STEPS) {
      expect(Number.isInteger(s)).toBe(true);
    }
  });

  it("steps are in ascending order", () => {
    for (let i = 1; i < BUDGET_STEPS.length; i++) {
      expect(BUDGET_STEPS[i]).toBeGreaterThan(BUDGET_STEPS[i - 1]);
    }
  });

  it("all steps are whole-dollar amounts (divisible by 100)", () => {
    for (const s of BUDGET_STEPS) {
      expect(s % 100).toBe(0);
    }
  });

  it("has at least 20 distinct steps", () => {
    expect(BUDGET_STEPS.length).toBeGreaterThanOrEqual(20);
  });
});

describe("snapBudget", () => {
  it("snaps $4.99 (499 cents) to $5 (minimum step)", () => {
    expect(snapBudget(499)).toBe(500);
  });

  it("snaps exact step to itself", () => {
    expect(snapBudget(2500)).toBe(2500);
    expect(snapBudget(10_000)).toBe(10_000);
  });

  it("result is always a valid BUDGET_STEPS entry", () => {
    for (const test of [300, 750, 1100, 7500, 55_000]) {
      expect(BUDGET_STEPS).toContain(snapBudget(test));
    }
  });
});

// ─── File validation ─────────────────────────────────────────────────────────

describe("validateImageFile", () => {
  it("accepts JPEG", () => {
    expect(validateImageFile("image/jpeg", 1024 * 1024).valid).toBe(true);
  });

  it("accepts PNG", () => {
    expect(validateImageFile("image/png", 1024).valid).toBe(true);
  });

  it("accepts WebP", () => {
    expect(validateImageFile("image/webp", 1024).valid).toBe(true);
  });

  it("accepts HEIC", () => {
    expect(validateImageFile("image/heic", 1024).valid).toBe(true);
  });

  it("rejects GIF (not in allowlist)", () => {
    expect(validateImageFile("image/gif", 100).valid).toBe(false);
  });

  it("rejects BMP (not in allowlist)", () => {
    expect(validateImageFile("image/bmp", 100).valid).toBe(false);
  });

  it("rejects files over 20 MB", () => {
    expect(validateImageFile("image/jpeg", 21 * 1024 * 1024).valid).toBe(false);
  });

  it("accepts files exactly at 20 MB", () => {
    expect(validateImageFile("image/jpeg", 20 * 1024 * 1024).valid).toBe(true);
  });
});

describe("validateVideoFile", () => {
  it("accepts MP4", () => {
    expect(validateVideoFile("video/mp4", 10 * 1024 * 1024).valid).toBe(true);
  });

  it("accepts MOV (quicktime)", () => {
    expect(validateVideoFile("video/quicktime", 5 * 1024 * 1024).valid).toBe(true);
  });

  it("accepts AVI", () => {
    expect(validateVideoFile("video/x-msvideo", 5 * 1024 * 1024).valid).toBe(true);
  });

  it("rejects WebM (not in allowlist)", () => {
    expect(validateVideoFile("video/webm", 100).valid).toBe(false);
  });

  it("rejects files over 500 MB", () => {
    expect(validateVideoFile("video/mp4", 501 * 1024 * 1024).valid).toBe(false);
  });

  it("accepts files exactly at 500 MB", () => {
    expect(validateVideoFile("video/mp4", 500 * 1024 * 1024).valid).toBe(true);
  });

  it("rejects videos over 60 seconds", () => {
    expect(validateVideoFile("video/mp4", 10_000, 61).valid).toBe(false);
  });

  it("accepts video exactly at 60 seconds", () => {
    expect(validateVideoFile("video/mp4", 10_000, 60).valid).toBe(true);
  });

  it("accepts videos with no duration supplied", () => {
    expect(validateVideoFile("video/mp4", 10_000, undefined).valid).toBe(true);
  });
});

// ─── Checkout return URL ──────────────────────────────────────────────────────

describe("buildAdCampaignReturnUrl", () => {
  const UUID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  it("generates brandthread:// URL by default (native/Expo)", () => {
    const url = buildAdCampaignReturnUrl(UUID);
    expect(url).toMatch(/^brandthread:\/\/design-campaign\//);
    expect(url).toContain(`id=${UUID}`);
    expect(url).toContain("paymentReturn=1");
  });

  it("generates https web URL when webOrigin is provided", () => {
    const url = buildAdCampaignReturnUrl(UUID, "https://app.brandthread.com");
    expect(url).toMatch(/^https:\/\/app\.brandthread\.com\/design-campaign\?/);
    expect(url).toContain(`id=${UUID}`);
    expect(url).toContain("paymentReturn=1");
  });

  it("URL-encodes the campaign ID", () => {
    const url = buildAdCampaignReturnUrl(UUID);
    expect(url).toContain(encodeURIComponent(UUID));
  });

  it("generated URL matches the server allowlist pattern (design-campaign screen + paymentReturn=1)", () => {
    const url = buildAdCampaignReturnUrl(UUID);
    expect(url).toContain("design-campaign");
    expect(url).toContain("paymentReturn=1");
    expect(url).not.toContain("sample-detail");
  });
});

// ─── No output count exposed ─────────────────────────────────────────────────

describe("No output count exposed", () => {
  it("service does not export OUTPUT_COUNT or VARIATION_COUNT", async () => {
    const mod = await import("../adCampaignService");
    expect(mod).not.toHaveProperty("OUTPUT_COUNT");
    expect(mod).not.toHaveProperty("VARIATION_COUNT");
    expect(mod).not.toHaveProperty("count");
  });

  it("validateFormatStage does not accept or use an output count argument", () => {
    // Passing only formats — no count field should be needed or checked
    const result = validateFormatStage({ formats: ["story_9x16" as any] });
    expect(result.valid).toBe(true);
  });

  it("AD_FORMAT_OPTIONS entries do not have a count property", () => {
    for (const fmt of AD_FORMAT_OPTIONS) {
      expect(fmt).not.toHaveProperty("count");
      expect(fmt).not.toHaveProperty("outputCount");
      expect(fmt).not.toHaveProperty("variationCount");
    }
  });
});

// ─── Constants alignment with server ─────────────────────────────────────────

describe("Client constants match server constraints", () => {
  it("BUDGET_MIN_CENTS is $5 (500 cents)", () => { expect(BUDGET_MIN_CENTS).toBe(500); });
  it("BUDGET_MAX_CENTS is $1000 (100_000 cents)", () => { expect(BUDGET_MAX_CENTS).toBe(100_000); });
  it("DURATION_MIN_DAYS is 1", () => { expect(DURATION_MIN_DAYS).toBe(1); });
  it("DURATION_MAX_DAYS is 30", () => { expect(DURATION_MAX_DAYS).toBe(30); });
  it("MAX_PHOTOS is 5", () => { expect(MAX_PHOTOS).toBe(5); });
  it("MAX_VIDEO_DURATION_SECONDS is 60", () => { expect(MAX_VIDEO_DURATION_SECONDS).toBe(60); });
});
