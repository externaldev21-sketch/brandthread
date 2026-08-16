import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

// ─── Username validation ──────────────────────────────────────────────────────
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

function validateUsername(u: string): string | null {
  if (!u || u.trim() === "") return "Username is required.";
  if (/\s/.test(u)) return "Username cannot contain spaces.";
  if (!USERNAME_REGEX.test(u))
    return "Username may only contain letters, numbers, and underscores (3–30 characters).";
  return null; // valid
}

// ─── POST /api/auth/sync ──────────────────────────────────────────────────────
// Create or update the user record from Clerk data.
router.post("/sync", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  try {
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
    const name =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      email.split("@")[0];
    const avatarUrl = clerkUser.imageUrl;

    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(users)
        .set({ email, name, avatarUrl, updatedAt: new Date() })
        .where(eq(users.clerkId, clerkUserId))
        .returning();
      res.json(updated);
    } else {
      const [created] = await db
        .insert(users)
        .values({ clerkId: clerkUserId, email, name, avatarUrl, role: "owner" })
        .returning();
      res.json(created);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to sync user" });
  }
});

// ─── PATCH /api/auth/onboarding ───────────────────────────────────────────────
// Save brand setup answers and mark onboarding complete.
// Accepts optional username; validates format and uniqueness if provided.
router.patch("/onboarding", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const { brandName, brandType, brandStage, sellModel, username } = req.body;

  if (!brandName || typeof brandName !== "string" || brandName.trim() === "") {
    res.status(400).json({ error: "brandName required" });
    return;
  }

  const updates: Record<string, any> = {
    brandName: brandName.trim(),
    ...(brandType && { brandType }),
    ...(brandStage && { brandStage }),
    ...(sellModel && { sellModel }),
    onboardingComplete: true,
    updatedAt: new Date(),
  };

  // Validate and persist username if provided
  if (username !== undefined) {
    const uname = String(username).trim().toLowerCase();
    const fmtErr = validateUsername(uname);
    if (fmtErr) {
      res.status(400).json({ error: fmtErr });
      return;
    }
    const [taken] = await db
      .select({ clerkId: users.clerkId })
      .from(users)
      .where(eq(users.username, uname))
      .limit(1);
    if (taken && taken.clerkId !== clerkUserId) {
      res.status(409).json({ error: "Username is already taken." });
      return;
    }
    updates.username = uname;
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.clerkId, clerkUserId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found — call POST /auth/sync first" });
    return;
  }
  res.json(updated);
});

// ─── PATCH /api/auth/profile ──────────────────────────────────────────────────
// Update editable profile fields. Validates and enforces uniqueness on username.
router.patch("/profile", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { displayName, bio, website, name, username } = req.body as {
    displayName?: string;
    bio?:         string;
    website?:     string;
    name?:        string;
    username?:    string;
  };

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (displayName !== undefined) updates.displayName = displayName;
  if (bio         !== undefined) updates.bio         = bio;
  if (website     !== undefined) updates.website     = website;
  if (name        !== undefined) updates.name        = name;

  // Username: format + uniqueness check
  if (username !== undefined) {
    const uname = String(username).trim().toLowerCase();
    if (uname === "") {
      // Allow clearing username
      updates.username = null;
    } else {
      const fmtErr = validateUsername(uname);
      if (fmtErr) {
        res.status(400).json({ error: fmtErr });
        return;
      }
      // Check uniqueness — skip if this user already owns it
      const [taken] = await db
        .select({ clerkId: users.clerkId })
        .from(users)
        .where(eq(users.username, uname))
        .limit(1);
      if (taken && taken.clerkId !== clerkId) {
        res.status(409).json({ error: "Username is already taken." });
        return;
      }
      updates.username = uname;
    }
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.clerkId, clerkId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(updated);
});

// ─── GET /api/auth/username/check ─────────────────────────────────────────────
// Real-time availability check. Returns { available: boolean, error?: string }.
// Requires auth so the current user's own username is never flagged as taken.
router.get("/username/check", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const raw = (req.query.username as string || "").trim().toLowerCase();

  const fmtErr = validateUsername(raw);
  if (fmtErr) {
    res.json({ available: false, error: fmtErr });
    return;
  }

  const [existing] = await db
    .select({ clerkId: users.clerkId })
    .from(users)
    .where(eq(users.username, raw))
    .limit(1);

  if (existing && existing.clerkId !== clerkUserId) {
    res.json({ available: false, error: "Username is already taken." });
  } else {
    res.json({ available: true });
  }
});

// ─── GET /api/auth/privacy ────────────────────────────────────────────────────
// Returns the caller's server-side privacy settings.
router.get("/privacy", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const [user] = await db
    .select({ dmPrivacy: users.dmPrivacy })
    .from(users)
    .where(eq(users.clerkId, clerkUserId))
    .limit(1);
  res.json({ dmPrivacy: user?.dmPrivacy ?? "requests" });
});

// ─── PATCH /api/auth/privacy ─────────────────────────────────────────────────
// Update server-side privacy settings. Currently exposes dmPrivacy; extensible
// — add more fields here as the product grows.
router.patch("/privacy", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const { dmPrivacy } = req.body as { dmPrivacy?: string };

  const validDmPrivacy = ["requests", "followers_only"];
  if (dmPrivacy !== undefined && !validDmPrivacy.includes(dmPrivacy)) {
    res.status(400).json({ error: `dmPrivacy must be one of: ${validDmPrivacy.join(", ")}` });
    return;
  }

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (dmPrivacy !== undefined) updates.dmPrivacy = dmPrivacy;

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.clerkId, clerkUserId))
    .returning({ dmPrivacy: users.dmPrivacy });

  res.json({ dmPrivacy: updated?.dmPrivacy ?? "requests" });
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkUserId))
    .limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found — call POST /auth/sync first" });
    return;
  }
  res.json(user);
});

export default router;
