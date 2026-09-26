import { Router } from "express";
import { clerkClient } from "@clerk/express";
import {
  db, users, orders, orderItems, conversationParticipants, conversations, messages,
  passwordResetCodes,
} from "@workspace/db";
import { eq, sql, inArray, or, asc, desc } from "drizzle-orm";
import crypto from "node:crypto";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { awardLoyaltyPointsOnce } from "./loyalty";
import { sendWelcomeEmail } from "../lib/brandthreadEmail";
import { isMailerConfigured, sendPasswordResetEmail } from "../lib/mailer";
import { getDeletionBlockers, hasDeletionConfirmation } from "../lib/accountDeletion";
import { getAuth } from "@clerk/express";
import { z } from "@workspace/api-zod";
import { requestPrimitives, validateRequest } from "../middlewares/validateRequest";
import {
  getClerkEmailAddress,
  normalizeProfileName,
  preserveExistingEmail,
} from "../lib/authProfile";
import { createWelcomeConversationOnce } from "../lib/brandthreadAgent";

const router = Router();
const usernameSchema = z.string().trim().regex(/^[a-zA-Z0-9_]{3,30}$/);
const optionalProfileText = z.string().trim().max(160).optional();
const syncBodySchema = z.object({
  name: requestPrimitives.shortText.optional(),
}).passthrough();
const onboardingBodySchema = z.object({
  brandName: requestPrimitives.shortText,
  brandType: optionalProfileText,
  brandStage: optionalProfileText,
  sellModel: optionalProfileText,
  username: usernameSchema.optional(),
}).passthrough();
const completeOnboardingBodySchema = z.object({
  accountType: z.enum(["buyer", "seller"]),
  expectedClerkId: z.string().min(1).optional(),
}).passthrough();
const buyerPreferencesBodySchema = z.object({
  styleInterests: z.array(z.string().trim().min(1).max(80)).max(24),
  expectedClerkId: z.string().min(1),
}).passthrough();
const profileBodySchema = z.object({
  displayName: optionalProfileText,
  brandName: optionalProfileText,
  bio: z.string().trim().max(5_000).optional(),
  website: z.union([z.literal(""), requestPrimitives.url]).optional(),
  name: optionalProfileText,
  username: usernameSchema.optional(),
  accountType: z.enum(["buyer", "seller"]).optional(),
  appThemeId: z.enum(["monochrome", "purple", "olive", "navy", "champagne", "black", "silver", "black-gold", "emerald-gold", "leopard-red", "maroon", "gold"]).optional(),
  appIconId: z.enum(["monochrome", "purple", "olive", "navy", "champagne", "black", "silver", "black-gold", "emerald-gold", "leopard-red", "maroon", "gold"]).nullable().optional(),
  expectedClerkId: z.string().min(1).optional(),
  // Seller storefront metadata (Edit Profile — Store Details section)
  category: optionalProfileText,
  location: optionalProfileText,
  contactEmail: z.union([z.literal(""), requestPrimitives.email]).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  socialLinks: z.record(z.string(), z.string().trim().max(300)).optional(),
}).passthrough();
const privacyBodySchema = z.object({
  dmPrivacy: z.enum(["requests", "followers_only"]),
}).passthrough();
const feedGesturesTipBodySchema = z.object({
  version: z.number().int().min(1),
}).passthrough();
const passwordResetRequestSchema = z.object({
  email: requestPrimitives.email,
}).passthrough();
const passwordResetConfirmSchema = z.object({
  email: requestPrimitives.email,
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code."),
  newPassword: z.string().min(1),
}).passthrough();

const PASSWORD_RESET_CODE_TTL_MS = 15 * 60_000;
const MIN_PASSWORD_LENGTH = 8;

function hashResetCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function generateResetCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

// ─── Username validation ──────────────────────────────────────────────────────
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

function validateUsername(u: string): string | null {
  if (!u || u.trim() === "") return "Username is required.";
  if (/\s/.test(u)) return "Username cannot contain spaces.";
  if (!USERNAME_REGEX.test(u))
    return "Username may only contain letters, numbers, and underscores (3–30 characters).";
  return null; // valid
}

