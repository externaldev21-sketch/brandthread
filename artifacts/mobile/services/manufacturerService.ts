/**
 * Manufacturer Hub service.
 *
 * Persisted manufacturer data always comes from the authenticated shared API.
 * AsyncStorage is used only for explicitly local, unsubmitted quote drafts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { serviceRequest } from '../lib/serviceConfig';
import {
  Counteroffer,
  Manufacturer,
  ManufacturerReview,
  ManufacturerConversation,
  ManufacturerInvitation,
  ManufacturerRelationship,
  ManufacturerThread,
  ProductionOrder,
  PRODUCTION_STAGES,
  ProductionStageKey,
  Quote,
  QuoteRequest,
  Sample,
  SampleReview,
  SampleRevision,
} from './manufacturerTypes';
import { mapPublicManufacturer } from './manufacturerDirectoryMapper';

export { mapPublicManufacturer } from './manufacturerDirectoryMapper';

const DRAFTS_KEY = 'mfg:local-quote-drafts:v2';

function now(): string {
  return new Date().toISOString();
}

function localId(): string {
  return `local-draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function assertCanonicalManufacturerId(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Choose a manufacturer from the live directory before continuing.');
  }
}

async function readDrafts(): Promise<QuoteRequest[]> {
  try {
    const value = await AsyncStorage.getItem(DRAFTS_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => item?.isDraft === true) : [];
  } catch {
    throw new Error('Local quote drafts could not be read. You can retry or start a new request.');
  }
}

async function writeDrafts(drafts: QuoteRequest[]): Promise<void> {
  try {
    await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    throw new Error('This draft could not be saved on your device.');
  }
}

function parseDays(value: unknown): number {
  return Number(String(value ?? '').match(/\d+/)?.[0] ?? 0);
}

function apiRowToQuoteRequest(row: any): QuoteRequest {
  const statusMap: Record<string, QuoteRequest['status']> = {
    submitted: 'sent',
    quoted: 'quote_received',
  };
  return {
    id: row.id,
    sellerId: row.sellerId ?? '',
    manufacturerId: row.manufacturerId,
    productName: row.productName ?? '',
    status: statusMap[row.status] ?? row.status ?? 'sent',
    quantity: Number(row.quantity ?? 0),
    materials: [],
    colorways: row.colorways ? String(row.colorways).split(',').map((v) => v.trim()).filter(Boolean) : [],
    sizes: [],
    variantQuantities: {},
    hasEmbroidery: false,
    hasWash: false,
    hasHardware: false,
    hasLabels: false,
    customPackaging: false,
    fileIds: [],
    notes: row.notes ?? row.details ?? undefined,
    currentStep: 5,
    isDraft: false,
    sampleRequired: row.type === 'sample',
    submittedAt: row.createdAt,
    createdAt: row.createdAt ?? now(),
    updatedAt: row.updatedAt ?? row.createdAt ?? now(),
  };
}

function apiRowToQuote(row: any): Quote | null {
  if (row.quotedPriceCents == null || !['quoted', 'accepted', 'declined', 'counteroffer_sent'].includes(row.status)) return null;
  const quantity = Number(row.quantity ?? 1);
  const totalEstimateCents = Number(row.quotedPriceCents);
  return {
    id: row.id,
    quoteRequestId: row.id,
    manufacturerId: row.manufacturerId,
    sellerId: row.sellerId ?? '',
    productName: row.productName ?? '',
    quantity,
    unitPriceCents: quantity > 0 ? Math.round(totalEstimateCents / quantity) : totalEstimateCents,
    sampleCostCents: row.type === 'sample' ? totalEstimateCents : 0,
    setupCostCents: 0,
    packagingCostCents: 0,
    shippingEstimateCents: 0,
    totalEstimateCents,
    moq: quantity,
    leadTimeDays: parseDays(row.quotedTurnaround),
    productionDays: parseDays(row.quotedTurnaround),
    paymentTerms: row.notes ?? 'Not provided',
    validUntil: row.quoteValidUntil ?? '',
    status: row.status === 'quoted' ? 'quote_received' : row.status,
    lineItems: [],
    notes: row.notes ?? undefined,
    receivedAt: row.updatedAt ?? row.createdAt ?? now(),
    updatedAt: row.updatedAt ?? row.createdAt ?? now(),
  };
}

export async function searchManufacturers(opts: {
  query?: string; country?: string; category?: string; moqMax?: number;
  unitPriceMaxCents?: number; leadTimeDaysMax?: number; verifiedOnly?: boolean;
  ratingMin?: number; material?: string;
}): Promise<Manufacturer[]> {
  const params = new URLSearchParams();
  if (opts.query) params.set('q', opts.query);
  if (opts.country) params.set('country', opts.country);
  if (opts.category) params.set('specialty', opts.category);
  const rows = await serviceRequest<any[]>(`/api/manufacturers/public${params.toString() ? `?${params}` : ''}`);
  if (!Array.isArray(rows)) throw new Error('Manufacturer directory returned an invalid response.');
  let results = rows.map(mapPublicManufacturer);
  if (opts.moqMax !== undefined) results = results.filter((item) => item.moq <= opts.moqMax!);
  if (opts.unitPriceMaxCents !== undefined) results = results.filter((item) => item.unitPriceMinCents <= opts.unitPriceMaxCents!);
  if (opts.leadTimeDaysMax !== undefined) results = results.filter((item) => item.leadTimeDays <= opts.leadTimeDaysMax!);
  if (opts.verifiedOnly) results = results.filter((item) => item.isVerified);
  return results;
}

export async function getManufacturer(id: string): Promise<Manufacturer | undefined> {
  assertCanonicalManufacturerId(id);
  const row = await serviceRequest<any>(`/api/manufacturers/public/${encodeURIComponent(id)}`);
  return row?.id ? mapPublicManufacturer(row) : undefined;
}

export async function getFavoriteManufacturerIds(): Promise<string[]> {
  const rows = await serviceRequest<Array<{ manufacturerId: string }>>('/api/manufacturers/favorites');
  if (!Array.isArray(rows)) throw new Error('Favorite manufacturers returned an invalid response.');
  return rows.map((row) => row.manufacturerId);
}

export async function favoriteManufacturer(manufacturerId: string): Promise<void> {
  assertCanonicalManufacturerId(manufacturerId);
  await serviceRequest('/api/manufacturers/favorites', { method: 'POST', body: JSON.stringify({ manufacturerId }) });
}

export async function unfavoriteManufacturer(manufacturerId: string): Promise<void> {
  assertCanonicalManufacturerId(manufacturerId);
  await serviceRequest(`/api/manufacturers/favorites/${encodeURIComponent(manufacturerId)}`, { method: 'DELETE' });
}

export async function getRelationships(): Promise<ManufacturerRelationship[]> {
  const rows = await serviceRequest<any[]>('/api/manufacturers/relationships');
  if (!Array.isArray(rows)) throw new Error('Manufacturer relationships returned an invalid response.');
  return rows.map((row) => {
    const status: ManufacturerRelationship['status'] =
      row.status === 'blocked' ? 'paused' : row.status === 'ended' ? 'archived' : 'connected';
    return {
      id: row.id,
      sellerId: row.sellerId ?? '',
      manufacturerId: row.manufacturerId,
      status,
      activeProductIds: [],
      unreadCount: 0,
      createdAt: row.createdAt ?? '',
      updatedAt: row.updatedAt ?? '',
    };
  });
}

export async function getRelationship(manufacturerId: string): Promise<ManufacturerRelationship | undefined> {
  return (await getRelationships()).find((item) => item.manufacturerId === manufacturerId);
}

export async function saveManufacturer(manufacturerId: string): Promise<ManufacturerRelationship> {
  assertCanonicalManufacturerId(manufacturerId);
  await Promise.all([
    favoriteManufacturer(manufacturerId),
    serviceRequest('/api/manufacturers/relationships', { method: 'POST', body: JSON.stringify({ manufacturerId }) }),
  ]);
  const relationship = await getRelationship(manufacturerId);
  if (!relationship) throw new Error('Manufacturer was saved but the relationship could not be refreshed.');
  return relationship;
}

export const unsaveManufacturer = unfavoriteManufacturer;

export async function getInvitations(): Promise<ManufacturerInvitation[]> {
  const rows = await serviceRequest<any[]>('/api/manufacturers/invite-tokens');
  if (!Array.isArray(rows)) throw new Error('Manufacturer invitations returned an invalid response.');
  return rows.map((row) => ({
    id: row.id,
    sellerId: row.sellerId ?? '',
    companyName: row.companyName ?? '',
    contactName: row.contactName ?? '',
    email: row.contactEmail ?? '',
    notes: row.notes ?? undefined,
    productIds: [],
    inviteLink: row.inviteUrl ?? undefined,
    status: row.status ?? 'pending',
    createdAt: row.createdAt ?? now(),
  }));
}

export async function createInvitation(data: Omit<ManufacturerInvitation, 'id' | 'sellerId' | 'status' | 'createdAt'>): Promise<ManufacturerInvitation> {
  const row = await serviceRequest<any>('/api/manufacturers/invite-tokens', {
    method: 'POST',
    body: JSON.stringify({ companyName: data.companyName, contactName: data.contactName, contactEmail: data.email, notes: data.notes }),
  });
  return {
    ...data,
    id: row.id,
    sellerId: row.sellerId ?? '',
    inviteLink: row.inviteUrl,
    status: row.status ?? 'pending',
    createdAt: row.createdAt ?? now(),
  };
}

export async function getQuoteRequests(): Promise<QuoteRequest[]> {
  const rows = await serviceRequest<any[]>('/api/seller-hub/quote-requests');
  if (!Array.isArray(rows)) throw new Error('Quote requests returned an invalid response.');
  return [...rows.map(apiRowToQuoteRequest), ...(await readDrafts())];
}

export async function getQuoteRequest(id: string): Promise<QuoteRequest | undefined> {
  if (id.startsWith('local-draft-')) return (await readDrafts()).find((item) => item.id === id);
  const row = await serviceRequest<any>(`/api/seller-hub/quote-requests/${encodeURIComponent(id)}`);
  return row?.id ? apiRowToQuoteRequest(row) : undefined;
}

export async function saveQuoteRequestDraft(data: Partial<QuoteRequest> & { manufacturerId: string; productName: string }): Promise<QuoteRequest> {
  assertCanonicalManufacturerId(data.manufacturerId);
  const drafts = await readDrafts();
  const existing = data.id ? drafts.find((item) => item.id === data.id) : undefined;
  const draft: QuoteRequest = {
    status: 'draft', quantity: 100, sampleRequired: true, materials: [], colorways: [], sizes: [],
    variantQuantities: {}, hasEmbroidery: false, hasWash: false, hasHardware: false, hasLabels: false,
    customPackaging: false, fileIds: [], currentStep: 1, isDraft: true,
    ...existing, ...data,
    id: existing?.id ?? (data.id?.startsWith('local-draft-') ? data.id : localId()),
    sellerId: '',
    manufacturerId: data.manufacturerId,
    productName: data.productName,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  };
  const next = existing ? drafts.map((item) => item.id === existing.id ? draft : item) : [...drafts, draft];
  await writeDrafts(next);
  return draft;
}

export async function submitQuoteRequest(id: string): Promise<QuoteRequest> {
  const draft = (await readDrafts()).find((item) => item.id === id);
  if (!draft) throw new Error('The local draft was not found. Reopen the request and try again.');
  const row = await serviceRequest<any>('/api/seller-hub/quote-requests', {
    method: 'POST',
    body: JSON.stringify({
      manufacturerId: draft.manufacturerId,
      type: draft.sampleRequired ? 'sample' : 'quote',
      productName: draft.productName,
      productType: draft.productionType ?? 'apparel',
      quantity: draft.quantity,
      colorways: draft.colorways.join(', '),
      details: draft.notes,
    }),
  });
  await writeDrafts((await readDrafts()).filter((item) => item.id !== id));
  return apiRowToQuoteRequest(row);
}

async function quoteRows(): Promise<any[]> {
  const rows = await serviceRequest<any[]>('/api/seller-hub/quote-requests');
  if (!Array.isArray(rows)) throw new Error('Quotes returned an invalid response.');
  return rows;
}

export async function getQuotes(): Promise<Quote[]> {
  return (await quoteRows()).map(apiRowToQuote).filter((item): item is Quote => item !== null);
}

export async function getQuote(id: string): Promise<Quote | undefined> {
  const row = await serviceRequest<any>(`/api/seller-hub/quote-requests/${encodeURIComponent(id)}`);
  return apiRowToQuote(row) ?? undefined;
}

export async function getQuotesForRequest(quoteRequestId: string): Promise<Quote[]> {
  const quote = await getQuote(quoteRequestId);
  return quote ? [quote] : [];
}

export async function acceptQuote(quoteId: string): Promise<Quote | undefined> {
  const row = await serviceRequest<any>(`/api/seller-hub/quote-requests/${encodeURIComponent(quoteId)}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'accepted' }),
  });
  return apiRowToQuote(row) ?? undefined;
}

export async function declineQuote(quoteId: string): Promise<void> {
  await serviceRequest(`/api/seller-hub/quote-requests/${encodeURIComponent(quoteId)}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'declined' }),
  });
}

export async function withdrawQuoteRequest(quoteId: string): Promise<void> {
  await serviceRequest(`/api/seller-hub/quote-requests/${encodeURIComponent(quoteId)}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }),
  });
}

export async function submitCounteroffer(
  quoteId: string,
  data: Omit<Counteroffer, 'id' | 'quoteId' | 'sellerId' | 'status' | 'createdAt'>,
): Promise<Counteroffer> {
  const row = await serviceRequest<any>(`/api/seller-hub/quote-requests/${encodeURIComponent(quoteId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'counteroffer_sent', counteroffer: data }),
  });
  return { id: row.id, quoteId, sellerId: row.sellerId ?? '', status: 'pending', ...data, createdAt: row.updatedAt ?? now() };
}

export async function getCounteroffersForQuote(quoteId: string): Promise<Counteroffer[]> {
  const row = await serviceRequest<any>(`/api/seller-hub/quote-requests/${encodeURIComponent(quoteId)}`);
  if (!row.counteroffer) return [];
  return [{
    id: row.id,
    quoteId,
    sellerId: row.sellerId ?? '',
    status: row.counteroffer.status ?? 'pending',
    desiredUnitPriceCents: row.counteroffer.desiredUnitPriceCents,
    desiredMoq: row.counteroffer.desiredMoq,
    desiredProductionDays: row.counteroffer.desiredProductionDays,
    desiredPaymentTerms: row.counteroffer.desiredPaymentTerms,
    notes: row.counteroffer.notes,
    createdAt: row.counteroffer.createdAt ?? row.updatedAt ?? row.createdAt,
  }];
}

export async function getManufacturerReviews(manufacturerId: string): Promise<ManufacturerReview[]> {
  assertCanonicalManufacturerId(manufacturerId);
  const rows = await serviceRequest<ManufacturerReview[]>(
    `/api/manufacturers/public/${encodeURIComponent(manufacturerId)}/reviews`,
  );
  if (!Array.isArray(rows)) throw new Error('Manufacturer reviews returned an invalid response.');
  return rows;
}

export async function submitManufacturerReview(
  manufacturerId: string,
  sampleOrderId: string,
  review: Omit<ManufacturerReview, 'id' | 'sellerId' | 'sellerName' | 'createdAt'>,
): Promise<ManufacturerReview> {
  assertCanonicalManufacturerId(manufacturerId);
  return serviceRequest<ManufacturerReview>(
    `/api/manufacturers/public/${encodeURIComponent(manufacturerId)}/reviews`,
    { method: 'POST', body: JSON.stringify({ sampleOrderId, ...review }) },
  );
}

export async function uploadSampleImage(sampleOrderId: string, contentType: string, bytes: Uint8Array): Promise<{ imageUrls: string[]; revision: number }> {
  const result = await serviceRequest<{ imageUrls: string[]; revision: number }>(`/api/sample-orders/${encodeURIComponent(sampleOrderId)}/images/upload`, {
    method: 'POST', headers: { 'Content-Type': contentType }, body: bytes as unknown as BodyInit,
  });
  return { imageUrls: result.imageUrls ?? [], revision: result.revision };
}

export async function getSampleImageUrls(sampleOrderId: string): Promise<string[]> {
  const result = await serviceRequest<{ imageUrls: string[] }>(`/api/sample-orders/${encodeURIComponent(sampleOrderId)}/images`);
  return result.imageUrls ?? [];
}

function mapSampleOrder(row: any, imageUris: string[] = []): Sample {
  const serverRevision = Number(row.revision);
  if (!Number.isInteger(serverRevision) || serverRevision < 1) {
    throw new Error('Sample order returned without a valid revision. Reload before making changes.');
  }
  let detail: { quoteId?: string; review?: SampleReview; revisions?: SampleRevision[] } = {};
  try { detail = JSON.parse(row.notes ?? '{}'); } catch { /* server may contain plain notes */ }
  const statusMap: Record<string, Sample['status']> = {
    payment_received: 'paid', processing: 'in_development', cut_and_sew: 'in_development', packing: 'in_development',
  };
  return {
    id: row.id, sellerId: row.sellerId ?? '', manufacturerId: row.manufacturerId ?? '',
    quoteId: detail.quoteId, productName: row.title ?? '', type: 'proto',
    status: statusMap[row.status] ?? row.status ?? 'requested',
    costCents: Number(row.priceCents ?? 0),
    paymentStatus: row.status === 'payment_received' ? 'paid' : 'pending',
    imageUris, fileIds: [], revisions: detail.revisions ?? [], review: detail.review,
    notes: row.description ?? undefined, createdAt: row.createdAt ?? now(), updatedAt: row.updatedAt ?? now(),
    threadId: row.threadId ?? undefined, orderType: row.orderType ?? 'sample',
    manufacturerName: row.manufacturerName ?? undefined, manufacturerCountry: row.manufacturerCountry ?? undefined,
    manufacturerPayoutReady: row.manufacturerPayoutReady === true, manufacturerHasStripe: row.manufacturerHasStripe === true,
    quantity: Number(row.quantity ?? 1), trackingNumber: row.trackingNumber ?? undefined, trackingCarrier: row.carrier ?? undefined,
    revision: serverRevision,
  };
}

