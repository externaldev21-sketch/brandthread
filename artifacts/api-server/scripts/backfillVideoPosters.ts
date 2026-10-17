#!/usr/bin/env -S tsx
/**
 * One-time backfill: generates a still poster (ffmpeg, first frame at 0.5s)
 * for every video post that has no `thumbnail_url` — including the
 * @brandthread seed videos — so the Discover grid never shows a blank tile.
 * Safe to re-run; posts that already have a poster are never touched.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run backfill:video-posters -- --origin https://<api host> [--dry-run] [--max 500]
 *
 * --origin is only needed for videos that are NOT served from
 * /api/posts/media/* (e.g. seeded external URLs); posters for those are still
 * stored in object storage and served from <origin>/api/posts/media/*.
 */
import { runVideoPosterBackfill } from "../src/lib/videoPoster";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const max = flag("--max") ? Number(flag("--max")) : undefined;
  const result = await runVideoPosterBackfill({ origin: flag("--origin") ?? null, dryRun, max });
  console.log(`Scanned ${result.scanned} video post(s) without a poster.`);
  if (dryRun) return;
  console.log(`Generated ${result.generated} poster(s).`);
  if (result.failed.length > 0) console.log(`Could not generate ${result.failed.length}: ${result.failed.join(", ")}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
