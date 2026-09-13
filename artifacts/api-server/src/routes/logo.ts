import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { db, onboardingAiSamples, users } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  buildFashionPrompt,
  generateImageBuffer,
  generateWithVisualQa,
  ImageQualityError,
  ImageQualityUnavailableError,
} from "@workspace/integrations-openai-ai-server/image";

const router = Router();
router.use(requireAuth);

const userHits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const rec = userHits.get(userId);
  if (!rec || now >= rec.resetAt) {
    userHits.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (rec.count >= MAX_PER_WINDOW) return false;
  rec.count += 1;
  return true;
}

const styleGuides: Record<string, string> = {
  Minimalist: "clean minimal flat design, simple geometric shapes, monochrome or two-tone palette, lots of white space",
  Bold:       "strong bold typography, high contrast colors, striking graphic design, powerful visual impact",
  Vintage:    "retro vintage aesthetic, distressed textures, muted earthy tones, classic badge-style composition",
  Luxury:     "elegant luxury branding, gold accents, premium feel, refined typography, dark rich background",
  Streetwear: "urban streetwear aesthetic, graffiti-inspired, black and white with a pop of color, edgy graphic",
  Playful:    "fun playful colorful design, rounded shapes, bright vibrant colors, friendly approachable feel",
};

// Generations can invoke visual QA more than once, so keep the lease longer
// than a normal provider request while still recovering abandoned work.
export const ONBOARDING_SAMPLE_RESERVATION_LEASE_MS = 15 * 60_000;

// The onboarding sample is mounted separately from the paid /logo router by
// routes/index.ts. Its allowance is durable and account-scoped, never a
// client-side entitlement or an expiring rate-limit bucket.
async function reserveOnboardingSample(accountId: string): Promise<string> {
  const reservationId = randomUUID();
  const reservedAt = new Date();
  const leaseCutoff = new Date(reservedAt.getTime() - ONBOARDING_SAMPLE_RESERVATION_LEASE_MS);
  const [created] = await db
    .insert(onboardingAiSamples)
    .values({ accountId, reservationId, status: "reserved", reservedAt })
    .onConflictDoUpdate({
      target: onboardingAiSamples.accountId,
      // Reclaim only an abandoned reservation. Completed rows are never
      // overwritten, and a fresh reservation remains owned by its request.
      set: { reservationId, status: "reserved", reservedAt, completedAt: null },
      where: and(
        eq(onboardingAiSamples.status, "reserved"),
        lt(onboardingAiSamples.reservedAt, leaseCutoff),
      ),
    })
    .returning({ reservationId: onboardingAiSamples.reservationId });
  if (created) return created.reservationId;

  const [existing] = await db
    .select({ status: onboardingAiSamples.status })
    .from(onboardingAiSamples)
    .where(eq(onboardingAiSamples.accountId, accountId))
    .limit(1);
  const error = new Error(
    existing?.status === "completed"
      ? "Your free onboarding sample has already been used."
      : "Your free onboarding sample is already being generated.",
  );
  (error as Error & { code?: string }).code =
    existing?.status === "completed" ? "onboarding_sample_used" : "onboarding_sample_in_progress";
  throw error;
}

async function releaseOnboardingSample(accountId: string, reservationId: string): Promise<void> {
  await db.delete(onboardingAiSamples).where(and(
    eq(onboardingAiSamples.accountId, accountId),
    eq(onboardingAiSamples.reservationId, reservationId),
    eq(onboardingAiSamples.status, "reserved"),
  ));
}

async function completeOnboardingSample(accountId: string, reservationId: string): Promise<boolean> {
  const rows = await db.update(onboardingAiSamples)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(
      eq(onboardingAiSamples.accountId, accountId),
      eq(onboardingAiSamples.reservationId, reservationId),
      eq(onboardingAiSamples.status, "reserved"),
    ))
    .returning({ accountId: onboardingAiSamples.accountId });
  return rows.length === 1;
}