export async function getSamples(): Promise<Sample[]> {
  const rows = await serviceRequest<any[]>('/api/sample-orders');
  if (!Array.isArray(rows)) throw new Error('Sample orders returned an invalid response.');
  return rows.map((row) => mapSampleOrder(row));
}

export async function getSample(id: string): Promise<Sample | undefined> {
  const row = await serviceRequest<any>(`/api/sample-orders/${encodeURIComponent(id)}`);
  if (!row?.id) return undefined;
  return mapSampleOrder(row, await getSampleImageUrls(id));
}

export async function createSample(data: {
  manufacturerId: string; quoteId?: string; productId?: string; productName: string; type?: Sample['type']; costCents: number;
}): Promise<Sample> {
  assertCanonicalManufacturerId(data.manufacturerId);
  const row = await serviceRequest<any>('/api/sample-orders', {
    method: 'POST',
    body: JSON.stringify({
      manufacturerId: data.manufacturerId, orderType: 'sample', title: data.productName,
      clientRequestId: localId(), quantity: 1, priceCents: Math.max(1, data.costCents), notes: JSON.stringify({ quoteId: data.quoteId }),
    }),
  });
  return mapSampleOrder(row);
}

export interface SampleCheckoutSession { sessionId: string; url: string | null; paymentStatus: string }
export interface BulkWalletOption { id: string; dropId: string; availableCents: number; eligible: boolean }

