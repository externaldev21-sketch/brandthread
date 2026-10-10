/**
 * AI data-sharing consent (App Store Review Guideline 5.1.2(i)).
 *
 * A user's Brandthread Agent messages and recent conversation history are sent
 * to a third-party AI provider (OpenAI) to generate replies. That only happens
 * after the user tapped Allow on the in-app consent sheet, which stores
 * users.ai_data_consent_at. See middlewares/requireAiConsent.ts (the guard)
 * and routes/ai-consent.ts (GET/POST/DELETE /api/ai-consent).
 */
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";

export const AI_CONSENT_REQUIRED_CODE = "AI_CONSENT_REQUIRED";
export const AI_CONSENT_PROVIDER = "OpenAI";
export const AI_CONSENT_REQUIRED_MESSAGE =
  "Allow Brandthread to send your messages to OpenAI before chatting with Brandthread Agent.";

/** Only requests that carry user content to the AI provider need consent. */
export function isConsentGatedMethod(method: string | undefined): boolean {
  const m = (method ?? "").toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH";
}

export function hasConsentTimestamp(value: Date | string | null | undefined): boolean {
  if (!value) return false;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t);
}

export async function readAiConsent(clerkId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: users.aiDataConsentAt })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  return row?.at ?? null;
}

export async function hasAiConsent(clerkId: string): Promise<boolean> {
  return hasConsentTimestamp(await readAiConsent(clerkId));
}

/** Records consent once; a repeat Allow keeps the original timestamp. */
export async function recordAiConsent(clerkId: string, now: Date = new Date()): Promise<Date | null> {
  const existing = await readAiConsent(clerkId);
  if (existing) return existing;
  const [row] = await db
    .update(users)
    .set({ aiDataConsentAt: now })
    .where(eq(users.clerkId, clerkId))
    .returning({ at: users.aiDataConsentAt });
  return row?.at ?? null;
}

export async function withdrawAiConsent(clerkId: string): Promise<void> {
  await db.update(users).set({ aiDataConsentAt: null }).where(eq(users.clerkId, clerkId));
}
