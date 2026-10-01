import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { db, users } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { validateRequest } from "../middlewares/validateRequest";
import { ageBandFromDob, isAgeBand, type AgeBand } from "../lib/ageGate";

const router = Router();

const ageBodySchema = z.object({
  dateOfBirth: z.string().trim(),
}).passthrough();

const UNDER_13_MESSAGE = "You must be at least 13 to use Brandthread.";

/** Best-effort sign-out everywhere for an account that failed the age gate. */
async function revokeAllSessions(clerkUserId: string, log?: { warn: (o: unknown, m: string) => void }) {
  try {
    const list = await clerkClient.sessions.getSessionList({ userId: clerkUserId, status: "active", limit: 100 });
    await Promise.all(list.data.map((s) => clerkClient.sessions.revokeSession(s.id)));
  } catch (err) {
    log?.warn({ err }, "could not revoke sessions for under-13 account");
  }
}

// POST /api/auth/age  { dateOfBirth: "YYYY-MM-DD" }
// The date of birth is read from the request, reduced to a band, and dropped:
// it is never written to the database or logged. The band is set once.
router.post("/age", requireAuth, validateRequest({ body: ageBodySchema }), async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const band = ageBandFromDob(req.body.dateOfBirth, new Date());
  if (!band) {
    res.status(400).json({ error: "Enter a valid date of birth.", code: "AGE_INVALID_DOB" });
    return;
  }

  const [existing] = await db
    .select({ ageBand: users.ageBand })
    .from(users)
    .where(eq(users.clerkId, clerkUserId))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "User not found — call POST /auth/sync first" });
    return;
  }

  // Already answered: immutable (no self-upgrade or downgrade; only support changes it).
  if (isAgeBand(existing.ageBand)) {
    if (existing.ageBand === "under_13") {
      res.status(403).json({ error: UNDER_13_MESSAGE, code: "AGE_UNDER_13" });
      return;
    }
    if (existing.ageBand === band) {
      res.json({ ageBand: existing.ageBand });
      return;
    }
    res.status(409).json({
      error: "Your age has already been set. Contact support to change it.",
      code: "AGE_BAND_LOCKED",
      ageBand: existing.ageBand,
    });
    return;
  }

  const now = new Date();
  const values: { ageBand: AgeBand; ageVerifiedAt: Date; updatedAt: Date; underageBlockedAt?: Date } = {
    ageBand: band,
    ageVerifiedAt: now,
    updatedAt: now,
  };
  if (band === "under_13") values.underageBlockedAt = now;

  const updated = await db
    .update(users)
    .set(values)
    .where(and(eq(users.clerkId, clerkUserId), isNull(users.ageBand)))
    .returning({ ageBand: users.ageBand });

  if (updated.length === 0) {
    // Lost a race with a concurrent answer; report the stored value.
    const [current] = await db.select({ ageBand: users.ageBand }).from(users).where(eq(users.clerkId, clerkUserId)).limit(1);
    res.status(409).json({ error: "Your age has already been set.", code: "AGE_BAND_LOCKED", ageBand: current?.ageBand ?? null });
    return;
  }

  if (band === "under_13") {
    await revokeAllSessions(clerkUserId, (req as any).log);
    res.status(403).json({ error: UNDER_13_MESSAGE, code: "AGE_UNDER_13" });
    return;
  }
  res.json({ ageBand: band });
});

export default router;
