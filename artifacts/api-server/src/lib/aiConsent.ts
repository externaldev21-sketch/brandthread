/**
 * Consent to send content to AI providers (App Store 5.1.2(i), QA-0043).
 *
 * Every endpoint that sends what a person uploads or types to a third-party
 * AI model (the AI credits catalogue, plus AI support chat) first needs the
 * person's one-time permission, stored here server-side. Until then the API
 * answers 403 { code: "ai_consent_required" }, and the app shows the consent
 * sheet and retries. The person can withdraw it in Settings at any time.
 */
import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { eq, sql } from "drizzle-orm";
import { aiDataConsents, db } from "@workspace/db";
import { findToolRule } from "./aiCredits/catalogue";

/** Bump when the disclosure (providers or data sent) changes: everyone is asked again. */
export const AI_CONSENT_VERSION = "2026-10-06";
/** Named in the consent sheet; keep in sync with lib/aiImageProviders and the AI routes. */
export const AI_PROVIDERS = ["OpenAI", "fal.ai", "FASHN"] as const;
export const AI_CONSENT_REQUIRED = "ai_consent_required";

/** Endpoints outside the credits catalogue that also send user content to an AI model. */
const EXTRA_AI_PATHS: RegExp[] = [/^\/support-chat\/message$/];

export function requiresAiConsent(method: string, path: string): boolean {
  if (findToolRule(method, path)) return true;
  return method.toUpperCase() === "POST" && EXTRA_AI_PATHS.some((re) => re.test(path));
}

export type AiConsentState = { granted: boolean; version: string; grantedAt: string | null };

/** Pure: is a stored row a valid consent to the current disclosure? */
export function consentIsCurrent(row: { version: string; grantedAt: Date | null } | null | undefined): boolean {
  return !!row?.grantedAt && row.version === AI_CONSENT_VERSION;
}

export async function getAiConsent(clerkUserId: string): Promise<AiConsentState> {
  const [row] = await db.select().from(aiDataConsents).where(eq(aiDataConsents.clerkUserId, clerkUserId)).limit(1);
  return {
    granted: consentIsCurrent(row),
    version: AI_CONSENT_VERSION,
    grantedAt: consentIsCurrent(row) ? row!.grantedAt!.toISOString() : null,
  };
}

export async function setAiConsent(clerkUserId: string, granted: boolean, now = new Date()): Promise<AiConsentState> {
  await db.insert(aiDataConsents).values({
    clerkUserId,
    version: AI_CONSENT_VERSION,
    grantedAt: granted ? now : null,
    withdrawnAt: granted ? null : now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: aiDataConsents.clerkUserId,
    set: {
      version: AI_CONSENT_VERSION,
      grantedAt: granted ? now : null,
      withdrawnAt: granted ? null : now,
      updatedAt: sql`NOW()`,
    },
  });
  return { granted, version: AI_CONSENT_VERSION, grantedAt: granted ? now.toISOString() : null };
}

/**
 * Mounted once in routes/index.ts ahead of the AI credits gate, so nothing is
 * debited or sent to a provider without consent. Signed-out requests pass
 * through: the route's own auth answers them before any provider is reached.
 */
export function makeAiConsentGate(lookup: (clerkUserId: string) => Promise<boolean> = async (id) => (await getAiConsent(id)).granted) {
  return async function aiConsentGate(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!requiresAiConsent(req.method, req.path)) return next();
    const { userId } = getAuth(req);
    if (!userId) return next();
    try {
      if (await lookup(userId)) return next();
    } catch (err) {
      // Fail closed: never send content to a provider without a stored yes.
      req.log?.error?.({ err }, "AI consent lookup failed");
      res.status(503).json({ error: "AI tools are unavailable right now. Try again shortly." });
      return;
    }
    res.status(403).json({
      error: "Allow AI data sharing to use Brandthread AI. You can change this in Settings.",
      code: AI_CONSENT_REQUIRED,
      version: AI_CONSENT_VERSION,
      providers: AI_PROVIDERS,
    });
  };
}

export const aiConsentGate = makeAiConsentGate();
