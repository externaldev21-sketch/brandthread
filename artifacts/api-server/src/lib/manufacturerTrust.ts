/**
 * Manufacturer trust rules shared by the manufacturer, seller-hub, public
 * directory, Stripe webhook and admin routes:
 *
 *  - Manufacturer Terms (versioned; accepted at registration).
 *  - Light vetting: 'pending_verification' → 'verified' automatically once the
 *    account email is verified, a phone number is on file and Stripe payouts
 *    are ready with nothing past due; admins can approve or reject.
 *  - Contact reveal: website / email / phone stay hidden from a seller until
 *    the pair has at least one paid order card.
 *  - Directory visibility: sellers see verified public listings plus
 *    manufacturers they already have a relationship with.
 *  - Chat filter: off-platform contact / payment steering is masked before the
 *    pair's first paid order and logged for admins.
 */
import { clerkClient } from "@clerk/express";
import {
  db,
  manufacturerContactSignals,
  manufacturerInviteTokens,
  manufacturerMessages,
  manufacturerRelationships,
  manufacturerThreads,
  manufacturers,
  sampleOrders,
} from "@workspace/db";
import { and, eq, exists, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  OFF_PLATFORM_PAYMENT_KINDS,
  detectOffPlatformContact,
  maskOffPlatformContact,
  type OffPlatformKind,
} from "./contentModerator";
import { postThreadSystemMessage } from "./manufacturerOrders";
import { logger } from "./logger";

// ─── Manufacturer Terms ───────────────────────────────────────────────────────

/**
 * Must equal the `Version:` header of
 * artifacts/mobile/content/legal/manufacturer-terms.md (a test checks it).
 * Bump both together when the terms change materially.
 */
export const MANUFACTURER_TERMS_VERSION = "2026-10-10";

/** legal_acceptances.version value, namespaced so it never collides with the member terms version. */
export function manufacturerTermsAcceptanceVersion(version = MANUFACTURER_TERMS_VERSION): string {
  return `manufacturer-terms/${version}`;
}

export function acceptedCurrentManufacturerTerms(body: unknown): boolean {
  const value = (body as { acceptedTermsVersion?: unknown } | null | undefined)?.acceptedTermsVersion;
  return value === MANUFACTURER_TERMS_VERSION;
}

export const MANUFACTURER_TERMS_REQUIRED = {
  error: "Agree to the Manufacturer Terms to continue.",
  code: "TERMS_REQUIRED",
  termsVersion: MANUFACTURER_TERMS_VERSION,
} as const;

// ─── Paid orders between a seller and a manufacturer ──────────────────────────

/** Order statuses that mean the seller has paid the card. */
export const PAID_ORDER_STATUSES = [
  "payment_received", "processing", "cut_and_sew", "packing", "shipped", "delivered",
  "review_needed", "approved", "rejected", "revision_requested", "completed", "complete",
] as const;

export async function hasPaidOrderBetween(sellerId: string, manufacturerId: string): Promise<boolean> {
  const [row] = await db.select({ id: sampleOrders.id }).from(sampleOrders).where(and(
    eq(sampleOrders.sellerId, sellerId),
    eq(sampleOrders.manufacturerId, manufacturerId),
    inArray(sampleOrders.status, [...PAID_ORDER_STATUSES]),
  )).limit(1);
  return !!row;
}

/** The subset of manufacturerIds the seller has paid at least one order card with. */
export async function paidManufacturerIdsForSeller(sellerId: string | null | undefined, manufacturerIds: string[]): Promise<Set<string>> {
  if (!sellerId || manufacturerIds.length === 0) return new Set();
  const rows = await db.selectDistinct({ manufacturerId: sampleOrders.manufacturerId }).from(sampleOrders).where(and(
    eq(sampleOrders.sellerId, sellerId),
    inArray(sampleOrders.manufacturerId, [...new Set(manufacturerIds)]),
    inArray(sampleOrders.status, [...PAID_ORDER_STATUSES]),
  ));
  return new Set(rows.map((row) => row.manufacturerId));
}

