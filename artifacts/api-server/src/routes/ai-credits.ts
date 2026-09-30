/**
 * AI credits (balance + history + packs).
 *
 * GET /api/ai/credits            — balance, monthly allowance, caps, pack list, tool prices
 * GET /api/ai/credits/history    — ledger, newest first (?limit=&before=ISO)
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { AI_TOOL_RULES, CREDIT_PACKS, MONTHLY_ALLOWANCE, getSpendCaps } from "../lib/aiCredits/catalogue";
import { getAccount, listHistory } from "../lib/aiCredits/ledger";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const userId = (req as any).clerkUserId as string;
    const account = await getAccount(userId);
    const caps = getSpendCaps();
    res.json({
      ...account,
      dailyCap: caps.perUserDaily,
      allowances: MONTHLY_ALLOWANCE,
      packs: CREDIT_PACKS,
      tools: AI_TOOL_RULES.map((r) => ({ tool: r.tool, label: r.label, cost: r.cost })),
    });
  } catch (err) { next(err); }
});

router.get("/history", async (req, res, next) => {
  try {
    const userId = (req as any).clerkUserId as string;
    const limit = Number.parseInt(String(req.query.limit ?? "30"), 10);
    const before = typeof req.query.before === "string" ? req.query.before : undefined;
    res.json(await listHistory(userId, { limit: Number.isFinite(limit) ? limit : 30, before }));
  } catch (err) { next(err); }
});

export default router;
