#!/usr/bin/env -S tsx
/**
 * ADMIN MAINTENANCE SCRIPT — one-off cleanup of old testing accounts that are
 * colliding on email uniqueness with real signups.
 *
 * This is NOT the automated test-signature cleanup in purgeTestData.ts (which
 * matches rows fabricated by the integration test suite via reserved email
 * TLDs / clerkId prefixes). This script instead deletes whatever REAL
 * accounts the admin identifies at run time, by explicit email list or by
 * "everyone except this keep-list" — because these are old testing accounts
 * made with ordinary-looking emails during manual QA, not automated-test
 * fixtures.
 *
 * Safety model:
 *   - Defaults to a DRY RUN: prints matched users and, per table, how many
 *     dependent rows WOULD be touched. No writes happen. Pass --confirm to
 *     actually execute.
 *   - ALWAYS writes a full JSON backup of every matched user and every
 *     dependent row it is about to touch to artifacts/api-server/backups/
 *     BEFORE doing anything else, even during --confirm. This happens on
 *     dry runs too, so the backup file always reflects "what would be
 *     deleted" and is a rehearsal you can inspect.
 *   - The dependent-row cleanup mirrors, table-for-table and in the same
 *     order, the FK-safe deletion performed by the single-account route
 *     DELETE /api/auth/account in src/routes/auth.ts. THIS DUPLICATION IS
 *     DELIBERATE (kept separate from src/lib/accountDeletion.ts on purpose)
 *     so this bulk admin tool can never change that route's behavior for
 *     real self-service deletions. If auth.ts's deletion order changes,
 *     update the ACCOUNT_CLEANUP_STATEMENTS list below to match.
 *   - Unlike the self-service route (which TOMBSTONES the users row —
 *     anonymizes it but keeps it so an old client can't resurrect it via
 *     /auth/sync), this script HARD-DELETES the users row entirely, because
 *     the whole point is to free up the email address for real signups.
 *   - Deliberately does NOT run getDeletionBlockers() (the "you have open
 *     orders" guard from src/lib/accountDeletion.ts). That guard protects a
 *     live user from self-deleting while a real counterparty is waiting on
 *     them. It does not apply here — these are being identified as stale
 *     test junk by an admin, not self-deleted by their owner. If the admin
 *     runs this against a live account with real open orders, its order/
 *     customer/return/dispute rows are anonymized (same as the route does)
 *     rather than deleted, so counterparties' own records are not broken.
 *   - bt_preview (?bt_preview=seller|buyer) is a MOBILE-APP-ONLY, client-side
 *     query-param bypass (see artifacts/mobile/lib/devPreview.ts) that skips
 *     Clerk sign-in in dev-web builds and shows in-memory fixture data. It
 *     never creates a Clerk user or a `users` row, so there is no
 *     server-side fixture data to exclude here — confirmed by searching the
 *     codebase for "bt_preview" and finding no api-server or db seed usage.
 *
 * Selection (pick exactly one):
 *   --emails a@x.com,b@y.com      Delete only these accounts (by email).
 *   --all --keep a@x.com,b@y.com  Delete every account EXCEPT the keep-list.
 *                                 --keep is mandatory with --all so a typo'd
 *                                 command can't wipe the whole users table.
 *
 * --keep a@x.com,b@y.com  (repeatable and/or comma-separated) Accounts to
 *   exclude even if they would otherwise match --emails or --all.
 *
 * With no selector, the script prints this usage and exits WITHOUT touching
 * the database — there is no accidental "wipe everything" default.
 *
 * Usage:
 *   # Dry run against a short list (default — no writes, backup still written):
 *   pnpm --filter @workspace/api-server run admin:reset-accounts -- \
 *     --emails old-test1@gmail.com,old-test2@gmail.com
 *
 *   # Actually delete that list, from local Postgres + Clerk:
 *   pnpm --filter @workspace/api-server run admin:reset-accounts -- \
 *     --emails old-test1@gmail.com,old-test2@gmail.com --confirm
 *
 *   # Wipe every account except two real ones you're keeping (dry run first!):
 *   pnpm --filter @workspace/api-server run admin:reset-accounts -- \
 *     --all --keep owner@brandthread.com,cofounder@brandthread.com
 *   pnpm --filter @workspace/api-server run admin:reset-accounts -- \
 *     --all --keep owner@brandthread.com,cofounder@brandthread.com --confirm
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { clerkClient } from "@clerk/express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface MatchedUser {
  id: string; // users.id (uuid)
  clerk_id: string;
  email: string;
}

// ─── CLI args ────────────────────────────────────────────────────────────────
function splitList(values: string[]): string[] {
  return values
    .flatMap((v) => v.split(","))
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function collectFlagValues(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) values.push(next);
    } else if (argv[i].startsWith(`${flag}=`)) {
      values.push(argv[i].slice(flag.length + 1));
    }
  }
  return values;
}

const argv = process.argv.slice(2);
const confirm = argv.includes("--confirm");
const useAll = argv.includes("--all");
const emails = splitList(collectFlagValues(argv, "--emails"));
const keep = new Set(splitList(collectFlagValues(argv, "--keep")));
const wantsHelp = argv.includes("--help") || argv.includes("-h");

function printUsageAndExit(code: number): never {
  console.log(`
reset-accounts.ts — admin one-off deletion of old testing accounts.

Selection (pick exactly one):
  --emails a@x.com,b@y.com       Delete only these accounts.
  --all --keep a@x.com,...       Delete every account EXCEPT the keep-list.

  --keep a@x.com,b@y.com         Accounts to always exclude (repeatable).
  --confirm                      Actually write/delete. Omit for a dry run.

Examples:
  pnpm --filter @workspace/api-server run admin:reset-accounts -- --emails a@x.com,b@y.com
  pnpm --filter @workspace/api-server run admin:reset-accounts -- --emails a@x.com,b@y.com --confirm
  pnpm --filter @workspace/api-server run admin:reset-accounts -- --all --keep owner@brandthread.com
  pnpm --filter @workspace/api-server run admin:reset-accounts -- --all --keep owner@brandthread.com --confirm

With no --emails and no --all, nothing is selected and nothing happens.
`);
  process.exit(code);
}

if (wantsHelp) printUsageAndExit(0);
if (emails.length === 0 && !useAll) printUsageAndExit(1);
if (emails.length > 0 && useAll) {
  console.error("Pass either --emails or --all, not both.");
  process.exit(1);
}
if (useAll && keep.size === 0) {
  console.error("--all requires --keep <email(s)> so this can't wipe every account by accident.");
  process.exit(1);
}

// ─── Dependent-table plan ───────────────────────────────────────────────────
// Mirrors DELETE /api/auth/account in src/routes/auth.ts exactly, table for
// table and in the same order, generalized from one clerkUserId to a set.
// Each entry backs up matching rows (SELECT *), then either counts (dry run)
// or executes (confirm) the same statement against the live users.
//
// $1 = array of matched clerk_ids (text[])
// $2 = array of matched users.id (uuid[]) — only used by the `users` table
// $3 = array of "deleted:<users.id>" tombstone subjects, positionally aligned
//      with $2 — only used by tables that reassign ownership to a tombstone
//      subject instead of deleting the row outright.
interface CleanupStep {
  table: string;
  /** SELECT used both for the backup snapshot and for the dry-run count. */
  selectWhere: string;
  /** Mutating statement run only under --confirm. */
  exec: string;
  /** True for UPDATE steps (dependent row survives, anonymized/tombstoned). */
  isUpdate: boolean;
}

