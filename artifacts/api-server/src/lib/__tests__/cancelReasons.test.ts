import { describe, expect, it } from "vitest";
import { CANCEL_COMMENT_MAX, CANCEL_REASON_FEEDBACK, cancellationDetailsFor, isCancelReasonId } from "../cancelReasons";

const STRIPE_FEEDBACK = ["customer_service", "low_quality", "missing_features", "other", "switched_service", "too_complex", "too_expensive", "unused"];

describe("cancel reasons", () => {
  it("maps every reason to a value Stripe accepts", () => {
    for (const feedback of Object.values(CANCEL_REASON_FEEDBACK)) expect(STRIPE_FEEDBACK).toContain(feedback);
  });

  it("only accepts known reason ids", () => {
    expect(isCancelReasonId("too_expensive")).toBe(true);
    for (const value of [undefined, null, "", "toString", "__proto__", 3]) expect(isCancelReasonId(value)).toBe(false);
  });

  it("builds cancellation details with a trimmed, capped comment", () => {
    expect(cancellationDetailsFor("switching_platform", "")).toEqual({ feedback: "switched_service" });
    expect(cancellationDetailsFor("other", "  moving on ")).toEqual({ feedback: "other", comment: "moving on" });
    expect(cancellationDetailsFor("other", "x".repeat(1500))?.comment).toHaveLength(CANCEL_COMMENT_MAX);
    expect(cancellationDetailsFor("nope", "hi")).toBeNull();
  });
});
