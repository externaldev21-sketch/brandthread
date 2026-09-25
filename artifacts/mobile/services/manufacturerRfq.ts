/**
 * RFQ broadcast + quote comparison — a seller posts one Request for
 * Quotation to up to 10 manufacturers at once and compares the quotes that
 * come back, one per manufacturer. Each quote independently progresses
 * through the existing seller_quote_requests status machine — accept /
 * decline / counteroffer reuse the same calls as a normal 1:1 quote
 * (see acceptQuote / declineQuote / submitCounteroffer in manufacturerService).
 */
import { serviceRequest } from '../lib/serviceConfig';

export type RfqStatus = 'open' | 'matched' | 'closed' | 'cancelled';

export type RfqQuoteStatus =
  | 'submitted' | 'viewed' | 'questions_asked' | 'quoted'
  | 'accepted' | 'declined' | 'counteroffer_sent' | 'cancelled';

export interface RfqCounteroffer {
  desiredUnitPriceCents?: number;
  desiredMoq?: number;
  desiredProductionDays?: number;
  desiredPaymentTerms?: string;
  notes?: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}

export interface Rfq {
  id: string;
  sellerId: string;
  garmentType: string;
  category: string;
  description: string;
  quantity: number;
  targetPriceCents: number | null;
  deadline: string | null;
  fileIds: string[];
  status: RfqStatus;
  manufacturersCount: number;
  quotesReceivedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RfqQuote {
  id: string;
  sellerId: string;
  manufacturerId: string;
  rfqId: string | null;
  productName: string;
  quantity: number | null;
  status: RfqQuoteStatus;
  quotedPriceCents: number | null;
  quotedTurnaround: string | null;
  quoteValidUntil: string | null;
  counteroffer: RfqCounteroffer | null;
  notes: string | null;
  manufacturerName: string;
  manufacturerCountry: string;
  manufacturerIsVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RfqDetail extends Rfq {
  quotes: RfqQuote[];
}

export interface CreateRfqInput {
  garmentType: string;
  category?: string;
  description?: string;
  quantity: number;
  targetPriceCents?: number;
  deadline?: string;
  fileIds?: string[];
  manufacturerIds: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mapRfq(row: any): Rfq {
  return {
    id: row.id,
    sellerId: row.sellerId ?? '',
    garmentType: row.garmentType ?? '',
    category: row.category ?? '',
    description: row.description ?? '',
    quantity: Number(row.quantity ?? 0),
    targetPriceCents: row.targetPriceCents ?? null,
    deadline: row.deadline ?? null,
    fileIds: Array.isArray(row.fileIds) ? row.fileIds : [],
    status: row.status ?? 'open',
    manufacturersCount: Number(row.manufacturersCount ?? 0),
    quotesReceivedCount: Number(row.quotesReceivedCount ?? 0),
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}

function mapRfqQuote(row: any): RfqQuote {
  return {
    id: row.id,
    sellerId: row.sellerId ?? '',
    manufacturerId: row.manufacturerId,
    rfqId: row.rfqId ?? null,
    productName: row.productName ?? '',
    quantity: row.quantity ?? null,
    status: row.status ?? 'submitted',
    quotedPriceCents: row.quotedPriceCents ?? null,
    quotedTurnaround: row.quotedTurnaround ?? null,
    quoteValidUntil: row.quoteValidUntil ?? null,
    counteroffer: row.counteroffer ?? null,
    notes: row.notes ?? null,
    manufacturerName: row.manufacturerName ?? 'Manufacturer',
    manufacturerCountry: row.manufacturerCountry ?? '',
    manufacturerIsVerified: !!row.manufacturerIsVerified,
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}

/** Post a Request for Quotation and fan it out to the chosen manufacturers. */
export async function createRfq(input: CreateRfqInput): Promise<Rfq> {
  if (!input.garmentType.trim()) throw new Error('Garment type is required.');
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error('Quantity must be a positive number.');
  if (!input.manufacturerIds.length || input.manufacturerIds.length > 10) {
    throw new Error('Choose between 1 and 10 manufacturers for this RFQ.');
  }
  if (!input.manufacturerIds.every((id) => UUID_RE.test(id))) {
    throw new Error('Choose manufacturers from the live directory before continuing.');
  }
  const row = await serviceRequest<any>('/api/seller-hub/rfqs', {
    method: 'POST',
    body: JSON.stringify({
      garmentType: input.garmentType.trim(),
      category: input.category?.trim() || undefined,
      description: input.description?.trim() || undefined,
      quantity: input.quantity,
      targetPriceCents: input.targetPriceCents,
      deadline: input.deadline,
      fileIds: input.fileIds ?? [],
      manufacturerIds: input.manufacturerIds,
    }),
  });
  return mapRfq(row);
}

/** The seller's posted RFQs, newest first, with live quote-received counts. */
export async function getRfqs(): Promise<Rfq[]> {
  const rows = await serviceRequest<any[]>('/api/seller-hub/rfqs');
  if (!Array.isArray(rows)) throw new Error('RFQs returned an invalid response.');
  return rows.map(mapRfq);
}

/** RFQ detail plus one quote per targeted manufacturer, for side-by-side compare. */
export async function getRfq(id: string): Promise<RfqDetail | undefined> {
  const row = await serviceRequest<any>(`/api/seller-hub/rfqs/${encodeURIComponent(id)}`);
  if (!row?.id) return undefined;
  return { ...mapRfq(row), quotes: Array.isArray(row.quotes) ? row.quotes.map(mapRfqQuote) : [] };
}

/** Withdraw an open/matched RFQ before any manufacturer has quoted. */
export async function cancelRfq(id: string): Promise<Rfq> {
  return mapRfq(await serviceRequest<any>(`/api/seller-hub/rfqs/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }),
  }));
}

/** Close an RFQ once the seller has picked a manufacturer (or is done comparing). */
export async function closeRfq(id: string): Promise<Rfq> {
  return mapRfq(await serviceRequest<any>(`/api/seller-hub/rfqs/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'closed' }),
  }));
}

export interface RfqTargetManufacturer {
  id: string;
  businessName: string;
  country: string;
  specialty: string;
  moq: number;
  priceRange: string | null;
  bulkTurnaround: string | null;
  photo: string | null;
  isVerified: boolean;
}

/** Active manufacturers a seller can pick as RFQ targets. */
export async function getRfqTargetManufacturers(): Promise<RfqTargetManufacturer[]> {
  const rows = await serviceRequest<any[]>('/api/seller-hub/manufacturers');
  if (!Array.isArray(rows)) throw new Error('Manufacturer directory returned an invalid response.');
  return rows.map((row) => ({
    id: row.id,
    businessName: row.businessName ?? 'Manufacturer',
    country: row.country ?? '',
    specialty: row.specialty ?? '',
    moq: Number(row.moq ?? 0),
    priceRange: row.priceRange ?? null,
    bulkTurnaround: row.bulkTurnaround ?? null,
    photo: Array.isArray(row.photos) ? row.photos[0] ?? null : null,
    isVerified: !!row.verifiedAt,
  }));
}