export async function createSampleCheckoutSession(id: string, returnUrl: string): Promise<SampleCheckoutSession> {
  return serviceRequest(`/api/sample-orders/${encodeURIComponent(id)}/checkout-session`, {
    method: 'POST', body: JSON.stringify({ returnUrl }),
  });
}

export async function confirmSamplePayment(id: string): Promise<Sample> {
  return mapSampleOrder(await serviceRequest(`/api/sample-orders/${encodeURIComponent(id)}/pay`, {
    method: 'POST', body: JSON.stringify({}),
  }));
}

export async function getBulkWalletOptions(id: string): Promise<{ requiredCents: number; wallets: BulkWalletOption[] }> {
  return serviceRequest(`/api/sample-orders/${encodeURIComponent(id)}/payment-options`);
}

export async function payBulkOrderFromWallet(id: string, walletId: string): Promise<ProductionOrder> {
  return mapBulkOrder(await serviceRequest(`/api/sample-orders/${encodeURIComponent(id)}/pay-from-wallet`, {
    method: 'POST', body: JSON.stringify({ walletId }),
  }));
}

export async function submitSampleReview(
  sampleId: string,
  expectedRevision: number,
  review: Omit<SampleReview, 'id' | 'sampleId' | 'sellerId' | 'createdAt'>,
): Promise<Sample | undefined> {
  const status = review.decision === 'approved' ? 'approved' : review.decision === 'rejected' ? 'rejected' : 'revision_requested';
  const row = await serviceRequest<any>(`/api/sample-orders/${encodeURIComponent(sampleId)}/sample-detail`, {
    method: 'PATCH', body: JSON.stringify({ status, expectedRevision, review }),
  });
  await submitManufacturerReview(row.manufacturerId, sampleId, {
    rating: review.overallRating,
    qualityRating: review.qualityRating || review.overallRating,
    communicationRating: review.fitRating || review.overallRating,
    deliveryRating: review.packagingRating || review.overallRating,
    comment: review.notes,
  });
  return mapSampleOrder(row);
}

