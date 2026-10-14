/**
 * Brand membership levels (lib/brandMembership.ts).
 *
 * Buyer (auth):
 *   GET /api/brand-membership/mine              every brand I've bought from, with my level there
 *   GET /api/brand-membership/brand/:sellerId   my level at one brand (the store header)
 * Seller (auth, manager):
 *   GET /api/brand-membership/settings          my thresholds + Inner Circle early access
 *   PUT /api/brand-membership/settings
 *
 * Levels come from what the buyer spent; nobody else's level is readable.
 */
import { Router } from "express";
import { db, brandMembershipSettings } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole, teamContext } from "../middlewares/requireRole";
import { membershipFor, membershipsFor, settingsFor, validateSettings } from "../lib/brandMembership";
import { profilesById } from "../lib/safety";

const router = Router();

router.get("/mine", requireAuth, async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const memberships = await membershipsFor(buyerId);
  const profiles = await profilesById(memberships.map((m) => m.sellerId));
  res.json({
    brands: memberships.flatMap((m) => {
      const p = profiles.get(m.sellerId);
      if (!p || p.deleted || p.suspended) return [];
      return [{ ...m, name: p.name, handle: p.handle, initials: p.initials, avatarUrl: p.avatarUrl }];
    }),
  });
});

router.get("/brand/:sellerId", requireAuth, async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const sellerId = String(req.params.sellerId ?? "").trim();
  if (!sellerId || sellerId.length > 128) { res.status(404).json({ error: "Not found" }); return; }
  if (sellerId === buyerId) { res.json({ sellerId, level: null, spendCents: 0, next: null }); return; }
  res.json(await membershipFor(sellerId, buyerId));
});

router.get("/settings", requireAuth, teamContext(), requireRole("manager"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  res.json(await settingsFor(sellerId));
});

router.put("/settings", requireAuth, teamContext(), requireRole("manager"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const parsed = validateSettings(req.body);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error, code: "INVALID_SETTINGS" }); return; }
  const v = parsed.value;
  await db.insert(brandMembershipSettings)
    .values({ sellerId, ...v, updatedAt: new Date() })
    .onConflictDoUpdate({ target: brandMembershipSettings.sellerId, set: { ...v, updatedAt: new Date() } });
  res.json(v);
});

export default router;
