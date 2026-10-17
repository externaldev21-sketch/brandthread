#!/usr/bin/env -S tsx
/**
 * Backfill: pixel dimensions for every post's media (migration 271), including
 * the @brandthread seed content. The API also runs this automatically ~45s
 * after boot; use this to run it on demand. Safe to run more than once.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run backfill:media-dimensions
 */
import { runMediaDimensionsBackfill } from "../src/jobs/mediaDimensionsBackfill";

async function main() {
  const result = await runMediaDimensionsBackfill();
  console.log(`Measured ${result.measured} post(s); ${result.unknown} could not be measured (stored as 0).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
