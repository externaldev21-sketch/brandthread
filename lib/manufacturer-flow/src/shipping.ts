/**
 * International carriers commonly used by garment manufacturers, with each
 * carrier's public tracking page. Anything else falls back to 17TRACK, which
 * auto-detects 2,000+ carriers from the tracking number.
 */
export type Carrier = { id: string; name: string; url: (trackingNumber: string) => string };

const enc = encodeURIComponent;

export const CARRIERS: readonly Carrier[] = [
  { id: "dhl", name: "DHL Express", url: (n) => `https://www.dhl.com/global-en/home/tracking/tracking-express.html?tracking-id=${enc(n)}` },
  { id: "fedex", name: "FedEx", url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${enc(n)}` },
  { id: "ups", name: "UPS", url: (n) => `https://www.ups.com/track?tracknum=${enc(n)}` },
  { id: "usps", name: "USPS", url: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${enc(n)}` },
  { id: "aramex", name: "Aramex", url: (n) => `https://www.aramex.com/us/en/track/results?ShipmentNumber=${enc(n)}` },
  { id: "sf-express", name: "SF Express", url: (n) => `https://www.sf-international.com/us/en/dynamic_function/waybill/#search/bill-number/${enc(n)}` },
  { id: "ems", name: "China Post / EMS", url: (n) => `https://t.17track.net/en#nums=${enc(n)}` },
  { id: "yunexpress", name: "YunExpress", url: (n) => `https://www.yuntrack.com/parcelTracking?id=${enc(n)}` },
  { id: "tnt", name: "TNT", url: (n) => `https://www.tnt.com/express/en_us/site/shipping-tools/tracking.html?searchType=con&cons=${enc(n)}` },
  { id: "dpd", name: "DPD", url: (n) => `https://tracking.dpd.de/status/en_US/parcel/${enc(n)}` },
  { id: "royal-mail", name: "Royal Mail", url: (n) => `https://www.royalmail.com/track-your-item#/tracking-results/${enc(n)}` },
  { id: "canada-post", name: "Canada Post", url: (n) => `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${enc(n)}` },
  { id: "india-post", name: "India Post", url: (n) => `https://t.17track.net/en#nums=${enc(n)}` },
  { id: "other", name: "Other carrier", url: (n) => `https://t.17track.net/en#nums=${enc(n)}` },
];

export function findCarrier(value: string | null | undefined): Carrier | null {
  if (!value) return null;
  const needle = value.trim().toLowerCase();
  return CARRIERS.find((carrier) => carrier.id === needle || carrier.name.toLowerCase() === needle)
    ?? CARRIERS.find((carrier) => needle.startsWith(carrier.name.toLowerCase().split(" ")[0]))
    ?? null;
}

/** Public tracking URL for a carrier + number, or null when there is no number. */
export function trackingUrl(carrier: string | null | undefined, trackingNumber: string | null | undefined): string | null {
  const number = trackingNumber?.trim();
  if (!number) return null;
  const match = findCarrier(carrier) ?? CARRIERS[CARRIERS.length - 1];
  return match.url(number);
}

export function carrierDisplayName(carrier: string | null | undefined): string {
  if (!carrier?.trim()) return "Carrier";
  return findCarrier(carrier)?.name ?? carrier.trim();
}
