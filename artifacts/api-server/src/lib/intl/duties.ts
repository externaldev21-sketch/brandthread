/**
 * Intl #109: duties & import taxes at checkout (DDP).
 *
 * When the seller's shipping zone for the buyer's country is DDP ("duties
 * prepaid"), checkout quotes the destination's duties, import taxes (VAT/GST
 * collected at the border) and customs fees, and adds them to the order as
 * their own amount (checkout_sessions.duties_cents → orders.duties_cents).
 * DAP zones are unchanged: the buyer pays the carrier on delivery.
 *
 * Money: duties are part of the Stripe charge and, like shipping and sales
 * tax, pass through to the seller's payout (lib/money/fees.ts splitOrder:
 * seller net = gross − platform fee − processing; the 5% platform fee is on
 * merchandise only, so it never touches duties). The seller is the shipper
 * of record on a DDP label and the carrier bills them the duties, so the
 * amount collected here is what reimburses that bill. Stripe's processing
 * fee is charged on the whole charge, duties included, as for tax.
 *
 * Provider: Zonos Landed Cost (GraphQL "landedCostOnly" workflow — shipping
 * is already known from the seller's zone, so Zonos isn't asked to rate it).
 * The request and response shapes follow Zonos' own TypeScript SDK
 * (github.com/Zonos/typescript-sdk, src/landedCostOnly). Verify against a
 * sandbox key before turning the flag on: the endpoint URL and auth header
 * are configurable (ZONOS_GRAPHQL_URL) for that reason.
 *
 * Off unless DUTIES_AT_CHECKOUT_ENABLED=true AND ZONOS_API_KEY is set.
 */

export type DutiesQuoteRequest = {
  origin: { country: string; postalCode: string | null };
  destination: { country: string; postalCode: string; city?: string; state?: string; street?: string };
  items: Array<{ productId: string; name: string; unitPriceCents: number; quantity: number }>;
  shippingCents: number;
};

export type DutiesQuote = {
  /** Duties + import taxes + customs fees, in USD cents. */
  dutiesCents: number;
  breakdown: { dutiesCents: number; taxesCents: number; feesCents: number };
  quoteId: string | null;
  provider: string;
};

export interface DutiesProvider {
  readonly name: string;
  quote(request: DutiesQuoteRequest): Promise<DutiesQuote>;
}

export class DutiesUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "DutiesUnavailableError";
  }
}

export function dutiesAtCheckoutEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DUTIES_AT_CHECKOUT_ENABLED === "true" && Boolean(env.ZONOS_API_KEY);
}

/** Decimal currency amount (number or string) to integer cents, half-up. */
export function decimalToCents(value: unknown): number {
  const text = typeof value === "number" ? value.toFixed(6) : typeof value === "string" ? value.trim() : "";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new DutiesUnavailableError(`Unreadable amount from duties provider: ${String(value)}`);
  const fraction = (match[3] ?? "").padEnd(3, "0");
  let cents = Number(match[2]) * 100 + Number(fraction.slice(0, 2));
  if (Number(fraction[2]) >= 5) cents += 1;
  return match[1] === "-" ? -cents : cents;
}

const centsToDecimal = (cents: number) => Number((cents / 100).toFixed(2));

export const ZONOS_DEFAULT_URL = "https://api.zonos.com/graphql";

/** From Zonos' SDK (src/landedCostOnly/_landedCostOnly.graphql.customer.ts), trimmed to the fields used. */
export const ZONOS_LANDED_COST_ONLY = `
  mutation landedCostOnly(
    $partyCreateWorkflowInput: [PartyCreateWorkflowInput!]!
    $itemCreateWorkflowInput: [ItemCreateWorkflowInput!]!
    $landedCostCalculateWorkflowInput: LandedCostWorkFlowInput!
    $shipmentRatingCreateWorkflowInput: ShipmentRatingCreateWorkflowInput!
  ) {
    partyCreateWorkflow(input: $partyCreateWorkflowInput) { id type }
    itemCreateWorkflow(input: $itemCreateWorkflowInput) { id }
    cartonizeWorkflow { id }
    shipmentRatingCreateWorkflow(input: $shipmentRatingCreateWorkflowInput) { id }
    landedCostCalculateWorkflow(input: $landedCostCalculateWorkflowInput) {
      id
      currencyCode
      method
      amountSubtotals { duties fees shipping taxes }
    }
  }
`;

