/**
 * Push consent policy (App Store Review Guideline 4.5.4).
 *
 * Transactional pushes (orders, messages, security, account/billing, live you
 * are in, activity on your own content) follow the existing category toggles.
 * Promotional/marketing pushes (seller-to-follower drop broadcasts, new-product
 * blasts, price-drop / back-in-stock nudges, cart recovery, digests, offers)
 * additionally require users.promo_push_opt_in = true, which defaults to false
 * and is changed only by an explicit toggle in Settings -> Notifications.
 *
 * `sendPushToUser` (lib/push.ts) is the single chokepoint that applies this.
 */

/** Notification `type` values that are promotional. Add new marketing types here. */
export const PROMOTIONAL_PUSH_TYPES: ReadonlySet<string> = new Set([
  "drop_live", // seller -> follower drop broadcast
  "new_product", // "a brand you follow just listed ..."
  "price_drop", // price-drop nudge on saved items
  "back_in_stock", // restock nudge on saved items
  "abandoned_cart", // cart recovery
  "promotion",
  "marketing",
  "digest",
  "offer",
]);

export interface PromoClassifiable {
  /** Explicit classification by the caller; wins over inference. */
  kind?: "transactional" | "promotional";
  data?: Record<string, unknown>;
}

export function isPromotionalPush(payload: PromoClassifiable): boolean {
  if (payload.kind === "promotional") return true;
  if (payload.kind === "transactional") return false;
  const type = payload.data?.type;
  return typeof type === "string" && PROMOTIONAL_PUSH_TYPES.has(type);
}

/**
 * True when the push may be sent with respect to promotional consent.
 * Transactional pushes are never blocked here. Promotional pushes need an
 * explicit opt-in: a missing recipient row or null flag means NOT opted in.
 * `explicitRequest` is for a push the user asked for by name for that exact
 * item (e.g. a per-drop "notify me" subscription).
 */
export function promoConsentAllows(
  payload: PromoClassifiable,
  recipient: { promoPushOptIn?: boolean | null } | undefined,
  explicitRequest = false,
): boolean {
  if (!isPromotionalPush(payload)) return true;
  if (explicitRequest) return true;
  return recipient?.promoPushOptIn === true;
}