// ─── POST /api/auth/sync ──────────────────────────────────────────────────────
// Create or update the user record from Clerk data.
router.post("/sync", requireAuth, validateRequest({ body: syncBodySchema }), async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  try {
    const preferredName = normalizeProfileName(req.body?.name);
    if (req.body?.name !== undefined && !preferredName) {
      res.status(400).json({ error: "name must not be blank" });
      return;
    }

    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    const email = getClerkEmailAddress(clerkUser);
    const clerkName =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      email.split("@")[0];
    // OAuth providers can leave a generated or incomplete display name. The
    // onboarding value belongs to the authenticated person and is therefore the
    // authoritative value for this initial local profile.
    const name = preferredName ?? clerkName;
    const avatarUrl = clerkUser.imageUrl;

    // Sync runs both during app startup and explicitly during onboarding. Use a
    // conflict-safe insert so concurrent first requests cannot turn a real
    // account into a transient 500/error screen.
    const { user, created } = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(users)
        .values({
          clerkId: clerkUserId,
          email,
          name,
          displayName: name,
          accountType: null,
          avatarUrl,
          role: "owner",
        })
        .onConflictDoNothing({ target: users.clerkId })
        .returning();

      if (inserted) {
        await awardLoyaltyPointsOnce({
          buyerId: clerkUserId,
          points: 100,
          source: "signup",
          referenceId: clerkUserId,
          note: "Welcome to Brandthread",
        }, tx);
        return { user: inserted, created: true };
      }

      const [existing] = await tx
        .select()
        .from(users)
        .where(eq(users.clerkId, clerkUserId))
        .limit(1);
      if (!existing) throw new Error("User sync conflict did not yield a user record");
      if (existing.deletedAt) {
        const error = new Error("This account has been deleted");
        (error as any).statusCode = 410;
        throw error;
      }

      const updates: Record<string, unknown> = {
        email: preserveExistingEmail(email, existing.email),
        avatarUrl,
        updatedAt: new Date(),
      };
      if (preferredName) {
        updates.name = preferredName;
        // Preserve a deliberately edited display name, but initialize it for
        // legacy/local rows that only had the raw name field.
        if (!existing.displayName || existing.displayName === existing.name) {
          updates.displayName = preferredName;
        }
      }
      const [updated] = await tx
        .update(users)
        .set(updates)
        .where(eq(users.clerkId, clerkUserId))
        .returning();
      if (!updated) throw new Error("User record disappeared during sync");
      return { user: updated, created: false };
    });
    if (created) {
      void sendWelcomeEmail({
        to: user.email,
        name: user.displayName ?? user.name,
        accountType: user.accountType === "buyer" || user.accountType === "seller"
          ? user.accountType
          : null,
        idempotencyKey: `welcome/${clerkUserId}`,
      }).then((sent) => {
        if (!sent) req.log.warn({ clerkUserId }, "Welcome email delivery failed");
      }).catch((err) => {
        req.log.warn({ err, clerkUserId }, "Welcome email delivery failed");
      });
    }
    res.status(created ? 201 : 200).json(user);
  } catch (err) {
    if ((err as any)?.statusCode === 410) {
      res.status(410).json({ error: "This account has been deleted." });
      return;
    }
    req.log.error({ err, clerkUserId }, "Failed to sync user");
    res.status(500).json({ error: "Failed to sync user" });
  }
});

// ─── POST /api/auth/data-export ─────────────────────────────────────────────
// Immediate authenticated portability export. The server derives ownership
// from Clerk and never accepts a user ID from the client.
router.post("/data-export", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const requested = Array.isArray(req.body?.include) ? req.body.include : ["profile", "orders", "messages"];
  const allowed = new Set(["profile", "orders", "messages"]);
  const include = [...new Set(requested.filter((key: unknown): key is string => typeof key === "string" && allowed.has(key)))];
  if (include.length === 0) {
    res.status(400).json({ error: "Select at least one export category." });
    return;
  }

  try {
    const result: Record<string, unknown> = {};
    if (include.includes("profile")) {
      const [profile] = await db.select({
        clerkId: users.clerkId,
        email: users.email,
        name: users.name,
        displayName: users.displayName,
        accountType: users.accountType,
        username: users.username,
        bio: users.bio,
        website: users.website,
        brandName: users.brandName,
        brandType: users.brandType,
        brandStage: users.brandStage,
        notificationPreferences: users.notificationPreferences,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      }).from(users).where(eq(users.clerkId, clerkUserId)).limit(1);
      result.profile = profile ?? null;
    }

    if (include.includes("orders")) {
      const ownedOrders = await db.select().from(orders)
        .where(or(eq(orders.buyerId, clerkUserId), eq(orders.ownerId, clerkUserId)))
        .orderBy(asc(orders.createdAt));
      const orderIds = ownedOrders.map((order) => order.id);
      const items = orderIds.length
        ? await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds))
        : [];
      const itemsByOrder = new Map<string, typeof items>();
      for (const item of items) {
        const group = itemsByOrder.get(item.orderId) ?? [];
        group.push(item);
        itemsByOrder.set(item.orderId, group);
      }
      result.orders = ownedOrders.map((order) => ({
        ...order,
        items: itemsByOrder.get(order.id) ?? [],
        relationship: order.buyerId === clerkUserId ? "buyer" : "seller",
      }));
    }

    if (include.includes("messages")) {
      const memberships = await db.select({
        conversationId: conversationParticipants.conversationId,
      }).from(conversationParticipants).where(eq(conversationParticipants.userId, clerkUserId));
      const conversationIds = memberships.map((membership) => membership.conversationId);
      const conversationRows = conversationIds.length
        ? await db.select().from(conversations).where(inArray(conversations.id, conversationIds)).orderBy(asc(conversations.createdAt))
        : [];
      const messageRows = conversationIds.length
        ? await db.select({
            id: messages.id,
            conversationId: messages.conversationId,
            senderId: messages.senderId,
            senderName: messages.senderName,
            body: messages.body,
            attachment: messages.attachment,
            attachments: messages.attachments,
            replyToId: messages.replyToId,
            status: messages.status,
            deliveredAt: messages.deliveredAt,
            readAt: messages.readAt,
            deletedAt: messages.deletedAt,
            createdAt: messages.createdAt,
          }).from(messages).where(inArray(messages.conversationId, conversationIds)).orderBy(asc(messages.createdAt))
        : [];
      result.messages = { conversations: conversationRows, messages: messageRows };
    }

    const exportedAt = new Date().toISOString();
    res.setHeader("Content-Disposition", `attachment; filename="brandthread-my-data-${Date.now()}.json"`);
    res.json({ exportedAt, include, ...result });
  } catch (err) {
    req.log.error({ err, clerkUserId }, "Failed to export account data");
    res.status(500).json({ error: "Could not generate your data export." });
  }
});

