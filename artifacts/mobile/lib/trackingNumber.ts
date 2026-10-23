/**
 * Carrier picker options and tracking-number format checks for the seller's
 * "Mark as shipped" form. Mirrors CARRIER_OPTIONS / validateTrackingNumber in
 * artifacts/api-server/src/lib/shippingTracking.ts exactly (the server
 * re-checks on POST /api/orders/:id/ship). If you change one, change both.
 */

export type CarrierKey = 'usps' | 'ups' | 'fedex' | 'dhl' | 'other';

export const CARRIER_OPTIONS: ReadonlyArray<{ key: CarrierKey; label: string }> = [
  { key: 'usps', label: 'USPS' },
  { key: 'ups', label: 'UPS' },
  { key: 'fedex', label: 'FedEx' },
  { key: 'dhl', label: 'DHL Express' },
  { key: 'other', label: 'Other' },
];

const TRACKING_FORMATS: Record<CarrierKey, RegExp> = {
  usps: /^(\d{20,34}|[A-Z]{2}\d{9}US)$/,
  ups: /^1Z[0-9A-Z]{16}$/,
  fedex: /^(\d{12}|\d{15}|\d{20}|\d{22})$/,
  dhl: /^(\d{10,11}|JJD\d{9,20})$/,
  other: /^[0-9A-Z]{6,40}$/,
};

const FORMAT_HINT: Record<CarrierKey, string> = {
  usps: 'USPS tracking numbers are 20 to 34 digits, or 2 letters, 9 digits and US.',
  ups: 'UPS tracking numbers start with 1Z and are 18 characters long.',
  fedex: 'FedEx tracking numbers are 12, 15, 20 or 22 digits.',
  dhl: 'DHL Express tracking numbers are 10 or 11 digits.',
  other: 'Tracking numbers are 6 to 40 letters and numbers.',
};

export function carrierKeyOf(carrier: string): CarrierKey {
  const key = carrier.toLowerCase().replace(/[^a-z]/g, '');
  if (key === 'usps') return 'usps';
  if (key === 'ups') return 'ups';
  if (key === 'fedex') return 'fedex';
  if (key === 'dhl' || key === 'dhlexpress') return 'dhl';
  return 'other';
}

export function normalizeTrackingNumber(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

export type TrackingValidation =
  | { ok: true; carrier: string; trackingNumber: string }
  | { ok: false; field: 'carrier' | 'trackingNumber'; error: string };

export function validateTrackingNumber(rawCarrier: string, rawNumber: string): TrackingValidation {
  const carrier = rawCarrier.trim();
  if (!carrier || carrier.length > 60 || carrier.toLowerCase() === 'other') {
    return { ok: false, field: 'carrier', error: "Choose a carrier, or enter the carrier's name." };
  }
  const trackingNumber = normalizeTrackingNumber(rawNumber);
  if (!trackingNumber) {
    return { ok: false, field: 'trackingNumber', error: 'Enter a tracking number.' };
  }
  const key = carrierKeyOf(carrier);
  if (!TRACKING_FORMATS[key].test(trackingNumber)) {
    return { ok: false, field: 'trackingNumber', error: `This doesn't look like a valid tracking number. ${FORMAT_HINT[key]}` };
  }
  const label = CARRIER_OPTIONS.find(option => option.key === key && key !== 'other')?.label ?? carrier;
  return { ok: true, carrier: label, trackingNumber };
}
