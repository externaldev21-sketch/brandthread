/**
 * Admin → platform balance health (BT-062). Read-only.
 *
 * GET /api/admin/platform-balance          last hourly check (runs one if none yet)
 * GET /api/admin/platform-balance?fresh=1  runs the check now
 *
 * `schedule.ok` is false when the platform Stripe account is not on manual
 * payouts while PAYOUT_MODE=hold; `coverage.ok` is false when the platform's
 * available + pending balance is below total seller_held.
 */
import { Router } from "express";
import { stripe } from "../../lib/stripe";
import { checkPlatformBalance, lastPlatformBalanceReport } from "../../lib/money/platformBalance";

const router = Router();

router.get("/platform-balance", async (req, res) => {
  try {
    const fresh = req.query.fresh === "1" || req.query.fresh === "true";
    const report = (!fresh && lastPlatformBalanceReport()) || await checkPlatformBalance({ stripe });
    const healthy = report.stripeConfigured
      && report.schedule?.ok !== false
      && report.coverage?.ok !== false
      && report.errors.length === 0;
    res.json({ healthy, ...report });
  } catch (err) {
    req.log.error({ err }, "Platform balance check failed");
    res.status(500).json({ error: "Platform balance check failed" });
  }
});

export default router;
