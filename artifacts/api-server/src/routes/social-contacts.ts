/**
 * Contact sync ("Find friends from contacts") — privacy-preserving, feature-flagged.
 *
 * GET    /api/social/contacts/status   — { enabled, optedIn }
 * POST   /api/social/contacts/match    — { hashes: string[] } -> Brandthread users who opted in to be found
 * POST   /api/social/contacts/opt-in   — "let friends find me": stores hashes of MY OWN email (derived
 *                                        server-side from my account) + optional phone hash
 * DELETE /api/social/contacts          — revoke: delete every hash I stored
 *
 * The device hashes address-book entries (SHA-256 of normalized email / E.164 phone) and sends ONLY
 * hashes; raw contacts are never received or stored. Matching reads user_contact_hashes, which only
 * contains people who explicitly opted in, so a non-opted-in user can never be discovered.
 * Gated by CONTACT_SYNC_ENABLED (default OFF): when off every endpoint except /status answers 503.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { db, users, follows, blocks, userContactHashes } from "@workspace/db";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import {
  contactSyncEnabled, hashContact, isValidContactHash, normalizeEmail,
  parseHashList, resolveMatchedUserIds,
} from "../lib/contactHashes";
import { formatUser } from "./social";

const router = Router();
router.use(requireAuth);

function requireEnabled(_req: Request, res: Response, next: NextFunction) {
  if (!contactSyncEnabled()) {
    res.status(503).json({ error: "Finding friends from contacts isn't available yet.", code: "CONTACT_SYNC_DISABLED" });
    return;
  }
  next();
}

router.get("/status", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const enabled = contactSyncEnabled();
  if (!enabled) { res.json({ enabled, optedIn: false }); return; }
  try {
    const rows = await db.select({ hash: userContactHashes.hash }).from(userContactHashes)
      .where(eq(userContactHashes.userId, userId)).limit(1);
    res.json({ enabled, optedIn: rows.length > 0 });
  } catch (err) {
    (req as any).log?.error?.({ err }, "contact sync status failed");
    res.status(500).json({ error: "Couldn't check contact sync. Try again." });
  }
});

router.post("/match", requireEnabled, rateLimit("contact-match"), async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const parsed = parseHashList((req.body ?? {}).hashes);
  if (!parsed.ok) { res.status(parsed.status).json({ error: parsed.error }); return; }
  if (parsed.hashes.length === 0) { res.json({ matches: [] }); return; }
  try {
    const [hashRows, blockRows] = await Promise.all([
      db.select({ userId: userContactHashes.userId }).from(userContactHashes)
        .where(inArray(userContactHashes.hash, parsed.hashes)),
      db.select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId }).from(blocks)
        .where(or(eq(blocks.blockerId, myId), eq(blocks.blockedId, myId))),
    ]);
    const blocked = new Set(blockRows.map((b) => (b.blockerId === myId ? b.blockedId : b.blockerId)));
    const ids = resolveMatchedUserIds(hashRows, myId, blocked);
    if (ids.length === 0) { res.json({ matches: [] }); return; }

    const [userRows, followRows] = await Promise.all([
      db.select().from(users).where(and(
        inArray(users.clerkId, ids),
        eq(users.accountType, "buyer"),
        isNull(users.suspendedAt),
        isNull(users.deletedAt),
      )),
      db.select({ followingId: follows.followingId }).from(follows)
        .where(and(eq(follows.followerId, myId), inArray(follows.followingId, ids))),
    ]);
    const following = new Set(followRows.map((r) => r.followingId));
    const byId = new Map(userRows.map((u) => [u.clerkId, u]));
    const matches = ids
      .map((id) => byId.get(id))
      .filter((u): u is NonNullable<typeof u> => !!u)
      .map((u) => ({ ...formatUser(u), isFollowing: following.has(u.clerkId) }));
    res.json({ matches });
  } catch (err) {
    (req as any).log?.error?.({ err }, "contact match failed");
    res.status(500).json({ error: "Couldn't check your contacts. Try again." });
  }
});

router.post("/opt-in", requireEnabled, rateLimit("follow"), async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const phoneHash = (req.body ?? {}).phoneHash;
  if (phoneHash !== undefined && phoneHash !== null && !isValidContactHash(phoneHash)) {
    res.status(400).json({ error: "phoneHash must be a SHA-256 hex digest" });
    return;
  }
  try {
    const [me] = await db.select({ email: users.email }).from(users).where(eq(users.clerkId, myId)).limit(1);
    const email = normalizeEmail(me?.email);
    const rows: Array<{ userId: string; kind: "email" | "phone"; hash: string }> = [];
    if (email) rows.push({ userId: myId, kind: "email", hash: hashContact("email", email) });
    if (typeof phoneHash === "string") rows.push({ userId: myId, kind: "phone", hash: phoneHash });
    if (rows.length === 0) { res.status(400).json({ error: "Add an email or phone number to your account first." }); return; }
    await db.transaction(async (tx) => {
      await tx.delete(userContactHashes).where(eq(userContactHashes.userId, myId));
      await tx.insert(userContactHashes).values(rows).onConflictDoNothing();
    });
    res.json({ optedIn: true, kinds: rows.map((r) => r.kind) });
  } catch (err) {
    (req as any).log?.error?.({ err }, "contact opt-in failed");
    res.status(500).json({ error: "Couldn't turn this on. Try again." });
  }
});

// Revoke stays available even when the flag is later switched off, so stored hashes can always be removed.
router.delete("/", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  try {
    await db.delete(userContactHashes).where(eq(userContactHashes.userId, myId));
    res.json({ ok: true });
  } catch (err) {
    (req as any).log?.error?.({ err }, "contact revoke failed");
    res.status(500).json({ error: "Couldn't remove your contact info. Try again." });
  }
});

export default router;
