/**
 * Signature rules identifying rows fabricated by the api-server test suite,
 * catalogued from every seeding helper under
 * artifacts/api-server/src/**\/__tests__ (money harness, per-route
 * integration tests, etc). These MUST never match real production data — see
 * README notes inline below each rule for why it's safe.
 */

/**
 * Email TLDs reserved by RFC 6761 for exactly this purpose (documentation,
 * examples, tests) — no real, deliverable email address can use them, so
 * matching on the TLD alone is safe and catches every fake-email convention
 * used across the test suite (`@money-tests.invalid`, `@example.test`,
 * `@test.local`, `@guest.test`, `@lisbon.test`, ...) without having to
 * enumerate every literal domain a test author might invent.
 */
export const TEST_EMAIL_TLD_PATTERN = "@([a-z0-9-]+\\.)*(test|invalid|example|local|localhost)$";

/**
 * `deleted@deleted.brandthread.invalid` / `deleted+<id>@deleted.brandthread.invalid`
 * are written by production code (routes/auth.ts account-deletion
 * anonymization), not by tests. They incidentally end in `.invalid` so must
 * be carved out of the test-email match explicitly.
 */
export const PRODUCTION_EMAIL_EXCLUSION_PATTERN = "^deleted(\\+.*)?@deleted\\.brandthread\\.invalid$";

/**
 * Columns that are logically a foreign key to `users.clerk_id` (a text
 * business key, not the uuid `id`) but are declared as plain `text` columns
 * rather than real Postgres foreign keys, so they can't be discovered via
 * information_schema. Any table with one of these columns is treated as
 * cascading from a matched test user.
 */
export const CLERK_ID_REFERENCE_COLUMNS = [
  "owner_id",
  "buyer_id",
  "seller_id",
  "user_id",
  "author_id",
  "reporter_id",
  "actor_id",
  "actor_clerk_id",
  "member_clerk_id",
  "requested_by",
  "inviter_id",
  "invitee_id",
  "follower_id",
  "following_id",
  "blocker_id",
  "blocked_id",
  "visitor_id",
  "target_owner_id",
  "moderated_by",
  "resolved_by",
  "created_by",
  "deleted_by",
  "assigned_moderator_id",
  "sender_id",
];

/**
 * moneyHarness.ts's seedSeller/seedBuyer also give fake users a clerkId of
 * the shape `money-seller-<tag>-<hex>-<n>` / `money-buyer-<tag>-<hex>-<n>`.
 * Their email already matches TEST_EMAIL_TLD_PATTERN, so this is a belt-and-
 * suspenders anchor, not load-bearing.
 */
export const CLERK_ID_LITERAL_PREFIXES = ["money-seller-", "money-buyer-"];

/**
 * moneyHarness.ts's seedManufacturer names fabricated manufacturers
 * `Factory <uid>`; several route integration tests use `<prefix>-factory-<n>`.
 * Real manufacturer businesses are never named starting with the literal
 * word "Factory " followed by a hex run, nor with a `-factory-<n>` suffix,
 * so this is a safe standalone anchor for rows that aren't reachable via a
 * seeded user (manufacturers aren't `users` rows).
 */
export const MANUFACTURER_NAME_PATTERNS = ["^Factory [a-z0-9-]+$", "-factory-[0-9]+$"];

/** Columns across the schema whose name suggests an email address; matched
 * generically via information_schema rather than a hardcoded per-table list. */
export const EMAIL_COLUMN_NAME_FRAGMENT = "email";

/**
 * Tables the database itself refuses to DELETE from (see
 * `ledger_reject_mutation()` in migration 084_money_ledger_state_machines.sql
 * — the money ledger is intentionally append-only for audit integrity). The
 * purge must never attempt to delete these rows even when they belong to an
 * otherwise-purged test user; deleting the owning user/order is sufficient,
 * and the leftover ledger rows are internal accounting data, never shown on
 * any buyer- or seller-facing surface.
 */
export const NON_DELETABLE_TABLES = ["ledger_transactions", "ledger_postings"];
