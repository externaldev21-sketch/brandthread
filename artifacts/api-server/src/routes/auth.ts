import { Router } from "express";
import { clerkClient } from "@clerk/express";
import {
  db, users, orders, orderItems, conversationParticipants, conversations, messages,
} from "@workspace/db";
import { eq, sql, inArray, or, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { awardLoyaltyPointsOnce } from "./loyalty";
import { sendWelcomeEmail } from "../lib/brandthreadEmail";
import { hasDeletionConfirmation } from "../lib/accountDeletion";
import { z } from "@workspace/api-zod";
import { requestPrimitives, validateRequest } from "../middlewares/validateRequest";
import {
  getClerkEmailAddress,
  normalizeProfileName,
  preserveExistingEmail,
} from "../lib/authProfile";

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
}).passthrough();
const privacyBodySchema = z.object({
  dmPrivacy: z.enum(["requests", "followers_only"]),
}).passthrough();

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
      res.status(409).json({ error: "Username is already taken." });
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
      return { status: 200, body: updated } as const;
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
  const { displayName, brandName, bio, website, name, username, accountType, appThemeId, appIconId, expectedClerkId } = req.body as {
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
        res.status(409).json({ error: "Username is already taken." });
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

export default router;
