/**
 * Mystery boxes (migration 264).
 *
 * A box is an ordinary product — the cart, checkout, price and the box's own
 * stock work unchanged — plus a pool of candidate variants from the same
 * seller (mystery_box_pools / mystery_box_pool_items). When an order holding
 * a box is paid, `resolveMysteryBoxPicks` runs inside the order transaction
 * (routes/webhooks.ts handleCheckoutPaid) and turns each box unit into one
 * candidate: weighted-random among candidates with stock, that candidate's
 * stock decremented, the pick recorded in mystery_box_picks. Nothing in stock
 * records a pick with no variant and flags the seller — the payment never
 * fails over a box.
 */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { SqlExecutor } from "./stockReservation";
import { logger } from "./logger";

export const MYSTERY_BOX_MAX_ITEMS = 50;
export type MysteryReveal = "at_purchase" | "on_delivery";
export const MYSTERY_REVEALS: readonly MysteryReveal[] = ["at_purchase", "on_delivery"];

export interface WeightedCandidate {
  variantId: string;
  weight: number;
  stock: number;
}

/** Returns an integer in [0, max). Injected so tests are deterministic. */
export type RandomInt = (max: number) => number;

export const cryptoRandomInt: RandomInt = (max) => crypto.randomInt(max);

/**
 * Pure weighted pick. Candidates with stock <= 0 or weight < 1 are excluded;
 * returns null when none remain. Each eligible candidate wins with
 * probability weight / sum(weights).
 */
export function pickWeighted(candidates: WeightedCandidate[], rng: RandomInt = cryptoRandomInt): string | null {
  const eligible = candidates.filter((c) => c.stock > 0 && Number.isInteger(c.weight) && c.weight >= 1);
  if (eligible.length === 0) return null;
  const total = eligible.reduce((sum, c) => sum + c.weight, 0);
  let roll = rng(total);
  for (const c of eligible) {
    if (roll < c.weight) return c.variantId;
    roll -= c.weight;
  }
  return eligible[eligible.length - 1]!.variantId;
}

export type PoolInput = { reveal: MysteryReveal; showOdds: boolean; items: Array<{ variantId: string; weight: number }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates the seller's PUT body shape (ownership is checked against the DB separately). */
export function parsePoolInput(body: unknown):
  | { ok: true; value: PoolInput }
  | { ok: false; code: string; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const reveal = b.reveal === undefined ? "at_purchase" : b.reveal;
  if (!MYSTERY_REVEALS.includes(reveal as MysteryReveal)) {
    return { ok: false, code: "INVALID_REVEAL", error: "Reveal must be at_purchase or on_delivery." };
  }
  if (!Array.isArray(b.items)) return { ok: false, code: "INVALID_ITEMS", error: "items required" };
  if (b.items.length > MYSTERY_BOX_MAX_ITEMS) {
    return { ok: false, code: "TOO_MANY_ITEMS", error: `A mystery box holds up to ${MYSTERY_BOX_MAX_ITEMS} items.` };
  }
  const seen = new Set<string>();
  const items: PoolInput["items"] = [];
  for (const raw of b.items as unknown[]) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const variantId = typeof r.variantId === "string" ? r.variantId : "";
    const weight = r.weight === undefined ? 1 : r.weight;
    if (!UUID_RE.test(variantId)) return { ok: false, code: "INVALID_ITEMS", error: "Each item needs a variantId." };
    if (typeof weight !== "number" || !Number.isInteger(weight) || weight < 1 || weight > 1000) {
      return { ok: false, code: "INVALID_WEIGHT", error: "Weight must be a whole number from 1 to 1000." };
    }
    if (seen.has(variantId)) continue;
    seen.add(variantId);
    items.push({ variantId, weight });
  }
  return { ok: true, value: { reveal: reveal as MysteryReveal, showOdds: b.showOdds === true, items } };
}

function rowsOf(result: unknown): any[] {
  return (result as any)?.rows ?? [];
}

export interface ResolveResult {
  picked: Array<{ orderItemId: string; unitIndex: number; variantId: string }>;
  unfilled: Array<{ orderItemId: string; unitIndex: number }>;
}

/**
 * Resolves every unpicked box unit of one order. Must run inside the
 * transaction that created the order so the candidate decrement and the pick
 * commit together. Idempotent: units that already have a pick are skipped,
 * and (order_item_id, unit_index) is unique.
 */
