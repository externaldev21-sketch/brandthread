/**
 * EasyPost — a second discounted-label provider next to Shippo.
 *
 * Feature-flagged on `EASYPOST_API_KEY`: with no key every helper here is
 * skipped by the caller (`isEasyPostEnabled()` is false) and nothing is ever
 * sent. The key stays server-side; requests use HTTP basic auth with the key
 * as the username, as EasyPost documents.
 *
 * Only the four calls the label flow needs: create a shipment (rates), buy a
 * rate, read a shipment (to reconcile a purchase that may already have gone
 * through) and request a refund (void).
 */
import { withRetry } from "./retry";

const EASYPOST_BASE_URL = "https://api.easypost.com/v2";

export function isEasyPostEnabled(): boolean {
  return Boolean(process.env.EASYPOST_API_KEY?.trim());
}

async function easypostRequest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const key = process.env.EASYPOST_API_KEY?.trim();
  if (!key) throw Object.assign(new Error("EasyPost is not configured"), { status: 503 });
  const response = await fetch(`${EASYPOST_BASE_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error(`Shipping provider request failed (${response.status})`), {
      status: response.status,
      providerBody: text.slice(0, 500),
    });
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export type EasyPostRate = {
  id: string;
  shipment_id?: string;
  carrier: string;
  service: string;
  rate: string;
  currency?: string;
  /** What the carrier charges at the counter, when EasyPost knows it. */
  retail_rate?: string | null;
  /** The carrier's published list price, when EasyPost knows it. */
  list_rate?: string | null;
  delivery_days?: number | null;
  est_delivery_days?: number | null;
  delivery_date?: string | null;
};

export type EasyPostShipment = {
  id: string;
  rates?: EasyPostRate[];
  selected_rate?: EasyPostRate | null;
  tracking_code?: string | null;
  postage_label?: { label_url?: string | null; label_pdf_url?: string | null } | null;
  /** submitted | refunded | rejected | not_applicable | null */
  refund_status?: string | null;
  reference?: string | null;
};

export type EasyPostAddress = {
  name?: string; street1?: string; street2?: string; city?: string; state?: string; zip?: string;
  country?: string; phone?: string; email?: string;
};

/** Quote request (read-only; safe to retry). Parcel in inches and pounds, as the rest of the label flow. */
export async function createEasyPostShipment(input: {
  from: EasyPostAddress;
  to: EasyPostAddress;
  parcel: { length: number; width: number; height: number; weightLb: number };
}): Promise<EasyPostShipment> {
  return withRetry(
    () => easypostRequest<EasyPostShipment>("/shipments", {
      method: "POST",
      body: {
        shipment: {
          from_address: input.from,
          to_address: input.to,
          parcel: {
            length: input.parcel.length,
            width: input.parcel.width,
            height: input.parcel.height,
            // EasyPost weights are in ounces.
            weight: Math.max(0.1, Math.round(input.parcel.weightLb * 16 * 10) / 10),
          },
          options: { label_format: "PDF", label_size: "4x6" },
        },
      },
    }),
    { label: "easypost.createShipment" },
  );
}

/** Reads a shipment (used to reconcile a purchase). Read-only; safe to retry. */
export async function getEasyPostShipment(shipmentId: string): Promise<EasyPostShipment> {
  return withRetry(
    () => easypostRequest<EasyPostShipment>(`/shipments/${encodeURIComponent(shipmentId)}`),
    { label: "easypost.getShipment" },
  );
}

// Buying spends money and is not retried automatically (see lib/retry.ts).
// EasyPost refuses to buy the same shipment twice, which is what makes the
// caller's read-then-buy reconciliation safe.
export async function buyEasyPostShipment(shipmentId: string, rateId: string): Promise<EasyPostShipment> {
  return easypostRequest<EasyPostShipment>(`/shipments/${encodeURIComponent(shipmentId)}/buy`, {
    method: "POST",
    body: { rate: { id: rateId } },
  });
}

// A refund request is money-adjacent; not retried automatically.
export async function refundEasyPostShipment(shipmentId: string): Promise<EasyPostShipment> {
  return easypostRequest<EasyPostShipment>(`/shipments/${encodeURIComponent(shipmentId)}/refund`, {
    method: "POST",
  });
}
