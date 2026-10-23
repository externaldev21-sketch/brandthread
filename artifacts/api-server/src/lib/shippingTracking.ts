/**
 * Seller-entered shipment details: the carrier list the seller picks from,
 * tracking-number format checks, and when a seller may mark an order
 * delivered themselves.
 *
 * The mobile "Mark as shipped" form mirrors CARRIER_OPTIONS and
 * validateTrackingNumber in artifacts/mobile/lib/trackingNumber.ts. If you
 * change one, change both.
 */
import { shippoCarrierToken } from "./shippo";

export type CarrierKey = "usps" | "ups" | "fedex" | "dhl" | "other";

export const CARRIER_OPTIONS: ReadonlyArray<{ key: CarrierKey; label: string }> = [
  { key: "usps", label: "USPS" },
  { key: "ups", label: "UPS" },
  { key: "fedex", label: "FedEx" },
  { key: "dhl", label: "DHL Express" },
  { key: "other", label: "Other" },
];

// Formats are checked after removing spaces and dashes and upper-casing.
const TRACKING_FORMATS: Record<CarrierKey, RegExp> = {
  // IMpb barcodes (20–34 digits, optionally with a 420+ZIP prefix) and
  // international S10 numbers like EA123456789US.
  usps: /^(\d{20,34}|[A-Z]{2}\d{9}US)$/,
  ups: /^1Z[0-9A-Z]{16}$/,
  fedex: /^(\d{12}|\d{15}|\d{20}|\d{22})$/,
  dhl: /^(\d{10,11}|JJD\d{9,20})$/,
  other: /^[0-9A-Z]{6,40}$/,
};

const FORMAT_HINT: Record<CarrierKey, string> = {
  usps: "USPS tracking numbers are 20 to 34 digits, or 2 letters, 9 digits and US.",
  ups: "UPS tracking numbers start with 1Z and are 18 characters long.",
  fedex: "FedEx tracking numbers are 12, 15, 20 or 22 digits.",
  dhl: "DHL Express tracking numbers are 10 or 11 digits.",
  other: "Tracking numbers are 6 to 40 letters and numbers.",
};

export function carrierKeyOf(carrier: string): CarrierKey {
  const key = carrier.toLowerCase().replace(/[^a-z]/g, "");
  if (key === "usps") return "usps";
  if (key === "ups") return "ups";
  if (key === "fedex") return "fedex";
  if (key === "dhl" || key === "dhlexpress") return "dhl";
  return "other";
}

export function normalizeTrackingNumber(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

export type TrackingValidation =
  | { ok: true; carrier: string; trackingNumber: string }
  | { ok: false; field: "carrier" | "trackingNumber"; error: string };

/**
 * `carrier` is a CARRIER_OPTIONS label, or the carrier's own name when the
 * seller picked "Other". Returns the carrier label and the normalized number
 * to store.
 */
export function validateTrackingNumber(rawCarrier: unknown, rawNumber: unknown): TrackingValidation {
  const carrier = typeof rawCarrier === "string" ? rawCarrier.trim() : "";
  if (!carrier || carrier.length > 60 || carrier.toLowerCase() === "other") {
    return { ok: false, field: "carrier", error: "Choose a carrier, or enter the carrier's name." };
  }
  const trackingNumber = typeof rawNumber === "string" ? normalizeTrackingNumber(rawNumber) : "";
  if (!trackingNumber) {
    return { ok: false, field: "trackingNumber", error: "Enter a tracking number." };
  }
  const key = carrierKeyOf(carrier);
  if (!TRACKING_FORMATS[key].test(trackingNumber)) {
    return { ok: false, field: "trackingNumber", error: `This doesn't look like a valid tracking number. ${FORMAT_HINT[key]}` };
  }
  const label = CARRIER_OPTIONS.find((option) => option.key === key && key !== "other")?.label ?? carrier;
  return { ok: true, carrier: label, trackingNumber };
}

type DeliveryCandidate = {
  status: string;
  deliveredAt: Date | null;
  autoRefundedAt: Date | null;
  carrier: string | null;
  trackingNumber: string | null;
};

type ItemShipment = { carrier: string | null; trackingNumber: string | null; deliveredAt: Date | null; refundedAt: Date | null };

export type SellerDeliveryCheck =
  | { ok: true }
  | { ok: false; code: "NOT_SHIPPED" | "AUTO_REFUNDED" | "CARRIER_TRACKED"; error: string };

/**
 * Delivery is normally confirmed by the carrier's scan or by the buyer. A
 * seller may mark a shipped order delivered only when no carrier status can
 * ever arrive for it: every undelivered parcel went with a carrier the
 * tracking integration can't follow (or without a tracking number).
 */
export function sellerMayMarkDelivered(order: DeliveryCandidate, items: ItemShipment[] = []): SellerDeliveryCheck {
  if (order.autoRefundedAt) {
    return { ok: false, code: "AUTO_REFUNDED", error: "This order was refunded because it wasn't delivered in time, so it can no longer be changed." };
  }
  if (order.status !== "shipped" || order.deliveredAt) {
    return { ok: false, code: "NOT_SHIPPED", error: "Only a shipped order can be marked delivered." };
  }
  const parcels = [
    { carrier: order.carrier, trackingNumber: order.trackingNumber },
    ...items.filter((item) => !item.deliveredAt && !item.refundedAt),
  ];
  const carrierTracked = parcels.some((p) => p.trackingNumber && shippoCarrierToken(p.carrier ?? order.carrier));
  if (carrierTracked) {
    return {
      ok: false,
      code: "CARRIER_TRACKED",
      error: "The carrier confirms delivery for this order. It will update automatically when the package is scanned as delivered.",
    };
  }
  return { ok: true };
}
