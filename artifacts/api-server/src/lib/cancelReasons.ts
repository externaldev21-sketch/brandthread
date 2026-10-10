/**
 * Why a seller cancelled their plan in-app. The app shows these as the
 * "main reason" list; each maps to Stripe's own cancellation feedback enum so
 * the answer lands in `cancellation_details` on the subscription.
 */
export const CANCEL_REASON_FEEDBACK = {
  just_testing: "unused",
  not_enough_sales: "other",
  closing_business: "unused",
  switching_platform: "switched_service",
  too_expensive: "too_expensive",
  missing_features: "missing_features",
  hard_to_set_up: "too_complex",
  other: "other",
} as const;

export type CancelReasonId = keyof typeof CANCEL_REASON_FEEDBACK;

export const CANCEL_COMMENT_MAX = 1000;

export function isCancelReasonId(value: unknown): value is CancelReasonId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CANCEL_REASON_FEEDBACK, value);
}

/** Stripe `cancellation_details` for a reason + optional comment, or null when no valid reason was given. */
export function cancellationDetailsFor(reason: unknown, comment: unknown): { feedback: string; comment?: string } | null {
  if (!isCancelReasonId(reason)) return null;
  const text = typeof comment === "string" ? comment.trim().slice(0, CANCEL_COMMENT_MAX) : "";
  return text ? { feedback: CANCEL_REASON_FEEDBACK[reason], comment: text } : { feedback: CANCEL_REASON_FEEDBACK[reason] };
}
