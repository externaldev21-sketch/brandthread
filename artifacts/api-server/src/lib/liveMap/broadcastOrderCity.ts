/**
 * Tells a seller's open dashboards that a paid order just landed in a city,
 * so the Live map can ping that dot once. Called from handleCheckoutPaid
 * after the order commits.
 *
 * Never throws: a broadcast problem must not affect the Stripe webhook.
 * The payload is city level only (no totals, names, street or zip).
 */
import { broadcastToSeller } from "../../ws/sellerHub";
import { logger } from "../logger";
import { resolveCity } from "./gazetteer";

export function broadcastOrderCity(
  sellerId: string,
  address: { city?: string | null; state?: string | null; country?: string | null } | null | undefined,
  at: Date = new Date(),
): void {
  try {
    if (!sellerId || !address) return;
    const place = resolveCity({ city: address.city, region: address.state, country: address.country });
    if (!place) return;
    broadcastToSeller(sellerId, {
      type: "order_city",
      key: place.key,
      city: place.city,
      region: place.region,
      country: place.country,
      lat: place.lat,
      lng: place.lng,
      at: at.toISOString(),
    });
  } catch (err) {
    logger.warn({ err }, "Live map order_city broadcast failed");
  }
}
