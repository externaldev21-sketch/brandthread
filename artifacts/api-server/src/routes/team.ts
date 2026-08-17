/**
 * Team, Roles & Permissions API — mounted at /api/team.
 *
 * Invite flow:
 *   POST /invite                  (owner)  create invite + shareable link (+ Resend email if configured)
 *   GET  /invite/accept/:token    (public) resolve invite details for the accept screen
 *   POST /invite/accept/:token    (authed) link the caller's Clerk account → status 'active'
 *
 * Members / roles / activity:
 *   GET    /members               team list (virtual owner row + members, online status)
 *   GET    /members/:id           one member + their recent activity
 *   PATCH  /members/:id           (owner) change role      — also PATCH /members/:id/role
 *   DELETE /members/:id           (owner) soft-remove (status='removed', access revoked)
 *   GET    /roles                 the three tiers with live staffCount per role
 *   GET    /roles/:role/members   members in one role
 *   GET    /activity              paginated audit log, filterable by actorClerkId & resourceType
 *
 * Reads resolve team context, so active team members can view the team of the
 * store they belong to. All mutations are owner-only.
 */
import { Router } from "express";
import { db, teamMembers, teamActivityLogs, users } from "@workspace/db";
import { eq, and, ne, or, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { teamContext, requireRole } from "../middlewares/requireRole";
import { logActivity, reqActor } from "../lib/activityLog";
import crypto from "crypto";

const router = Router();

// ─── Role definitions (the three tiers ARE the permission model) ──────────────
const ROLE_DEFINITIONS = [
  {
    key: "owner",
    name: "Owner",
    group: "Organization",
    description: "Full access to all features including billing, payouts, and team management",
    permissions: ["*"],
  },
  {
    key: "manager",
    name: "Manager",
    group: "Store",
    description: "Manage products, orders, inventory, and analytics",
    permissions: ["products", "orders", "inventory", "analytics", "customers"],
  },
  {
    key: "staff",
    name: "Staff",
    group: "Store",
    description: "Fulfillment and shipping only — can view and fulfill orders",
    permissions: ["orders:read", "orders:fulfill"],
  },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ONLINE_WINDOW_MS = 5 * 60 * 1000; // active in the last 5 minutes = online

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Shareable invite links: web URL (expo web serves the domain root) + native deep link. */
function inviteUrls(token: string) {
  const domain =
    process.env.REPLIT_DOMAINS?.split(",")[0] ?? process.env.REPLIT_DEV_DOMAIN ?? "";
  const deepLink = `mobile://team-invite?token=${token}`;
  return {
    inviteUrl: domain ? `https://${domain}/team-invite?token=${token}` : deepLink,
    deepLink,
  };
}

/** Serialize a team_members row for the client. Invite link only for the owner. */
function decorateMember(m: typeof teamMembers.$inferSelect, includeInvite: boolean) {
  const online =
    m.status === "active" &&
    !!m.lastActiveAt &&
    Date.now() - new Date(m.lastActiveAt).getTime() < ONLINE_WINDOW_MS;
  const base: Record<string, unknown> = {
    id: m.id,
    email: m.email,
    name: m.name,
    role: m.role,
    status: m.status,
    invitedAt: m.invitedAt,
    joinedAt: m.acceptedAt,
    lastActiveAt: m.lastActiveAt,
    memberClerkId: m.memberClerkId,
    online,
    isOwner: false,
  };
  if (includeInvite && m.status === "pending" && m.inviteToken) {
    const { inviteUrl, deepLink } = inviteUrls(m.inviteToken);
    base.inviteToken = m.inviteToken;
    base.inviteUrl = inviteUrl;
    base.deepLink = deepLink;
  }
  return base;
}

/** Virtual member row for the store owner (not stored in team_members). */
async function ownerRow(ownerClerkId: string, viewerIsOwner: boolean) {
  const [u] = await db
    .select({
      email: users.email,
      name: users.name,
      displayName: users.displayName,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.clerkId, ownerClerkId))
    .limit(1);
  return {
    id: "owner",
    email: u?.email ?? "",
    name: u?.displayName ?? u?.name ?? "Owner",
    role: "owner",
    status: "active",
    invitedAt: null,
    joinedAt: u?.createdAt ?? null,
    lastActiveAt: null,
    memberClerkId: ownerClerkId,
    online: viewerIsOwner, // the owner is online when they're the one looking
    isOwner: true,
  };
}

/** Best-effort invite email via Resend when the integration is configured. */
async function trySendInviteEmail(
  to: string,
  ownerName: string,
  role: string,
  inviteUrl: string,
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? "Brandthread <onboarding@resend.dev>",
        to: [to],
        subject: `${ownerName} invited you to join their team on Brandthread`,
        html: `<p>${ownerName} invited you to join their Brandthread team as <b>${role}</b>.</p><p><a href="${inviteUrl}">Accept the invite</a></p><p>Or paste this link into your browser:<br/>${inviteUrl}</p>`,
      }),
    });
    if (!r.ok) console.error("[team] Resend email failed:", r.status, await r.text());
    return r.ok;
  } catch (err) {
    console.error("[team] Resend email failed:", err);
    return false;
  }
}