// ─── GET /api/auth/account/deletion-check ───────────────────────────────────
// Tells the app, before the person confirms, whether anything must be settled
// first (open orders, held drop funds, disputes…) and exactly what deletion
// removes versus what the law requires us to keep.
router.get("/account/deletion-check", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  try {
    const [account] = await db.select({ accountType: users.accountType, deletedAt: users.deletedAt })
      .from(users).where(eq(users.clerkId, clerkUserId)).limit(1);
    if (!account) {
      res.status(404).json({ error: "Account record was not found." });
      return;
    }
    const blockers = await getDeletionBlockers(clerkUserId);
    const isSeller = account.accountType === "seller";
    res.json({
      canDelete: blockers.length === 0,
      accountType: account.accountType,
      blockers,
      willDelete: [
        "Your profile, username, photo and bio",
        "Posts, comments, stories, likes, reposts and follows",
        "Direct messages you sent",
        "Saved items, cart, addresses and notification settings",
        ...(isSeller ? [
          "Your storefront, product listings, discount codes and shipping settings",
          "Payout and subscription links to Stripe",
        ] : []),
        "Your sign-in (you'll be signed out on every device)",
      ],
      willRetain: [
        "Order, payment, refund and tax records, with your name and address removed — kept as long as the law requires",
        "Reports you made about other people's content, without your identity",
        ...(isSeller ? ["Reviews buyers left on past orders, shown as from a deleted account"] : []),
      ],
    });
  } catch (err) {
    req.log.error({ err, clerkUserId }, "Deletion eligibility check failed");
    res.status(500).json({ error: "We couldn't check your account right now. Try again." });
  }
});