export function zonosVariables(request: DutiesQuoteRequest) {
  return {
    partyCreateWorkflowInput: [
      {
        type: "ORIGIN",
        location: {
          countryCode: request.origin.country.toUpperCase(),
          ...(request.origin.postalCode ? { postalCode: request.origin.postalCode } : {}),
        },
      },
      {
        type: "DESTINATION",
        location: {
          countryCode: request.destination.country.toUpperCase(),
          postalCode: request.destination.postalCode,
          ...(request.destination.street ? { line1: request.destination.street } : {}),
          ...(request.destination.city ? { locality: request.destination.city } : {}),
          ...(request.destination.state ? { administrativeAreaCode: request.destination.state } : {}),
        },
      },
    ],
    itemCreateWorkflowInput: request.items.map((item) => ({
      productId: item.productId,
      name: item.name,
      description: item.name,
      amount: centsToDecimal(item.unitPriceCents),
      currencyCode: "USD",
      quantity: item.quantity,
      // Origin unknown per product; Zonos defaults to the origin party when omitted.
    })),
    landedCostCalculateWorkflowInput: {
      calculationMethod: "DDP",
      endUse: "NOT_FOR_RESALE",
      tariffRate: "ZONOS_PREFERRED",
      currencyCode: "USD",
      quoteType: "API",
    },
    shipmentRatingCreateWorkflowInput: {
      amount: centsToDecimal(request.shippingCents),
      currencyCode: "USD",
      displayName: "custom:custom",
      serviceLevelCode: "custom:custom",
    },
  };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Reads the landedCostOnly response into a DutiesQuote (throws DutiesUnavailableError). */
export function parseZonosLandedCost(body: unknown): DutiesQuote {
  const value = body as { data?: { landedCostCalculateWorkflow?: unknown }; errors?: Array<{ message?: string }> } | null;
  if (value?.errors?.length) {
    throw new DutiesUnavailableError(`Zonos error: ${value.errors.map((e) => e.message ?? "unknown").join("; ")}`);
  }
  const raw = value?.data?.landedCostCalculateWorkflow;
  const landed = (Array.isArray(raw) ? raw.find(Boolean) : raw) as
    | { id?: string; currencyCode?: string; amountSubtotals?: { duties?: unknown; taxes?: unknown; fees?: unknown } }
    | undefined;
  if (!landed?.amountSubtotals) throw new DutiesUnavailableError("Zonos returned no landed cost");
  if (landed.currencyCode && landed.currencyCode.toUpperCase() !== "USD") {
    throw new DutiesUnavailableError(`Zonos answered in ${landed.currencyCode}, expected USD`);
  }
  const duties = Math.max(0, decimalToCents(landed.amountSubtotals.duties ?? 0));
  const taxes = Math.max(0, decimalToCents(landed.amountSubtotals.taxes ?? 0));
  const fees = Math.max(0, decimalToCents(landed.amountSubtotals.fees ?? 0));
  return {
    dutiesCents: duties + taxes + fees,
    breakdown: { dutiesCents: duties, taxesCents: taxes, feesCents: fees },
    quoteId: landed.id ?? null,
    provider: "zonos",
  };
}

export class ZonosDutiesProvider implements DutiesProvider {
  readonly name = "zonos";
  constructor(private readonly options: { apiKey: string; url?: string; fetchImpl?: FetchLike; timeoutMs?: number }) {}

  async quote(request: DutiesQuoteRequest): Promise<DutiesQuote> {
    const fetchImpl: FetchLike = this.options.fetchImpl ?? ((url, init) => fetch(url, init) as any);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8000);
    let response;
    try {
      response = await fetchImpl(this.options.url || ZONOS_DEFAULT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", credentialToken: this.options.apiKey },
        body: JSON.stringify({ query: ZONOS_LANDED_COST_ONLY, variables: zonosVariables(request) }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new DutiesUnavailableError("Zonos request failed", err);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new DutiesUnavailableError(`Zonos answered ${response.status}`);
    return parseZonosLandedCost(await response.json());
  }
}

/** The configured provider, or null when the feature is off. */
export function getDutiesProvider(env: NodeJS.ProcessEnv = process.env): DutiesProvider | null {
  if (!dutiesAtCheckoutEnabled(env)) return null;
  return new ZonosDutiesProvider({ apiKey: env.ZONOS_API_KEY!, url: env.ZONOS_GRAPHQL_URL });
}

/**
 * Duties for one seller group. Zero unless the flag is on, the resolved zone
 * is DDP and the parcel crosses a border. Throws DutiesUnavailableError when
 * a DDP quote is needed but can't be had, so checkout never silently leaves
 * the seller paying duties the buyer wasn't charged.
 */
export async function dutiesForGroup(input: {
  dutiesHandling: string | null | undefined;
  shipFromCountry: string;
  request: DutiesQuoteRequest;
  provider?: DutiesProvider | null;
  env?: NodeJS.ProcessEnv;
}): Promise<{ dutiesCents: number; quoteId: string | null }> {
  if (input.dutiesHandling !== "ddp") return { dutiesCents: 0, quoteId: null };
  if (input.request.destination.country.toUpperCase() === input.shipFromCountry.toUpperCase()) {
    return { dutiesCents: 0, quoteId: null };
  }
  const provider = input.provider === undefined ? getDutiesProvider(input.env) : input.provider;
  if (!provider) return { dutiesCents: 0, quoteId: null };
  const quote = await provider.quote(input.request);
  return { dutiesCents: Math.max(0, quote.dutiesCents), quoteId: quote.quoteId };
}

// ─── Hosted Stripe Checkout (buyer.ts session, guest checkout) ──────────────

/** The 409 every checkout path answers when a DDP quote is needed but unavailable. */
export const DUTIES_UNAVAILABLE_RESPONSE = {
  error: "Import duties couldn't be calculated for this address. Try again in a moment.",
  code: "DUTIES_UNAVAILABLE",
} as const;

/** Stripe's "nontaxable" product tax code, so Stripe Tax never taxes the duties line itself. */
export const NONTAXABLE_TAX_CODE = "txcd_00000000";
export const DUTIES_LINE_NAME = "Duties & import taxes";

/** The Checkout Session line item for DDP duties (its own line, like shipping). */
export function dutiesLineItem(dutiesCents: number) {
  return {
    price_data: {
      currency: "usd",
      unit_amount: dutiesCents,
      tax_behavior: "exclusive" as const,
      product_data: { name: DUTIES_LINE_NAME, tax_code: NONTAXABLE_TAX_CODE },
    },
    quantity: 1,
  };
}

/**
 * Duties for a hosted-Checkout cart. Zero (and no work at all) unless the
 * flag is on and the matched zone is DDP; throws DutiesUnavailableError
 * when a quote is needed and can't be had.
 */
export async function hostedCheckoutDuties(input: {
  dutiesHandling: string | null | undefined;
  shipFromCountry: string;
  destination: { country: string; zip: string; city?: string; state?: string; street?: string };
  items: Array<{ variantId: string; productName: string; priceCents: number; quantity: number }>;
  shippingCents: number;
  provider?: DutiesProvider | null;
  env?: NodeJS.ProcessEnv;
}): Promise<{ dutiesCents: number; quoteId: string | null }> {
  if (input.dutiesHandling !== "ddp") return { dutiesCents: 0, quoteId: null };
  if (input.provider === undefined && !dutiesAtCheckoutEnabled(input.env)) return { dutiesCents: 0, quoteId: null };
  return dutiesForGroup({
    dutiesHandling: input.dutiesHandling,
    shipFromCountry: input.shipFromCountry,
    provider: input.provider,
    env: input.env,
    request: {
      origin: { country: input.shipFromCountry, postalCode: null },
      destination: {
        country: input.destination.country, postalCode: input.destination.zip,
        city: input.destination.city, state: input.destination.state, street: input.destination.street,
      },
      items: input.items.map((item) => ({ productId: item.variantId, name: item.productName, unitPriceCents: item.priceCents, quantity: item.quantity })),
      shippingCents: input.shippingCents,
    },
  });
}
