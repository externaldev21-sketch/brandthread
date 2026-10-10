/**
 * requireAiConsent - refuses to let a write request reach an AI route until
 * the signed-in user has allowed AI data sharing (users.ai_data_consent_at).
 *
 *   router.use("/brandthread-agent", requireAiConsent(), aiSafetyGuard(...), router)
 *
 * Mounted BEFORE aiSafetyGuard so not even the moderation call sees the text
 * of a user who has not consented. Answers
 *   428 { error, code: "AI_CONSENT_REQUIRED", provider: "OpenAI" }
 * and fails closed (503) when consent cannot be read. GET/HEAD/OPTIONS and
 * signed-out requests pass through (the route's own auth answers those).
 */
import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import {
  AI_CONSENT_PROVIDER,
  AI_CONSENT_REQUIRED_CODE,
  AI_CONSENT_REQUIRED_MESSAGE,
  hasAiConsent,
  isConsentGatedMethod,
} from "../lib/aiConsent";
import { logger } from "../lib/logger";

export interface RequireAiConsentOptions {
  /** Test seams. */
  getUserId?: (req: Request) => string | null;
  hasConsent?: (userId: string) => Promise<boolean>;
}

const CHECKED = Symbol.for("brandthread.aiConsentChecked");

function defaultUserId(req: Request): string | null {
  const fromRequireAuth = (req as any).clerkUserId as string | undefined;
  if (fromRequireAuth) return fromRequireAuth;
  try {
    return getAuth(req).userId ?? null;
  } catch {
    return null;
  }
}

export function requireAiConsent(options: RequireAiConsentOptions = {}) {
  const getUserId = options.getUserId ?? defaultUserId;
  const hasConsent = options.hasConsent ?? hasAiConsent;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!isConsentGatedMethod(req.method) || (req as any)[CHECKED]) {
      next();
      return;
    }
    const userId = getUserId(req);
    if (!userId) {
      next();
      return;
    }
    let ok = false;
    try {
      ok = await hasConsent(userId);
    } catch (err) {
      logger.error({ err }, "AI consent lookup failed");
      res.status(503).json({ error: "Could not check AI data sharing settings. Try again.", code: "AI_CONSENT_UNAVAILABLE" });
      return;
    }
    if (!ok) {
      res.status(428).json({
        error: AI_CONSENT_REQUIRED_MESSAGE,
        code: AI_CONSENT_REQUIRED_CODE,
        provider: AI_CONSENT_PROVIDER,
      });
      return;
    }
    (req as any)[CHECKED] = true;
    next();
  };
}