// ─── DELETE /api/auth/account ───────────────────────────────────────────────
// Permanently erase an authenticated account. Financial/tax records are kept,
// but are stripped of direct personal data. The user row is deliberately kept
// as a tombstone so an old app cannot re-create it with /auth/sync.
router.delete("/account", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  if (!hasDeletionConfirmation(req.body)) {
    res.status(400).json({ error: 'Type DELETE exactly to permanently delete your account.' });
    return;
  }

  try {
    const [account] = await db.select({
      id: users.id, deletedAt: users.deletedAt,
    }).from(users).where(eq(users.clerkId, clerkUserId)).limit(1);
    if (!account) {
      res.status(404).json({ error: "Account record was not found." });
      return;
    }

    if (!account.deletedAt) {
      // Never strand a buyer or a seller's customers: open orders, held drop
      // funds, disputes and in-flight payouts must be settled first.
      const blockers = await getDeletionBlockers(clerkUserId);
      if (blockers.length > 0) {
        res.status(409).json({
          error: "Settle the items below before deleting your account.",
          code: "DELETION_BLOCKED",
          blockers,
        });
        return;
      }
      await db.transaction(async (tx) => {
        const deletedSubject = `deleted:${account.id}`;
        // Private, device, social, preference and draft data.
        await tx.execute(sql`DELETE FROM push_tokens WHERE user_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM buyer_addresses WHERE buyer_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM cart_items WHERE user_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM saved_items WHERE user_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM notifications_feed WHERE user_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM blocks WHERE blocker_id = ${clerkUserId} OR blocked_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM follows WHERE follower_id = ${clerkUserId} OR following_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM story_likes WHERE user_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM story_views WHERE user_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM interactions WHERE user_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM posts WHERE user_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM stories WHERE author_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM product_reserves WHERE user_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM waitlist_entries WHERE user_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM drop_alert_subscriptions WHERE user_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM checkout_sessions WHERE buyer_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM loyalty_points WHERE buyer_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM referrals WHERE inviter_id = ${clerkUserId} OR invitee_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM klaviyo_integrations WHERE owner_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM seller_subscription_entitlements WHERE clerk_user_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM post_comment_likes WHERE user_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM post_comments WHERE author_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM muted_words WHERE user_id = ${clerkUserId}`);
        // Reports the person filed stay in the moderation record without
        // their identity; reports about their content keep the snapshot.
        await tx.execute(sql`UPDATE reports SET reporter_id = ${deletedSubject} WHERE reporter_id = ${clerkUserId}`);
        await tx.execute(sql`UPDATE reports SET target_owner_id = ${deletedSubject} WHERE target_owner_id = ${clerkUserId}`);

        // Conversations are private content. Preserve a counterpart's thread,
        // but remove the deleted person's messages, participant profile, and
        // cached message preview.
        await tx.execute(sql`UPDATE conversations SET last_message = NULL
          WHERE id IN (SELECT conversation_id FROM conversation_participants WHERE user_id = ${clerkUserId})`);
        await tx.execute(sql`DELETE FROM messages WHERE sender_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM conversation_participants WHERE user_id = ${clerkUserId}`);

        // Retained commerce records keep amounts/statuses/payment references for
        // legal and accounting purposes while removing customer-facing PII.
        await tx.execute(sql`UPDATE orders SET buyer_id = NULL, guest_email = NULL,
          shipping_address = NULL, notes = NULL, updated_at = NOW()
          WHERE buyer_id = ${clerkUserId}`);
        await tx.execute(sql`UPDATE orders SET owner_id = ${deletedSubject}, updated_at = NOW()
          WHERE owner_id = ${clerkUserId}`);
        await tx.execute(sql`UPDATE customers SET owner_id = ${deletedSubject},
          email = 'deleted@deleted.brandthread.invalid', name = 'Deleted customer',
          phone = NULL, address = NULL, updated_at = NOW() WHERE owner_id = ${clerkUserId}`);
        await tx.execute(sql`UPDATE returns SET notes = NULL, seller_response = NULL, evidence_urls = '[]'::json
          WHERE buyer_id = ${clerkUserId} OR seller_id = ${clerkUserId}`);
        await tx.execute(sql`UPDATE returns SET buyer_id = ${deletedSubject} WHERE buyer_id = ${clerkUserId}`);
        await tx.execute(sql`UPDATE returns SET seller_id = ${deletedSubject} WHERE seller_id = ${clerkUserId}`);
        await tx.execute(sql`UPDATE disputes SET seller_id = ${deletedSubject}, customer_claim = '', evidence_json = '[]'::json,
          stripe_evidence_details = '{}'::json, updated_at = NOW() WHERE seller_id = ${clerkUserId}`);
        await tx.execute(sql`UPDATE reviews SET buyer_id = 'deleted', body = NULL WHERE buyer_id = ${clerkUserId}`);
        await tx.execute(sql`UPDATE reviews SET seller_id = ${deletedSubject} WHERE seller_id = ${clerkUserId}`);

        // Seller catalog/profile content is no longer public. Products are
        // archived rather than deleted because historical order line items can
        // reference their variants.
        await tx.execute(sql`UPDATE products SET status = 'archived', images = '[]'::json,
          description = NULL, updated_at = NOW() WHERE owner_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM storefronts WHERE owner_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM seller_quote_requests WHERE seller_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM seller_tax_config WHERE seller_id = ${clerkUserId}`);
        await tx.execute(sql`DELETE FROM shipping_rates WHERE seller_id = ${clerkUserId}`);
        await tx.execute(sql`UPDATE discount_codes SET active = false WHERE seller_id = ${clerkUserId}`);

        // Remove all direct identity, auth/billing linkage and public profile
        // details. clerk_id remains solely as the non-reusable tombstone key.
        await tx.update(users).set({
          email: `deleted+${account.id}@deleted.brandthread.invalid`,
          name: "Deleted user", displayName: "Deleted user", avatarUrl: null,
          bio: null, profileImageUrl: null, username: null, brandName: null,
          brandType: null, brandStage: null, sellModel: null, website: null,
          stripeCustomerId: null, stripeAccountId: null, subscriptionId: null,
          stripeVerificationSessionId: null, notificationPreferences: {},
          termsAcceptedAt: null, termsVersion: null,
          deletedAt: new Date(), updatedAt: new Date(),
        }).where(eq(users.clerkId, clerkUserId));
      });
    }

    // This happens only after the database cleanup commits. If Clerk rejects
    // it, the tombstone remains and a retry is safe and explicit.
    await clerkClient.users.deleteUser(clerkUserId);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, clerkUserId }, "Account deletion failed");
    res.status(502).json({
      error: "We could not complete account deletion. Database cleanup may have completed, but Clerk sign-in removal failed. Retry the request or contact support.",
    });
  }
});

// ─── POST /api/auth/legal-acceptance ─────────────────────────────────────────
// Records that the person agreed to the Terms of Service, Community Guidelines
// and Privacy Policy version shown to them (sign-up checkbox or update prompt).
const legalAcceptanceSchema = z.object({
  version: z.string().trim().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:\.[0-9]+)?$/),
}).passthrough();

router.post("/legal-acceptance", requireAuth, validateRequest({ body: legalAcceptanceSchema }), async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const { version } = req.body as { version: string };
  const acceptedAt = new Date();
  const rows = await db.update(users)
    .set({ termsAcceptedAt: acceptedAt, termsVersion: version, updatedAt: acceptedAt })
    .where(eq(users.clerkId, clerkUserId))
    .returning({ id: users.id });
  if (rows.length === 0) {
    res.status(404).json({ error: "User not found — call POST /auth/sync first" });
    return;
  }
  res.json({ termsVersion: version, termsAcceptedAt: acceptedAt.toISOString() });
});