// ─── Public routes (no auth) ──────────────────────────────────────────────────

// GET /api/team/invite/accept/:token — resolve invite details for the accept screen
router.get("/invite/accept/:token", async (req, res) => {
  const { token } = req.params;
  const [invite] = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.inviteToken, token))
    .limit(1);
  if (!invite || invite.status === "removed") {
    res.status(404).json({ valid: false, error: "Invalid or expired invite" });
    return;
  }
  const [owner] = await db
    .select({ name: users.name, displayName: users.displayName, brandName: users.brandName })
    .from(users)
    .where(eq(users.clerkId, invite.ownerId))
    .limit(1);
  res.json({
    valid: true,
    status: invite.status,
    alreadyAccepted: invite.status === "active",
    email: invite.email,
    name: invite.name,
    role: invite.role,
    invitedAt: invite.invitedAt,
    owner: {
      name: owner?.displayName ?? owner?.name ?? "A Brandthread seller",
      brandName: owner?.brandName ?? null,
    },
  });
});

// ─── Authenticated routes ─────────────────────────────────────────────────────
router.use(requireAuth);
router.use(teamContext());

// POST /api/team/invite/accept/:token — link the signed-in caller to the invite
async function handleAccept(req: any, res: any) {
  const { token } = req.params;
  const actorId = (req.actorClerkId as string) ?? (req.clerkUserId as string);

  const [invite] = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.inviteToken, token))
    .limit(1);
  if (!invite || invite.status === "removed") {
    res.status(404).json({ error: "Invalid or expired invite token" });
    return;
  }
  if (invite.ownerId === actorId) {
    res.status(400).json({ error: "You can't accept an invite to your own team" });
    return;
  }
  if (invite.status === "active") {
    if (invite.memberClerkId === actorId) {
      res.json({ ok: true, alreadyActive: true, member: decorateMember(invite, false) });
    } else {
      res.status(409).json({ error: "This invite has already been used by someone else" });
    }
    return;
  }

  // Atomic: only one caller can flip pending → active.
  const [updated] = await db
    .update(teamMembers)
    .set({
      memberClerkId: actorId,
      status: "active",
      acceptedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(teamMembers.id, invite.id), eq(teamMembers.status, "pending")))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "This invite has already been used" });
    return;
  }

  await logActivity(
    invite.ownerId,
    actorId,
    invite.role,
    `${updated.name ?? updated.email} joined the team as ${invite.role}`,
    "team",
    updated.id,
  );
  res.json({ ok: true, member: decorateMember(updated, false) });
}
router.post("/invite/accept/:token", handleAccept);
router.post("/accept/:token", handleAccept); // legacy alias

// GET /api/team/members — virtual owner row + all non-removed members
router.get("/members", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const viewerIsOwner = (((req as any).actorRole as string) ?? "owner") === "owner";

  const rows = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.ownerId, ownerId), ne(teamMembers.status, "removed")))
    .orderBy(desc(teamMembers.createdAt));

  const owner = await ownerRow(ownerId, viewerIsOwner);
  res.json([owner, ...rows.map((m) => decorateMember(m, viewerIsOwner))]);
});

