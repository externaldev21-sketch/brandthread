/**
 * Platform admin API (mounted at /api/admin). Every route requires a signed-in
 * user whose users.role is 'admin'. See docs/admin-dashboard.md.
 *
 * GET /api/admin/me is the one exception to the admin gate: any signed-in
 * user may ask whether they are an admin (the dashboard uses it to decide
 * between rendering and redirecting).
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { requireAuth } from "../../middlewares/requireAuth";
import { requireAdmin } from "./guard";
import usersRouter from "./users";
import commerceRouter from "./commerce";
import insightsRouter from "./insights";
import growthRouter from "./growth";
import accessRouter from "./access";
import moneyRouter from "./money";
import manufacturerTrustRouter from "./manufacturerTrust";
import b2bRouter from "./b2b";

const router = Router();
router.use(requireAuth);

router.get("/me", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const [account] = await db.select({ role: users.role, email: users.email, name: users.name, suspendedAt: users.suspendedAt })
    .from(users).where(eq(users.clerkId, clerkId)).limit(1);
  const isAdmin = account?.role === "admin" && !account.suspendedAt;
  return res.json({ isAdmin, ...(isAdmin ? { email: account!.email, name: account!.name } : {}) });
});

router.use(requireAdmin);
router.use("/users", usersRouter);
router.use(commerceRouter);
router.use(insightsRouter);
router.use(growthRouter);
router.use(moneyRouter); // refunds, dispute evidence, payout holds, Thread Cash, risk
router.use("/access", accessRouter); // invite-only launch waitlist
router.use("/manufacturer-trust", manufacturerTrustRouter); // manufacturer vetting + chat contact signals
router.use(b2bRouter); // sample/bulk card refunds + B2B chargebacks

export default router;