export async function addSampleRevision(
  sampleId: string,
  expectedRevision: number,
  revision: Omit<SampleRevision, 'id' | 'sampleId' | 'sellerId' | 'status' | 'createdAt'>,
): Promise<Sample | undefined> {
  const row = await serviceRequest<any>(`/api/sample-orders/${encodeURIComponent(sampleId)}/sample-detail`, {
    method: 'PATCH', body: JSON.stringify({ status: 'revision_requested', expectedRevision, revision }),
  });
  return mapSampleOrder(row);
}

function mapBulkOrder(row: any): ProductionOrder {
  const serverRevision = Number(row.revision);
  if (!Number.isInteger(serverRevision) || serverRevision < 1) {
    throw new Error('Production order returned without a valid revision. Reload before making changes.');
  }
  const stageMap: Record<string, ProductionStageKey> = {
    pending_payment: 'deposit_pending', payment_received: 'deposit_paid', processing: 'materials_sourcing',
    cut_and_sew: 'sewing', packing: 'packaging', shipped: 'shipped', delivered: 'delivered',
  };
  const currentStage = stageMap[row.status] ?? 'quote_accepted';
  const currentIndex = PRODUCTION_STAGES.findIndex((stage) => stage.key === currentStage);
  return {
    id: row.id, sellerId: row.sellerId ?? '', manufacturerId: row.manufacturerId, quoteId: '',
    productName: row.title ?? '', status: row.status === 'delivered' ? 'completed' : row.status === 'pending_payment' ? 'pending' : 'active',
    quantity: Number(row.quantity ?? 1), variants: {}, totalCostCents: Number(row.priceCents ?? 0),
    depositAmountCents: row.status === 'pending_payment' ? 0 : Number(row.priceCents ?? 0),
    remainingBalanceCents: row.status === 'pending_payment' ? Number(row.priceCents ?? 0) : 0,
    currentStage, stages: PRODUCTION_STAGES.map((stage, index) => ({ ...stage, completedAt: index < currentIndex ? row.updatedAt : undefined })),
    updates: [], qcChecklist: [], issues: [], payments: [], fileIds: [],
    trackingNumber: row.trackingNumber ?? undefined, trackingCarrier: row.carrier ?? undefined,
    deliveredDate: row.deliveredAt ?? undefined, notes: row.description ?? undefined,
    createdAt: row.createdAt, updatedAt: row.updatedAt, revision: serverRevision, threadId: row.threadId,
    manufacturerName: row.manufacturerName, manufacturerPayoutReady: row.manufacturerPayoutReady === true,
    manufacturerHasStripe: row.manufacturerHasStripe === true, walletPaymentState: row.walletPaymentState ?? null,
  };
}

