#!/usr/bin/env -S tsx
/**
 * Generates Studio carousel cover-art candidates (see
 * src/lib/studioCoverArt.ts) for one or more cards, uploads them, and
 * auto-picks candidate 1 for any card that doesn't have a chosen cover yet
 * (Dev: "the manifest picks candidate 1 by default so the app has covers
 * immediately, and I can swap picks after reviewing"). Safe to re-run — it
 * only ever appends candidates, never deletes or overwrites an existing
 * pick.
 *
 * Requires the same OpenAI AI integration every other AI image feature in
 * this app already needs — AI_INTEGRATIONS_OPENAI_API_KEY and
 * AI_INTEGRATIONS_OPENAI_BASE_URL (Replit's provisioned "OpenAI AI
 * integration") — plus PUBLIC_OBJECT_SEARCH_PATHS/PRIVATE_OBJECT_DIR for
 * object storage, same as every other generated image in this app.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx ./scripts/generateStudioCoverArt.ts
 *   pnpm --filter @workspace/api-server exec tsx ./scripts/generateStudioCoverArt.ts add-product go-live payouts
 *   pnpm --filter @workspace/api-server exec tsx ./scripts/generateStudioCoverArt.ts --count 2 add-product
 *
 * With no card ids given, runs for every known card (see
 * STUDIO_COVER_SUBJECTS). Defaults to 4 candidates per card.
 */
import { generateStudioCoverArtCandidates, STUDIO_COVER_SUBJECTS } from "../src/lib/studioCoverArt";

async function main() {
  const args = process.argv.slice(2);
  let count = 4;
  const cardIds: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--count") {
      count = Number(args[++i]);
      continue;
    }
    cardIds.push(args[i]);
  }
  const targets = cardIds.length > 0 ? cardIds : Object.keys(STUDIO_COVER_SUBJECTS);

  for (const cardId of targets) {
    if (!(cardId in STUDIO_COVER_SUBJECTS)) {
      console.error(`Skipping unknown card id "${cardId}" (known: ${Object.keys(STUDIO_COVER_SUBJECTS).join(", ")})`);
      continue;
    }
    console.log(`Generating ${count} candidate(s) for "${cardId}"...`);
    const candidates = await generateStudioCoverArtCandidates(cardId, count);
    candidates.forEach((c) => console.log(`  ${c.objectPath}`));
  }

  console.log("\nDone. Review candidates and swap picks via:");
  console.log("  GET  /api/config/studio-cover-art/:cardId/candidates  (admin, lists signed URLs)");
  console.log("  POST /api/config/studio-cover-art/:cardId/select      (admin, { objectPath })");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Studio cover-art generation failed:", err);
    process.exit(1);
  });