// ─── Sessions (Login Activity) ───────────────────────────────────────────────
// Real Clerk sessions for the signed-in person, with the device, browser and
// approximate location Clerk recorded for each one.
function describeSession(session: Awaited<ReturnType<typeof clerkClient.sessions.getSessionList>>["data"][number], currentSessionId: string | null) {
  const activity = session.latestActivity;
  const deviceType = activity?.deviceType?.trim() || null;
  const browser = [activity?.browserName, activity?.browserVersion?.split(".")[0]].filter(Boolean).join(" ") || null;
  const location = [activity?.city, activity?.country].filter(Boolean).join(", ") || null;
  const isMobile = !!activity?.isMobile;
  return {
    id: session.id,
    current: session.id === currentSessionId,
    status: session.status,
    device: deviceType ?? (isMobile ? "Mobile device" : browser ? "Computer" : "Unknown device"),
    browser,
    isMobile,
    location,
    ipAddress: activity?.ipAddress ?? null,
    lastActiveAt: new Date(session.lastActiveAt).toISOString(),
    createdAt: new Date(session.createdAt).toISOString(),
  };
}

router.get("/sessions", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const currentSessionId = getAuth(req).sessionId ?? null;
  try {
    const list = await clerkClient.sessions.getSessionList({ userId: clerkUserId, status: "active", limit: 50 });
    const sessions = list.data
      .map((session) => describeSession(session, currentSessionId))
      .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt.localeCompare(a.lastActiveAt));
    res.json({ sessions });
  } catch (err) {
    req.log.error({ err, clerkUserId }, "Failed to list sessions");
    res.status(502).json({ error: "We couldn't load your sign-in activity. Try again." });
  }
});

router.delete("/sessions/:sessionId", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const sessionId = String(req.params.sessionId);
  try {
    const session = await clerkClient.sessions.getSession(sessionId);
    if (session.userId !== clerkUserId) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    await clerkClient.sessions.revokeSession(sessionId);
    res.json({ ok: true, revoked: 1 });
  } catch (err) {
    req.log.error({ err, clerkUserId, sessionId }, "Failed to revoke session");
    res.status(502).json({ error: "We couldn't sign out that device. Try again." });
  }
});

router.post("/sessions/revoke-others", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const currentSessionId = getAuth(req).sessionId ?? null;
  try {
    const list = await clerkClient.sessions.getSessionList({ userId: clerkUserId, status: "active", limit: 100 });
    const others = list.data.filter((session) => session.id !== currentSessionId);
    await Promise.all(others.map((session) => clerkClient.sessions.revokeSession(session.id)));
    res.json({ ok: true, revoked: others.length });
  } catch (err) {
    req.log.error({ err, clerkUserId }, "Failed to revoke other sessions");
    res.status(502).json({ error: "We couldn't sign out your other devices. Try again." });
  }
});

// ─── PATCH /api/auth/onboarding ───────────────────────────────────────────────
// Save brand setup answers. Completion is committed separately only after every
// required role-specific write succeeds.
// Accepts optional username; validates format and uniqueness if provided.
router.patch("/onboarding", requireAuth, validateRequest({ body: onboardingBodySchema }), async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const { brandName, brandType, brandStage, sellModel, username } = req.body;

  if (!brandName || typeof brandName !== "string" || brandName.trim() === "") {
    res.status(400).json({ error: "brandName required" });
    return;
  }

  const updates: Record<string, any> = {
    brandName: brandName.trim(),
    ...(brandType && { brandType }),
    ...(brandStage && { brandStage }),
    ...(sellModel && { sellModel }),
    updatedAt: new Date(),
  };

  // Validate and persist username if provided
  if (username !== undefined) {
    const uname = String(username).trim().toLowerCase();
    const fmtErr = validateUsername(uname);
    if (fmtErr) {
      res.status(400).json({ error: fmtErr });
      return;
    }
    const [taken] = await db
      .select({ clerkId: users.clerkId })
      .from(users)
      .where(eq(users.username, uname))
      .limit(1);
    if (taken && taken.clerkId !== clerkUserId) {
      res.status(409).json({ error: "Username is already taken.", code: "USERNAME_TAKEN" });
      return;
    }
    updates.username = uname;
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.clerkId, clerkUserId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found — call POST /auth/sync first" });
    return;
  }
  res.json(updated);
});

