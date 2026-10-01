import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { findToolRule } from "./catalogue";
import { allowTextRequest, debitCredits, refundDebit } from "./ledger";
import { acquireLowPrioritySlot } from "./lowPriority";

const GENERIC_LIMIT = { error: "Too many requests, try again later" };

/**
 * Enforces the AI rules in lib/aiCredits/catalogue.ts for every matching
 * route. Mounted once in routes/index.ts ahead of the AI routers, so the
 * routes themselves stay untouched. Requests without a signed-in user pass
 * through; the route's own auth answers them and no AI provider is reached.
 *
 *  - text rules (chat, store AI text) are free; only a silent anti-abuse
 *    ceiling applies and it answers with a generic message
 *  - generation rules debit credits before the handler runs, which makes it
 *    impossible to run a paid call without credits or past the emergency cap;
 *    if the handler then answers with an error the credits are returned
 *  - Pro is never blocked by a balance. Past the hidden fair-use line its jobs
 *    wait in a small FIFO queue (slower, never failed)
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

  try {
    const result = await debitCredits({ clerkUserId: userId, cost: rule.cost, toolKey: rule.tool });
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
          cost: rule.cost,
          balance: result.balance,
        });
        return;
      }
      res.status(503).json({ error: "AI limit reached", code: result.reason, toolKey: rule.tool, cost: rule.cost, balance: result.balance });
      return;
    }
    const entryId = result.entryId;
    (req as Request & { aiCreditEntryId?: string }).aiCreditEntryId = entryId;
    if (!result.unlimited) {
      res.setHeader("X-AI-Credits-Charged", String(rule.cost));
      res.setHeader("X-AI-Credits-Balance", String(result.balance));
    }
    res.on("finish", () => {
      if (res.statusCode >= 400) {
        refundDebit(entryId).catch((err) => req.log?.error({ err, entryId }, "AI credit refund failed"));
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
