/**
 * EasyPost adapter. Mirrors the response shapes of lib/shippo.ts (rates,
 * transactions, refunds) so routes stay provider-agnostic; selection happens
 * in lib/shippingProvider.ts. Off unless EASYPOST_API_KEY is set.
 *
 * Differences from Shippo that the adapter hides:
 *  - A purchase needs the shipment id AND the rate id, so a rate's `object_id`
 *    is `<shipmentId>|<rateId>`.
 *  - There is no transaction object: the shipment id plays that role.
 *  - Weights are ounces; Shippo-shaped parcels (lb) are converted.
 *  - Buying twice errors; the adapter re-reads the shipment instead, which
 *    makes a retried purchase idempotent.
 */
import { withRetry } from "./retry";
import type { ShippoLabelFileType, ShippoRate } from "./shippo";

const EASYPOST_API_BASE = "https://api.easypost.com/v2";

export function easypostApiKey(): string | null {
  return process.env.EASYPOST_API_KEY?.trim() || null;
}

async function easypostRequest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const apiKey = easypostApiKey();
  if (!apiKey) throw Object.assign(new Error("EasyPost is not configured"), { status: 503 });
  const response = await fetch(`${EASYPOST_API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
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

type EasyPostRate = {
  id: string;
  carrier: string;
  service: string;
  rate: string;
  currency: string;
  delivery_days?: number | null;
};

type EasyPostShipment = {
  id: string;
  rates?: EasyPostRate[];
  tracking_code?: string | null;
  postage_label?: { label_url?: string | null; label_pdf_url?: string | null } | null;
  selected_rate?: EasyPostRate | null;
  refund_status?: string | null;
};

export function encodeRateId(shipmentId: string, rateId: string): string {
  return `${shipmentId}|${rateId}`;
}

export function decodeRateId(value: string): { shipmentId: string; rateId: string } {
  const [shipmentId, rateId] = value.split("|");
  if (!shipmentId || !rateId) throw Object.assign(new Error("Invalid EasyPost rate id"), { status: 400 });
  return { shipmentId, rateId };
}

function toShippoRate(shipmentId: string, rate: EasyPostRate): ShippoRate {
  return {
    object_id: encodeRateId(shipmentId, rate.id),
    amount: rate.rate,
    currency: rate.currency,
    provider: rate.carrier,
    servicelevel: { name: rate.service, token: rate.service },
    estimated_days: rate.delivery_days ?? undefined,
  };
}

const LB_TO_OZ = 16;

function parcelToEasyPost(parcel: Record<string, unknown>) {
  const weight = Number(parcel.weight);
  const oz = parcel.mass_unit === "oz" ? weight : weight * LB_TO_OZ;
  return {
    length: Number(parcel.length), width: Number(parcel.width), height: Number(parcel.height),
    weight: Math.max(0.1, Math.round(oz * 10) / 10),
  };
}

export async function createShipment(body: {
  address_from: Record<string, unknown>;
  address_to: Record<string, unknown>;
  parcels: Array<Record<string, unknown>>;
}) {
  const shipment = await withRetry(
    () => easypostRequest<EasyPostShipment>("/shipments", {
      method: "POST",
      body: {
        shipment: {
          from_address: body.address_from,
          to_address: body.address_to,
          parcel: parcelToEasyPost(body.parcels[0] ?? {}),
          options: { label_format: "PDF", label_size: "4x6" },
        },
      },
    }),
    { label: "easypost.createShipment" },
  );
  return { object_id: shipment.id, rates: (shipment.rates ?? []).map((rate) => toShippoRate(shipment.id, rate)) };
}

function toTransaction(shipment: EasyPostShipment, status = "SUCCESS") {
  const rate = shipment.selected_rate ? toShippoRate(shipment.id, shipment.selected_rate) : undefined;
  return {
    object_id: shipment.id,
    status,
    tracking_number: shipment.tracking_code ?? undefined,
    label_url: shipment.postage_label?.label_pdf_url ?? shipment.postage_label?.label_url ?? undefined,
    rate,
  };
}

// Buying a label spends money, so like Shippo's it is never auto-retried. A
// second buy of the same shipment is answered by re-reading that shipment.
export async function purchaseTransaction(rateObjectId: string, _reference: string, _fileType?: ShippoLabelFileType) {
  const { shipmentId, rateId } = decodeRateId(rateObjectId);
  try {
    const shipment = await easypostRequest<EasyPostShipment>(`/shipments/${encodeURIComponent(shipmentId)}/buy`, {
      method: "POST",
      body: { rate: { id: rateId } },
    });
    return toTransaction(shipment, shipment.tracking_code ? "SUCCESS" : "QUEUED");
  } catch (err: any) {
    if (err?.status === 422 || err?.status === 400) {
      const existing = await easypostRequest<EasyPostShipment>(`/shipments/${encodeURIComponent(shipmentId)}`);
      if (existing.tracking_code) return toTransaction(existing);
    }
    throw err;
  }
}

/** EasyPost has no reference lookup; a purchase is reconciled by re-buying (see above). */
export async function findTransaction(_reference: string) {
  return null;
}

export async function refundTransaction(shipmentId: string) {
  const shipment = await easypostRequest<EasyPostShipment>(`/shipments/${encodeURIComponent(shipmentId)}/refund`, {
    method: "POST",
  });
  return { object_id: shipment.id, status: shipment.refund_status === "refunded" ? "SUCCESS" : "QUEUED" };
}
