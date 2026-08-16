import { Router } from "express";
import { db, teamMembers, teamActivityLogs } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import crypto from "crypto";

const router = Router();
router.use(requireAuth);

// ─── Role definitions ─────────────────────────────────────────────────────────
const ROLE_DEFINITIONS = [
  {
    name: "Owner",
    group: "Organization",
    description: "Full access to all features including billing and team management",
    permissions: ["*"],
  },
  {
    name: "Manager",
    group: "Store",
    description: "Manage products, orders, inventory, and analytics",
    permissions: ["products", "orders", "inventory", "analytics", "customers"],
  },
  {
    name: "Staff",
    group: "Store",
    description: "Fulfillment and shipping only — can view and fulfill orders",
    permissions: ["orders:read", "orders:fulfill"],
  },
];

// ─── Helper ───────────────────────────────────────────────────────────────────
async function logActivity(ownerId: string, memberId: string | null, actorName: string, action: string, target?: string, metadata?: Record<string, unknown>) {
  try {
    await db.insert(teamActivityLogs).values({
      ownerId,
      memberId: memberId ?? undefined,
      actorName,
      action,
      target,
      metadata: metadata ?? {},
    });
  } catch { /* best-effort */ }
}

// GET /api/team/members
router.get("/members", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const rows = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.ownerId, ownerId))
    .orderBy(desc(teamMembers.createdAt));
  res.json(rows);
});

// POST /api/team/invite
router.post("/invite", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { email, name, role = "staff" } = req.body;
  if (!email) return res.status(400).json({ error: "email required" });
  if (!["manager", "staff"].includes(role)) return res.status(400).json({ error: "Invalid role" });

  const inviteToken = crypto.randomBytes(24).toString("hex");

  const [member] = await db
    .insert(teamMembers)
    .values({ ownerId, email, name: name ?? null, role, inviteToken })
    .onConflictDoUpdate({
      target: [teamMembers.ownerId, teamMembers.email],
      set: { role, inviteToken, status: "pending", updatedAt: new Date() },
    })
    .returning();

  await logActivity(ownerId, member.id, "Owner", `Invited ${email} as ${role}`);

  // In production, send invite email here via Resend or similar.
  // For now, return the token so it can be shared manually in dev.
  res.json({ ok: true, member, inviteToken });
});

// POST /api/team/accept/:token
router.post("/accept/:token", async (req, res) => {
  const { token } = req.params;
  const [member] = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.inviteToken, token))
    .limit(1);
  if (!member) return res.status(404).json({ error: "Invalid or expired invite token" });
  if (member.status === "active") return res.json({ ok: true, alreadyActive: true });

  await db
    .update(teamMembers)
    .set({ status: "active", acceptedAt: new Date(), inviteToken: null, updatedAt: new Date() })
    .where(eq(teamMembers.id, member.id));

  await logActivity(member.ownerId, member.id, member.name ?? member.email, "Accepted invite");
  res.json({ ok: true });
});

// PATCH /api/team/members/:id/role
router.patch("/members/:id/role", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { id } = req.params;
  const { role } = req.body;
  if (!["manager", "staff"].includes(role)) return res.status(400).json({ error: "Invalid role" });

  const [updated] = await db
    .update(teamMembers)
    .set({ role, updatedAt: new Date() })
    .where(and(eq(teamMembers.id, id), eq(teamMembers.ownerId, ownerId)))
    .returning();

  if (!updated) return res.status(404).json({ error: "Member not found" });

  await logActivity(ownerId, id, "Owner", `Changed ${updated.name ?? updated.email}'s role to ${role}`);
  res.json(updated);
});

// DELETE /api/team/members/:id
router.delete("/members/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { id } = req.params;

  const [removed] = await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.id, id), eq(teamMembers.ownerId, ownerId)))
    .returning();

  if (!removed) return res.status(404).json({ error: "Member not found" });

  await logActivity(ownerId, null, "Owner", `Removed ${removed.name ?? removed.email} from team`);
  res.json({ ok: true });
});

// GET /api/team/roles
router.get("/roles", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;

  // Count active members per role
  const rows = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.ownerId, ownerId), eq(teamMembers.status, "active")));

  const counts: Record<string, number> = {};
  for (const r of rows) {
    counts[r.role] = (counts[r.role] ?? 0) + 1;
  }
  // Owner is always 1
  counts["owner"] = 1;

  const result = ROLE_DEFINITIONS.map(rd => ({
    ...rd,
    staffCount: counts[rd.name.toLowerCase()] ?? 0,
  }));

  res.json(result);
});

// GET /api/team/activity
router.get("/activity", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const logs = await db
    .select()
    .from(teamActivityLogs)
    .where(eq(teamActivityLogs.ownerId, ownerId))
    .orderBy(desc(teamActivityLogs.createdAt))
    .limit(limit);

  res.json({ logs });
});

export default router;
