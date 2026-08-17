/**
 * Seller Vacation Mode
 *
 * GET /api/seller/vacation  — current vacation mode state
 * PUT /api/seller/vacation  — set { vacationMode, vacationMessage?, vacationUntil? }
 */
import { Router } from "express";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

// GET /api/seller/vacation
router.get("/", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;

  const [user] = await db
    .select({
      vacationMode:    users.vacationMode,
      vacationMessage: users.vacationMessage,
      vacationUntil:   users.vacationUntil,
    })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!user) return res.status(404).json({ error: "User not found" });

  // Auto-clear expired vacation mode
  if (user.vacationMode && user.vacationUntil && new Date(user.vacationUntil) < new Date()) {
    await db
      .update(users)
      .set({ vacationMode: false, vacationUntil: null, updatedAt: new Date() })
      .where(eq(users.clerkId, clerkId));
    return res.json({ vacationMode: false, vacationMessage: user.vacationMessage, vacationUntil: null });
  }

  return res.json(user);
});

// PUT /api/seller/vacation
router.put("/", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { vacationMode, vacationMessage, vacationUntil } = req.body as {
    vacationMode?:    boolean;
    vacationMessage?: string;
    vacationUntil?:   string | null;
  };

  if (typeof vacationMode !== "boolean") {
    return res.status(400).json({ error: "vacationMode (boolean) required" });
  }

  const [updated] = await db
    .update(users)
    .set({
      vacationMode,
      vacationMessage: vacationMessage?.trim() || null,
      vacationUntil:   vacationUntil ? new Date(vacationUntil) : null,
      updatedAt:       new Date(),
    })
    .where(eq(users.clerkId, clerkId))
    .returning({
      vacationMode:    users.vacationMode,
      vacationMessage: users.vacationMessage,
      vacationUntil:   users.vacationUntil,
    });

  return res.json(updated);
});

export default router;
