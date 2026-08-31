import { ReplitConnectors } from "@replit/connectors-sdk";

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

export async function createShipment(body: {
  address_from: Record<string, unknown>;
  address_to: Record<string, unknown>;
  parcels: Array<Record<string, unknown>>;
}) {
  return shippoRequest<{ object_id: string; rates: ShippoRate[] }>("/shipments", {
    method: "POST",
    body: { ...body, async: false },
  });
}

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
  return shippoRequest<ShippoRate>(`/rates/${encodeURIComponent(rateId)}`);
}

export async function findTransaction(reference: string) {
  const page = await shippoRequest<{ results?: Array<{
    object_id: string;
    status: string;
    metadata?: string;
    tracking_number?: string;
    label_url?: string;
    rate?: ShippoRate;
  }> }>(`/transactions?metadata=${encodeURIComponent(reference)}`);
  return (page.results ?? []).find((item) => item.metadata === reference) ?? null;
}

export async function refundTransaction(transactionId: string) {
  return shippoRequest<{ object_id: string; status: string }>("/refunds", {
    method: "POST",
    body: { transaction: transactionId, async: false },
  });
}