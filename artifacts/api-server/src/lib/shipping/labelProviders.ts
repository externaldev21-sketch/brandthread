/**
 * Outbound labels from more than one discounted provider.
 *
 * Shippo (through the Replit connector, as before) is always asked. EasyPost
 * is asked too when `EASYPOST_API_KEY` is set. Both quotes run in parallel and
 * their rates are merged into one list, cheapest first; when both offer the
 * same carrier service only the cheaper one is kept. Each rate remembers the
 * provider it came from (and that provider's shipment), so the label is
 * bought, and later voided, at the same provider.
 *
 * A provider that fails is logged and left out; the quote only fails when
 * every provider asked failed. With no EasyPost key the behaviour is exactly
 * the Shippo-only flow it replaces.
 *
 * Savings: EasyPost returns the carrier's retail / list price next to the
 * discounted one. Shippo rates carry no retail figure, so their
 * `retail_price_cents` is null and the app shows no saving for them — a retail
 * price is never estimated.
 */
import {
  createShipment as createShippoShipment, findTransaction, purchaseTransaction, refundTransaction, type ShippoRate,
} from "../shippo";
import {
  buyEasyPostShipment, createEasyPostShipment, getEasyPostShipment, isEasyPostEnabled, refundEasyPostShipment,
  type EasyPostRate, type EasyPostShipment,
} from "../easypost";
import { logger } from "../logger";

export type LabelProvider = "shippo" | "easypost";

export type QuotedRate = ShippoRate & {
  label_provider: LabelProvider;
  /** The provider's shipment this rate belongs to (needed to buy an EasyPost rate). */
  shipment_id: string;
  /** Carrier retail price in cents, only when the provider published one above our price. */
  retail_price_cents: number | null;
};

type ShipmentRequest = {
  address_from: Record<string, unknown>;
  address_to: Record<string, unknown>;
  parcels: Array<Record<string, unknown>>;
};

