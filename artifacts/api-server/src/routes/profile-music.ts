/**
 * Profile song — see lib/profileMusic.ts for the provider and the flag.
 *
 * GET /api/profile-music/config          — { enabled }
 * GET /api/profile-music/search?q=       — tracks from the licensed provider (503 when off)
 * PUT /api/profile-music/me              — { trackId: string | null }; null removes it (allowed when off)
 * GET /api/profile-music/user/:userId    — { song } for a profile (null when off, blocked or none)
 *
 * The client only ever sends a track id; title, artist and the preview URL
 * are re-read from the provider, so a profile can't point at arbitrary audio.
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { isBlockedEitherWay, optionalViewerId } from "../lib/safety";
import { parseStoredSong, profileMusicProvider } from "../lib/profileMusic";

const router = Router();

router.get("/config", async (_req, res) => {
  res.json({ enabled: !!(await profileMusicProvider()) });
});

router.get("/search", requireAuth, async (req, res) => {
  const provider = await profileMusicProvider();
  if (!provider) return res.status(503).json({ code: "PROFILE_MUSIC_OFF", error: "Profile music is off" });
  const q = String(req.query.q ?? "").trim().slice(0, 100);
  if (!q) return res.json({ tracks: [] });
  return res.json({ tracks: await provider.search(q) });
});

router.put("/me", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { trackId } = req.body as { trackId?: unknown };
  if (trackId === null) {
    await db.update(users).set({ profileSong: null, updatedAt: new Date() }).where(eq(users.clerkId, userId));
    return res.json({ song: null });
  }
  if (typeof trackId !== "string" || !trackId) return res.status(400).json({ error: "trackId must be a string or null" });
  const provider = await profileMusicProvider();
  if (!provider) return res.status(503).json({ code: "PROFILE_MUSIC_OFF", error: "Profile music is off" });
  const song = await provider.byId(trackId);
  if (!song) return res.status(404).json({ error: "Track not found" });
  await db.update(users).set({ profileSong: song, updatedAt: new Date() }).where(eq(users.clerkId, userId));
  return res.json({ song });
});

router.get("/user/:userId", async (req, res) => {
  if (!(await profileMusicProvider())) return res.json({ song: null });
  const viewerId = optionalViewerId(req);
  const ownerId = req.params.userId;
  if (viewerId && viewerId !== ownerId && (await isBlockedEitherWay(viewerId, ownerId))) return res.json({ song: null });
  const [row] = await db
    .select({ song: users.profileSong, suspendedAt: users.suspendedAt, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.clerkId, ownerId))
    .limit(1);
  if (!row || row.suspendedAt || row.deletedAt) return res.json({ song: null });
  return res.json({ song: parseStoredSong(row.song) });
});

export default router;
