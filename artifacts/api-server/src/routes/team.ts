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
import { eq, and, ne, or, asc, desc, gt, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  teamContext,
  requireRole,
  InvalidStoreContextError,
  resolveTeamContext,
} from "../middlewares/requireRole";
import { logActivity, reqActor } from "../lib/activityLog";
import { teamMembershipOrderBy } from "../lib/teamMembership";
import {
  inviteUrls,
  resetTeamInviteReminderTracking,
  sendTeamInviteEmail,
} from "../lib/teamInvites";
import crypto from "crypto";
import { getVerifiedPlanAccess, sendPlanLimitReached, sendPlanLookupUnavailable } from "../lib/planAccess";

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
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

async function activeMembershipsFor(userId: string) {
  const memberships = await db
    .select({
      id: teamMembers.id,
      ownerId: teamMembers.ownerId,
      role: teamMembers.role,
      acceptedAt: teamMembers.acceptedAt,
    })
    .from(teamMembers)
    .where(and(eq(teamMembers.memberClerkId, userId), eq(teamMembers.status, "active")))
    .orderBy(...teamMembershipOrderBy());

  const ownerIds = [...new Set(
    memberships
      .map((membership) => membership.ownerId)
      .filter((ownerId) => ownerId !== userId),
  )];
  const owners = ownerIds.length === 0
    ? []
    : await db
      .select({
        clerkId: users.clerkId,
        name: users.name,
        displayName: users.displayName,
        brandName: users.brandName,
      })
      .from(users)
      .where(inArray(users.clerkId, ownerIds));
  const ownerById = new Map(owners.map((owner) => [owner.clerkId, owner]));

  return memberships
    .filter((membership) => membership.ownerId !== userId)
    .map((membership) => {
      const owner = ownerById.get(membership.ownerId);
      return {
        id: membership.id,
        ownerId: membership.ownerId,
        role: membership.role,
        acceptedAt: membership.acceptedAt,
        ownerName: owner?.brandName ?? owner?.displayName ?? owner?.name ?? "Another store",
      };
    });
}

/**
 * Returns true when an invite token is expired.
 * NULL expiry is treated as expired (fail-closed) — the migration backfills all
 * existing pending rows, so NULL should never appear after upgrade. If it does,
 * rejecting it is safer than accepting a link with unknown age.
 */
function isExpired(m: typeof teamMembers.$inferSelect): boolean {
  if (!m.expiresAt) return true; // no expiry set → fail-closed
  return new Date(m.expiresAt) < new Date();
}

