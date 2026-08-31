import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canManufacturerTransitionQuote } from "../manufacturers";
import { canSellerTransitionQuote } from "../seller-hub";

const publicRoute = fs.readFileSync(path.resolve(__dirname, "..", "manufacturer-public.ts"), "utf8");
const manufacturerRoute = fs.readFileSync(path.resolve(__dirname, "..", "manufacturers.ts"), "utf8");
const sellerHubRoute = fs.readFileSync(path.resolve(__dirname, "..", "seller-hub.ts"), "utf8");
const migration = fs.readFileSync(
  path.resolve(__dirname, "../../../../../lib/db/migrations/055_manufacturer_reviews_and_quotes.sql"),
  "utf8",
);

describe("Manufacturer Hub live-data contract", () => {
  it("allows only seller quote transitions appropriate to the current state", () => {
    expect(canSellerTransitionQuote("submitted", "cancelled")).toBe(true);
    expect(canSellerTransitionQuote("submitted", "accepted")).toBe(false);
    expect(canSellerTransitionQuote("quoted", "accepted")).toBe(true);
    expect(canSellerTransitionQuote("quoted", "counteroffer_sent")).toBe(true);
    expect(canSellerTransitionQuote("accepted", "cancelled")).toBe(false);
  });

  it("allows only the owning manufacturer to progress its quote inbox", () => {
    expect(canManufacturerTransitionQuote("submitted", "quoted")).toBe(true);
    expect(canManufacturerTransitionQuote("counteroffer_sent", "quoted")).toBe(true);
    expect(canManufacturerTransitionQuote("accepted", "declined")).toBe(false);
    expect(manufacturerRoute).toContain("eq(sellerQuoteRequests.manufacturerId, mfr.id)");
    expect(manufacturerRoute).toContain("eq(sellerQuoteRequests.status, existing.status)");
  });

  it("keeps seller relationships and quote reads scoped to the authenticated identity", () => {
    expect(manufacturerRoute).toContain("eq(manufacturerRelationships.sellerId, sellerId)");
    expect(sellerHubRoute).toContain("eq(sellerQuoteRequests.sellerId, sellerId)");
    expect(sellerHubRoute).toContain("A canonical manufacturerId and productName are required");
  });

  it("requires an owned completed order and prevents duplicate manufacturer reviews", () => {
    expect(publicRoute).toContain("eq(sampleOrders.sellerId, userId)");
    expect(publicRoute).toContain("eq(sampleOrders.manufacturerId, manufacturerId)");
    expect(publicRoute).toContain("A completed manufacturer order or delivered sample is required");
    expect(publicRoute).toContain('error?.code === "23505"');
    expect(migration).toContain("CHECK (rating BETWEEN 1 AND 5)");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS manufacturer_reviews_order_unique");
  });

  it("derives directory rating and counts from persisted reviews", () => {
    expect(publicRoute).toContain("getReviewSummaries");
    expect(publicRoute).toContain("round(avg(");
    expect(publicRoute).toContain("reviewCount:");
    expect(migration).toContain("AVG(r.rating) * 100");
  });
});