// ─── POST /api/auth/onboarding/complete ───────────────────────────────────────
// This is deliberately separate from profile writes. Mobile calls it only after
// every required role-specific server write succeeds, so a username collision
// or interrupted brand save can never make a later login skip unfinished setup.
router.post(
  "/onboarding/complete",
  requireAuth,
  validateRequest({ body: completeOnboardingBodySchema }),
  async (req, res) => {
    const clerkUserId = (req as any).clerkUserId as string;
    const accountType = req.body.accountType as "buyer" | "seller";
    const expectedClerkId = req.body.expectedClerkId as string | undefined;
    if (expectedClerkId && expectedClerkId !== clerkUserId) {
      (req as any).log?.warn(
        { requestedAccountType: accountType },
        "onboarding completion rejected after account context changed",
      );
      res.status(409).json({
        error: "The signed-in account changed before onboarding could be saved.",
        code: "ACCOUNT_CONTEXT_CHANGED",
      });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(users)
        .where(eq(users.clerkId, clerkUserId))
        .limit(1)
        .for("update");
      if (!existing) {
        return {
          status: 404,
          body: { error: "User not found — call POST /auth/sync first" },
        } as const;
      }
      if (existing.onboardingComplete && existing.accountType === accountType) {
        return {
          status: 200,
          body: existing,
          firstCompletion: false,
        } as const;
      }
      if (existing.onboardingComplete) {
        return {
          status: 409,
          body: {
            error: "The requested role does not match the completed onboarding role.",
            code: "ONBOARDING_ROLE_MISMATCH",
          },
        } as const;
      }
      if (existing.accountType !== accountType) {
        return {
          status: 409,
          body: {
            error: existing.accountType
              ? "The requested role does not match the saved onboarding role."
              : "Save the onboarding role before completing setup.",
            code: "ONBOARDING_ROLE_MISMATCH",
          },
        } as const;
      }
      const hasIdentity =
        existing.name.trim().length >= 2 &&
        (existing.displayName?.trim().length ?? 0) >= 2 &&
        (existing.username?.trim().length ?? 0) >= 3;
      const hasSellerBrand =
        accountType !== "seller" ||
        ((existing.brandName?.trim().length ?? 0) > 0 &&
          (existing.brandStage?.trim().length ?? 0) > 0);
      if (!hasIdentity || !hasSellerBrand) {
        return {
          status: 409,
          body: {
            error: "Required onboarding profile fields are incomplete.",
            code: "ONBOARDING_PROFILE_INCOMPLETE",
          },
        } as const;
      }

      const [updated] = await tx
        .update(users)
        .set({ onboardingComplete: true, updatedAt: new Date() })
        .where(eq(users.clerkId, clerkUserId))
        .returning();
      return { status: 200, body: updated, firstCompletion: true } as const;
    });
    if (result.status >= 400) {
      (req as any).log?.warn(
        {
          code: "code" in result.body ? result.body.code : undefined,
          requestedAccountType: accountType,
        },
        "onboarding completion rejected",
      );
    }
    // Brandthread Agent welcome — hooked here (not /auth/sync, which fires
    // before the user has picked buyer vs seller) so the welcome copy can be
    // role-specific from the first message. `createWelcomeConversationOnce`
    // is itself idempotent, so this is safe even if the client retries this
    // call. Fired after responding: it must never slow down or fail
    // onboarding completion.
    if (result.status === 200 && "firstCompletion" in result && result.firstCompletion) {
      const body = result.body as typeof users.$inferSelect;
      void createWelcomeConversationOnce(clerkUserId, accountType, {
        name: body.displayName ?? body.name,
        handle: body.username ? `@${body.username}` : "",
        initials: (body.displayName ?? body.name).trim().slice(0, 2).toUpperCase() || "U",
        color: "#8B5CF6",
      }).catch((err) => {
        (req as any).log?.error({ err, clerkUserId }, "Failed to send Brandthread Agent welcome");
      });
    }
    res.status(result.status).json(result.body);
  },
);

// ─── PATCH /api/auth/onboarding/buyer-preferences ─────────────────────────────
// Buyer preferences belong to the authenticated account, not the seller router.
router.patch(
  "/onboarding/buyer-preferences",
  requireAuth,
  validateRequest({ body: buyerPreferencesBodySchema }),
  async (req, res) => {
    const clerkUserId = (req as any).clerkUserId as string;
    const styleInterests = req.body.styleInterests as string[];
    const expectedClerkId = req.body.expectedClerkId as string;
    if (expectedClerkId !== clerkUserId) {
      (req as any).log?.warn(
        "buyer onboarding preferences rejected after account context changed",
      );
      res.status(409).json({
        error: "The signed-in account changed before preferences could be saved.",
        code: "ACCOUNT_CONTEXT_CHANGED",
      });
      return;
    }
    const [existing] = await db
      .select({ accountType: users.accountType })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "User not found — call POST /auth/sync first" });
      return;
    }
    if (existing.accountType !== "buyer") {
      (req as any).log?.warn(
        { savedAccountType: existing.accountType },
        "buyer onboarding preferences rejected",
      );
      res.status(409).json({
        error: "Save the buyer onboarding role before saving buyer preferences.",
        code: "ONBOARDING_ROLE_MISMATCH",
      });
      return;
    }
    await db.execute(sql`
      UPDATE users
      SET buyer_style_interests = ${JSON.stringify(styleInterests)}::jsonb,
          updated_at = now()
      WHERE clerk_id = ${clerkUserId}
    `);
    res.json({ ok: true });
  },
);

