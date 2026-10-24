/**
 * Pure rules for a seller's public reply on a review (POST / PATCH / DELETE
 * /api/reviews/:reviewId/reply). No I/O here so every rule is unit-testable.
 */
import { REVIEW_REPLY_MAX } from "./reviewContent";

/** Trimmed reply text, or the 400 message to send back. */
export function checkReviewReplyText(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "replyText is required" };
  const text = raw.trim();
  if (text.length > REVIEW_REPLY_MAX) return { ok: false, error: `Replies can be up to ${REVIEW_REPLY_MAX} characters.` };
  return { ok: true, text };
}

/**
 * Who may change the reply on a review: only the seller it was left for.
 * `needsReply` (edit/delete) also requires a reply to exist. Returns the
 * error status + body, or null when allowed.
 */
export function reviewReplyAccess(
  review: { sellerId: string | null; sellerReply?: string | null } | undefined,
  sellerId: string,
  needsReply: boolean,
): { status: 403 | 404; error: string } | null {
  if (!review) return { status: 404, error: "Review not found" };
  if (!review.sellerId || review.sellerId !== sellerId) return { status: 403, error: "Forbidden" };
  if (needsReply && !review.sellerReply) return { status: 404, error: "Reply not found" };
  return null;
}
