#!/usr/bin/env -S tsx
/**
 * One-time backfill: sends the Brandthread Agent welcome conversation to
 * every existing onboarded user who doesn't have one yet. Safe to run more
 * than once — each user is individually gated by the `agent_conversations`
 * ledger (see lib/brandthreadAgent.ts), so a second run converges to zero
 * new conversations.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx ./scripts/backfillAgentWelcome.ts
 */
import { runAgentWelcomeBackfill } from "../src/lib/brandthreadAgent";

async function main() {
  const result = await runAgentWelcomeBackfill();
  console.log(`Scanned ${result.scanned} user(s) without a Brandthread Agent conversation.`);
  console.log(`Sent welcome to ${result.created} user(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