export async function getProductionOrders(): Promise<ProductionOrder[]> {
  const rows = await serviceRequest<any[]>('/api/sample-orders');
  if (!Array.isArray(rows)) throw new Error('Production orders returned an invalid response.');
  return rows.filter((row) => row.orderType === 'bulk').map(mapBulkOrder);
}

export async function getProductionOrder(id: string): Promise<ProductionOrder | undefined> {
  const row = await serviceRequest<any>(`/api/sample-orders/${encodeURIComponent(id)}`);
  return row?.id && row.orderType === 'bulk' ? mapBulkOrder(row) : undefined;
}

export async function getConversations(): Promise<ManufacturerConversation[]> {
  const rows = await serviceRequest<ManufacturerThread[]>('/api/manufacturers/threads');
  if (!Array.isArray(rows)) throw new Error('Manufacturer threads returned an invalid response.');
  return rows.map((row) => ({
    id: row.id, sellerId: '', manufacturerId: row.manufacturerId, manufacturerName: row.manufacturerName,
    contextLabel: row.subject, lastMessage: row.lastMessage ?? undefined, lastMessageAt: row.lastMessageAt,
    unreadCount: row.unreadCount, messages: [], createdAt: row.createdAt, updatedAt: row.lastMessageAt,
  }));
}