// ─── PATCH /api/auth/profile ──────────────────────────────────────────────────
// Update editable profile fields. Validates and enforces uniqueness on username.
router.patch("/profile", requireAuth, validateRequest({ body: profileBodySchema }), async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const {
    displayName, brandName, bio, website, name, username, accountType, appThemeId, appIconId, expectedClerkId,
    category, location, contactEmail, tags, socialLinks,
  } = req.body as {
    displayName?: string;
    brandName?:   string;
    bio?:         string;
    website?:     string;
    name?:        string;
    username?:    string;
    accountType?: "buyer" | "seller";
    appThemeId?: string;
    appIconId?: string | null;
    expectedClerkId?: string;
    category?:     string;
    location?:     string;
    contactEmail?: string;
    tags?:         string[];
    socialLinks?:  Record<string, string>;
  };
  if (expectedClerkId && expectedClerkId !== clerkId) {
    (req as any).log?.warn("profile update rejected after account context changed");
    res.status(409).json({
      error: "The signed-in account changed before the profile could be saved.",
      code: "ACCOUNT_CONTEXT_CHANGED",
    });
    return;
  }

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (displayName !== undefined) updates.displayName = displayName;
  if (brandName !== undefined) {
    const trimmedBrandName = String(brandName).trim();
    if (!trimmedBrandName) {
      res.status(400).json({ error: "brandName cannot be empty" });
      return;
    }
    updates.brandName = trimmedBrandName;
  }
  if (bio         !== undefined) updates.bio         = bio;
  if (website     !== undefined) updates.website     = website;
  if (name        !== undefined) updates.name        = name;
  if (accountType !== undefined) {
    if (accountType !== "buyer" && accountType !== "seller") {
      res.status(400).json({ error: "accountType must be buyer or seller" });
      return;
    }
    updates.accountType = accountType;
  }
  if (appThemeId !== undefined) updates.appThemeId = appThemeId;
  if (appIconId !== undefined) updates.appIconId = appIconId;
  if (category     !== undefined) updates.category     = category;
  if (location     !== undefined) updates.location     = location;
  if (contactEmail !== undefined) updates.contactEmail = contactEmail;
  if (tags         !== undefined) updates.tags         = tags;
  if (socialLinks  !== undefined) updates.socialLinks   = socialLinks;

  // Username: format + uniqueness check
  if (username !== undefined) {
    const uname = String(username).trim().toLowerCase();
    if (uname === "") {
      // Allow clearing username
      updates.username = null;
    } else {
      const fmtErr = validateUsername(uname);
      if (fmtErr) {
        res.status(400).json({ error: fmtErr });
        return;
      }
      // Check uniqueness — skip if this user already owns it
      const [taken] = await db
        .select({ clerkId: users.clerkId })
        .from(users)
        .where(eq(users.username, uname))
        .limit(1);
      if (taken && taken.clerkId !== clerkId) {
        res.status(409).json({ error: "Username is already taken.", code: "USERNAME_TAKEN" });
        return;
      }
      updates.username = uname;
    }
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.clerkId, clerkId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(updated);
});

// ─── GET /api/auth/username/check ─────────────────────────────────────────────
// Real-time availability check. Returns { available: boolean, error?: string }.
// Requires auth so the current user's own username is never flagged as taken.
router.get("/username/check", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const raw = (req.query.username as string || "").trim().toLowerCase();

  const fmtErr = validateUsername(raw);
  if (fmtErr) {
    res.json({ available: false, error: fmtErr });
    return;
  }

  const [existing] = await db
    .select({ clerkId: users.clerkId })
    .from(users)
    .where(eq(users.username, raw))
    .limit(1);

  if (existing && existing.clerkId !== clerkUserId) {
    res.json({ available: false, error: "Username is already taken." });
  } else {
    res.json({ available: true });
  }
});

// ─── GET /api/auth/privacy ────────────────────────────────────────────────────
// Returns the caller's server-side privacy settings.
router.get("/privacy", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const [user] = await db
    .select({ dmPrivacy: users.dmPrivacy })
    .from(users)
    .where(eq(users.clerkId, clerkUserId))
    .limit(1);
  res.json({ dmPrivacy: user?.dmPrivacy ?? "requests" });
});

// ─── PATCH /api/auth/privacy ─────────────────────────────────────────────────
// Update server-side privacy settings. Currently exposes dmPrivacy; extensible
// — add more fields here as the product grows.
router.patch("/privacy", requireAuth, validateRequest({ body: privacyBodySchema }), async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const { dmPrivacy } = req.body as { dmPrivacy?: string };

  const validDmPrivacy = ["requests", "followers_only"];
  if (dmPrivacy !== undefined && !validDmPrivacy.includes(dmPrivacy)) {
    res.status(400).json({ error: `dmPrivacy must be one of: ${validDmPrivacy.join(", ")}` });
    return;
  }

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (dmPrivacy !== undefined) updates.dmPrivacy = dmPrivacy;

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.clerkId, clerkUserId))
    .returning({ dmPrivacy: users.dmPrivacy });

  res.json({ dmPrivacy: updated?.dmPrivacy ?? "requests" });
});

// ─── GET /api/auth/feed-gestures-tip ──────────────────────────────────────────
// Server-side source of truth for the buyer "Watching Threads" gesture coach
// mark: the version of the tip this user has already seen (0 = never).
router.get("/feed-gestures-tip", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const [user] = await db
    .select({ seenVersion: users.feedGesturesTipSeenVersion })
    .from(users)
    .where(eq(users.clerkId, clerkUserId))
    .limit(1);
  res.json({ seenVersion: user?.seenVersion ?? 0 });
});