// GET /api/team/members/:id — one member + recent activity ('owner' = virtual row)
router.get("/members/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const viewerIsOwner = (((req as any).actorRole as string) ?? "owner") === "owner";
  const { id } = req.params;

  if (id === "owner") {
    const member = await ownerRow(ownerId, viewerIsOwner);
    const recentActivity = await db
      .select()
      .from(teamActivityLogs)
      .where(and(eq(teamActivityLogs.ownerId, ownerId), eq(teamActivityLogs.actorClerkId, ownerId)))
      .orderBy(desc(teamActivityLogs.createdAt))
      .limit(10);
    res.json({ member, recentActivity });
    return;
  }

  if (!isUuid(id)) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  const [m] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.id, id), eq(teamMembers.ownerId, ownerId)))
    .limit(1);
  if (!m || m.status === "removed") {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  const activityCond = m.memberClerkId
    ? or(eq(teamActivityLogs.memberId, m.id), eq(teamActivityLogs.actorClerkId, m.memberClerkId))
    : eq(teamActivityLogs.memberId, m.id);
  const recentActivity = await db
    .select()
    .from(teamActivityLogs)
    .where(and(eq(teamActivityLogs.ownerId, ownerId), activityCond))
    .orderBy(desc(teamActivityLogs.createdAt))
    .limit(10);

  res.json({ member: decorateMember(m, viewerIsOwner), recentActivity });
});

