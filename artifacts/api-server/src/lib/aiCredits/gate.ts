import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { AI_FAILED_UNITS_LOCAL, findToolRule, unitsFor } from "./catalogue";
import { allowTextRequest, debitCredits, meterRequest, refundDebit } from "./ledger";
import { acquireLowPrioritySlot } from "./lowPriority";

const GENERIC_LIMIT = { error: "Too many requests, try again later" };

/**
 * Enforces the AI rules in lib/aiCredits/catalogue.ts for every matching
 * route. Mounted once in routes/index.ts ahead of the AI routers, so the
 * routes themselves stay untouched. Requests without a signed-in user pass
 * through; the route's own auth answers them and no AI provider is reached.
 * Paths are matched in normalized form (case, repeated and trailing slashes).
 *
 *  - text rules (chat) are free; only a silent anti-abuse ceiling applies and
 *    it answers with a generic message
 *  - metered rules (support chat, store AI, the onboarding sample) are free to
 *    the user but capped per user per day and counted toward the global cap
 *  - generation rules debit cost x units credits before the handler runs, which
 *    makes it impossible to run a paid call without credits or past the caps;
 *    if the handler answers with an error the credits are returned, and units a
 *    handler reports as failed are returned on success
 */
export async function aiCreditsGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const rule = findToolRule(req.method, req.path);
  if (!rule) return next();
  const { userId } = getAuth(req);
  if (!userId) return next();

  if (rule.kind === "text") {
    try {
      if (!(await allowTextRequest(userId))) {
        res.status(429).json(GENERIC_LIMIT);
        return;
      }
    } catch (err) {
      // The ceiling is an abuse guard, not billing: never block chat because it failed.
      req.log?.warn({ err }, "AI text ceiling check failed");
    }
    return next();
  }

  if (rule.kind === "metered") {
    try {
      const result = await meterRequest({
        clerkUserId: userId, toolKey: rule.tool, cost: rule.cost, dailyLimit: rule.dailyLimit?.() ?? 1,
      });
      if (!result.ok) {
        if (result.reason === "rate_limited") res.status(429).json(GENERIC_LIMIT);
        else res.status(503).json({ error: "AI limit reached", code: result.reason, toolKey: rule.tool });
        return;
      }
      const entryId = result.entryId;
      res.on("finish", () => {
        if (res.statusCode >= 400) {
          refundDebit(entryId).catch((err) => req.log?.error({ err, entryId }, "AI metered refund failed"));
        }
      });
      return next();
    } catch (err) {
      // Fail closed: the global spend cap could not be checked.
      req.log?.error({ err }, "AI metering failed");
      res.status(503).json({ error: "AI is temporarily unavailable", code: "credits_unavailable" });
      return;
    }
  }

  const units = unitsFor(rule, req.body);
  const cost = rule.cost * units;
  try {
    const result = await debitCredits({ clerkUserId: userId, cost, units, toolKey: rule.tool });
    if (!result.ok) {
      if (result.reason === "rate_limited") {
        res.status(429).json(GENERIC_LIMIT);
        return;
      }
      if (result.reason === "insufficient_credits") {
        res.status(402).json({
          error: "Not enough AI credits",
          code: "insufficient_credits",
          toolKey: rule.tool,
          cost,
          balance: result.balance,
        });
        return;
      }
      if (result.reason === "billing_issue") {
        res.status(402).json({
          error: "AI tools are paused until your subscription payment goes through",
          code: "billing_issue",
          toolKey: rule.tool,
          cost,
          balance: result.balance,
        });
        return;
      }
      res.status(503).json({ error: "AI limit reached", code: result.reason, toolKey: rule.tool, cost, balance: result.balance });
      return;
    }
    const entryId = result.entryId;
    (req as Request & { aiCreditEntryId?: string }).aiCreditEntryId = entryId;
    if (!result.unlimited) {
      res.setHeader("X-AI-Credits-Charged", String(cost));
      res.setHeader("X-AI-Credits-Balance", String(result.balance));
    }
    res.on("finish", () => {
      if (res.statusCode >= 400) {
        refundDebit(entryId).catch((err) => req.log?.error({ err, entryId }, "AI credit refund failed"));
        return;
      }
      const failed = Number(res.locals?.[AI_FAILED_UNITS_LOCAL] ?? 0);
      if (units > 1 && Number.isInteger(failed) && failed > 0) {
        refundDebit(entryId, { units: Math.min(failed, units) })
          .catch((err) => req.log?.error({ err, entryId }, "AI credit partial refund failed"));
      }
    });

    if (result.lowPriority) {
      let aborted = false;
      const release = await acquireLowPrioritySlot((cb) => {
        res.once("close", () => { aborted = true; cb(); });
      });
      if (!release || aborted) {
        // The client left while queued: nothing ran, so give the usage back.
        refundDebit(entryId).catch((err) => req.log?.error({ err, entryId }, "AI usage refund failed"));
        return;
      }
      res.once("close", release);
    }
    next();
  } catch (err) {
    // Fail closed: if billing cannot be verified, the paid call must not run.
    req.log?.error({ err }, "AI credits gate failed");
    res.status(503).json({ error: "AI credits are temporarily unavailable", code: "credits_unavailable" });
  }
}
