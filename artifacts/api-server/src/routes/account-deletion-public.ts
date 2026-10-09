/**
 * Public web account-deletion request (Google Play requires a URL where a
 * person can ask for deletion without opening the app).
 *
 *  POST /api/public/account-deletion/request  { email }
 *    Always answers with the same generic message, so it cannot be used to
 *    find out which emails are registered. If an active account has that
 *    email, a single-use 60-minute link is emailed to it.
 *  POST /api/public/account-deletion/confirm  { token, confirmation: "DELETE" }
 *    Only the holder of the emailed link can reach this. It schedules
 *    accountDeletionHandler in routes/auth.ts, including the same blocker
 *    checks and 30-day grace period used by authenticated deletion.
 */
import { Router } from "express";
import { db, users, accountDeletionRequests } from "@workspace/db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "@workspace/api-zod";
import { rateLimit } from "../middlewares/rateLimit";
import { requestPrimitives, validateRequest } from "../middlewares/validateRequest";
import { isMailerConfigured, sendAccountDeletionEmail } from "../lib/mailer";
import { getWebOrigin } from "../lib/webOrigin";
import { hasDeletionConfirmation } from "../lib/accountDeletion";
import {
  DELETION_REQUEST_RESEND_COOLDOWN_MS,
  DELETION_REQUEST_TTL_MS,
  deletionConfirmLink,
  generateDeletionToken,
  hashDeletionToken,
  isWellFormedDeletionToken,
  runHandlerCapturing,
} from "../lib/accountDeletionRequests";
import { accountDeletionHandler } from "./auth";

const router = Router();

const requestSchema = z.object({ email: requestPrimitives.email }).passthrough();
const confirmSchema = z.object({
  token: z.string().trim().min(1).max(200),
  confirmation: z.string().max(20),
}).passthrough();

const GENERIC_MESSAGE =
  "If an account exists for that email, we sent a confirmation link to it. Nothing is deleted until you open the link and confirm.";

router.post(
  "/request",
  rateLimit("authentication"),
  validateRequest({ body: requestSchema }),
  async (req, res) => {
    const email = (req.body as { email: string }).email.trim().toLowerCase();

    if (!isMailerConfigured()) {
      res.status(422).json({
        error: "We can't send emails right now. Please try again shortly or contact support@brandthread.app.",
        code: "MAIL_NOT_CONFIGURED",
      });
      return;
    }

    try {
      const [account] = await db
        .select({ clerkId: users.clerkId })
        .from(users)
        .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deletedAt)))
        .limit(1);

      if (account?.clerkId) {
        const [latest] = await db
          .select({ createdAt: accountDeletionRequests.createdAt })
          .from(accountDeletionRequests)
          .where(eq(accountDeletionRequests.email, email))
          .orderBy(desc(accountDeletionRequests.createdAt))
          .limit(1);
        const cooling = latest && Date.now() - latest.createdAt.getTime() < DELETION_REQUEST_RESEND_COOLDOWN_MS;
        if (!cooling) {
          const token = generateDeletionToken();
          await db.insert(accountDeletionRequests).values({
            email,
            clerkId: account.clerkId,
            tokenHash: hashDeletionToken(token),
            expiresAt: new Date(Date.now() + DELETION_REQUEST_TTL_MS),
          });
          const sent = await sendAccountDeletionEmail({ to: email, link: deletionConfirmLink(getWebOrigin(), token) });
          if (!sent) req.log.warn("Account deletion email failed to send after request was stored");
        }
      }
    } catch (err) {
      req.log.error({ err }, "Account deletion request failed");
      // Same generic answer: never reveal whether the email exists.
    }

    res.json({ ok: true, message: GENERIC_MESSAGE });
  },
);

router.post(
  "/confirm",
  rateLimit("authentication"),
  validateRequest({ body: confirmSchema }),
  async (req, res) => {
    const { token, confirmation } = req.body as { token: string; confirmation: string };
    if (!hasDeletionConfirmation({ confirmation })) {
      res.status(400).json({ error: "Type DELETE exactly to permanently delete your account.", code: "CONFIRMATION_REQUIRED" });
      return;
    }
    if (!isWellFormedDeletionToken(token)) {
      res.status(400).json({ error: "This link isn't valid. Request a new one.", code: "INVALID_TOKEN" });
      return;
    }

    try {
      // Claim atomically so a double click or a replay can never run it twice.
      const [claimed] = await db
        .update(accountDeletionRequests)
        .set({ status: "processing", confirmedAt: new Date() })
        .where(and(
          eq(accountDeletionRequests.tokenHash, hashDeletionToken(token)),
          eq(accountDeletionRequests.status, "pending"),
          gt(accountDeletionRequests.expiresAt, new Date()),
        ))
        .returning({ id: accountDeletionRequests.id, clerkId: accountDeletionRequests.clerkId });
      if (!claimed) {
        res.status(400).json({ error: "This link has expired or was already used. Request a new one.", code: "INVALID_TOKEN" });
        return;
      }

      const result = await runHandlerCapturing(accountDeletionHandler, {
        clerkUserId: claimed.clerkId,
        body: { confirmation: "DELETE" },
        deletionEmailVerified: true,
        log: req.log,
      });

      if (result.status === 200) {
        await db.update(accountDeletionRequests)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(accountDeletionRequests.id, claimed.id));
        res.json({ ok: true });
        return;
      }

      // Blocked (open orders etc.) or a transient failure: release the claim so
      // the owner can retry with the same link until it expires.
      await db.update(accountDeletionRequests)
        .set({ status: "pending", lastError: String(result.body.error ?? result.status).slice(0, 500) })
        .where(eq(accountDeletionRequests.id, claimed.id));
      res.status(result.status).json(result.body);
    } catch (err) {
      req.log.error({ err }, "Account deletion confirmation failed");
      res.status(500).json({ error: "We couldn't complete the deletion. Try again or contact support@brandthread.app." });
    }
  },
);

export default router;
