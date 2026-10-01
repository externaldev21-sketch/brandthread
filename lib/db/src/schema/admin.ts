import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { boosts } from "./index";

// ─── Admin dashboard (migration 112) ─────────────────────────────────────────
// Everything here is written only by the platform-admin routes
// (api-server routes/admin.ts), except ai_usage_events which the OpenAI client
// hook fills for every AI call.

/** Append-only (a database trigger rejects UPDATE/DELETE). */
export const adminAuditLog = pgTable("admin_audit_log", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  actorClerkId: text("actor_clerk_id").notNull(),
  actorEmail: text("actor_email"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  summary: text("summary").notNull().default(""),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  createdIdx: index("admin_audit_log_created_idx").on(t.createdAt),
  actorIdx: index("admin_audit_log_actor_idx").on(t.actorClerkId, t.createdAt),
  targetIdx: index("admin_audit_log_target_idx").on(t.targetType, t.targetId),
}));

export const adminAnnouncements = pgTable("admin_announcements", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  body: text("body").notNull(),
  /** 'all' | 'sellers' | 'buyers' */
  audience: text("audience").notNull().default("all"),
  sendPush: boolean("send_push").notNull().default(true),
  sendInApp: boolean("send_in_app").notNull().default(true),
  /** 'sending' | 'sent' | 'failed' */
  status: text("status").notNull().default("sending"),
  recipientCount: integer("recipient_count").notNull().default(0),
  deliveredCount: integer("delivered_count").notNull().default(0),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export const featuredItems = pgTable("featured_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  /** 'brand' (target = users.clerk_id) | 'thread' (target = posts.id) */
  kind: text("kind").notNull(),
  targetId: text("target_id").notNull(),
  label: text("label"),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  targetUnique: unique("featured_items_target_unique").on(t.kind, t.targetId),
  activeIdx: index("featured_items_active_idx").on(t.kind, t.active, t.position),
}));

export const adminInviteCodes = pgTable("admin_invite_codes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  label: text("label"),
  /** NULL = unlimited. */
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminInviteCodeUses = pgTable("admin_invite_code_uses", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  codeId: uuid("code_id").notNull().references(() => adminInviteCodes.id, { onDelete: "cascade" }),
  /** Clerk ID — one redemption per user, ever. */
  userId: text("user_id").notNull().unique(),
  usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  codeIdx: index("admin_invite_code_uses_code_idx").on(t.codeId),
}));

export const aiUsageEvents = pgTable("ai_usage_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Clerk ID; NULL for calls made outside a signed-in request. */
  userId: text("user_id"),
  /** 'chat' | 'image' | 'image_edit' */
  feature: text("feature").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  /** Estimated cost in millionths of a US dollar. */
  costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
  /** false when the model has no known price (cost_micros is then 0). */
  priced: boolean("priced").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("ai_usage_events_user_idx").on(t.userId, t.createdAt),
  createdIdx: index("ai_usage_events_created_idx").on(t.createdAt),
}));

export const boostReviews = pgTable("boost_reviews", {
  boostId: uuid("boost_id").primaryKey().references(() => boosts.id, { onDelete: "cascade" }),
  /** 'approved' | 'rejected' */
  status: text("status").notNull(),
  reason: text("reason"),
  reviewedBy: text("reviewed_by").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Invite-only launch waitlist (migration 241) ─────────────────────────────
// People who asked for access while `inviteOnlySignup` is on. Unique on
// lower(email) (index created in the migration — Drizzle can't express it).
export const accessWaitlistSignups = pgTable("access_waitlist_signups", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  invitedBy: text("invited_by"),
  /** The single-use admin_invite_codes row issued to this person. */
  inviteCodeId: uuid("invite_code_id").references(() => adminInviteCodes.id, { onDelete: "set null" }),
});