// ─── PATCH /api/auth/feed-gestures-tip ────────────────────────────────────────
// Records that the user has now seen a given version of the tip. Never
// lowers the stored version (a stale/older client can't un-mark it seen).
router.patch(
  "/feed-gestures-tip",
  requireAuth,
  validateRequest({ body: feedGesturesTipBodySchema }),
  async (req, res) => {
    const clerkUserId = (req as any).clerkUserId as string;
    const { version } = req.body as { version: number };

    const [updated] = await db
      .update(users)
      .set({
        feedGesturesTipSeenVersion: sql`GREATEST(${users.feedGesturesTipSeenVersion}, ${version})`,
        updatedAt: new Date(),
      })
      .where(eq(users.clerkId, clerkUserId))
      .returning({ seenVersion: users.feedGesturesTipSeenVersion });

    res.json({ seenVersion: updated?.seenVersion ?? version });
  },
);

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkUserId))
    .limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found — call POST /auth/sync first" });
    return;
  }
  res.json(user);
});

// ─── POST /api/auth/password-reset/request ──────────────────────────────────
// Server-issued, Resend-backed forgot-password code (Clerk remains the
// system of record for the credential itself — see /confirm below). Always
// responds with the same generic shape whether or not the account exists, so
// the endpoint can never be used to enumerate registered emails. The one
// exception is when mail isn't configured at all: nothing was sent, so we
// say so with a typed error rather than claim success.
router.post(
  "/password-reset/request",
  rateLimit("authentication"),
  validateRequest({ body: passwordResetRequestSchema }),
  async (req, res) => {
    const { email } = req.body as { email: string };

    if (!isMailerConfigured()) {
      req.log.warn(
        "Password reset requested but RESEND_API_KEY is not set — no email was sent",
      );
      // 422, not 503/500: the request itself is fine and nothing failed on the
      // server's end — mail is just not configured — so the mobile client's
      // generic "server unavailable" banner (triggered for >=500) shouldn't
      // fire; this screen shows its own inline copy for the typed code.
      res.status(422).json({
        error: "We can't send emails right now. Please try again shortly or contact support.",
        code: "MAIL_NOT_CONFIGURED",
      });
      return;
    }

    try {
      const list = await clerkClient.users.getUserList({ emailAddress: [email] });
      const clerkUser = list.data[0];
      if (clerkUser) {
        const code = generateResetCode();
        await db.insert(passwordResetCodes).values({
          email,
          clerkId: clerkUser.id,
          codeHash: hashResetCode(code),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_CODE_TTL_MS),
        });
        const sent = await sendPasswordResetEmail({ to: email, code });
        if (!sent) {
          req.log.warn({ email }, "Password reset email failed to send after code was issued");
        }
      }
    } catch (err) {
      req.log.error({ err, email }, "Password reset request failed");
      // Fall through to the generic response — never leak whether the
      // failure was account-existence-related or a transient error.
    }

    res.json({
      ok: true,
      message: "If an account exists with that email, we sent a password reset code.",
    });
  },
);

// ─── POST /api/auth/password-reset/confirm ───────────────────────────────────
// Verifies the caller's own hashed, single-use, 15-minute code, then — only
// after that check passes — sets the new password through Clerk's backend
// API. Clerk remains the sole holder of the credential; this route never
// stores or compares a plaintext password against anything but Clerk.
router.post(
  "/password-reset/confirm",
  rateLimit("authentication"),
  validateRequest({ body: passwordResetConfirmSchema }),
  async (req, res) => {
    const { email, code, newPassword } = req.body as {
      email: string;
      code: string;
      newPassword: string;
    };

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({
        error: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
        code: "WEAK_PASSWORD",
      });
      return;
    }

    try {
      const [latest] = await db
        .select()
        .from(passwordResetCodes)
        .where(eq(passwordResetCodes.email, email))
        .orderBy(desc(passwordResetCodes.createdAt))
        .limit(1);

      if (!latest || latest.usedAt) {
        res.status(400).json({
          error: "That code isn't valid. Request a new one.",
          code: "INVALID_CODE",
        });
        return;
      }
      if (latest.expiresAt.getTime() < Date.now()) {
        res.status(400).json({
          error: "That code has expired. Request a new one.",
          code: "CODE_EXPIRED",
        });
        return;
      }
      if (hashResetCode(code) !== latest.codeHash) {
        res.status(400).json({
          error: "That code isn't right. Check your email and try again.",
          code: "INVALID_CODE",
        });
        return;
      }

      await clerkClient.users.updateUser(latest.clerkId, { password: newPassword });

      // Marked used only after Clerk confirms the password change, guarded so
      // a concurrent retry of the same code can't both report success.
      const [claimed] = await db
        .update(passwordResetCodes)
        .set({ usedAt: new Date() })
        .where(sql`${passwordResetCodes.id} = ${latest.id} AND ${passwordResetCodes.usedAt} IS NULL`)
        .returning({ id: passwordResetCodes.id });
      if (!claimed) {
        res.status(400).json({
          error: "That code isn't valid. Request a new one.",
          code: "INVALID_CODE",
        });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err, email }, "Password reset confirmation failed");
      res.status(502).json({
        error: "We couldn't reset your password right now. Try again.",
        code: "PASSWORD_RESET_FAILED",
      });
    }
  },
);

export default router;