type ContactFields = {
  website?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  description?: string | null;
};

/**
 * Contact details a seller may see. Before the first paid order: website,
 * email and phone are withheld and contact details written into the
 * description are masked.
 */
export function contactFieldsForViewer<T extends ContactFields>(row: T, revealed: boolean) {
  if (revealed) {
    return {
      website: row.website ?? null,
      contactEmail: row.contactEmail ?? null,
      contactPhone: row.contactPhone ?? null,
      description: row.description ?? null,
      contactHidden: false,
    };
  }
  return {
    website: null,
    contactEmail: null,
    contactPhone: null,
    description: row.description ? maskOffPlatformContact(row.description) : row.description ?? null,
    contactHidden: true,
  };
}

// ─── Directory visibility ─────────────────────────────────────────────────────

export const VERIFICATION_STATUSES = ["pending_verification", "verified", "rejected"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Listed in the public directory: active, opted in, and verified. */
export function publicDirectoryCondition(): SQL {
  return and(
    eq(manufacturers.status, "active"),
    eq(manufacturers.isPublicDirectory, true),
    eq(manufacturers.verificationStatus, "verified"),
  )!;
}

/** The seller already works with this manufacturer (relationship, invite, thread or order). */
export function sellerRelationshipCondition(sellerId: string): SQL {
  return or(
    exists(db.select({ one: sql`1` }).from(manufacturerRelationships).where(and(
      eq(manufacturerRelationships.manufacturerId, manufacturers.id),
      eq(manufacturerRelationships.sellerId, sellerId),
    ))),
    exists(db.select({ one: sql`1` }).from(manufacturerInviteTokens).where(and(
      eq(manufacturerInviteTokens.manufacturerId, manufacturers.id),
      eq(manufacturerInviteTokens.sellerId, sellerId),
    ))),
    exists(db.select({ one: sql`1` }).from(manufacturerThreads).where(and(
      eq(manufacturerThreads.manufacturerId, manufacturers.id),
      eq(manufacturerThreads.buyerClerkId, sellerId),
    ))),
    exists(db.select({ one: sql`1` }).from(sampleOrders).where(and(
      eq(sampleOrders.manufacturerId, manufacturers.id),
      eq(sampleOrders.sellerId, sellerId),
    ))),
  )!;
}

/** Manufacturers a seller may browse or send a request to. */
export function visibleToSellerCondition(sellerId: string): SQL {
  return and(
    eq(manufacturers.status, "active"),
    or(
      and(eq(manufacturers.isPublicDirectory, true), eq(manufacturers.verificationStatus, "verified")),
      sellerRelationshipCondition(sellerId),
    ),
  )!;
}

// ─── Light vetting ────────────────────────────────────────────────────────────

export type VerificationGap = "email" | "phone" | "payouts";

type StripeAccountLike = {
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  capabilities?: { transfers?: string | null; card_payments?: string | null } | null;
  tos_acceptance?: { service_agreement?: string | null } | null;
  requirements?: { currently_due?: string[] | null; past_due?: string[] | null; disabled_reason?: string | null } | null;
};

/**
 * Stripe side of the rule: the account can receive funds and pay out, and
 * nothing is past due. Cross-border "recipient" accounts never get
 * charges_enabled (they receive transfers), so the transfers capability counts
 * for them, matching connectReadiness() in routes/manufacturer-connect.ts.
 */
export function stripeAccountVerified(account: StripeAccountLike): boolean {
  const recipient = account.tos_acceptance?.service_agreement === "recipient";
  const canReceive = recipient ? account.capabilities?.transfers === "active" : account.charges_enabled === true;
  const pastDue = account.requirements?.past_due ?? [];
  return canReceive && account.payouts_enabled === true && pastDue.length === 0 && !account.requirements?.disabled_reason;
}

export function hasUsablePhone(phone: string | null | undefined): boolean {
  return (phone ?? "").replace(/\D/g, "").length >= 7;
}

/** True when the Clerk account's primary email is verified. Never throws. */
export async function isAccountEmailVerified(clerkId: string | null | undefined): Promise<boolean> {
  if (!clerkId) return false;
  try {
    const user = await clerkClient.users.getUser(clerkId) as {
      primaryEmailAddressId?: string | null;
      emailAddresses?: Array<{ id?: string; verification?: { status?: string | null } | null }>;
    } | null;
    if (!user) return false;
    const addresses = user.emailAddresses ?? [];
    const primary = addresses.find((address) => address.id === user.primaryEmailAddressId) ?? addresses[0];
    return primary?.verification?.status === "verified";
  } catch (err) {
    logger.warn({ err, clerkId }, "Unable to read manufacturer email verification");
    return false;
  }
}

export async function verificationGaps(
  mfr: Pick<typeof manufacturers.$inferSelect, "clerkId" | "contactPhone" | "paymentSetup">,
  options: { stripeAccount?: StripeAccountLike | null; emailVerified?: boolean } = {},
): Promise<VerificationGap[]> {
  const gaps: VerificationGap[] = [];
  const emailVerified = options.emailVerified ?? await isAccountEmailVerified(mfr.clerkId);
  if (!emailVerified) gaps.push("email");
  if (!hasUsablePhone(mfr.contactPhone)) gaps.push("phone");
  const stripeOk = options.stripeAccount ? stripeAccountVerified(options.stripeAccount) : mfr.paymentSetup === true;
  if (!stripeOk) gaps.push("payouts");
  return gaps;
}

/** One plain line for the portal, e.g. "Verify your email and finish payout setup." */
export function verificationGapLine(gaps: VerificationGap[]): string | null {
  if (gaps.length === 0) return null;
  const parts = gaps.map((gap) => gap === "email" ? "verify your email" : gap === "phone" ? "add a phone number" : "finish payout setup");
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}.`;
}

/**
 * Re-checks a pending manufacturer and verifies it when every rule passes.
 * Only moves 'pending_verification' → 'verified' (never overrides an admin
 * rejection). Returns the status after the check and what is still missing.
 */
export async function refreshManufacturerVerification(
  manufacturerId: string,
  options: { stripeAccount?: StripeAccountLike | null; emailVerified?: boolean } = {},
): Promise<{ status: VerificationStatus; gaps: VerificationGap[]; changed: boolean }> {
  const [mfr] = await db.select().from(manufacturers).where(eq(manufacturers.id, manufacturerId)).limit(1);
  if (!mfr) return { status: "pending_verification", gaps: ["email", "phone", "payouts"], changed: false };
  const status = mfr.verificationStatus as VerificationStatus;
  if (status !== "pending_verification") return { status, gaps: [], changed: false };
  const gaps = await verificationGaps(mfr, options);
  if (gaps.length > 0) return { status, gaps, changed: false };
  const now = new Date();
  const [updated] = await db.update(manufacturers).set({
    verificationStatus: "verified",
    verifiedAt: mfr.verifiedAt ?? now,
    verificationNote: "Verified automatically: email, phone and Stripe payouts",
    verificationDecidedBy: "system:auto",
    verificationDecidedAt: now,
    updatedAt: now,
  }).where(and(eq(manufacturers.id, mfr.id), eq(manufacturers.verificationStatus, "pending_verification")))
    .returning({ id: manufacturers.id });
  return { status: updated ? "verified" : status, gaps: [], changed: !!updated };
}

/** Admin override used by /api/admin/manufacturers/:id/verification. */
export async function decideManufacturerVerification(input: {
  manufacturerId: string;
  decision: "approve" | "reject";
  adminId: string;
  note?: string | null;
}) {
  const now = new Date();
  const [updated] = await db.update(manufacturers).set(input.decision === "approve" ? {
    verificationStatus: "verified",
    verifiedAt: sql`COALESCE(${manufacturers.verifiedAt}, ${now})`,
    verificationNote: input.note?.trim() || "Approved by an admin",
    verificationDecidedBy: input.adminId,
    verificationDecidedAt: now,
    updatedAt: now,
  } : {
    verificationStatus: "rejected",
    verifiedAt: null,
    verificationNote: input.note?.trim() || "Rejected by an admin",
    verificationDecidedBy: input.adminId,
    verificationDecidedAt: now,
    updatedAt: now,
  }).where(eq(manufacturers.id, input.manufacturerId)).returning();
  return updated ?? null;
}

export const VERIFICATION_REQUIRED_FOR_CARDS = {
  error: "Your profile is being verified. You can send payable order cards once it's verified.",
  code: "VERIFICATION_PENDING",
} as const;

// ─── Chat filter ──────────────────────────────────────────────────────────────

export const OFF_PLATFORM_NOTICE = "Orders paid outside Brandthread aren't protected.";

export type FilteredMessage = {
  content: string;
  contactFlags: OffPlatformKind[] | null;
  masked: boolean;
  /** True when a signal should be logged and the thread notice shown. */
  flagged: boolean;
};

/**
 * Runs the off-platform detector over a seller↔manufacturer message.
 * Before the pair's first paid order every hit is flagged and identifiers are
 * masked. After it, contact details are fine; only payment steering is
 * flagged (never masked).
 */
export function filterManufacturerMessage(content: string, paidBefore: boolean): FilteredMessage {
  const detection = detectOffPlatformContact(content);
  if (detection.kinds.length === 0) return { content, contactFlags: null, masked: false, flagged: false };
  if (paidBefore) {
    const paymentKinds = detection.kinds.filter((kind) => OFF_PLATFORM_PAYMENT_KINDS.has(kind));
    return { content, contactFlags: paymentKinds.length ? paymentKinds : null, masked: false, flagged: paymentKinds.length > 0 };
  }
  const masked = maskOffPlatformContact(content, detection);
  return { content: masked, contactFlags: detection.kinds, masked: masked !== content, flagged: true };
}

/**
 * Logs a moderation signal for admins and posts the one-line notice into the
 * thread the first time the filter fires there. Never throws: a logging
 * failure must not fail the message send.
 */
export async function recordContactSignal(input: {
  threadId: string;
  messageId: string | null;
  manufacturerId: string;
  sellerId: string;
  senderClerkId: string;
  senderRole: "seller" | "manufacturer";
  kinds: OffPlatformKind[];
  masked: boolean;
  originalContent: string;
}) {
  try {
    await db.insert(manufacturerContactSignals).values({
      threadId: input.threadId,
      messageId: input.messageId,
      manufacturerId: input.manufacturerId,
      sellerId: input.sellerId,
      senderClerkId: input.senderClerkId,
      senderRole: input.senderRole,
      kinds: input.kinds,
      masked: input.masked,
      excerpt: input.originalContent.slice(0, 1000),
    });
    const noticeKey = `off-platform-notice:${input.threadId}`;
    const [existing] = await db.select({ id: manufacturerMessages.id }).from(manufacturerMessages).where(and(
      eq(manufacturerMessages.threadId, input.threadId),
      eq(manufacturerMessages.clientRequestId, noticeKey),
    )).limit(1);
    if (!existing) {
      await postThreadSystemMessage(db, {
        threadId: input.threadId,
        content: OFF_PLATFORM_NOTICE,
        notify: input.senderRole === "seller" ? "manufacturer" : "seller",
        dedupeKey: noticeKey,
      });
    }
  } catch (err) {
    logger.error({ err, threadId: input.threadId }, "Failed to record manufacturer chat contact signal");
  }
}
