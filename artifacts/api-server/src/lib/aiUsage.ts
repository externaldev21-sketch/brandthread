/**
 * Per-user AI spend metering. The OpenAI client (lib/integrations-openai-ai-server)
 * reports each completed call; this module attributes it to the signed-in
 * caller of the current request (via AsyncLocalStorage) and appends a row to
 * ai_usage_events for the admin dashboard. Best-effort: a failed insert is
 * logged and never affects the AI call.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { db, aiUsageEvents } from "@workspace/db";
import { setAiUsageReporter, type AiUsageReport } from "@workspace/integrations-openai-ai-server";
import { priceAiUsage } from "./admin/aiPricing";
import { logger } from "./logger";

const userContext = new AsyncLocalStorage<{ userId: string | null }>();

/** Express middleware: remembers the caller for any AI call made while handling the request. */
export function aiUsageContext(req: Request, _res: Response, next: NextFunction): void {
  let userId: string | null = null;
  try {
    userId = getAuth(req)?.userId ?? null;
  } catch {
    userId = null;
  }
  userContext.run({ userId }, next);
}

export async function recordAiUsage(report: AiUsageReport, userId: string | null): Promise<void> {
  if (report.inputTokens === 0 && report.outputTokens === 0) return;
  const { costMicros, priced } = priceAiUsage(report.model, report.inputTokens, report.outputTokens);
  try {
    await db.insert(aiUsageEvents).values({
      userId,
      feature: report.feature,
      model: report.model,
      inputTokens: report.inputTokens,
      outputTokens: report.outputTokens,
      costMicros,
      priced,
    });
  } catch (err) {
    logger.warn({ err, model: report.model }, "Failed to record AI usage");
  }
}

setAiUsageReporter((report) => {
  void recordAiUsage(report, userContext.getStore()?.userId ?? null);
});
