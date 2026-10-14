/**
 * Products whose draw is still open or being drawn can't be bought through
 * normal checkout; the only way in is a draw entry. Once the draw has run
 * (or was cancelled) any stock left over sells normally. Kept apart from
 * lib/productDraws.ts so checkout gating doesn't import the draw engine.
 */
import { and, inArray } from "drizzle-orm";
import { db, productDraws } from "@workspace/db";
import type { DbExecutor } from "./money/ledger";

export const DRAW_BLOCKING_STATUSES = ["open", "drawing"] as const;

export async function drawOnlyProductIds(productIds: string[], executor: DbExecutor = db): Promise<string[]> {
  if (productIds.length === 0) return [];
  const rows = await executor
    .select({ productId: productDraws.productId })
    .from(productDraws)
    .where(and(inArray(productDraws.productId, productIds), inArray(productDraws.status, [...DRAW_BLOCKING_STATUSES])));
  return rows.map((r) => r.productId);
}
