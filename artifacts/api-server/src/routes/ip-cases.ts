import { Router } from "express";
import crypto from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, ipCaseAuditHistory, ipCases, products } from "@workspace/db";
import { requireAuth, requireModerator } from "../middlewares/requireAuth";
import { sendIpCaseInformationRequestEmail } from "../lib/brandthreadEmail";

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
const moderatorCase = (
  c: typeof ipCases.$inferSelect,
  listing: typeof products.$inferSelect | null = null,
) => {
  const { statusTokenHash: _statusTokenHash, ...safeCase } = c;
  return {
    ...safeCase,
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
// holder must not need a marketplace account to report infringement.
router.post("/", async (req, res) => {
  const body = req.body ?? {};
  const claimantName = typeof body.claimantName === "string" ? body.claimantName.trim() : "";
  const claimantEmail = typeof body.claimantEmail === "string" ? body.claimantEmail.trim().toLowerCase() : "";
  const rightsType = typeof body.rightsType === "string" ? body.rightsType : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const listingProductId = typeof body.listingProductId === "string" ? body.listingProductId : null;
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
  if (listingProductId) {
    const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, listingProductId)).limit(1);
    if (!product) return res.status(400).json({ error: "Invalid listing target" });
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const reference = `IP-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
  const [caseRow] = await db.insert(ipCases).values({
    publicReference: reference, statusTokenHash: hashToken(token), claimantName, claimantEmail,
    claimantContact: typeof body.claimantContact === "string" ? body.claimantContact.trim().slice(0, 500) : null,
    listingProductId, listingUrl, rightsType, description, evidenceReferences: evidenceReferences as string[],
  }).returning();
  await audit(caseRow.id, "submitted", null, caseRow.status, (req as any).clerkUserId ?? null);
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

router.use(requireAuth, requireModerator);
router.get("/access", (_req, res) => {
  return res.json({ moderator: true });
});
router.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status && !CASE_STATUSES.includes(status as typeof CASE_STATUSES[number])) return res.status(400).json({ error: "Invalid status" });
  const rows = await db.select({ case: ipCases, listing: products }).from(ipCases)
    .leftJoin(products, eq(products.id, ipCases.listingProductId))
    .where(status ? eq(ipCases.status, status) : undefined)
    .orderBy(desc(ipCases.createdAt)).limit(200);
  return res.json(rows.map(({ case: caseRow, listing }) => moderatorCase(caseRow, listing)));
});
router.get("/:id", async (req, res) => {
  const [row] = await db.select({ case: ipCases, listing: products }).from(ipCases)
    .leftJoin(products, eq(products.id, ipCases.listingProductId))
    .where(eq(ipCases.id, req.params.id)).limit(1);
  if (!row) return res.status(404).json({ error: "Case not found" });
  return res.json(moderatorCase(row.case, row.listing));
});
router.get("/:id/audit", async (req, res) => {
  const rows = await db.select().from(ipCaseAuditHistory).where(eq(ipCaseAuditHistory.caseId, req.params.id))
    .orderBy(desc(ipCaseAuditHistory.createdAt));
  return res.json(rows);
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
    if (action && existing.listingProductId) {
      const [listing] = await tx.select({
        id: products.id,
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
    }
    await tx.update(ipCases).set({ status: nextStatus, moderatorNotes: moderatorNotes ?? existing.moderatorNotes,
      assignedModeratorId: (req as any).clerkUserId, resolvedAt: ["dismissed", "actioned"].includes(nextStatus) ? now : null, updatedAt: now })
      .where(eq(ipCases.id, existing.id));
    await tx.insert(ipCaseAuditHistory).values({ caseId: existing.id, action: action ?? "status_updated",
      previousStatus: existing.status, nextStatus, actorId: (req as any).clerkUserId,
      details: moderatorNotes !== undefined ? { moderatorNotes } : {} });
    return { kind: "updated" as const, existing, nextStatus };
  });
  if (result.kind === "missing") return res.status(404).json({ error: "Case not found" });
  if (result.kind === "resolved") return res.status(409).json({ error: "Resolved cases cannot be reopened or actioned again" });
  if (result.kind === "invalid_transition") return res.status(409).json({ error: "Invalid case status transition" });
  if (result.kind === "missing_listing") return res.status(400).json({ error: "Case has no product listing target" });
  if (result.kind === "listing_already_removed") {
    return res.status(409).json({ error: "The listing has already been permanently removed" });
  }
  const { existing, nextStatus } = result;
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
  const [updated] = await db.select().from(ipCases).where(eq(ipCases.id, existing.id)).limit(1);
  const [listing] = updated.listingProductId
    ? await db.select().from(products).where(eq(products.id, updated.listingProductId)).limit(1)
    : [];
  return res.json(moderatorCase(updated, listing ?? null));
});

export default router;