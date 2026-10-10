/**
 * Manufacturer trust admin API (mounted at /api/admin/manufacturer-trust,
 * behind requireAdmin). Backend for the admin dashboard pages.
 *
 *   GET  /verification?status=pending_verification|verified|rejected|all
 *        manufacturers by vetting state, with what is still missing
 *   POST /verification/:id   { decision: "approve" | "reject", note? }   override
 *   GET  /contact-signals?days=30
 *        chat filter hits: recent rows + repeat offenders (by sender)
 */
import { Router } from "express";
import { desc, eq, gte, sql } from "drizzle-orm";
import { db, manufacturerContactSignals, manufacturers } from "@workspace/db";
import { actorOf, recordAdminAction } from "../../lib/admin/audit";
import { decideManufacturerVerification, hasUsablePhone, VERIFICATION_STATUSES } from "../../lib/manufacturerTrust";
import { UUID_RE, bodyString, clampDays, pageParams, queryString } from "./util";

const router = Router();

router.get("/verification", async (req, res) => {
  const status = queryString(req, "status", 32) || "pending_verification";
  const { limit, offset } = pageParams(req, { limit: 50, max: 100 });
  if (status !== "all" && !(VERIFICATION_STATUSES as readonly string[]).includes(status)) {
    res.status(400).json({ error: `status must be one of: all, ${VERIFICATION_STATUSES.join(", ")}` }); return;
  }
  try {
    const rows = await db.select().from(manufacturers)
      .where(status === "all" ? undefined : eq(manufacturers.verificationStatus, status))
      .orderBy(desc(manufacturers.createdAt))
      .limit(limit)
      .offset(offset);
    res.json({
      items: rows.map((m) => ({
        id: m.id,
        businessName: m.businessName,
        country: m.country,
        status: m.status,
        verificationStatus: m.verificationStatus,
        isPublicDirectory: m.isPublicDirectory,
        contactEmail: m.contactEmail,
        hasPhone: hasUsablePhone(m.contactPhone),
        payoutsReady: m.paymentSetup,
        termsVersion: m.termsVersion,
        verificationNote: m.verificationNote,
        verificationDecidedBy: m.verificationDecidedBy,
        verificationDecidedAt: m.verificationDecidedAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Admin manufacturer verification list failed");
    res.status(500).json({ error: "Could not load manufacturers." });
  }
});

router.post("/verification/:id", async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(404).json({ error: "Manufacturer not found" }); return; }
  const decision = bodyString(req.body, "decision", 10);
  if (decision !== "approve" && decision !== "reject") {
    res.status(400).json({ error: "decision must be approve or reject" }); return;
  }
  const note = bodyString(req.body, "note", 1000) || null;
  const actor = actorOf(req);
  try {
    const updated = await decideManufacturerVerification({ manufacturerId: id, decision, adminId: actor.clerkId, note });
    if (!updated) { res.status(404).json({ error: "Manufacturer not found" }); return; }
    await recordAdminAction(actor, {
      action: `manufacturer.verification.${decision}`,
      targetType: "manufacturer",
      targetId: id,
      summary: `${decision === "approve" ? "Approved" : "Rejected"} ${updated.businessName}`,
      metadata: { note },
    });
    res.json({
      id: updated.id,
      verificationStatus: updated.verificationStatus,
      verificationNote: updated.verificationNote,
      verificationDecidedAt: updated.verificationDecidedAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err, manufacturerId: id }, "Admin manufacturer verification decision failed");
    res.status(500).json({ error: "Could not save the decision." });
  }
});

router.get("/contact-signals", async (req, res) => {
  const days = clampDays(req, 30);
  const since = new Date(Date.now() - days * 86_400_000);
  const { limit, offset } = pageParams(req, { limit: 50, max: 200 });
  try {
    const [recent, offenders] = await Promise.all([
      db.select({
        id: manufacturerContactSignals.id,
        threadId: manufacturerContactSignals.threadId,
        messageId: manufacturerContactSignals.messageId,
        manufacturerId: manufacturerContactSignals.manufacturerId,
        manufacturerName: manufacturers.businessName,
        sellerId: manufacturerContactSignals.sellerId,
        senderClerkId: manufacturerContactSignals.senderClerkId,
        senderRole: manufacturerContactSignals.senderRole,
        kinds: manufacturerContactSignals.kinds,
        masked: manufacturerContactSignals.masked,
        excerpt: manufacturerContactSignals.excerpt,
        createdAt: manufacturerContactSignals.createdAt,
      }).from(manufacturerContactSignals)
        .leftJoin(manufacturers, eq(manufacturers.id, manufacturerContactSignals.manufacturerId))
        .where(gte(manufacturerContactSignals.createdAt, since))
        .orderBy(desc(manufacturerContactSignals.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({
        senderClerkId: manufacturerContactSignals.senderClerkId,
        senderRole: manufacturerContactSignals.senderRole,
        hits: sql<number>`count(*)::int`,
        threads: sql<number>`count(DISTINCT ${manufacturerContactSignals.threadId})::int`,
        lastAt: sql<Date>`max(${manufacturerContactSignals.createdAt})`,
      }).from(manufacturerContactSignals)
        .where(gte(manufacturerContactSignals.createdAt, since))
        .groupBy(manufacturerContactSignals.senderClerkId, manufacturerContactSignals.senderRole)
        .having(sql`count(*) >= 2`)
        .orderBy(sql`count(*) DESC`)
        .limit(50),
    ]);
    res.json({
      days,
      items: recent.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      repeatOffenders: offenders.map((row) => ({ ...row, lastAt: new Date(row.lastAt).toISOString() })),
    });
  } catch (err) {
    req.log.error({ err }, "Admin manufacturer contact signals failed");
    res.status(500).json({ error: "Could not load chat signals." });
  }
});

export default router;
