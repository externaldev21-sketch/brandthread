import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { findToolRule } from "./catalogue";
import { debitCredits, refundDebit } from "./ledger";

/**
 * Debits AI credits for every route listed in AI_TOOL_RULES. Mounted once in
 * routes/index.ts ahead of the AI routers, so the routes themselves stay
 * untouched. Requests without a signed-in user pass through; the route's own
 * auth answers them and no AI provider is reached.
 *
 * The debit happens before the handler, which makes it impossible to run a
 * paid call without credits and the daily caps. If the handler then answers
 * with an error (including a plan check failing further down), the credits
 * are returned.
 */
export async function aiCreditsGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const rule = findToolRule(req.method, req.path);
  if (!rule) return next();
  // Text tools are never debited; their routes carry their own rate limit.
  if (rule.kind === "text") return next();
  const { userId } = getAuth(req);
  if (!userId) return next();

  try {
    const result = await debitCredits({ clerkUserId: userId, cost: rule.cost, toolKey: rule.tool });
    if (!result.ok) {
      const body = {
        error: result.reason === "insufficient_credits" ? "Not enough AI credits" : "AI limit reached",
        code: result.reason === "insufficient_credits" ? "insufficient_credits" : result.reason,
        toolKey: rule.tool,
        cost: rule.cost,
        balance: result.balance,
      };
      const status = result.reason === "insufficient_credits" ? 402 : result.reason === "user_daily_cap" ? 429 : 503;
      res.status(status).json(body);
      return;
    }
    const entryId = result.entryId;
    (req as Request & { aiCreditEntryId?: string }).aiCreditEntryId = entryId;
    res.setHeader("X-AI-Credits-Charged", String(rule.cost));
    res.setHeader("X-AI-Credits-Balance", String(result.balance));
    res.on("finish", () => {
      if (res.statusCode >= 400) {
        refundDebit(entryId).catch((err) => req.log?.error({ err, entryId }, "AI credit refund failed"));
      }
    });
    next();
  } catch (err) {
    // Fail closed: if billing cannot be verified, the paid call must not run.
    req.log?.error({ err }, "AI credits gate failed");
    res.status(503).json({ error: "AI credits are temporarily unavailable", code: "credits_unavailable" });
  }
}
