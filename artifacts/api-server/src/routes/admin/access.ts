/**
 * Invite-only launch — waitlist admin (mounted at /api/admin/access, behind
 * requireAdmin). Codes themselves are managed by the existing
 * /api/admin/invites routes (create, list with usage, disable = revoke).
 *
 *   GET  /api/admin/access/waitlist?status=pending|invited|all
 *   POST /api/admin/access/waitlist/:id/invite   issue a single-use code + mark invited
 */
import { Router } from "express";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, accessWaitlistSignups, adminInviteCodes } from "@workspace/db";
import { actorOf, recordAdminAction } from "../../lib/admin/audit";
import { generateAdminInviteCode } from "../../lib/admin/inviteCodes";
import { UUID_RE, pageParams, queryString } from "./util";

const router = Router();
const INVITE_TTL_MS = 30 * 24 * 60 * 60_000;

router.get("/waitlist", async (req, res) => {
  const status = queryString(req, "status", 12) || "all";
  const { limit, offset } = pageParams(req, { limit: 50, max: 100 });
  const where = status === "pending" ? isNull(accessWaitlistSignups.invitedAt)
    : status === "invited" ? isNotNull(accessWaitlistSignups.invitedAt)
    : undefined;
  try {
    const [rows, [counts]] = await Promise.all([
      db.select({
        id: accessWaitlistSignups.id,
        email: accessWaitlistSignups.email,
        createdAt: accessWaitlistSignups.createdAt,
        invitedAt: accessWaitlistSignups.invitedAt,
        code: adminInviteCodes.code,
      })
        .from(accessWaitlistSignups)
        .leftJoin(adminInviteCodes, eq(adminInviteCodes.id, accessWaitlistSignups.inviteCodeId))
        .where(where)
        .orderBy(desc(accessWaitlistSignups.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({
        total: sql<number>`count(*)::int`,
        invited: sql<number>`count(${accessWaitlistSignups.invitedAt})::int`,
      }).from(accessWaitlistSignups),
    ]);
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        email: r.email,
        createdAt: r.createdAt.toISOString(),
        invitedAt: r.invitedAt?.toISOString() ?? null,
        code: r.code ?? null,
      })),
      counts: { total: counts.total, invited: counts.invited, pending: counts.total - counts.invited },
    });
  } catch (err) {
    req.log.error({ err }, "Admin waitlist list failed");
    res.status(500).json({ error: "Could not load the waitlist." });
  }
});

router.post("/waitlist/:id/invite", async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(404).json({ error: "Waitlist entry not found" }); return; }
  const actor = actorOf(req);
  try {
    const result = await db.transaction(async (tx) => {
      const [entry] = await tx.select().from(accessWaitlistSignups)
        .where(eq(accessWaitlistSignups.id, id)).limit(1).for("update");
      if (!entry) return { status: 404 as const };
      if (entry.invitedAt && entry.inviteCodeId) {
        const [existing] = await tx.select({ code: adminInviteCodes.code }).from(adminInviteCodes)
          .where(eq(adminInviteCodes.id, entry.inviteCodeId)).limit(1);
        if (existing) return { status: 200 as const, code: existing.code, invitedAt: entry.invitedAt, reused: true };
      }
      let issued: { id: string; code: string } | undefined;
      while (!issued) {
        const [row] = await tx.insert(adminInviteCodes).values({
          code: generateAdminInviteCode(),
          label: entry.email.slice(0, 80),
          maxUses: 1,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          createdBy: actor.clerkId,
        }).onConflictDoNothing().returning({ id: adminInviteCodes.id, code: adminInviteCodes.code });
        issued = row;
      }
      const invitedAt = new Date();
      await tx.update(accessWaitlistSignups)
        .set({ invitedAt, invitedBy: actor.clerkId, inviteCodeId: issued.id })
        .where(and(eq(accessWaitlistSignups.id, id)));
      await recordAdminAction(actor, {
        action: "waitlist.invite", targetType: "waitlist_signup", targetId: id,
        summary: `Invited ${entry.email} from the waitlist`,
        metadata: { codeId: issued.id },
      }, tx);
      return { status: 200 as const, code: issued.code, invitedAt, reused: false };
    });
    if (result.status === 404) { res.status(404).json({ error: "Waitlist entry not found" }); return; }
    res.json({ code: result.code, invitedAt: result.invitedAt.toISOString(), reused: result.reused });
  } catch (err) {
    req.log.error({ err, id }, "Admin waitlist invite failed");
    res.status(500).json({ error: "Could not invite this person." });
  }
});

export default router;