const ACCOUNT_CLEANUP_STEPS: CleanupStep[] = [
  { table: "push_tokens", selectWhere: `user_id = ANY($1)`, exec: `DELETE FROM push_tokens WHERE user_id = ANY($1)`, isUpdate: false },
  { table: "buyer_addresses", selectWhere: `buyer_id = ANY($1)`, exec: `DELETE FROM buyer_addresses WHERE buyer_id = ANY($1)`, isUpdate: false },
  { table: "cart_items", selectWhere: `user_id = ANY($1)`, exec: `DELETE FROM cart_items WHERE user_id = ANY($1)`, isUpdate: false },
  { table: "saved_items", selectWhere: `user_id = ANY($1)`, exec: `DELETE FROM saved_items WHERE user_id = ANY($1)`, isUpdate: false },
  { table: "notifications_feed", selectWhere: `user_id = ANY($1)`, exec: `DELETE FROM notifications_feed WHERE user_id = ANY($1)`, isUpdate: false },
  { table: "blocks", selectWhere: `blocker_id = ANY($1) OR blocked_id = ANY($1)`, exec: `DELETE FROM blocks WHERE blocker_id = ANY($1) OR blocked_id = ANY($1)`, isUpdate: false },
  { table: "follows", selectWhere: `follower_id = ANY($1) OR following_id = ANY($1)`, exec: `DELETE FROM follows WHERE follower_id = ANY($1) OR following_id = ANY($1)`, isUpdate: false },
  { table: "story_likes", selectWhere: `user_id = ANY($1)`, exec: `DELETE FROM story_likes WHERE user_id = ANY($1)`, isUpdate: false },
  { table: "story_views", selectWhere: `user_id = ANY($1)`, exec: `DELETE FROM story_views WHERE user_id = ANY($1)`, isUpdate: false },
  { table: "interactions", selectWhere: `user_id = ANY($1)`, exec: `DELETE FROM interactions WHERE user_id = ANY($1)`, isUpdate: false },
  { table: "posts", selectWhere: `user_id = ANY($1)`, exec: `DELETE FROM posts WHERE user_id = ANY($1)`, isUpdate: false },
  { table: "stories", selectWhere: `author_id = ANY($1)`, exec: `DELETE FROM stories WHERE author_id = ANY($1)`, isUpdate: false },
  { table: "product_reserves", selectWhere: `user_id = ANY($1)`, exec: `DELETE FROM product_reserves WHERE user_id = ANY($1)`, isUpdate: false },
  { table: "waitlist_entries", selectWhere: `user_id = ANY($1)`, exec: `DELETE FROM waitlist_entries WHERE user_id = ANY($1)`, isUpdate: false },
  { table: "drop_alert_subscriptions", selectWhere: `user_id = ANY($1)`, exec: `DELETE FROM drop_alert_subscriptions WHERE user_id = ANY($1)`, isUpdate: false },
  { table: "checkout_sessions", selectWhere: `buyer_id = ANY($1)`, exec: `DELETE FROM checkout_sessions WHERE buyer_id = ANY($1)`, isUpdate: false },
  { table: "loyalty_points", selectWhere: `buyer_id = ANY($1)`, exec: `DELETE FROM loyalty_points WHERE buyer_id = ANY($1)`, isUpdate: false },
  { table: "referrals", selectWhere: `inviter_id = ANY($1) OR invitee_id = ANY($1)`, exec: `DELETE FROM referrals WHERE inviter_id = ANY($1) OR invitee_id = ANY($1)`, isUpdate: false },
  { table: "klaviyo_integrations", selectWhere: `owner_id = ANY($1)`, exec: `DELETE FROM klaviyo_integrations WHERE owner_id = ANY($1)`, isUpdate: false },
  { table: "seller_subscription_entitlements", selectWhere: `clerk_user_id = ANY($1)`, exec: `DELETE FROM seller_subscription_entitlements WHERE clerk_user_id = ANY($1)`, isUpdate: false },
  { table: "post_comment_likes", selectWhere: `user_id = ANY($1)`, exec: `DELETE FROM post_comment_likes WHERE user_id = ANY($1)`, isUpdate: false },
  { table: "post_comments", selectWhere: `author_id = ANY($1)`, exec: `DELETE FROM post_comments WHERE author_id = ANY($1)`, isUpdate: false },
  { table: "muted_words", selectWhere: `user_id = ANY($1)`, exec: `DELETE FROM muted_words WHERE user_id = ANY($1)`, isUpdate: false },

  // Reports keep their moderation record but lose the deleted person's
  // identity, exactly like auth.ts. Two separate UPDATEs because a report
  // filed by one deleted account about another must tombstone both sides
  // independently, without either write clobbering the other's tombstone
  // subject (each row's own id maps to its own "deleted:<uuid>").
  {
    table: "reports (as reporter)",
    selectWhere: `reporter_id = ANY($1)`,
    exec: `UPDATE reports SET reporter_id = 'deleted:' || u.id
           FROM users u WHERE u.clerk_id = reports.reporter_id AND reports.reporter_id = ANY($1)`,
    isUpdate: true,
  },
  {
    table: "reports (as target)",
    selectWhere: `target_owner_id = ANY($1)`,
    exec: `UPDATE reports SET target_owner_id = 'deleted:' || u.id
           FROM users u WHERE u.clerk_id = reports.target_owner_id AND reports.target_owner_id = ANY($1)`,
    isUpdate: true,
  },

  // Conversations: clear the cached preview for any thread a matched user
  // participates in, then remove their messages and participant rows.
  {
    table: "conversations (preview cleared)",
    selectWhere: `id IN (SELECT conversation_id FROM conversation_participants WHERE user_id = ANY($1))`,
    exec: `UPDATE conversations SET last_message = NULL
           WHERE id IN (SELECT conversation_id FROM conversation_participants WHERE user_id = ANY($1))`,
    isUpdate: true,
  },
  { table: "messages", selectWhere: `sender_id = ANY($1)`, exec: `DELETE FROM messages WHERE sender_id = ANY($1)`, isUpdate: false },
  { table: "conversation_participants", selectWhere: `user_id = ANY($1)`, exec: `DELETE FROM conversation_participants WHERE user_id = ANY($1)`, isUpdate: false },

  // Retained commerce records: strip PII, keep amounts/statuses for
  // accounting, same as auth.ts.
  {
    table: "orders (as buyer)",
    selectWhere: `buyer_id = ANY($1)`,
    exec: `UPDATE orders SET buyer_id = NULL, guest_email = NULL, shipping_address = NULL, notes = NULL, updated_at = NOW()
           WHERE buyer_id = ANY($1)`,
    isUpdate: true,
  },
  {
    table: "orders (as seller)",
    selectWhere: `owner_id = ANY($1)`,
    exec: `UPDATE orders SET owner_id = 'deleted:' || u.id, updated_at = NOW()
           FROM users u WHERE u.clerk_id = orders.owner_id AND orders.owner_id = ANY($1)`,
    isUpdate: true,
  },
  {
    table: "customers",
    selectWhere: `owner_id = ANY($1)`,
    exec: `UPDATE customers SET owner_id = 'deleted:' || u.id, email = 'deleted@deleted.brandthread.invalid',
             name = 'Deleted customer', phone = NULL, address = NULL, updated_at = NOW()
           FROM users u WHERE u.clerk_id = customers.owner_id AND customers.owner_id = ANY($1)`,
    isUpdate: true,
  },
  {
    table: "returns (evidence stripped)",
    selectWhere: `buyer_id = ANY($1) OR seller_id = ANY($1)`,
    exec: `UPDATE returns SET notes = NULL, seller_response = NULL, evidence_urls = '[]'::json
           WHERE buyer_id = ANY($1) OR seller_id = ANY($1)`,
    isUpdate: true,
  },
  {
    table: "returns (as buyer)",
    selectWhere: `buyer_id = ANY($1)`,
    exec: `UPDATE returns SET buyer_id = 'deleted:' || u.id
           FROM users u WHERE u.clerk_id = returns.buyer_id AND returns.buyer_id = ANY($1)`,
    isUpdate: true,
  },
  {
    table: "returns (as seller)",
    selectWhere: `seller_id = ANY($1)`,
    exec: `UPDATE returns SET seller_id = 'deleted:' || u.id
           FROM users u WHERE u.clerk_id = returns.seller_id AND returns.seller_id = ANY($1)`,
    isUpdate: true,
  },
  {
    table: "disputes",
    selectWhere: `seller_id = ANY($1)`,
    exec: `UPDATE disputes SET seller_id = 'deleted:' || u.id, customer_claim = '', evidence_json = '[]'::json,
             stripe_evidence_details = '{}'::json, updated_at = NOW()
           FROM users u WHERE u.clerk_id = disputes.seller_id AND disputes.seller_id = ANY($1)`,
    isUpdate: true,
  },
  {
    table: "reviews (as buyer)",
    selectWhere: `buyer_id = ANY($1)`,
    exec: `UPDATE reviews SET buyer_id = 'deleted', body = NULL WHERE buyer_id = ANY($1)`,
    isUpdate: true,
  },
  {
    table: "reviews (as seller)",
    selectWhere: `seller_id = ANY($1)`,
    exec: `UPDATE reviews SET seller_id = 'deleted:' || u.id
           FROM users u WHERE u.clerk_id = reviews.seller_id AND reviews.seller_id = ANY($1)`,
    isUpdate: true,
  },

  // Seller catalog/profile content.
  {
    table: "products",
    selectWhere: `owner_id = ANY($1)`,
    exec: `UPDATE products SET status = 'archived', images = '[]'::json, description = NULL, updated_at = NOW()
           WHERE owner_id = ANY($1)`,
    isUpdate: true,
  },
  { table: "storefronts", selectWhere: `owner_id = ANY($1)`, exec: `DELETE FROM storefronts WHERE owner_id = ANY($1)`, isUpdate: false },
  { table: "seller_quote_requests", selectWhere: `seller_id = ANY($1)`, exec: `DELETE FROM seller_quote_requests WHERE seller_id = ANY($1)`, isUpdate: false },
  { table: "seller_tax_config", selectWhere: `seller_id = ANY($1)`, exec: `DELETE FROM seller_tax_config WHERE seller_id = ANY($1)`, isUpdate: false },
  { table: "shipping_rates", selectWhere: `seller_id = ANY($1)`, exec: `DELETE FROM shipping_rates WHERE seller_id = ANY($1)`, isUpdate: false },
  {
    table: "discount_codes",
    selectWhere: `seller_id = ANY($1)`,
    exec: `UPDATE discount_codes SET active = false WHERE seller_id = ANY($1)`,
    isUpdate: true,
  },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL must be set.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // ── Resolve the matched user set ───────────────────────────────────────
    const keepList = [...keep];
    let matched: MatchedUser[];
    if (emails.length > 0) {
      const { rows } = await client.query<MatchedUser>(
        `SELECT id, clerk_id, email FROM users WHERE lower(email) = ANY($1) AND NOT (lower(email) = ANY($2))`,
        [emails, keepList],
      );
      matched = rows;
    } else {
      const { rows } = await client.query<MatchedUser>(
        `SELECT id, clerk_id, email FROM users WHERE NOT (lower(email) = ANY($1))`,
        [keepList],
      );
      matched = rows;
    }

    if (matched.length === 0) {
      console.log("No matching accounts found. Nothing to do.");
      return;
    }

    console.log(`Matched ${matched.length} account(s):`);
    for (const u of matched) console.log(`  ${u.email}  (clerk_id=${u.clerk_id})`);
    if (keepList.length) console.log(`Excluded via --keep: ${keepList.join(", ")}`);
    console.log();

    const clerkIds = matched.map((u) => u.clerk_id);

    // ── Backup FIRST, always, before any write — even on a dry run ─────────
    const backup: Record<string, unknown[]> = {};
    {
      const { rows } = await client.query(`SELECT * FROM users WHERE clerk_id = ANY($1)`, [clerkIds]);
      backup.users = rows;
    }
    for (const step of ACCOUNT_CLEANUP_STEPS) {
      const tableName = step.table.split(" ")[0];
      const { rows } = await client.query(`SELECT * FROM ${tableName} WHERE ${step.selectWhere}`, [clerkIds]);
      backup[step.table] = rows;
    }

    const backupsDir = path.join(__dirname, "..", "backups");
    fs.mkdirSync(backupsDir, { recursive: true });
    const backupPath = path.join(backupsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log(`Backup written to ${backupPath}`);
    console.log();

    // ── Dry run: report counts per table, no writes ────────────────────────
    if (!confirm) {
      console.log("DRY RUN — would delete/update rows by table (no writes performed):");
      console.log(`  ${"users".padEnd(32)} ${matched.length}`);
      for (const step of ACCOUNT_CLEANUP_STEPS) {
        const tableName = step.table.split(" ")[0];
        const { rows } = await client.query(
          `SELECT COUNT(*)::int AS n FROM ${tableName} WHERE ${step.selectWhere}`,
          [clerkIds],
        );
        const n = Number(rows[0]?.n ?? 0);
        if (n > 0) console.log(`  ${step.table.padEnd(32)} ${n}${step.isUpdate ? " (update/tombstone)" : ""}`);
      }
      console.log("\nDry run only — nothing was deleted. Re-run with --confirm to execute (backup was still written above).");
      return;
    }

    // ── Confirm run: single transaction, FK-safe order ──────────────────────
    await client.query("BEGIN");
    try {
      for (const step of ACCOUNT_CLEANUP_STEPS) {
        await client.query(step.exec, [clerkIds]);
      }
      // Hard-delete the users row itself (unlike auth.ts's tombstone update —
      // the whole point here is to free the email for a real signup).
      await client.query(`DELETE FROM users WHERE clerk_id = ANY($1)`, [clerkIds]);
      await client.query("COMMIT");
      console.log(`Committed: deleted ${matched.length} user(s) and their dependent rows.`);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }

    // ── Clerk deletion happens only after the DB transaction commits, same
    // ordering as auth.ts. Best-effort per user: one failure doesn't stop the
    // rest, and is safe to retry (the DB side already committed).
    console.log("\nDeleting from Clerk...");
    for (const u of matched) {
      try {
        await clerkClient.users.deleteUser(u.clerk_id);
        console.log(`  Clerk: deleted ${u.clerk_id} (${u.email})`);
      } catch (err) {
        console.error(`  Clerk: FAILED to delete ${u.clerk_id} (${u.email}) — retry manually:`, err);
      }
    }

    console.log(`\nDone. Backed up to ${backupPath}. Deleted ${matched.length} account(s) from Postgres and attempted Clerk deletion for each.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