export async function getOrCreateConversation(manufacturerId: string, opts?: {
  productId?: string; quoteId?: string; sampleId?: string; productionId?: string; contextLabel?: string;
}): Promise<ManufacturerConversation> {
  assertCanonicalManufacturerId(manufacturerId);
  const row = await serviceRequest<any>('/api/manufacturers/threads', {
    method: 'POST', body: JSON.stringify({ manufacturerId, subject: opts?.contextLabel ?? 'General' }),
  });
  return {
    id: row.id, sellerId: row.buyerClerkId ?? '', manufacturerId: row.manufacturerId ?? manufacturerId,
    manufacturerName: row.manufacturerName ?? 'Manufacturer', contextLabel: row.subject ?? opts?.contextLabel ?? 'General',
    unreadCount: row.sellerUnreadCount ?? row.unreadCount ?? 0, messages: [], lastMessage: row.lastMessage,
    lastMessageAt: row.lastMessageAt, createdAt: row.createdAt, updatedAt: row.lastMessageAt ?? row.createdAt,
  };
}

export async function getHubStats(): Promise<{
  activeQuotes: number; quotesDueToExpire: number; samplesNeedingReview: number;
  activeProduction: number; productionIssues: number; unreadMessages: number;
}> {
  const [quotes, samples, orders, conversations] = await Promise.all([
    getQuotes(), getSamples(), getProductionOrders(), getConversations(),
  ]);
  return {
    activeQuotes: quotes.filter((quote) => !['declined', 'cancelled', 'accepted'].includes(quote.status)).length,
    quotesDueToExpire: quotes.filter((quote) => new Date(quote.validUntil).getTime() <= Date.now() + 7 * 86400000).length,
    samplesNeedingReview: samples.filter((sample) => ['review_needed', 'delivered'].includes(sample.status)).length,
    activeProduction: orders.filter((order) => order.status === 'active').length,
    productionIssues: orders.reduce((sum, order) => sum + order.issues.filter((issue) => issue.status === 'open').length, 0),
    unreadMessages: conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0),
  };
}