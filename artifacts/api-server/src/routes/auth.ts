import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

// POST /api/auth/sync — create or update the user record from Clerk data.
// Each Clerk user is the sole owner of their brand; role is always 'owner'.
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

// PATCH /api/auth/onboarding — save brand setup answers and mark onboarding complete
router.patch("/onboarding", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const { brandName, brandType, brandStage, sellModel } = req.body;
  if (!brandName || typeof brandName !== "string" || brandName.trim() === "") {
    res.status(400).json({ error: "brandName required" }); return;
  }
  const [updated] = await db
    .update(users)
    .set({
      brandName: brandName.trim(),
      ...(brandType  && { brandType }),
      ...(brandStage && { brandStage }),
      ...(sellModel  && { sellModel }),
      onboardingComplete: true,
      updatedAt: new Date(),
    })
    .where(eq(users.clerkId, clerkUserId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "User not found — call POST /auth/sync first" });
    return;
  }
  res.json(updated);
});

// GET /api/auth/me
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
