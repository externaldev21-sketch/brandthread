import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSupportedAttachment } from "../manufacturers";
import { isDefinitiveTransferRejection } from "../sample-orders";
import { connectReadiness, isAllowedOnboardingUrl } from "../manufacturer-connect";
import { isAllowedCheckoutReturnUrl } from "../sample-orders";
import { getWebOrigin } from "../../lib/webOrigin";
import { CALL_TOKEN_TTL_SECONDS, isAuthorizedManufacturerThreadParticipant, isValidCallClientEventId } from "../call";
import { reversalDeltaCents } from "../webhooks";

const route = fs.readFileSync(path.resolve(__dirname, "..", "manufacturers.ts"), "utf8");
const sampleRoute = fs.readFileSync(path.resolve(__dirname, "..", "sample-orders.ts"), "utf8");
const migration = fs.readFileSync(
  path.resolve(__dirname, "../../../../../lib/db/migrations/046_manufacturer_thread_participant_unread.sql"),
  "utf8",
);
const paymentCallMigration = fs.readFileSync(
  path.resolve(__dirname, "../../../../../lib/db/migrations/050_manufacturer_payment_call_events.sql"),
  "utf8",
);
const sharedContractMigration = fs.readFileSync(
  path.resolve(__dirname, "../../../../../lib/db/migrations/052_manufacturer_shared_contracts.sql"),
  "utf8",
);
const publicRoute = fs.readFileSync(path.resolve(__dirname, "..", "manufacturer-public.ts"), "utf8");
const openApi = fs.readFileSync(
  path.resolve(__dirname, "../../../../../lib/api-spec/openapi.yaml"),
  "utf8",
);
const connectRoute = fs.readFileSync(path.resolve(__dirname, "..", "manufacturer-connect.ts"), "utf8");
const webhookRoute = fs.readFileSync(path.resolve(__dirname, "..", "webhooks.ts"), "utf8");

