import { Router } from "express";
import crypto from "crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, ipCaseAuditHistory, ipCases, products, users } from "@workspace/db";
import { requireAuth, requireModerator } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import {
  sendIpCaseInformationRequestEmail,
  sendIpCounterNoticeOutcomeEmail,
  sendIpTakedownSellerEmail,
} from "../lib/brandthreadEmail";
import {
  addStrike,
  canReceiveCounterNotice,
  canResolveCounterNotice,
  extractProductId,
  removeStrike,
  repeatInfringerThreshold,
  validateNotice,
} from "../lib/ipEnforcement";

const router = Router();
const RIGHTS_TYPES = ["copyright", "trademark", "counterfeit", "other"] as const;
const CASE_STATUSES = ["submitted", "under_review", "information_requested", "dismissed", "actioned"] as const;
const CASE_TRANSITIONS: Record<string, readonly string[]> = {
  submitted: ["under_review", "information_requested", "dismissed"],
  under_review: ["information_requested", "dismissed"],
  information_requested: ["under_review", "dismissed"],
  dismissed: [],
  actioned: [],
};
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const publicCase = (c: typeof ipCases.$inferSelect) => ({
  caseReference: c.publicReference, status: c.status, rightsType: c.rightsType,
  createdAt: c.createdAt, updatedAt: c.updatedAt, resolvedAt: c.resolvedAt,
});
type SellerStanding = { ipStrikeCount: number; ipRepeatInfringer: boolean; ipRepeatInfringerFlaggedAt: Date | null };
const moderatorCase = (
  c: typeof ipCases.$inferSelect,
  listing: typeof products.$inferSelect | null = null,
  seller: SellerStanding | null = null,
) => {
  const { statusTokenHash: _statusTokenHash, ...safeCase } = c;
  return {
    ...safeCase,
    sellerStanding: seller
      ? { ...seller, threshold: repeatInfringerThreshold() }
      : null,
    listingContext: listing
      ? {
          id: listing.id,
          name: listing.name,
          description: listing.description,
          status: listing.status,
          ownerId: listing.ownerId,
          images: listing.images,
          updatedAt: listing.updatedAt,
        }
      : null,
  };
};
async function audit(caseId: string, action: string, previousStatus?: string | null,
  nextStatus?: string | null, actorId?: string | null, details: Record<string, unknown> = {}) {
  await db.insert(ipCaseAuditHistory).values({ caseId, action, previousStatus: previousStatus ?? null,
    nextStatus: nextStatus ?? null, actorId: actorId ?? null, details });
}

