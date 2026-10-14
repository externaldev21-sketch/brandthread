/**
 * Monthly Wrapped.
 * GET /api/buyer/wrapped?month=YYYY-MM — default: last month (UTC). Only past
 * months: a month still in progress has no recap yet.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { buildWrapped, isMonthKey, previousMonth } from "../lib/wrapped";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const buyerId = (req as unknown as { clerkUserId: string }).clerkUserId;
  const latest = previousMonth(new Date());
  const month = req.query.month === undefined ? latest : req.query.month;
  if (!isMonthKey(month) || month > latest) return res.status(400).json({ error: "month must be a past month, YYYY-MM" });
  try {
    return res.json(await buildWrapped(buyerId, month));
  } catch (err) {
    req.log.error({ err }, "Failed to build wrapped");
    return res.status(500).json({ error: "Couldn’t load your recap" });
  }
});

export default router;