// POST /api/team/invite — owner creates (or refreshes) an invite
router.post("/invite", requireRole("owner"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { email, name, role = "staff" } = req.body ?? {};
  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }
  if (!["manager", "staff"].includes(role)) {
    res.status(400).json({ error: "Invalid role — must be manager or staff" });
    return;
  }
  const normEmail = email.trim().toLowerCase();

  const [ownerUser] = await db
    .select({ email: users.email, name: users.name, displayName: users.displayName, brandName: users.brandName })
    .from(users)
    .where(eq(users.clerkId, ownerId))
    .limit(1);
  if (ownerUser?.email?.toLowerCase() === normEmail) {
    res.status(400).json({ error: "You can't invite yourself" });
    return;
  }

  const [existing] = await db
    .select({ status: teamMembers.status })
    .from(teamMembers)
    .where(and(eq(teamMembers.ownerId, ownerId), eq(teamMembers.email, normEmail)))
    .limit(1);
  if (existing?.status === "active") {
    res.status(409).json({ error: `${normEmail} is already on your team` });
    return;
  }

  const inviteToken = crypto.randomBytes(24).toString("hex");
  const [member] = await db
    .insert(teamMembers)
    .values({ ownerId, email: normEmail, name: name ?? null, role, inviteToken, status: "pending" })
    .onConflictDoUpdate({
      target: [teamMembers.ownerId, teamMembers.email],
      set: {
        role,
        inviteToken,
        status: "pending",
        memberClerkId: null,
        acceptedAt: null,
        invitedAt: new Date(),
        ...(name ? { name } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();

  const { inviteUrl, deepLink } = inviteUrls(inviteToken);
  const actor = reqActor(req);
  void logActivity(
    ownerId, actor.actorClerkId, actor.actorRole,
    `Invited ${normEmail} as ${role}`,
    "team", member.id, { email: normEmail, role },
  );

  const ownerName = ownerUser?.brandName ?? ownerUser?.displayName ?? ownerUser?.name ?? "A Brandthread seller";
  const emailSent = await trySendInviteEmail(normEmail, ownerName, role, inviteUrl);

  res.json({ ok: true, member: decorateMember(member, true), inviteToken, inviteUrl, deepLink, emailSent });
});

// PATCH /api/team/members/:id (+ legacy /members/:id/role) — owner changes a role
async function handleRoleChange(req: any, res: any) {
  const ownerId = req.clerkUserId as string;
  const { id } = req.params;
  const role = req.body?.role;
  if (id === "owner") {
    res.status(400).json({ error: "The owner's role can't be changed" });
    return;
  }
  if (!["manager", "staff"].includes(role)) {
    res.status(400).json({ error: "Invalid role — must be manager or staff" });
    return;
  }
  if (!isUuid(id)) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  const [updated] = await db
    .update(teamMembers)
    .set({ role, updatedAt: new Date() })
    .where(and(eq(teamMembers.id, id), eq(teamMembers.ownerId, ownerId), ne(teamMembers.status, "removed")))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  const actor = reqActor(req);
  void logActivity(
    ownerId, actor.actorClerkId, actor.actorRole,
    `Changed ${updated.name ?? updated.email}'s role to ${role}`,
    "team", id, { role },
  );
  res.json(decorateMember(updated, true));
}
router.patch("/members/:id", requireRole("owner"), handleRoleChange);
router.patch("/members/:id/role", requireRole("owner"), handleRoleChange);

// DELETE /api/team/members/:id — owner soft-removes a member (access revoked)
router.delete("/members/:id", requireRole("owner"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { id } = req.params;
  if (id === "owner") {
    res.status(400).json({ error: "The owner can't be removed" });
    return;
  }
  if (!isUuid(id)) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  const [removed] = await db
    .update(teamMembers)
    .set({ status: "removed", memberClerkId: null, inviteToken: null, updatedAt: new Date() })
    .where(and(eq(teamMembers.id, id), eq(teamMembers.ownerId, ownerId), ne(teamMembers.status, "removed")))
    .returning();
  if (!removed) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  const actor = reqActor(req);
  void logActivity(
    ownerId, actor.actorClerkId, actor.actorRole,
    `Removed ${removed.name ?? removed.email} from the team`,
    "team", id,
  );
  res.json({ ok: true });
});

// GET /api/team/roles — the three tiers with live counts
router.get("/roles", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;

  const rows = await db
    .select({ role: teamMembers.role, status: teamMembers.status })
    .from(teamMembers)
    .where(and(eq(teamMembers.ownerId, ownerId), ne(teamMembers.status, "removed")));

  const activeCounts: Record<string, number> = { owner: 1 }; // the owner is always 1
  const pendingCounts: Record<string, number> = {};
  for (const r of rows) {
    if (r.status === "active") activeCounts[r.role] = (activeCounts[r.role] ?? 0) + 1;
    else if (r.status === "pending") pendingCounts[r.role] = (pendingCounts[r.role] ?? 0) + 1;
  }

  res.json(
    ROLE_DEFINITIONS.map((rd) => ({
      ...rd,
      staffCount: activeCounts[rd.key] ?? 0,
      pendingCount: pendingCounts[rd.key] ?? 0,
    })),
  );
});

// GET /api/team/roles/:role/members — who is in this role
router.get("/roles/:role/members", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const viewerIsOwner = (((req as any).actorRole as string) ?? "owner") === "owner";
  const role = String(req.params.role).toLowerCase();
  if (!["owner", "manager", "staff"].includes(role)) {
    res.status(400).json({ error: "Unknown role" });
    return;
  }

  if (role === "owner") {
    res.json([await ownerRow(ownerId, viewerIsOwner)]);
    return;
  }

  const rows = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.ownerId, ownerId), eq(teamMembers.role, role), ne(teamMembers.status, "removed")))
    .orderBy(desc(teamMembers.createdAt));
  res.json(rows.map((m) => decorateMember(m, viewerIsOwner)));
});

// GET /api/team/activity — paginated audit log, newest first
// Query: limit (≤100), offset, actorClerkId, resourceType
router.get("/activity", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const conds = [eq(teamActivityLogs.ownerId, ownerId)];
  if (typeof req.query.actorClerkId === "string" && req.query.actorClerkId) {
    conds.push(eq(teamActivityLogs.actorClerkId, req.query.actorClerkId));
  }
  if (typeof req.query.resourceType === "string" && req.query.resourceType) {
    conds.push(eq(teamActivityLogs.resourceType, req.query.resourceType));
  }

  const rows = await db
    .select()
    .from(teamActivityLogs)
    .where(and(...conds))
    .orderBy(desc(teamActivityLogs.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const logs = rows.slice(0, limit);
  res.json({ logs, hasMore, nextOffset: offset + logs.length });
});

export default router;