/** "12.3" → 1230; null for anything that isn't a plain non-negative amount. */
export function amountToCents(amount: string | null | undefined): number | null {
  if (typeof amount !== "string") return null;
  const match = amount.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** "GroundAdvantage" → "Ground Advantage", "2ndDayAir" → "2nd Day Air", ("FEDEX_GROUND", "FedEx") → "Ground". */
export function prettyService(service: string | null | undefined, carrier?: string | null): string {
  const raw = (service ?? "").trim();
  if (!raw) return "Shipping";
  if (/\s/.test(raw)) return raw;
  if (/^[A-Z0-9_]+$/.test(raw) && raw.includes("_")) {
    const words = raw.split("_").filter(Boolean);
    const carrierKey = (carrier ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (words.length > 1 && words[0].toLowerCase() === carrierKey) words.shift();
    return words.map((word) => word.charAt(0) + word.slice(1).toLowerCase()).join(" ");
  }
  return raw
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/(\d)([A-Z])/g, "$1 $2")
    .trim();
}

/** The higher of EasyPost's retail and list price, only when it is above our price. */
export function easyPostRetailCents(rate: Pick<EasyPostRate, "rate" | "retail_rate" | "list_rate">): number | null {
  const price = amountToCents(rate.rate);
  if (price == null) return null;
  const candidates = [amountToCents(rate.retail_rate ?? null), amountToCents(rate.list_rate ?? null)]
    .filter((value): value is number => value != null && value > price);
  return candidates.length ? Math.max(...candidates) : null;
}

export function fromEasyPostRate(rate: EasyPostRate, shipmentId: string): QuotedRate {
  return {
    object_id: rate.id,
    amount: rate.rate,
    currency: rate.currency ?? "USD",
    provider: rate.carrier,
    servicelevel: { name: prettyService(rate.service, rate.carrier), token: rate.service },
    estimated_days: rate.delivery_days ?? rate.est_delivery_days ?? undefined,
    duration_terms: undefined,
    label_provider: "easypost",
    shipment_id: rate.shipment_id ?? shipmentId,
    retail_price_cents: easyPostRetailCents(rate),
  };
}

function serviceKey(rate: QuotedRate): string {
  const carrier = rate.provider.toLowerCase().replace(/[^a-z0-9]/g, "");
  const service = (rate.servicelevel?.name ?? rate.servicelevel?.token ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${carrier}:${service.startsWith(carrier) ? service.slice(carrier.length) : service}`;
}

/** One list across providers: cheapest first, one row per carrier service (the cheaper one wins). */
export function mergeRates(lists: QuotedRate[][]): QuotedRate[] {
  const best = new Map<string, { rate: QuotedRate; cents: number }>();
  for (const rate of lists.flat()) {
    const cents = amountToCents(rate.amount);
    if (cents == null || cents <= 0) continue;
    const key = serviceKey(rate);
    const current = best.get(key);
    // A rate keeps only the retail price its own provider published for it.
    if (!current || cents < current.cents) best.set(key, { rate, cents });
  }
  return [...best.values()].sort((a, b) => a.cents - b.cents).map((entry) => entry.rate);
}

function easyPostParcel(parcel: Record<string, unknown> | undefined) {
  return {
    length: Number(parcel?.length),
    width: Number(parcel?.width),
    height: Number(parcel?.height),
    weightLb: Number(parcel?.weight),
  };
}

/**
 * Quotes every enabled provider for one parcel. Drop-in for Shippo's
 * `createShipment`: same request, rates in Shippo's shape plus the provider
 * fields above.
 */
export async function createShipment(body: ShipmentRequest): Promise<{ object_id: string; rates: QuotedRate[] }> {
  const asks: Array<Promise<{ provider: LabelProvider; shipmentId: string; rates: QuotedRate[] }>> = [
    createShippoShipment(body).then((shipment) => ({
      provider: "shippo" as const,
      shipmentId: shipment.object_id,
      rates: (shipment.rates ?? []).map((rate) => ({
        ...rate, label_provider: "shippo" as const, shipment_id: shipment.object_id, retail_price_cents: null,
      })),
    })),
  ];
  if (isEasyPostEnabled()) {
    asks.push(createEasyPostShipment({
      from: body.address_from as any,
      to: body.address_to as any,
      parcel: easyPostParcel(body.parcels[0]),
    }).then((shipment: EasyPostShipment) => ({
      provider: "easypost" as const,
      shipmentId: shipment.id,
      rates: (shipment.rates ?? []).map((rate) => fromEasyPostRate(rate, shipment.id)),
    })));
  }
  const settled = await Promise.allSettled(asks);
  const ok = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const failures = settled.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (ok.length === 0) throw failures[0];
  if (failures.length) {
    for (const err of failures) {
      logger.warn({ err, providerBody: (err as any)?.providerBody }, "A shipping provider could not quote; using the others");
    }
  }
  return { object_id: ok[0].shipmentId, rates: mergeRates(ok.map((entry) => entry.rates)) };
}

export type LabelTransaction = {
  object_id: string;
  status: string;
  tracking_number?: string;
  label_url?: string;
  rate?: { provider?: string; servicelevel?: { name?: string } };
};

function easyPostTransaction(shipment: EasyPostShipment): LabelTransaction {
  const labelUrl = shipment.postage_label?.label_pdf_url ?? shipment.postage_label?.label_url ?? undefined;
  const bought = Boolean(shipment.tracking_code && labelUrl);
  return {
    object_id: shipment.id,
    status: bought ? "SUCCESS" : "ERROR",
    tracking_number: shipment.tracking_code ?? undefined,
    label_url: labelUrl ?? undefined,
    rate: shipment.selected_rate
      ? { provider: shipment.selected_rate.carrier, servicelevel: { name: prettyService(shipment.selected_rate.service, shipment.selected_rate.carrier) } }
      : undefined,
  };
}

/**
 * Buys the label at the provider the rate came from. Retry-safe: Shippo is
 * looked up by our reference first; an EasyPost shipment that was already
 * bought is read back instead of bought again.
 */
export async function purchaseLabel(input: {
  provider: string | null | undefined;
  rateId: string;
  shipmentId: string | null | undefined;
  reference: string;
}): Promise<LabelTransaction> {
  if (input.provider === "easypost") {
    if (!input.shipmentId) throw Object.assign(new Error("This shipping rate is missing its shipment"), { status: 409 });
    const current = await getEasyPostShipment(input.shipmentId);
    if (current.refund_status) {
      // This shipment's label was bought and then voided: never hand it out again.
      throw Object.assign(new Error("This shipping rate was already used. Get new rates."), { status: 409, code: "INVALID_SHIPPING_QUOTE" });
    }
    const existing = easyPostTransaction(current);
    if (existing.status === "SUCCESS") return existing;
    return easyPostTransaction(await buyEasyPostShipment(input.shipmentId, input.rateId));
  }
  return await findTransaction(input.reference) ?? await purchaseTransaction(input.rateId, input.reference);
}

/** Voids a label at its provider. status "SUCCESS" = refunded; anything else = still pending. */
export async function refundLabel(input: {
  provider: string | null | undefined;
  transactionId: string;
}): Promise<{ status: string }> {
  if (input.provider === "easypost") {
    const current = await getEasyPostShipment(input.transactionId);
    const status = current.refund_status
      ? current
      : await refundEasyPostShipment(input.transactionId);
    if (status.refund_status === "refunded") return { status: "SUCCESS" };
    if (status.refund_status === "submitted") return { status: "PENDING" };
    throw Object.assign(new Error("The carrier would not refund this label"), { status: 502 });
  }
  return refundTransaction(input.transactionId);
}