export async function resolveMysteryBoxPicks(
  tx: SqlExecutor,
  orderId: string,
  rng: RandomInt = cryptoRandomInt,
): Promise<ResolveResult> {
  const result: ResolveResult = { picked: [], unfilled: [] };
  const lines = rowsOf(await tx.execute(sql`
    SELECT oi.id AS order_item_id, oi.quantity, pv.product_id
      FROM order_items oi
      JOIN product_variants pv ON pv.id = oi.variant_id
      JOIN mystery_box_pools mbp ON mbp.product_id = pv.product_id
     WHERE oi.order_id = ${orderId}::uuid
     ORDER BY oi.id
  `));
  for (const line of lines) {
    const done = new Set<number>(rowsOf(await tx.execute(
      sql`SELECT unit_index FROM mystery_box_picks WHERE order_item_id = ${line.order_item_id}::uuid`,
    )).map((r) => Number(r.unit_index)));
    for (let unitIndex = 0; unitIndex < Number(line.quantity); unitIndex++) {
      if (done.has(unitIndex)) continue;
      // Lock candidate rows in id order (same discipline as stockReservation)
      // so concurrent boxes from one pool serialize instead of overselling.
      const candidates: WeightedCandidate[] = rowsOf(await tx.execute(sql`
        SELECT pv.id AS variant_id, pv.stock, mi.weight
          FROM mystery_box_pool_items mi
          JOIN product_variants pv ON pv.id = mi.variant_id
         WHERE mi.product_id = ${line.product_id}::uuid
         ORDER BY pv.id
           FOR UPDATE OF pv
      `)).map((r) => ({ variantId: String(r.variant_id), stock: Number(r.stock), weight: Number(r.weight) }));
      const variantId = pickWeighted(candidates, rng);
      if (variantId) {
        await tx.execute(sql`UPDATE product_variants SET stock = stock - 1 WHERE id = ${variantId}::uuid AND stock > 0`);
      }
      const inserted = rowsOf(await tx.execute(sql`
        INSERT INTO mystery_box_picks (order_item_id, unit_index, variant_id)
        VALUES (${line.order_item_id}::uuid, ${unitIndex}, ${variantId}::uuid)
        ON CONFLICT (order_item_id, unit_index) DO NOTHING
        RETURNING id
      `));
      if (inserted.length === 0) {
        // Another writer already recorded this unit; give the unit back.
        if (variantId) await tx.execute(sql`UPDATE product_variants SET stock = stock + 1 WHERE id = ${variantId}::uuid`);
        continue;
      }
      if (variantId) result.picked.push({ orderItemId: line.order_item_id, unitIndex, variantId });
      else result.unfilled.push({ orderItemId: line.order_item_id, unitIndex });
    }
  }
  return result;
}

/**
 * The paid-order hook: resolves the order's box units in a SAVEPOINT inside
 * the caller's order transaction, then flags the seller for any unit that
 * had nothing in stock. Never throws — a failure here leaves the order,
 * payment and stock exactly as they were (no pick recorded, nothing
 * decremented for the boxes).
 */
export async function applyMysteryBoxPicks(
  tx: { transaction: <T>(fn: (sp: any) => Promise<T>) => Promise<T> },
  orderId: string,
  sellerId: string,
  rng: RandomInt = cryptoRandomInt,
): Promise<ResolveResult | null> {
  try {
    return await tx.transaction(async (sp) => {
      const res = await resolveMysteryBoxPicks(sp, orderId, rng);
      if (res.unfilled.length > 0) {
        const n = res.unfilled.length;
        await sp.execute(sql`
          INSERT INTO notifications_feed (id, user_id, type, title, body, target_id, target_type, is_read, created_at)
          VALUES (gen_random_uuid(), ${sellerId}, 'mystery_box_unfilled', 'Mystery box needs an item',
                  ${`${n} mystery box ${n === 1 ? "unit has" : "units have"} no item in stock. Choose one to ship.`},
                  ${orderId}, 'order', false, now())
          ON CONFLICT DO NOTHING
        `);
      }
      return res;
    });
  } catch (err) {
    logger.error({ err, orderId }, "Mystery box pick failed; order unaffected");
    return null;
  }
}

/** True when the box product has at least one pool item with stock. */
export async function mysteryBoxHasStock(tx: SqlExecutor, productId: string): Promise<boolean> {
  const rows = rowsOf(await tx.execute(sql`
    SELECT 1 FROM mystery_box_pool_items mi
      JOIN product_variants pv ON pv.id = mi.variant_id
     WHERE mi.product_id = ${productId}::uuid AND pv.stock > 0
     LIMIT 1
  `));
  return rows.length > 0;
}

/**
 * Of the given variant ids, those that belong to a mystery box whose pool
 * has nothing in stock. Variants that are not boxes are never returned.
 */
export async function emptyMysteryBoxVariants(tx: SqlExecutor, variantIds: string[]): Promise<string[]> {
  const ids = [...new Set(variantIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const rows = rowsOf(await tx.execute(sql`
    SELECT pv.id AS variant_id
      FROM product_variants pv
      JOIN mystery_box_pools mbp ON mbp.product_id = pv.product_id
     WHERE pv.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
       AND NOT EXISTS (
         SELECT 1 FROM mystery_box_pool_items mi
           JOIN product_variants c ON c.id = mi.variant_id
          WHERE mi.product_id = mbp.product_id AND c.stock > 0
       )
  `));
  return rows.map((r) => String(r.variant_id));
}