async function lockTeamSeats(tx: any, ownerId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"team-seat-limit:" + ownerId}))`);
}

async function teamSeatCount(tx: any, ownerId: string): Promise<number> {
  const rows = await tx
    .select({ status: teamMembers.status, expiresAt: teamMembers.expiresAt })
    .from(teamMembers)
    .where(and(eq(teamMembers.ownerId, ownerId), ne(teamMembers.status, "removed")));
  const now = Date.now();
  return rows.filter((row: { status: string; expiresAt: Date | null }) =>
    row.status === "active"
    || (row.status === "pending" && !!row.expiresAt && row.expiresAt.valueOf() > now),
  ).length;
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
    expiresAt: m.expiresAt ?? null,
    expired: m.status === "pending" && isExpired(m),
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
  // Expired tokens: return a 200 with expired=true so the client can show a distinct state
  if (invite.status === "pending" && isExpired(invite)) {
    res.json({ valid: false, expired: true, error: "This invite link has expired. Ask the store owner to send a new one." });
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
    expiresAt: invite.expiresAt ?? null,
    owner: {
      name: owner?.displayName ?? owner?.name ?? "A Brandthread seller",
      brandName: owner?.brandName ?? null,
    },
  });
});

// ─── Authenticated routes ─────────────────────────────────────────────────────
router.use(requireAuth);

// GET /api/team/my-memberships — all active memberships in other stores.
// Must be placed BEFORE teamContext() so it always reads the real caller's id.
router.get("/my-memberships", async (req, res) => {
  const userId = (req as any).clerkUserId as string | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  try {
    res.json({ memberships: await activeMembershipsFor(userId) });
  } catch (err) {
    req.log.error({ err, userId }, "Team memberships lookup failed");
    res.status(503).json({
      error: "Unable to load store memberships",
      code: "STORE_MEMBERSHIPS_UNAVAILABLE",
    });
  }
});

// GET /api/team/my-membership — legacy single-membership response. Keep this
// while clients migrate to the explicit multi-store switcher.
router.get("/my-membership", async (req, res) => {
  const userId = (req as any).clerkUserId as string | undefined;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  try {
    const [membership] = await activeMembershipsFor(userId);
    if (!membership) {
      res.json({ membership: null });
      return;
    }

    res.json({ membership });
  } catch (err) {
    req.log.error({ err, userId }, "Team membership lookup failed");
    res.json({ membership: null });
  }
});

// POST /api/team/context — validate an explicit store selection. The selection
// is request-scoped; clients should send the returned membership id in
// X-Store-Context on subsequent requests.
router.post("/context", async (req, res) => {
  const selection =
    typeof req.body?.storeContext === "string"
      ? req.body.storeContext
      : typeof req.body?.membershipId === "string"
        ? req.body.membershipId
        : null;
  if (!selection || (selection !== "own" && selection !== "joined" && !isUuid(selection))) {
    res.status(400).json({
      error: "Choose your own store or an active store membership.",
      code: "INVALID_STORE_CONTEXT",
    });
    return;
  }

  req.headers["x-store-context"] = selection;
  try {
    const context = await resolveTeamContext(req);
    res.json({
      storeContext: selection,
      storeOwnerId: context?.storeOwnerId ?? null,
      teamMembershipId: context?.teamMembershipId ?? null,
      role: context?.actorRole ?? "owner",
    });
  } catch (err) {
    if (err instanceof InvalidStoreContextError) {
      res.status(403).json({
        error: err.message,
        code: "STORE_CONTEXT_NOT_ALLOWED",
      });
      return;
    }
    req.log.error({ err }, "Store context selection failed");
    res.status(503).json({
      error: "Unable to verify the selected store",
      code: "STORE_CONTEXT_UNAVAILABLE",
    });
  }
});

router.use(teamContext());

/** GET /api/team/context — resolved role for the active store context. */
router.get("/context", (req, res) => {
  const context = (req as any).teamContext;
  res.json({
    role: context?.actorRole ?? "owner",
    storeOwnerId: context?.storeOwnerId ?? (req as any).clerkUserId ?? null,
    teamMembershipId: context?.teamMembershipId ?? null,
  });
});

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
  if (invite.status === "pending" && isExpired(invite)) {
    res.status(410).json({ error: "This invite link has expired. Ask the store owner to send a new one.", expired: true });
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

  let access;
  try {
    access = await getVerifiedPlanAccess(invite.ownerId);
  } catch (error) {
    sendPlanLookupUnavailable(req, res, error);
    return;
  }
  const acceptance = await db.transaction(async (tx) => {
    await lockTeamSeats(tx, invite.ownerId);
    const [currentInvite] = await tx
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.id, invite.id))
      .limit(1);
    if (!currentInvite || currentInvite.status !== "pending") {
      return { kind: "used" as const };
    }
    if (isExpired(currentInvite)) {
      return { kind: "expired" as const };
    }
    const limit = access.limits.teamSeats;
    if (limit !== null && await teamSeatCount(tx, invite.ownerId) > limit) {
      return { kind: "limited" as const };
    }
    const [accepted] = await tx
      .update(teamMembers)
      .set({
        memberClerkId: actorId,
        status: "active",
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(teamMembers.id, invite.id),
        eq(teamMembers.status, "pending"),
        gt(teamMembers.expiresAt, new Date()),
      ))
      .returning();
    if (accepted) return { kind: "accepted" as const, member: accepted };
    const [latest] = await tx.select().from(teamMembers).where(eq(teamMembers.id, invite.id)).limit(1);
    return latest?.status === "pending" && isExpired(latest)
      ? { kind: "expired" as const }
      : { kind: "used" as const };
  });
  if (acceptance.kind === "expired") {
    res.status(410).json({ error: "This invite link has expired. Ask the store owner to send a new one.", expired: true });
    return;
  }
  if (acceptance.kind === "used") {
    res.status(409).json({ error: "This invite has already been used" });
    return;
  }
  if (acceptance.kind === "limited") {
    sendPlanLimitReached(res, {
      resource: "teamSeats",
      currentPlan: access.planId,
      requiredPlan: access.planId === "starter" ? "growth" : "scale",
      limit: access.limits.teamSeats!,
    });
    return;
  }
  const updated = acceptance.member;

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

  let access;
  try {
    access = await getVerifiedPlanAccess(ownerId);
  } catch (error) {
    sendPlanLookupUnavailable(req, res, error);
    return;
  }

  const inviteToken = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const admission = await db.transaction(async (tx) => {
    await lockTeamSeats(tx, ownerId);
    const [existing] = await tx
      .select({ status: teamMembers.status, expiresAt: teamMembers.expiresAt })
      .from(teamMembers)
      .where(and(eq(teamMembers.ownerId, ownerId), eq(teamMembers.email, normEmail)))
      .limit(1);
    if (existing?.status === "active") return { kind: "active" as const };
    const limit = access.limits.teamSeats;
    const existingConsumesSeat = existing?.status === "pending"
      && !!existing.expiresAt
      && existing.expiresAt.valueOf() > Date.now();
    if (limit !== null && !existingConsumesSeat && await teamSeatCount(tx, ownerId) >= limit) {
      return { kind: "limited" as const };
    }
    const [member] = await tx
      .insert(teamMembers)
      .values({ ownerId, email: normEmail, name: name ?? null, role, inviteToken, expiresAt, status: "pending" })
      .onConflictDoUpdate({
        target: [teamMembers.ownerId, teamMembers.email],
        set: {
          role, inviteToken, expiresAt, status: "pending", memberClerkId: null,
          acceptedAt: null, invitedAt: new Date(), ...resetTeamInviteReminderTracking(),
          ...(name ? { name } : {}), updatedAt: new Date(),
        },
      })
      .returning();
    return { kind: "created" as const, member };
  });
  if (admission.kind === "active") {
    res.status(409).json({ error: `${normEmail} is already on your team` });
    return;
  }
  if (admission.kind === "limited") {
    sendPlanLimitReached(res, {
      resource: "teamSeats",
      currentPlan: access.planId,
      requiredPlan: access.planId === "starter" ? "growth" : "scale",
      limit: access.limits.teamSeats!,
    });
    return;
  }
  const member = admission.member;

  const { inviteUrl, deepLink } = inviteUrls(inviteToken);
  const actor = reqActor(req);
  void logActivity(
    ownerId, actor.actorClerkId, actor.actorRole,
    `Invited ${normEmail} as ${role}`,
    "team", member.id, { email: normEmail, role },
  );

  const ownerName = ownerUser?.brandName ?? ownerUser?.displayName ?? ownerUser?.name ?? "A Brandthread seller";
  const emailSent = await sendTeamInviteEmail(normEmail, ownerName, role, inviteUrl);

  res.json({ ok: true, member: decorateMember(member, true), inviteToken, inviteUrl, deepLink, emailSent });
});

// POST /api/team/invite/:id/regenerate — owner rotates the token + resets expiry for a pending invite
router.post("/invite/:id/regenerate", requireRole("owner"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { id } = req.params;
  if (!isUuid(id)) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  let access;
  try {
    access = await getVerifiedPlanAccess(ownerId);
  } catch (error) {
    sendPlanLookupUnavailable(req, res, error);
    return;
  }
  const inviteToken = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const result = await db.transaction(async (tx) => {
    await lockTeamSeats(tx, ownerId);
    const [pending] = await tx
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.id, id), eq(teamMembers.ownerId, ownerId), eq(teamMembers.status, "pending")))
      .limit(1);
    if (!pending) return { kind: "missing" as const };
    const currentlyConsumesSeat = !isExpired(pending);
    const limit = access.limits.teamSeats;
    const seatsAfterRegeneration = await teamSeatCount(tx, ownerId) + (currentlyConsumesSeat ? 0 : 1);
    if (limit !== null && seatsAfterRegeneration > limit) return { kind: "limited" as const };
    const [updated] = await tx
      .update(teamMembers)
      .set({
        inviteToken, expiresAt, invitedAt: new Date(),
        ...resetTeamInviteReminderTracking(), updatedAt: new Date(),
      })
      .where(eq(teamMembers.id, id))
      .returning();
    return { kind: "updated" as const, updated };
  });
  if (result.kind === "missing") {
    res.status(404).json({ error: "Pending invite not found" });
    return;
  }
  if (result.kind === "limited") {
    sendPlanLimitReached(res, {
      resource: "teamSeats",
      currentPlan: access.planId,
      requiredPlan: access.planId === "starter" ? "growth" : "scale",
      limit: access.limits.teamSeats!,
    });
    return;
  }
  const updated = result.updated;
  const { inviteUrl, deepLink } = inviteUrls(inviteToken);
  const actor = reqActor(req);
  void logActivity(
    ownerId, actor.actorClerkId, actor.actorRole,
    `Regenerated invite link for ${updated.email}`,
    "team", id, { email: updated.email },
  );
  res.json({ ok: true, member: decorateMember(updated, true), inviteUrl, deepLink });
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

  const [existing] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.id, id), eq(teamMembers.ownerId, ownerId)))
    .limit(1);
  if (!existing || existing.status === "removed") {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  const wasExpiredInvite = existing.status === "pending" && isExpired(existing);

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
    wasExpiredInvite
      ? `Dismissed expired invite for ${removed.name ?? removed.email}`
      : `Removed ${removed.name ?? removed.email} from the team`,
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
