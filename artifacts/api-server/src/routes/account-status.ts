/**
 * Account status (feature 72) and your own reports (feature 68), mounted at
 * /api/account-status. Signed-in only; each person sees only their own.
 *
 * GET /          → standing, active strikes (of 3), strike history
 * GET /reports   → reports you filed and what happened to them
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { loadAccountStatus, loadMyReports } from "../lib/accountStatus";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  try {
    res.json(await loadAccountStatus(userId));
  } catch (err) {
    req.log?.error({ err, userId }, "Account status failed");
    res.status(500).json({ error: "We couldn't load your account status. Try again." });
  }
});

router.get("/reports", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  try {
    res.json({ reports: await loadMyReports(userId) });
  } catch (err) {
    req.log?.error({ err, userId }, "Your reports failed");
    res.status(500).json({ error: "We couldn't load your reports. Try again." });
  }
});

export default router;
