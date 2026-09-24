import { ReplitConnectors } from "@replit/connectors-sdk";
import { withRetry } from "./retry";

const connectors = new ReplitConnectors();

async function shippoRequest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await connectors.proxy("shippo", path, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
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

export type ShippoRate = {
  object_id: string;
  amount: string;
  currency: string;
  provider: string;
  servicelevel?: { name?: string; token?: string };
  estimated_days?: number;
  duration_terms?: string;
};

// Requesting a shipping quote doesn't spend money or create a label — it's
// effectively a read, so it's safe to retry on transport failures.
export async function createShipment(body: {
  address_from: Record<string, unknown>;
  address_to: Record<string, unknown>;
  parcels: Array<Record<string, unknown>>;
}) {
  return withRetry(
    () => shippoRequest<{ object_id: string; rates: ShippoRate[] }>("/shipments", {
      method: "POST",
      body: { ...body, async: false },
    }),
    { label: "shippo.createShipment" },
  );
}

// Purchasing a label spends the seller's Shippo balance and Shippo does not
// document a client-supplied idempotency key for this endpoint, so it is NOT
// retried automatically — see src/lib/retry.ts's doc comment. A failed
// purchase must be resolved (or explicitly resubmitted) by the caller.
export async function purchaseTransaction(rateId: string, reference: string) {
  return shippoRequest<{
    object_id: string;
    status: string;
    tracking_number?: string;
    label_url?: string;
    rate?: ShippoRate;
    messages?: Array<{ text?: string }>;
  }>("/transactions", {
    method: "POST",
    body: { rate: rateId, label_file_type: "PDF", metadata: reference, async: false },
  });
}

export async function getRate(rateId: string) {
  return withRetry(
    () => shippoRequest<ShippoRate>(`/rates/${encodeURIComponent(rateId)}`),
    { label: "shippo.getRate" },
  );
}

export async function findTransaction(reference: string) {
  const page = await withRetry(
    () => shippoRequest<{ results?: Array<{
      object_id: string;
      status: string;
      metadata?: string;
      tracking_number?: string;
      label_url?: string;
      rate?: ShippoRate;
    }> }>(`/transactions?metadata=${encodeURIComponent(reference)}`),
    { label: "shippo.findTransaction" },
  );
  return (page.results ?? []).find((item) => item.metadata === reference) ?? null;
}

// A refund request is money-adjacent and not idempotent on Shippo's side, so
// it is left unwrapped — see src/lib/retry.ts's doc comment.
export async function refundTransaction(transactionId: string) {
  return shippoRequest<{ object_id: string; status: string }>("/refunds", {
    method: "POST",
    body: { transaction: transactionId, async: false },
  });
}