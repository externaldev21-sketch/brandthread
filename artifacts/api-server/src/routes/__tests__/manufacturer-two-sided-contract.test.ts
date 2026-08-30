import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSupportedAttachment } from "../manufacturers";
import { isDefinitiveTransferRejection } from "../sample-orders";

const route = fs.readFileSync(path.resolve(__dirname, "..", "manufacturers.ts"), "utf8");
const sampleRoute = fs.readFileSync(path.resolve(__dirname, "..", "sample-orders.ts"), "utf8");
const migration = fs.readFileSync(
  path.resolve(__dirname, "../../../../../lib/db/migrations/046_manufacturer_thread_participant_unread.sql"),
  "utf8",
);

describe("manufacturer two-sided authorization contract", () => {
  it("maintains and clears participant-specific unread counters", () => {
    expect(route).toContain("manufacturerUnreadCount: sql");
    expect(route).toContain("sellerUnreadCount: sql");
    expect(route).toContain(".set({ sellerUnreadCount: 0 })");
    expect(route).toContain(".set({ manufacturerUnreadCount: 0, unreadCount: 0 })");
  });

  it("scopes manufacturer order mutations to the authenticated manufacturer", () => {
    expect(route).toContain("eq(manufacturerOrders.manufacturerId, mfr.id)");
    expect(route).toContain("eq(sampleOrders.manufacturerId, mfr.id)");
    expect(sampleRoute).toContain("if (!isManufacturer)");
  });

  it("uses an idempotent participant-state migration", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS seller_unread_count");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS manufacturer_unread_count");
    expect(migration).toContain("WHERE manufacturer_unread_count = 0");
  });

  it("signs private media only after authorizing a thread and validates uploaded bytes", () => {
    expect(route).toContain("getObjectEntityDownloadURL(value)");
    expect(route).toContain("Promise.all(messages.map(serializeMessage))");
    expect(route).toContain("isSupportedAttachment(req.body, contentType)");
    expect(route).toContain('"%PDF-"');
  });

  it("guards shared order cards and concurrent production changes", () => {
    expect(sampleRoute).toContain("Number.isSafeInteger(priceCents)");
    expect(sampleRoute).toContain("Number.isSafeInteger(quantity)");
    expect(sampleRoute).toContain('eq(manufacturerThreads.buyerClerkId, sellerId)');
    expect(sampleRoute).toContain("eq(sampleOrders.status, current)");
  });

  it("validates actual attachment magic bytes", () => {
    expect(isSupportedAttachment(Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg")).toBe(true);
    expect(isSupportedAttachment(Buffer.from("%PDF-1.7"), "application/pdf")).toBe(true);
    expect(isSupportedAttachment(Buffer.from("not an image"), "image/png")).toBe(false);
    expect(isSupportedAttachment(Buffer.from("%PDF-1.7"), "image/png")).toBe(false);
  });

  it("only releases wallet reservations for definitive Stripe rejections", () => {
    expect(isDefinitiveTransferRejection({ statusCode: 400 })).toBe(true);
    expect(isDefinitiveTransferRejection({ statusCode: 402 })).toBe(true);
    expect(isDefinitiveTransferRejection({ statusCode: 409 })).toBe(false);
    expect(isDefinitiveTransferRejection({ statusCode: 429 })).toBe(false);
    expect(isDefinitiveTransferRejection({ statusCode: 500 })).toBe(false);
    expect(isDefinitiveTransferRejection(new Error("network timeout"))).toBe(false);
  });

  it("guards paid transitions and persists wallet reconciliation identity", () => {
    expect(sampleRoute).toContain('eq(sampleOrders.status, "pending_payment")');
    expect(sampleRoute).toContain('walletPaymentAttemptKey: attemptKey');
    expect(sampleRoute).toContain('idempotencyKey: attemptKey');
    expect(sampleRoute).toContain('order.walletPaymentState === "processing" ? true');
    expect(sampleRoute).toContain('throw new Error("WALLET_FINALIZE_CONFLICT")');
  });

  it("requires complete shipping details before a shared order transition", () => {
    expect(route).toContain('status === "shipped"');
    expect(route).toContain('!req.body.trackingNumber.trim()');
    expect(route).toContain('!req.body.carrier.trim()');
    expect(sampleRoute).toContain('nextStage === "shipped"');
    expect(sampleRoute).toContain("carrier and trackingNumber are required");
  });

  it("rotates expired Checkout sessions with a durable versioned idempotency key", () => {
    expect(sampleRoute).toContain('session.status === "open"');
    expect(sampleRoute).toContain('stripeCheckoutSessionId: null');
    expect(sampleRoute).toContain('checkoutSessionVersion: sql');
    expect(sampleRoute).toContain('sample-order-checkout/${row.order.id}/v${checkoutSessionVersion}');
    expect(sampleRoute).toContain('session.payment_status === "paid" || session.status === "complete"');
  });
});