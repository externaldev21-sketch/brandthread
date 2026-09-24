/**
 * Shared sample / bulk order lifecycle.
 *
 * One state machine is used by the API (authoritative checks), the
 * manufacturer web portal and the seller mobile app (which button to show and
 * how to label it), so the three surfaces can never disagree about what an
 * order card means.
 *
 *   pending_payment ──(payment confirmed)──▶ payment_received ─▶ processing
 *        │                                   ─▶ cut_and_sew ─▶ packing
 *        │                                   ─▶ shipped (carrier + tracking) ─▶ delivered
 *        └──(manufacturer withdraws / seller declines)──▶ cancelled
 */

export const ORDER_TYPES = ["sample", "bulk"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

/** The six tracker stages the seller watches, in order. */
export const PRODUCTION_STAGES = [
  "payment_received",
  "processing",
  "cut_and_sew",
  "packing",
  "shipped",
  "delivered",
] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

/** Seller decisions recorded after a sample is delivered (legacy sample review). */
export const SAMPLE_DECISION_STATUSES = ["review_needed", "approved", "rejected", "revision_requested"] as const;

export type OrderStatus =
  | "pending_payment"
  | ProductionStage
  | "cancelled"
  | (typeof SAMPLE_DECISION_STATUSES)[number]
  | "complete"
  | "completed";

export type OrderActor = "seller" | "manufacturer" | "payment_system";

const STAGE_LABELS: Record<string, string> = {
  pending_payment: "Awaiting payment",
  payment_received: "Payment received",
  processing: "Processing",
  cut_and_sew: "Cut & sew",
  packing: "Packing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  review_needed: "Review needed",
  approved: "Approved",
  rejected: "Rejected",
  revision_requested: "Revision requested",
  complete: "Complete",
  completed: "Complete",
};

const STAGE_DESCRIPTIONS: Record<ProductionStage, string> = {
  payment_received: "Payment is secured. The manufacturer can start work.",
  processing: "Materials are being sourced and the job is being scheduled.",
  cut_and_sew: "Fabric is being cut and garments are being sewn.",
  packing: "Quality check and packing for shipment.",
  shipped: "Handed to the carrier. Tracking is live.",
  delivered: "The order arrived.",
};

export function orderStatusLabel(status: string): string {
  return STAGE_LABELS[status] ?? status.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function stageDescription(stage: ProductionStage): string {
  return STAGE_DESCRIPTIONS[stage];
}

export function orderTypeLabel(orderType: string): string {
  return orderType === "bulk" ? "Bulk order" : "Sample";
}

export function isProductionStage(status: string): status is ProductionStage {
  return (PRODUCTION_STAGES as readonly string[]).includes(status);
}

export function stageIndex(status: string): number {
  return (PRODUCTION_STAGES as readonly string[]).indexOf(status);
}

/** Orders that no longer need work from either side. */
export function isTerminalStatus(status: string): boolean {
  return ["delivered", "cancelled", "approved", "rejected", "complete", "completed"].includes(status);
}

export function nextProductionStage(status: string): ProductionStage | null {
  const index = stageIndex(status);
  if (index < 0 || index >= PRODUCTION_STAGES.length - 1) return null;
  return PRODUCTION_STAGES[index + 1];
}

export type TransitionInput = {
  from: string;
  to: string;
  actor: OrderActor;
  carrier?: string | null;
  trackingNumber?: string | null;
};

export type TransitionResult =
  | { ok: true }
  | { ok: false; code: TransitionErrorCode; message: string };

export type TransitionErrorCode =
  | "UNKNOWN_STATUS"
  | "NOT_ALLOWED_FOR_ACTOR"
  | "PAYMENT_REQUIRED"
  | "SKIPS_A_STAGE"
  | "TRACKING_REQUIRED"
  | "ALREADY_FINAL";

const fail = (code: TransitionErrorCode, message: string): TransitionResult => ({ ok: false, code, message });

/**
 * Authoritative transition rules. The API calls this before every write; the
 * clients call it to decide which action to render.
 */
export function validateTransition(input: TransitionInput): TransitionResult {
  const { from, to, actor } = input;
  if (from === to) return fail("SKIPS_A_STAGE", `The order is already ${orderStatusLabel(to).toLowerCase()}.`);
  if (isTerminalStatus(from)) {
    return fail("ALREADY_FINAL", `This order is ${orderStatusLabel(from).toLowerCase()} and can't change.`);
  }

  if (to === "cancelled") {
    if (from !== "pending_payment") {
      return fail("NOT_ALLOWED_FOR_ACTOR", "Paid orders can't be cancelled here. Message the other side to arrange a refund.");
    }
    if (actor === "payment_system") return fail("NOT_ALLOWED_FOR_ACTOR", "Only a participant can cancel an order.");
    return { ok: true };
  }

  if (from === "pending_payment") {
    if (to !== "payment_received") {
      return fail("PAYMENT_REQUIRED", "Production can start only after the seller pays.");
    }
    if (actor !== "payment_system") {
      return fail("PAYMENT_REQUIRED", "Payment is confirmed by Stripe, not marked by hand.");
    }
    return { ok: true };
  }

  const fromIndex = stageIndex(from);
  const toIndex = stageIndex(to);
  if (fromIndex < 0 || toIndex < 0) return fail("UNKNOWN_STATUS", `Unknown order stage "${to}".`);
  if (toIndex !== fromIndex + 1) {
    return fail("SKIPS_A_STAGE", `Update stages in order. The next stage is ${orderStatusLabel(PRODUCTION_STAGES[fromIndex + 1] ?? from).toLowerCase()}.`);
  }

  if (to === "delivered") {
    // Either side can close out a shipment: the manufacturer from carrier
    // proof of delivery, the seller by confirming receipt.
    if (actor === "payment_system") return fail("NOT_ALLOWED_FOR_ACTOR", "Delivery is confirmed by a participant.");
    return { ok: true };
  }

  if (actor !== "manufacturer") {
    return fail("NOT_ALLOWED_FOR_ACTOR", "Only the manufacturer updates production stages.");
  }

  if (to === "shipped" && (!input.carrier?.trim() || !input.trackingNumber?.trim())) {
    return fail("TRACKING_REQUIRED", "Add the carrier and tracking number before marking the order shipped.");
  }
  return { ok: true };
}

// ── Order cards (sent in chat) ────────────────────────────────────────────────

export const CARD_LIMITS = {
  titleMax: 120,
  descriptionMax: 2000,
  minPriceCents: 100, // US$1.00 — Stripe's practical minimum for a card charge
  maxPriceCents: 50_000_000, // US$500,000
  maxQuantity: 1_000_000,
} as const;

export type CardInput = {
  orderType: string;
  title: string;
  description?: string | null;
  quantity: number;
  priceCents: number;
};

export type CardFieldErrors = Partial<Record<"orderType" | "title" | "description" | "quantity" | "priceCents", string>>;

export function validateCardInput(input: CardInput): { ok: true } | { ok: false; errors: CardFieldErrors } {
  const errors: CardFieldErrors = {};
  if (!(ORDER_TYPES as readonly string[]).includes(input.orderType)) errors.orderType = "Choose sample or bulk order.";
  const title = input.title?.trim() ?? "";
  if (!title) errors.title = "Add a short name for this order.";
  else if (title.length > CARD_LIMITS.titleMax) errors.title = `Keep the name under ${CARD_LIMITS.titleMax} characters.`;
  if ((input.description?.length ?? 0) > CARD_LIMITS.descriptionMax) {
    errors.description = `Keep details under ${CARD_LIMITS.descriptionMax} characters.`;
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) errors.quantity = "Quantity must be at least 1.";
  else if (input.quantity > CARD_LIMITS.maxQuantity) errors.quantity = "Quantity is too large.";
  else if (input.orderType === "sample" && input.quantity > 50) errors.quantity = "Samples are limited to 50 pieces. Send a bulk order card instead.";
  if (!Number.isInteger(input.priceCents) || input.priceCents < CARD_LIMITS.minPriceCents) {
    errors.priceCents = "Price must be at least US$1.00.";
  } else if (input.priceCents > CARD_LIMITS.maxPriceCents) {
    errors.priceCents = "Price is above the US$500,000 limit for one card.";
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true };
}

/** Parses a user-typed amount like "1,250.50" or "85" into integer cents. */
export function parseAmountToCents(value: string): number | null {
  const cleaned = value.replace(/[\s,]/g, "").replace(/^(US)?\$/i, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export type CardViewer = "seller" | "manufacturer";

export type CardPhase = "awaiting_payment" | "in_production" | "shipped" | "delivered" | "cancelled" | "closed";

export type CardAction =
  | { kind: "pay"; label: string }
  | { kind: "decline"; label: string }
  | { kind: "withdraw"; label: string }
  | { kind: "advance"; label: string; to: ProductionStage; needsTracking: boolean }
  | { kind: "confirm_delivery"; label: string }
  | { kind: "track"; label: string };

export type CardState = {
  phase: CardPhase;
  headline: string;
  detail: string;
  /** Six-step progress, 0 when unpaid, 6 when delivered. */
  completedStages: number;
  actions: CardAction[];
};

export type CardOrderSnapshot = {
  status: string;
  orderType: string;
  manufacturerPayoutReady?: boolean | null;
  trackingNumber?: string | null;
  paymentReviewState?: string | null;
};

/** Everything a chat card needs to render, per viewer. */
export function deriveCardState(order: CardOrderSnapshot, viewer: CardViewer): CardState {
  const kind = orderTypeLabel(order.orderType).toLowerCase();
  const actions: CardAction[] = [];

  if (order.status === "pending_payment") {
    if (viewer === "seller") {
      if (order.manufacturerPayoutReady === false) {
        return {
          phase: "awaiting_payment",
          headline: "Not payable yet",
          detail: "The manufacturer is finishing payout setup. You'll be able to pay as soon as they're verified.",
          completedStages: 0,
          actions: [{ kind: "decline", label: "Decline" }],
        };
      }
      actions.push({ kind: "pay", label: "Pay now" }, { kind: "decline", label: "Decline" });
      return { phase: "awaiting_payment", headline: "Awaiting your payment", detail: `Pay to start the ${kind}. Your payment is held by Stripe and paid out to the manufacturer.`, completedStages: 0, actions };
    }
    actions.push({ kind: "withdraw", label: "Withdraw card" });
    return {
      phase: "awaiting_payment",
      headline: "Waiting for the seller to pay",
      detail: order.manufacturerPayoutReady === false
        ? "Finish payout setup so the seller can pay this card."
        : "You'll be notified the moment payment arrives.",
      completedStages: 0,
      actions,
    };
  }

  if (order.status === "cancelled") {
    return { phase: "cancelled", headline: "Cancelled", detail: "This card was withdrawn or declined before payment.", completedStages: 0, actions: [] };
  }

  const index = stageIndex(order.status);
  if (index >= 0) {
    const completedStages = index + 1;
    if (order.status === "delivered") {
      return { phase: "delivered", headline: "Delivered", detail: `The ${kind} arrived.`, completedStages, actions: order.trackingNumber ? [{ kind: "track", label: "View tracking" }] : [] };
    }
    if (order.status === "shipped") {
      if (order.trackingNumber) actions.push({ kind: "track", label: "Track shipment" });
      if (viewer === "seller") actions.push({ kind: "confirm_delivery", label: "I received it" });
      else actions.push({ kind: "advance", label: "Mark delivered", to: "delivered", needsTracking: false });
      return { phase: "shipped", headline: "On the way", detail: "Tracking is live. Mark it delivered when it arrives.", completedStages, actions };
    }
    const next = nextProductionStage(order.status);
    if (viewer === "manufacturer" && next) {
      actions.push({ kind: "advance", label: `Mark ${orderStatusLabel(next).toLowerCase()}`, to: next, needsTracking: next === "shipped" });
    }
    return {
      phase: "in_production",
      headline: orderStatusLabel(order.status),
      detail: order.paymentReviewState && order.paymentReviewState !== "none"
        ? "Payment is under review by Stripe. Hold production until it clears."
        : stageDescription(order.status as ProductionStage),
      completedStages,
      actions,
    };
  }

  return { phase: "closed", headline: orderStatusLabel(order.status), detail: "This order is closed.", completedStages: PRODUCTION_STAGES.length, actions: [] };
}

// ── Tracker timeline ─────────────────────────────────────────────────────────

export type StageEvent = { toStatus: string; createdAt: string | Date };

export type TimelineStep = {
  stage: ProductionStage;
  label: string;
  description: string;
  state: "done" | "current" | "upcoming";
  at: string | null;
};

/**
 * Builds the six-step tracker with the time each stage was reached. The most
 * recent event for a stage wins; stages reached without a recorded event
 * (older orders) are shown as done without a time rather than invented.
 */
export function buildTimeline(
  order: { status: string; shippedAt?: string | Date | null; deliveredAt?: string | Date | null; paidAt?: string | Date | null },
  events: StageEvent[],
): TimelineStep[] {
  const reached = stageIndex(order.status);
  const at = new Map<string, string>();
  for (const event of events) {
    const iso = new Date(event.createdAt).toISOString();
    const previous = at.get(event.toStatus);
    if (!previous || previous < iso) at.set(event.toStatus, iso);
  }
  const toIso = (value: string | Date | null | undefined) => (value ? new Date(value).toISOString() : null);
  if (!at.has("payment_received") && order.paidAt) at.set("payment_received", toIso(order.paidAt)!);
  if (!at.has("shipped") && order.shippedAt) at.set("shipped", toIso(order.shippedAt)!);
  if (!at.has("delivered") && order.deliveredAt) at.set("delivered", toIso(order.deliveredAt)!);

  // Seller sample decisions happen after delivery, so every stage is done.
  const effective = (SAMPLE_DECISION_STATUSES as readonly string[]).includes(order.status)
    || order.status === "complete" || order.status === "completed"
    ? PRODUCTION_STAGES.length - 1
    : reached;

  return PRODUCTION_STAGES.map((stage, index) => ({
    stage,
    label: orderStatusLabel(stage),
    description: stageDescription(stage),
    state: effective < 0 ? "upcoming" : index < effective || (index === effective && stage === "delivered") ? "done" : index === effective ? "current" : "upcoming",
    at: effective >= index ? at.get(stage) ?? null : null,
  }));
}
