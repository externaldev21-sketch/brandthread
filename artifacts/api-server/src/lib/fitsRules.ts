/**
 * Pure rules for Fits (stitches, buyer fit checks, brand repost requests).
 * No DB access here so they are unit-tested directly (fitsRules.test.ts).
 */

/** TikTok Stitch uses at most 5 seconds of the original. */
export const STITCH_MAX_CLIP_MS = 5_000;
/** Longest original we accept a clip offset into (10 minutes). */
export const STITCH_MAX_OFFSET_MS = 10 * 60_000;
/** A stitch link must be attached right after its post is published. */
export const STITCH_LINK_WINDOW_MS = 15 * 60_000;

export type ClipCheck = { ok: true; startMs: number; endMs: number } | { ok: false; error: string };

/** Photo originals have no timeline: omit both values (0..0). */
export function validateStitchClip(start: unknown, end: unknown): ClipCheck {
  if (start === undefined && end === undefined) return { ok: true, startMs: 0, endMs: 0 };
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return { ok: false, error: "clipStartMs and clipEndMs must be whole milliseconds" };
  }
  const s = start as number;
  const e = end as number;
  if (s < 0 || e <= s) return { ok: false, error: "clipEndMs must be after clipStartMs" };
  if (e - s > STITCH_MAX_CLIP_MS) return { ok: false, error: "A stitch can use up to 5 seconds of the original" };
  if (e > STITCH_MAX_OFFSET_MS) return { ok: false, error: "clip is outside the original" };
  return { ok: true, startMs: s, endMs: e };
}

/** Order statuses that never count as owning the item. */
const NON_PURCHASE_STATUSES = new Set(["pending", "cancelled", "refunded"]);

/**
 * A buyer "actually bought" a product when an order line for it is paid,
 * the order is not pending/cancelled/refunded, and that line wasn't refunded.
 */
export function isQualifyingPurchase(line: {
  orderStatus: string | null;
  paidAt: Date | string | null;
  itemRefundedAt: Date | string | null;
}): boolean {
  if (!line.paidAt) return false;
  if (line.itemRefundedAt) return false;
  return !NON_PURCHASE_STATUSES.has(String(line.orderStatus ?? "").toLowerCase());
}

export type RepostRequestStatus = "pending" | "approved" | "declined" | "cancelled";
export type RepostRequestAction = "approve" | "decline" | "cancel";

/**
 * State machine: only a pending request moves. The post's owner approves or
 * declines; the requesting brand can cancel. Everything else is refused.
 */
export function nextRepostRequestStatus(
  current: RepostRequestStatus,
  action: RepostRequestAction,
  actor: "owner" | "requester",
): { ok: true; status: RepostRequestStatus } | { ok: false; code: "NOT_PENDING" | "FORBIDDEN" } {
  if (current !== "pending") return { ok: false, code: "NOT_PENDING" };
  if (action === "cancel") return actor === "requester" ? { ok: true, status: "cancelled" } : { ok: false, code: "FORBIDDEN" };
  if (actor !== "owner") return { ok: false, code: "FORBIDDEN" };
  return { ok: true, status: action === "approve" ? "approved" : "declined" };
}

/** Brands need the buyer's permission to repost any buyer post. */
export function brandRepostNeedsPermission(reposterAccountType: string | null, ownerAccountType: string | null, sameUser: boolean): boolean {
  return !sameUser && reposterAccountType === "seller" && ownerAccountType === "buyer";
}
