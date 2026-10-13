/**
 * Admin → Metrics: internal marketplace numbers. Read-only.
 *
 * GET /api/admin/metrics/today            GMV, fees, orders, new buyers, sign-ups, active sellers — today vs yesterday
 * GET /api/admin/metrics/cohorts?months=6 30-day repeat-buyer rate by first-purchase month
 * GET /api/admin/metrics/top?days=30      top sellers and top products
 * GET /api/admin/metrics/funnel?days=30   install → sign-up → first purchase
 * GET /api/admin/metrics/seller-risk?days=90  refund / chargeback rate per seller, flagged above 2%
 * GET /api/admin/metrics/inactive-sellers     sellers with no activity for 14+ days
 *
 * Definitions live in lib/admin/launchMetrics.ts.
 */
import { Router } from "express";
import {
  INACTIVE_SELLER_DAYS, SELLER_RISK_THRESHOLD, acquisitionFunnel, inactiveSellers, repeatBuyerCohorts,
  sellerRefundChargebackRates, todaySnapshot, topProducts, topSellers,
} from "../../lib/admin/launchMetrics";
import { reportTimeZone, todayWindows } from "../../lib/admin/reportCalendar";
import { clampDays } from "./util";

const router = Router();
const DAY_MS = 86_400_000;

function trailing(days: number, now = new Date()) {
  return { from: new Date(now.getTime() - days * DAY_MS), to: now };
}

router.get("/metrics/today", async (req, res) => {
  const tz = reportTimeZone();
  try {
    const now = new Date();
    const snapshot = await todaySnapshot(todayWindows(now, tz));
    return res.json({ timeZone: tz, asOf: now.toISOString(), ...snapshot });
  } catch (err) {
    req.log.error({ err }, "Admin metrics today failed");
    return res.status(500).json({ error: "Could not load today's numbers." });
  }
});

router.get("/metrics/cohorts", async (req, res) => {
  const months = Math.min(Math.max(parseInt(String(req.query.months ?? 6), 10) || 6, 1), 24);
  try {
    return res.json({ windowDays: 30, cohorts: await repeatBuyerCohorts(new Date(), months) });
  } catch (err) {
    req.log.error({ err }, "Admin cohorts failed");
    return res.status(500).json({ error: "Could not load cohorts." });
  }
});

router.get("/metrics/top", async (req, res) => {
  const days = clampDays(req, 30);
  try {
    const w = trailing(days);
    const [sellers, products] = await Promise.all([topSellers(w), topProducts(w)]);
    return res.json({ days, sellers, products });
  } catch (err) {
    req.log.error({ err }, "Admin top sellers/products failed");
    return res.status(500).json({ error: "Could not load top sellers and products." });
  }
});

router.get("/metrics/funnel", async (req, res) => {
  const days = clampDays(req, 30);
  try {
    return res.json({ days, ...(await acquisitionFunnel(trailing(days))) });
  } catch (err) {
    req.log.error({ err }, "Admin funnel failed");
    return res.status(500).json({ error: "Could not load the funnel." });
  }
});

router.get("/metrics/seller-risk", async (req, res) => {
  const days = clampDays(req, 90);
  try {
    const sellers = await sellerRefundChargebackRates(trailing(days));
    return res.json({ days, threshold: SELLER_RISK_THRESHOLD, sellers });
  } catch (err) {
    req.log.error({ err }, "Admin seller risk failed");
    return res.status(500).json({ error: "Could not load refund and chargeback rates." });
  }
});

router.get("/metrics/inactive-sellers", async (req, res) => {
  try {
    const sellers = await inactiveSellers(new Date());
    return res.json({
      days: INACTIVE_SELLER_DAYS,
      // Emails stay server-side; the dashboard links to the seller instead.
      sellers: sellers.map(({ email: _email, ...s }) => s),
    });
  } catch (err) {
    req.log.error({ err }, "Admin inactive sellers failed");
    return res.status(500).json({ error: "Could not load inactive sellers." });
  }
});

export default router;
