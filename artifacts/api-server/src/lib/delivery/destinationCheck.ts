/**
 * BT-070: a carrier "delivered" scan only counts for an order when the parcel
 * went to that order's address.
 *
 * A seller can type any real tracking number (say, one of their own delivered
 * parcels). Before the hourly poll / Shippo webhook may set delivered_at (which
 * starts the payout clock), the track's destination is compared with the
 * order's shipping address:
 *   - labels bought through Brandthread are trusted (we created the shipment
 *     to the order's address ourselves);
 *   - seller-typed tracking must match on ZIP (first 5 for US ZIPs), or on
 *     city + state when the carrier gives no ZIP;
 *   - a mismatch, or a track with no destination data, is not accepted: the
 *     order is flagged and stays undelivered until the buyer confirms receipt
 *     (POST /api/buyer/orders/:id/confirm-receipt).
 */

export type DestinationAddress = {
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
} | null | undefined;

export type DestinationVerdict =
  | { accept: true; reason: "brandthread_label" | "zip_match" | "city_state_match" }
  | { accept: false; reason: "zip_mismatch" | "city_state_mismatch" | "no_destination_data" };

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", districtofcolumbia: "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", newhampshire: "NH", newjersey: "NJ", newmexico: "NM", newyork: "NY",
  northcarolina: "NC", northdakota: "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  rhodeisland: "RI", southcarolina: "SC", southdakota: "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", westvirginia: "WV", wisconsin: "WI", wyoming: "WY",
  puertorico: "PR",
};

function clean(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "11201-1234" -> "11201"; non-US postcodes are compared whole, case/space-insensitive. */
export function normalizeZip(zip: string | null | undefined): string {
  const raw = (zip ?? "").trim();
  const us = raw.match(/^(\d{5})(?:[-\s]?\d{4})?$/);
  if (us) return us[1];
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeState(state: string | null | undefined): string {
  const key = clean(state);
  if (!key) return "";
  if (key.length === 2) return key.toUpperCase();
  return US_STATES[key] ?? key.toUpperCase();
}

export function verifyTrackDestination(input: {
  /** The tracking number belongs to an active label bought through Brandthread for this order. */
  brandthreadLabel: boolean;
  orderAddress: DestinationAddress;
  trackAddressTo: DestinationAddress;
}): DestinationVerdict {
  if (input.brandthreadLabel) return { accept: true, reason: "brandthread_label" };
  const order = input.orderAddress;
  const track = input.trackAddressTo;
  if (!order || !track) return { accept: false, reason: "no_destination_data" };

  const orderZip = normalizeZip(order.zip);
  const trackZip = normalizeZip(track.zip);
  if (orderZip && trackZip) {
    return orderZip === trackZip ? { accept: true, reason: "zip_match" } : { accept: false, reason: "zip_mismatch" };
  }

  const orderCity = clean(order.city);
  const trackCity = clean(track.city);
  const orderState = normalizeState(order.state);
  const trackState = normalizeState(track.state);
  if (orderCity && trackCity && orderState && trackState) {
    return orderCity === trackCity && orderState === trackState
      ? { accept: true, reason: "city_state_match" }
      : { accept: false, reason: "city_state_mismatch" };
  }
  return { accept: false, reason: "no_destination_data" };
}

export type UnverifiedDeliveryFlag = { code: string; label: string; severity: "info" | "medium" | "high" };

/** The seller-visible risk flag recorded when a delivered scan is not accepted. */
export function unverifiedDeliveryFlag(verdict: DestinationVerdict): UnverifiedDeliveryFlag | null {
  if (verdict.accept) return null;
  if (verdict.reason === "no_destination_data") {
    return {
      code: "tracking_destination_unverified",
      label: "Carrier shows delivered but no destination to check; waiting for the buyer to confirm receipt",
      severity: "medium",
    };
  }
  return {
    code: "tracking_destination_mismatch",
    label: "Tracking was delivered to a different address than this order; waiting for the buyer to confirm receipt",
    severity: "high",
  };
}

/** Adds the flag once; returns null when it is already there (nothing to write). */
export function withUnverifiedDeliveryFlag(
  existing: unknown,
  flag: UnverifiedDeliveryFlag,
): UnverifiedDeliveryFlag[] | null {
  const flags = Array.isArray(existing)
    ? (existing as unknown[]).filter((f): f is UnverifiedDeliveryFlag => !!f && typeof (f as UnverifiedDeliveryFlag).code === "string")
    : [];
  if (flags.some((f) => f.code === flag.code)) return null;
  return [...flags, flag];
}