// POST /api/logo/generate
router.post("/generate", async (req, res) => {
  const userId = (req as any).auth?.userId ?? (req as any).auth?.sub ?? "anon";
  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "Too many logo generations. Please wait a minute and try again." });
    return;
  }

  const { brandName, style } = req.body ?? {};
  if (!brandName || typeof brandName !== "string" || brandName.trim().length === 0) {
    res.status(400).json({ error: "brandName is required" });
    return;
  }

  const logoStyle = typeof style === "string" && styleGuides[style] ? style : "Minimalist";
  const guide = styleGuides[logoStyle];
  const safeName = brandName.trim().slice(0, 60); // prevent prompt injection via long names

  const brief = `Brand name: "${safeName}". Style: ${guide}. Use the exact brand name or its exact initials only.`;
  const prompt = buildFashionPrompt(
    "logo",
    brief,
    "Create a crisp fashion-brand logo on a clean background. It must remain legible at small sizes and contain no invented words.",
  );

  try {
    const buffer = await generateWithVisualQa({
      operation: "logo",
      prompt,
      brief,
      generate: (retryPrompt) => generateImageBuffer(retryPrompt, "1024x1024"),
    });
    res.json({ b64_json: buffer.toString("base64") });
  } catch (err) {
    // Do not leak upstream provider error details to the client.
    if (err instanceof ImageQualityError) {
      res.status(422).json({ error: "The generated logo did not meet the quality check. Please try again.", retryable: true });
    } else if (err instanceof ImageQualityUnavailableError) {
      res.status(502).json({ error: "Logo quality verification is temporarily unavailable. Please try again.", retryable: true });
    } else {
      res.status(502).json({ error: "Logo generation failed. Please try again." });
    }
  }
});

// POST /api/onboarding-sample/logo
router.post("/logo", async (req, res) => {
  const userId = (req as any).clerkUserId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  // The mobile flow establishes this seller marker with an authenticated
  // profile write before requesting the sample. The client cannot override
  // this server-owned state, and completed/buyer accounts are rejected.
  const [account] = await db
    .select({ accountType: users.accountType, role: users.role, onboardingComplete: users.onboardingComplete })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  if (!account || account.accountType !== "seller" || account.role === "buyer" || account.onboardingComplete) {
    res.status(403).json({ error: "Seller onboarding is required for this sample.", code: "seller_onboarding_required" });
    return;
  }

  let reservationId: string;
  try {
    reservationId = await reserveOnboardingSample(userId);
  } catch (error: any) {
    const status = error?.code === "onboarding_sample_in_progress" ? 409 : 429;
    res.status(status).json({ error: error?.message || "The onboarding sample is unavailable.", code: error?.code });
    return;
  }

  let brandName: unknown;
  let style: unknown;
  let brief: string;
  let prompt: string;
  try {
    ({ brandName, style } = req.body ?? {});
    if (typeof brandName !== "string" || brandName.trim().length === 0) {
      throw new Error("brandName is required");
    }
    const logoStyle = typeof style === "string" && styleGuides[style] ? style : "Minimalist";
    brief = `Brand name: "${brandName.trim().slice(0, 60)}". Style: ${styleGuides[logoStyle]}. Use the exact brand name or its exact initials only.`;
    prompt = buildFashionPrompt(
      "logo",
      brief,
      "Create a crisp fashion-brand logo on a clean background. It must remain legible at small sizes and contain no invented words.",
    );
  } catch (error: any) {
    await releaseOnboardingSample(userId, reservationId).catch(() => {});
    res.status(400).json({ error: error?.message || "Invalid onboarding sample request." });
    return;
  }

  let buffer: Buffer;
  try {
    buffer = await generateWithVisualQa({
      operation: "logo",
      prompt,
      brief,
      generate: (retryPrompt) => generateImageBuffer(retryPrompt, "1024x1024"),
    });
  } catch (err) {
    // A failed provider or QA attempt must not consume the allowance.
    await releaseOnboardingSample(userId, reservationId).catch(() => {});
    if (err instanceof ImageQualityError) {
      res.status(422).json({ error: "The generated logo did not meet the quality check. Please try again.", retryable: true });
    } else if (err instanceof ImageQualityUnavailableError) {
      res.status(502).json({ error: "Logo quality verification is temporarily unavailable. Please try again.", retryable: true });
    } else {
      res.status(502).json({ error: "Logo generation failed. Please try again.", retryable: true });
    }
    return;
  }

  // Completion is the durable success boundary. If this update cannot be
  // recorded, do not release the reservation or risk a second success.
  const completed = await completeOnboardingSample(userId, reservationId);
  if (!completed) {
    res.status(503).json({ error: "The sample could not be recorded. Please try again.", retryable: true });
    return;
  }
  res.json({ b64_json: buffer.toString("base64") });
});

export default router;