// Public claimant intake. Authentication is intentionally optional; a rights
// holder must not need a marketplace account to report infringement. Used by
// the in-app report and by the public web notice form (channel "web_notice",
// which must carry the DMCA-style statements and an electronic signature).
router.post("/", rateLimit("report"), async (req, res) => {
  const body = req.body ?? {};
  const claimantName = typeof body.claimantName === "string" ? body.claimantName.trim() : "";
  const claimantEmail = typeof body.claimantEmail === "string" ? body.claimantEmail.trim().toLowerCase() : "";
  const rightsType = typeof body.rightsType === "string" ? body.rightsType : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  let listingProductId = typeof body.listingProductId === "string" ? body.listingProductId : null;
  const listingUrl = typeof body.listingUrl === "string" ? body.listingUrl.trim() : null;
  const evidenceReferences: unknown[] = Array.isArray(body.evidenceReferences) ? body.evidenceReferences : [];
  if (!claimantName || claimantName.length > 200 || !emailPattern.test(claimantEmail) ||
      !RIGHTS_TYPES.includes(rightsType as typeof RIGHTS_TYPES[number]) || description.length < 10 ||
      description.length > 10000 || (!listingProductId && !listingUrl) ||
      evidenceReferences.length > 20 || evidenceReferences.some((x) => typeof x !== "string" || x.length < 1 || x.length > 2048)) {
    return res.status(400).json({ error: "Invalid IP case submission" });
  }
  if (listingUrl && (listingUrl.length > 2048 || !/^https?:\/\//i.test(listingUrl))) {
    return res.status(400).json({ error: "listingUrl must be an http(s) URL" });
  }
  const notice = validateNotice(body);
  if (!notice.ok) return res.status(400).json({ error: notice.error });
  // A pasted listing link that carries a product id is resolved to that product
  // so moderators can take it down from the case.
  const explicitProduct = listingProductId !== null;
  if (!listingProductId) listingProductId = extractProductId(listingUrl);
  let sellerId: string | null = null;
  if (listingProductId) {
    const [product] = await db.select({ id: products.id, ownerId: products.ownerId }).from(products)
      .where(eq(products.id, listingProductId)).limit(1);
    if (!product) {
      if (explicitProduct) return res.status(400).json({ error: "Invalid listing target" });
      listingProductId = null;
    } else {
      sellerId = product.ownerId;
    }
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const reference = `IP-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
  const [caseRow] = await db.insert(ipCases).values({
    publicReference: reference, statusTokenHash: hashToken(token), claimantName, claimantEmail,
    claimantContact: typeof body.claimantContact === "string" ? body.claimantContact.trim().slice(0, 500) : null,
    listingProductId, listingUrl, rightsType, description, evidenceReferences: evidenceReferences as string[],
    sellerId, channel: notice.channel, signature: notice.signature,
    goodFaithStatement: body.goodFaithStatement === true, accuracyStatement: body.accuracyStatement === true,
  }).returning();
  await audit(caseRow.id, "submitted", null, caseRow.status, (req as any).clerkUserId ?? null, { channel: notice.channel });
  return res.status(201).json({ ...publicCase(caseRow), statusToken: token });
});

// Bearer-like token avoids exposing whether arbitrary case references exist.
router.get("/:reference/status", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) return res.status(404).json({ error: "Case not found" });
  const [caseRow] = await db.select().from(ipCases).where(and(
    eq(ipCases.publicReference, req.params.reference), eq(ipCases.statusTokenHash, hashToken(token)),
  )).limit(1);
  if (!caseRow) return res.status(404).json({ error: "Case not found" });
  return res.json(publicCase(caseRow));
});

async function recordCounterNotice(caseId: string, statement: string, actorId: string, via: "seller" | "moderator") {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(ipCases).where(eq(ipCases.id, caseId)).limit(1).for("update");
    if (!existing) return "missing" as const;
    if (!canReceiveCounterNotice(existing)) return "not_allowed" as const;
    const now = new Date();
    await tx.update(ipCases).set({
      counterNoticeStatus: "received", counterNoticeStatement: statement,
      counterNoticeReceivedAt: now, updatedAt: now,
    }).where(eq(ipCases.id, caseId));
    await tx.insert(ipCaseAuditHistory).values({
      caseId, action: "counter_notice_received", previousStatus: existing.status, nextStatus: existing.status,
      actorId, details: { via },
    });
    return "ok" as const;
  });
}

// Seller-side counter-notice: only the owner of the taken-down listing can file
// it, once, after a takedown. A moderator then reinstates or upholds.
router.post("/seller/:reference/counter-notice", requireAuth, rateLimit("report"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const statement = typeof req.body?.statement === "string" ? req.body.statement.trim() : "";
  if (statement.length < 20 || statement.length > 5000 || req.body?.goodFaith !== true) {
    return res.status(400).json({ error: "Describe why the listing was removed by mistake and confirm your good-faith statement" });
  }
  const [caseRow] = await db.select({ id: ipCases.id }).from(ipCases)
    .where(and(eq(ipCases.publicReference, String(req.params.reference)), eq(ipCases.sellerId, sellerId))).limit(1);
  if (!caseRow) return res.status(404).json({ error: "Case not found" });
  const result = await recordCounterNotice(caseRow.id, statement, sellerId, "seller");
  if (result === "missing") return res.status(404).json({ error: "Case not found" });
  if (result === "not_allowed") return res.status(409).json({ error: "A counter-notice can only be filed once, after a takedown" });
  return res.status(201).json({ ok: true, counterNoticeStatus: "received" });
});

router.use(requireAuth, requireModerator);
router.get("/access", (_req, res) => {
  return res.json({ moderator: true });
});

async function sellerStandings(ownerIds: string[]): Promise<Map<string, SellerStanding>> {
  const ids = [...new Set(ownerIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await db.select({
    clerkId: users.clerkId, ipStrikeCount: users.ipStrikeCount,
    ipRepeatInfringer: users.ipRepeatInfringer, ipRepeatInfringerFlaggedAt: users.ipRepeatInfringerFlaggedAt,
  }).from(users).where(inArray(users.clerkId, ids));
  return new Map(rows.map(({ clerkId, ...standing }) => [clerkId, standing]));
}

router.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status && !CASE_STATUSES.includes(status as typeof CASE_STATUSES[number])) return res.status(400).json({ error: "Invalid status" });
  const counterNotice = req.query.counterNotice === "received";
  const rows = await db.select({ case: ipCases, listing: products }).from(ipCases)
    .leftJoin(products, eq(products.id, ipCases.listingProductId))
    .where(and(
      status ? eq(ipCases.status, status) : undefined,
      counterNotice ? eq(ipCases.counterNoticeStatus, "received") : undefined,
    ))
    .orderBy(desc(ipCases.createdAt)).limit(200);
  const standings = await sellerStandings(rows.map((r) => r.case.sellerId ?? r.listing?.ownerId ?? ""));
  return res.json(rows.map(({ case: caseRow, listing }) =>
    moderatorCase(caseRow, listing, standings.get(caseRow.sellerId ?? listing?.ownerId ?? "") ?? null)));
});

// Sellers with strikes or a repeat-infringer flag, flagged first.
router.get("/repeat-infringers", async (_req, res) => {
  const rows = await db.select({
    userId: users.clerkId, name: users.name, brandName: users.brandName, username: users.username,
    ipStrikeCount: users.ipStrikeCount, ipRepeatInfringer: users.ipRepeatInfringer,
    ipRepeatInfringerFlaggedAt: users.ipRepeatInfringerFlaggedAt, suspendedAt: users.suspendedAt,
  }).from(users)
    .where(or(sql`${users.ipStrikeCount} > 0`, eq(users.ipRepeatInfringer, true)))
    .orderBy(desc(users.ipRepeatInfringer), desc(users.ipStrikeCount)).limit(200);
  return res.json({ threshold: repeatInfringerThreshold(), sellers: rows });
});

router.post("/repeat-infringers/:userId/clear", async (req, res) => {
  const resetStrikes = req.body?.resetStrikes === true;
  const rows = await db.update(users).set({
    ipRepeatInfringer: false, ipRepeatInfringerFlaggedAt: null,
    ...(resetStrikes ? { ipStrikeCount: 0 } : {}), updatedAt: new Date(),
  }).where(eq(users.clerkId, req.params.userId)).returning({ id: users.id });
  if (rows.length === 0) return res.status(404).json({ error: "Seller not found" });
  req.log.info({ userId: req.params.userId, moderator: (req as any).clerkUserId, resetStrikes }, "IP repeat-infringer flag cleared");
  return res.json({ ok: true });
});

router.get("/:id", async (req, res) => {
  const [row] = await db.select({ case: ipCases, listing: products }).from(ipCases)
    .leftJoin(products, eq(products.id, ipCases.listingProductId))
    .where(eq(ipCases.id, req.params.id)).limit(1);
  if (!row) return res.status(404).json({ error: "Case not found" });
  const ownerId = row.case.sellerId ?? row.listing?.ownerId ?? "";
  const standings = await sellerStandings([ownerId]);
  return res.json(moderatorCase(row.case, row.listing, standings.get(ownerId) ?? null));
});
router.get("/:id/audit", async (req, res) => {
  const rows = await db.select().from(ipCaseAuditHistory).where(eq(ipCaseAuditHistory.caseId, req.params.id))
    .orderBy(desc(ipCaseAuditHistory.createdAt));
  return res.json(rows);
});

// Moderator records a counter-notice received by email/support.
router.post("/:id/counter-notice", async (req, res) => {
  const statement = typeof req.body?.statement === "string" ? req.body.statement.trim() : "";
  if (statement.length < 10 || statement.length > 5000) return res.status(400).json({ error: "Counter-notice text is required" });
  const result = await recordCounterNotice(req.params.id, statement, (req as any).clerkUserId, "moderator");
  if (result === "missing") return res.status(404).json({ error: "Case not found" });
  if (result === "not_allowed") return res.status(409).json({ error: "A counter-notice can only be filed once, after a takedown" });
  return res.status(201).json({ ok: true, counterNoticeStatus: "received" });
});

// Moderator decision on a received counter-notice: reinstate the listing (and
// remove that case's strike) or uphold the takedown.
router.post("/:id/counter-notice/resolve", async (req, res) => {
  const outcome = req.body?.outcome;
  const notes = typeof req.body?.notes === "string" ? req.body.notes.trim().slice(0, 10000) : "";
  if (outcome !== "reinstate" && outcome !== "uphold") return res.status(400).json({ error: "outcome must be reinstate or uphold" });
  const actorId = (req as any).clerkUserId as string;
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(ipCases).where(eq(ipCases.id, req.params.id)).limit(1).for("update");
    if (!existing) return { kind: "missing" as const };
    if (!canResolveCounterNotice(existing.counterNoticeStatus)) return { kind: "no_counter_notice" as const };
    let strikeCount: number | null = null;
    if (outcome === "reinstate") {
      if (existing.listingProductId) {
        await tx.update(products).set({ status: "active", deletedAt: null, recoverableUntil: null, removalKind: null, updatedAt: now })
          .where(and(
            eq(products.id, existing.listingProductId),
            inArray(products.removalKind, ["moderation_hidden", "moderation_removed"]),
          ));
      }
      if (existing.strikeAppliedAt && existing.sellerId) {
        const [seller] = await tx.select({ count: users.ipStrikeCount, flagged: users.ipRepeatInfringer }).from(users)
          .where(eq(users.clerkId, existing.sellerId)).limit(1).for("update");
        if (seller) {
          const next = removeStrike(seller.count, seller.flagged);
          await tx.update(users).set({ ipStrikeCount: next.count, updatedAt: now }).where(eq(users.clerkId, existing.sellerId));
          strikeCount = next.count;
        }
      }
    }
    const counterNoticeStatus = outcome === "reinstate" ? "reinstated" : "upheld";
    await tx.update(ipCases).set({
      counterNoticeStatus, takedownAt: outcome === "reinstate" ? null : existing.takedownAt,
      strikeAppliedAt: outcome === "reinstate" ? null : existing.strikeAppliedAt,
      moderatorNotes: notes || existing.moderatorNotes, updatedAt: now,
    }).where(eq(ipCases.id, existing.id));
    await tx.insert(ipCaseAuditHistory).values({
      caseId: existing.id, action: `counter_notice_${counterNoticeStatus}`,
      previousStatus: existing.status, nextStatus: existing.status, actorId,
      details: notes ? { notes } : {},
    });
    return { kind: "ok" as const, existing, counterNoticeStatus, strikeCount };
  });
  if (result.kind === "missing") return res.status(404).json({ error: "Case not found" });
  if (result.kind === "no_counter_notice") return res.status(409).json({ error: "No pending counter-notice on this case" });
  const { existing } = result;
  if (existing.sellerId) {
    const [seller] = await db.select({ email: users.email }).from(users).where(eq(users.clerkId, existing.sellerId)).limit(1);
    if (seller?.email) {
      await sendIpCounterNoticeOutcomeEmail({
        to: seller.email, caseReference: existing.publicReference,
        outcome: result.counterNoticeStatus as "reinstated" | "upheld",
        idempotencyKey: `ip-counter-${existing.id}-${result.counterNoticeStatus}`,
      }).catch(() => false);
    }
  }
  return res.json({ ok: true, counterNoticeStatus: result.counterNoticeStatus, sellerStrikeCount: result.strikeCount });
});

router.patch("/:id", async (req, res) => {
  const status = req.body?.status;
  const moderatorNotes = req.body?.moderatorNotes;
  const action = req.body?.action;
  if ((status !== undefined && !CASE_STATUSES.includes(status)) ||
      (moderatorNotes !== undefined && (typeof moderatorNotes !== "string" || moderatorNotes.length > 10000)) ||
      (action !== undefined && !["hide_listing", "remove_listing"].includes(action))) return res.status(400).json({ error: "Invalid case update" });
  if (action !== undefined && status !== undefined) {
    return res.status(400).json({ error: "Listing actions cannot be combined with a status update" });
  }
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(ipCases)
      .where(eq(ipCases.id, req.params.id)).limit(1).for("update");
    if (!existing) return { kind: "missing" as const };
    if (["dismissed", "actioned"].includes(existing.status) && (status !== undefined || action !== undefined)) {
      return { kind: "resolved" as const };
    }
    if (
      status !== undefined
      && status !== existing.status
      && !CASE_TRANSITIONS[existing.status]?.includes(status)
    ) {
      return { kind: "invalid_transition" as const };
    }
    if (action && !existing.listingProductId) return { kind: "missing_listing" as const };
    const nextStatus = action ? "actioned" : (status ?? existing.status);
    let takedown: { sellerId: string; listingName: string | null; strikeCount: number; flagged: boolean } | null = null;
    if (action && existing.listingProductId) {
      const [listing] = await tx.select({
        id: products.id,
        name: products.name,
        ownerId: products.ownerId,
        removalKind: products.removalKind,
      }).from(products).where(eq(products.id, existing.listingProductId)).limit(1).for("update");
      if (!listing) return { kind: "missing_listing" as const };
      if (action === "hide_listing" && listing.removalKind === "moderation_removed") {
        return { kind: "listing_already_removed" as const };
      }
      const listingUpdate = action === "remove_listing"
        ? { status: "archived", deletedAt: now, recoverableUntil: null, removalKind: "moderation_removed", updatedAt: now }
        : { status: "archived", deletedAt: null, recoverableUntil: null, removalKind: "moderation_hidden", updatedAt: now };
      await tx.update(products).set(listingUpdate)
        .where(eq(products.id, existing.listingProductId));
      // Repeat-infringer policy: one strike per taken-down case, applied once.
      let strikeCount = 0;
      let flagged = false;
      if (!existing.strikeAppliedAt) {
        const [seller] = await tx.select({ count: users.ipStrikeCount, flagged: users.ipRepeatInfringer }).from(users)
          .where(eq(users.clerkId, listing.ownerId)).limit(1).for("update");
        if (seller) {
          const next = addStrike(seller.count, seller.flagged);
          await tx.update(users).set({
            ipStrikeCount: next.count, ipRepeatInfringer: next.flagged,
            ...(next.newlyFlagged ? { ipRepeatInfringerFlaggedAt: now } : {}), updatedAt: now,
          }).where(eq(users.clerkId, listing.ownerId));
          strikeCount = next.count;
          flagged = next.flagged;
        }
      }
      takedown = { sellerId: listing.ownerId, listingName: listing.name, strikeCount, flagged };
    }
    await tx.update(ipCases).set({ status: nextStatus, moderatorNotes: moderatorNotes ?? existing.moderatorNotes,
      assignedModeratorId: (req as any).clerkUserId, resolvedAt: ["dismissed", "actioned"].includes(nextStatus) ? now : null, updatedAt: now,
      ...(takedown ? {
        sellerId: takedown.sellerId, takedownAt: now,
        strikeAppliedAt: existing.strikeAppliedAt ?? now,
      } : {}),
    }).where(eq(ipCases.id, existing.id));
    await tx.insert(ipCaseAuditHistory).values({ caseId: existing.id, action: action ?? "status_updated",
      previousStatus: existing.status, nextStatus, actorId: (req as any).clerkUserId,
      details: { ...(moderatorNotes !== undefined ? { moderatorNotes } : {}),
        ...(takedown ? { sellerStrikeCount: takedown.strikeCount, repeatInfringer: takedown.flagged } : {}) } });
    return { kind: "updated" as const, existing, nextStatus, takedown };
  });
  if (result.kind === "missing") return res.status(404).json({ error: "Case not found" });
  if (result.kind === "resolved") return res.status(409).json({ error: "Resolved cases cannot be reopened or actioned again" });
  if (result.kind === "invalid_transition") return res.status(409).json({ error: "Invalid case status transition" });
  if (result.kind === "missing_listing") return res.status(400).json({ error: "Case has no product listing target" });
  if (result.kind === "listing_already_removed") {
    return res.status(409).json({ error: "The listing has already been permanently removed" });
  }
  const { existing, nextStatus, takedown } = result;
  if (nextStatus === "information_requested" && moderatorNotes?.trim()) {
    const emailSent = await sendIpCaseInformationRequestEmail({
      to: existing.claimantEmail,
      caseReference: existing.publicReference,
      requestedInformation: moderatorNotes.trim(),
      idempotencyKey: `ip-case-info-${existing.id}-${hashToken(moderatorNotes.trim())}`,
    });
    if (!emailSent) {
      req.log.warn({ caseId: existing.id }, "IP case information request email was not sent");
    }
  }
  if (takedown) {
    const [seller] = await db.select({ email: users.email }).from(users).where(eq(users.clerkId, takedown.sellerId)).limit(1);
    const notified = seller?.email
      ? await sendIpTakedownSellerEmail({
        to: seller.email, caseReference: existing.publicReference, listingName: takedown.listingName,
        rightsType: existing.rightsType, strikeCount: takedown.strikeCount, flaggedRepeatInfringer: takedown.flagged,
        idempotencyKey: `ip-takedown-${existing.id}`,
      }).catch(() => false)
      : false;
    if (notified) {
      await db.update(ipCases).set({ sellerNotifiedAt: new Date() }).where(eq(ipCases.id, existing.id));
      await audit(existing.id, "seller_notified", nextStatus, nextStatus, (req as any).clerkUserId);
    } else {
      req.log.warn({ caseId: existing.id }, "IP takedown seller notification was not sent");
    }
  }
  const [updated] = await db.select().from(ipCases).where(eq(ipCases.id, existing.id)).limit(1);
  const [listing] = updated.listingProductId
    ? await db.select().from(products).where(eq(products.id, updated.listingProductId)).limit(1)
    : [];
  const standings = await sellerStandings([updated.sellerId ?? listing?.ownerId ?? ""]);
  return res.json(moderatorCase(updated, listing ?? null, standings.get(updated.sellerId ?? listing?.ownerId ?? "") ?? null));
});

export default router;