describe("manufacturer two-sided authorization contract", () => {
  it("maintains and clears participant-specific unread counters", () => {
    expect(route).toContain("manufacturerUnreadCount: sql");
    expect(route).toContain("sellerUnreadCount: sql");
    expect(route).toContain(".set({ sellerUnreadCount: 0 })");
    expect(route).toContain(".set({ manufacturerUnreadCount: 0, unreadCount: 0 })");
  });

  it("scopes manufacturer order mutations to the authenticated manufacturer", () => {
    expect(route).toContain("eq(sampleOrders.manufacturerId, mfr.id)");
    expect(sampleRoute).toContain("if (!isManufacturer)");
    expect(openApi).not.toContain("/manufacturers/me/orders:");
    expect(route).not.toContain('router.get("/me/orders"');
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
    expect(sampleRoute).toContain("CreateProductionOrderBody.safeParse(req.body)");
    expect(sampleRoute).toContain('eq(manufacturerThreads.buyerClerkId, sellerId)');
    expect(sampleRoute).toContain("eq(sampleOrders.status, current)");
  });

  it("persists canonical relationships and idempotency identities", () => {
    expect(sharedContractMigration).toContain("manufacturer_relationships");
    expect(sharedContractMigration).toContain("manufacturer_messages_sender_request_unique");
    expect(sharedContractMigration).toContain("sample_orders_seller_request_unique");
    expect(route).toContain("manufacturerRelationships");
    expect(route).toContain("senderClerkId: sellerId");
    expect(route).toContain("senderClerkId: userId");
    expect(sampleRoute).toContain("clientRequestId");
    expect(connectRoute).toContain("manufacturer-connect-account/${mfr.id}");
  });

  it("keeps unauthenticated applications private and public DTOs contact-safe", () => {
    expect(publicRoute).toContain('status:            "pending"');
    expect(publicRoute).toContain("isPublicDirectory: false");
    expect(publicRoute).not.toContain("contactEmail:    manufacturers.contactEmail");
    expect(publicRoute).not.toContain("contactPhone:    manufacturers.contactPhone");
    expect(openApi).toContain("ManufacturerApplicationReceipt");
    expect(openApi).toContain("published: { type: boolean, const: false }");
  });

  it("requires optimistic concurrency tokens for profile and production changes", () => {
    expect(openApi).toContain("required: [expectedRevision]");
    expect(openApi).toContain("required: [status, expectedRevision]");
    expect(route).toContain("eq(manufacturers.revision, expectedRevision)");
    expect(route).toContain("eq(sampleOrders.revision, expectedRevision)");
    expect(sharedContractMigration).toContain("revision INTEGER NOT NULL DEFAULT 1");
    expect(route).toContain('code: "STALE_WRITE"');
  });

  it("binds shared order cards to the authenticated thread participants", () => {
    expect(route).toContain("cardIsBoundToThread");
    expect(route).toContain("eq(sampleOrders.threadId, threadId)");
    expect(route).toContain("eq(sampleOrders.manufacturerId, manufacturerId)");
    expect(route).toContain("eq(sampleOrders.sellerId, sellerId)");
    expect(route).toContain("Order cards must reference an order in this thread");
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

  it("does not report incomplete manufacturer payout accounts as ready", () => {
    expect(connectReadiness({
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: true,
      requirements: { currently_due: ["external_account"] },
    })).toMatchObject({
      ready: false,
      status: "restricted",
      requirementsDue: ["external_account"],
    });
    expect(connectReadiness({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
    }).ready).toBe(true);
  });

  it("rejects unauthorized manufacturer call participants and keeps credentials short-lived", () => {
    const thread = { buyerClerkId: "seller_1", manufacturerClerkId: "manufacturer_1" };
    expect(isAuthorizedManufacturerThreadParticipant("seller_1", thread)).toBe(true);
    expect(isAuthorizedManufacturerThreadParticipant("manufacturer_1", thread)).toBe(true);
    expect(isAuthorizedManufacturerThreadParticipant("intruder", thread)).toBe(false);
    expect(isAuthorizedManufacturerThreadParticipant("intruder", null)).toBe(false);
    expect(CALL_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(15 * 60);
  });

  it("uses the same full Stripe readiness truth in account webhooks", () => {
    expect(webhookRoute).toContain("connectReadiness(account)");
    expect(webhookRoute).toContain("paymentSetup: manufacturerReadiness.ready");
    expect(route).not.toContain(".set({ paymentSetup: true");
  });

  it("only accepts first-party Connect onboarding return and refresh URLs", () => {
    expect(isAllowedOnboardingUrl("brandthread://payouts/complete")).toBe(true);
    expect(isAllowedOnboardingUrl("brandthread://payouts/refresh")).toBe(true);
    expect(isAllowedOnboardingUrl("brandthread://attacker.example/complete")).toBe(false);
    expect(isAllowedOnboardingUrl("brandthread://payouts/complete/extra")).toBe(false);
    expect(isAllowedOnboardingUrl("brandthread://user@payouts/complete")).toBe(false);
    expect(isAllowedOnboardingUrl("https://evil.example/redirect")).toBe(false);
    expect(isAllowedOnboardingUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedOnboardingUrl(`${new URL(getWebOrigin()).origin}/arbitrary`)).toBe(false);
    expect(connectRoute).toContain("isAllowedOnboardingUrl(refreshUrl)");
    expect(connectRoute).toContain("isAllowedOnboardingUrl(returnUrl)");
  });

  it("only accepts the canonical sample-checkout callback and required query", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(isAllowedCheckoutReturnUrl(`brandthread://sample-detail?id=${id}&paymentReturn=1`)).toBe(true);
    expect(isAllowedCheckoutReturnUrl(`brandthread://attacker/sample-detail?id=${id}&paymentReturn=1`)).toBe(false);
    expect(isAllowedCheckoutReturnUrl(`brandthread://sample-detail?id=${id}&paymentReturn=1&next=https://evil.example`)).toBe(false);
    expect(isAllowedCheckoutReturnUrl(`brandthread://sample-detail?id=not-an-order&paymentReturn=1`)).toBe(false);
    expect(isAllowedCheckoutReturnUrl(`brandthread://sample-detail?id=${id}&id=22222222-2222-4222-8222-222222222222&paymentReturn=1`)).toBe(false);
    expect(isAllowedCheckoutReturnUrl(`brandthread://sample-detail?id=${id}&paymentReturn=1&paymentReturn=0`)).toBe(false);
    const origin = new URL(getWebOrigin()).origin;
    expect(isAllowedCheckoutReturnUrl(`${origin}/sample-detail?id=${id}&id=22222222-2222-4222-8222-222222222222&paymentReturn=1`)).toBe(false);
  });

  it("reconciles partial transfer reversals exactly once into review state", () => {
    expect(reversalDeltaCents(300, 100, 1_000)).toBe(200);
    expect(reversalDeltaCents(1_200, 300, 1_000)).toBe(700);
    expect(reversalDeltaCents(300, 300, 1_000)).toBe(0);
    expect(webhookRoute).toContain("FOR UPDATE");
    expect(webhookRoute).toContain('paymentReviewState: reviewState');
    expect(webhookRoute).toContain('walletPaymentState: "reversed"');
    expect(paymentCallMigration).toContain("payment_review_state");
  });

  it("reconciles partial, full, and replayed destination-charge reversals without wallet mutation", () => {
    expect(reversalDeltaCents(250, 0, 1_000)).toBe(250);
    expect(reversalDeltaCents(1_000, 250, 1_000)).toBe(750);
    expect(reversalDeltaCents(1_000, 1_000, 1_000)).toBe(0);
    expect(webhookRoute).toContain('case "charge.refunded"');
    expect(webhookRoute).toContain('source: "dispute"');
    expect(webhookRoute).toContain("handleManufacturerCardReversal");
    expect(webhookRoute).toContain("stripeChargeId: input.chargeId");
    expect(webhookRoute).toContain("onConflictDoNothing({ target: manufacturerActivityEvents.providerEventId })");
  });

  it("requires a stable client event id and safely identifies call-event replays", () => {
    expect(isValidCallClientEventId("call_evt_123")).toBe(true);
    expect(isValidCallClientEventId("short")).toBe(false);
    expect(isValidCallClientEventId("bad event id")).toBe(false);
    const callRoute = fs.readFileSync(path.resolve(__dirname, "..", "call.ts"), "utf8");
    expect(callRoute).toContain("clientEventId");
    expect(callRoute).toContain("providerEventId = `call:${threadId}:${callerId}:${clientEventId}`");
    expect(callRoute).toContain("duplicate: true");
    expect(callRoute).toContain("if (!recorded)");
  });

  it("keeps ordinary buyer and seller conversation calls backward compatible", () => {
    const callRoute = fs.readFileSync(path.resolve(__dirname, "..", "call.ts"), "utf8");
    const mobileCall = fs.readFileSync(path.resolve(__dirname, "../../../../mobile/app/call-screen.tsx"), "utf8");
    expect(callRoute).toContain("conversationParticipants");
    expect(callRoute).toContain('channelPrefix = "call"');
    expect(callRoute).toContain("`call_${threadId}`");
    expect(callRoute).toContain("if (thread)");
    expect(mobileCall).toContain("params.manufacturerCall === '1'");
  });

  it("accepts webhook-before-response wallet reconciliation with one notification owner", () => {
    expect(sampleRoute).toContain('eq(sampleOrders.status, "payment_received")');
    expect(sampleRoute).toContain('eq(sampleOrders.walletPaymentState, "paid")');
    expect(sampleRoute).toContain("eq(sampleOrders.stripeTransferId, stripeTransferId)");
    expect(sampleRoute).toContain("ownsNotification: !!notificationOwner");
    expect(sampleRoute).toContain("reconciliation.ownsNotification");
    expect(webhookRoute).toContain('providerEventId: `transfer:${transfer.id}`');
    expect(webhookRoute).toContain("notificationOwner: \"webhook\"");
    expect(webhookRoute).toContain("if (ownsNotification)");
  });
});