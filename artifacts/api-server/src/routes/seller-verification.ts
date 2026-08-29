/**
 * Seller Identity Verification via Stripe Identity.
 *
 * POST /api/seller/verification/start   — creates a hosted VerificationSession
 * GET  /api/seller/verification/status  — returns current verification_status
 *
 * The hosted verification flow opens in the seller's device browser.
 * Stripe sends a webhook (identity.verification_session.verified |
 * identity.verification_session.requires_input) to update the stored status.
 *
 * Requires Stripe Identity to be enabled in the Stripe Dashboard:
 *   Dashboard → More → Identity → Get started
 */
import { Router } from "express";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { getWebOrigin } from "../lib/webOrigin";
import { requireStripe } from "../lib/stripe";

const router = Router();
router.use(requireAuth);

// ─── GET /api/seller/verification/status ─────────────────────────────────────
router.get("/status", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const [user] = await db
    .select({
      verified:                    users.verified,
      verificationStatus:          users.verificationStatus,
      stripeVerificationSessionId: users.stripeVerificationSessionId,
    })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!user) return res.status(404).json({ error: "User not found" });

  return res.json({
    verified:           user.verified,
    verificationStatus: user.verificationStatus,
    sessionId:          user.stripeVerificationSessionId,
  });
});

// ─── POST /api/seller/verification/start ─────────────────────────────────────
router.post("/start", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;

  // Fetch current state
  const [user] = await db
    .select({
      id:                          users.id,
      email:                       users.email,
      verified:                    users.verified,
      verificationStatus:          users.verificationStatus,
      stripeVerificationSessionId: users.stripeVerificationSessionId,
    })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!user) return res.status(404).json({ error: "User not found" });

  // Already verified — nothing to do
  if (user.verified) {
    return res.status(400).json({ error: "ALREADY_VERIFIED" });
  }

  const stripe = requireStripe();

  // If there's an existing pending session, try to reuse its URL to avoid
  // creating duplicates (Stripe enforces one active session per person).
  if (user.stripeVerificationSessionId && user.verificationStatus === "pending") {
    try {
      const existing = await (stripe.identity.verificationSessions as any).retrieve(
        user.stripeVerificationSessionId,
      );
      // A session is reusable while its status is 'requires_input' or 'created'
      if (
        existing.status === "requires_input" ||
        existing.status === "created"
      ) {
        // Retrieve a fresh client_secret to re-open the hosted URL
        const refreshed = await (stripe.identity.verificationSessions as any).retrieve(
          user.stripeVerificationSessionId,
          { expand: ["last_error", "url"] },
        );
        if (refreshed.url) {
          return res.json({ url: refreshed.url, sessionId: refreshed.id, reused: true });
        }
      }
    } catch {
      // Session may have expired — fall through to create a new one
    }
  }

  // Build return URL — used by Stripe's hosted flow after the seller finishes.
  // In mobile the WebBrowser intercepts this URL to close the browser tab.
  const returnUrl =
    process.env.STRIPE_IDENTITY_RETURN_URL ??
    `${getWebOrigin()}/verification-complete`;

  let session: any;
  try {
    session = await (stripe.identity.verificationSessions as any).create({
      type: "document",
      metadata: {
        seller_clerk_id: clerkId,
      },
      options: {
        document: {
          // Accept any government ID — most permissive set for global sellers
          allowed_types: ["driving_license", "id_card", "passport"],
          require_live_capture: true,
          require_matching_selfie: true,
        },
      },
      return_url: returnUrl,
    });
  } catch (err: any) {
    req.log.error({ err, clerkId }, "Stripe Identity verification session creation failed");
    // Surface a friendly error when Identity is not enabled on the account
    if (err?.code === "identity_not_enabled" || err?.type === "StripeInvalidRequestError") {
      return res.status(503).json({
        error: "IDENTITY_NOT_ENABLED",
        message:
          "Stripe Identity is not enabled on this Stripe account. " +
          "Enable it in the Stripe Dashboard under More → Identity.",
      });
    }
    return res.status(500).json({ error: "Failed to create verification session" });
  }

  // Persist session ID and move status to 'pending'
  await db
    .update(users)
    .set({
      stripeVerificationSessionId: session.id,
      verificationStatus: "pending",
      updatedAt: new Date(),
    })
    .where(eq(users.clerkId, clerkId));

  return res.json({ url: session.url, sessionId: session.id, reused: false });
});

// ─── POST /api/seller/verification/cancel ────────────────────────────────────
// Allows a seller to reset a 'failed' or 'pending' session so they can retry.
router.post("/cancel", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;

  const [user] = await db
    .select({ stripeVerificationSessionId: users.stripeVerificationSessionId, verified: users.verified })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.verified) return res.status(400).json({ error: "ALREADY_VERIFIED" });

  // Cancel the existing session in Stripe (best-effort)
  if (user.stripeVerificationSessionId) {
    try {
      const stripe2 = requireStripe();
      await (stripe2.identity.verificationSessions as any).cancel(
        user.stripeVerificationSessionId,
      );
    } catch {
      // Non-fatal — may already be cancelled / expired
    }
  }

  // Reset local state
  await db
    .update(users)
    .set({
      stripeVerificationSessionId: null as any,
      verificationStatus: "unverified",
      updatedAt: new Date(),
    })
    .where(eq(users.clerkId, clerkId));

  return res.json({ ok: true });
});

export default router;
