import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Cross-instance realtime (migration 458, api-server lib/realtime).
 * Large NOTIFY payloads are stored here and only their id is notified.
 */
export const realtimeBusPayloads = pgTable("realtime_bus_payloads", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  createdAtIdx: index("realtime_bus_payloads_created_at_idx").on(table.createdAt),
}));

/** Who has a realtime room open on which API instance (heartbeat + TTL). */
export const realtimePresence = pgTable("realtime_presence", {
  scope: text("scope").notNull(),
  roomId: text("room_id").notNull(),
  userId: text("user_id").notNull(),
  instanceId: text("instance_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.scope, table.roomId, table.userId, table.instanceId] }),
  expiresAtIdx: index("realtime_presence_expires_at_idx").on(table.expiresAt),
}));
