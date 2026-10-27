/**
 * "Your manufacturers" on the Manufacturer Hub landing: one row per
 * manufacturer this seller already works with, folded together from every
 * place a working relationship shows up — saved/connected relationships,
 * message threads, quote requests and quotes, samples, and bulk orders.
 *
 * Pure so the folding and the one-line status are unit-tested
 * (tests/manufacturer-hub-summary.test.ts); the screen only fetches.
 */
import type {
  Manufacturer,
  ManufacturerConversation,
  ManufacturerRelationship,
  ProductionOrder,
  Quote,
  QuoteRequest,
  Sample,
} from '@/services/manufacturerTypes';

export interface MyManufacturerRow {
  manufacturerId: string;
  name: string;
  photo?: string;
  /** e.g. "Quote received · 2 samples" — or where they are, when nothing is open. */
  statusLine: string;
  /** Something is waiting on the seller (a quote to answer, a payment, unread messages). */
  needsAttention: boolean;
  lastActivityAt: string;
}

export interface MyManufacturerSources {
  relationships?: ManufacturerRelationship[];
  conversations?: ManufacturerConversation[];
  quoteRequests?: QuoteRequest[];
  quotes?: Quote[];
  samples?: Sample[];
  orders?: ProductionOrder[];
  /** Directory profiles, for names/photos the other sources don't carry. */
  profiles?: Manufacturer[];
}

// Requests the manufacturer still has to answer.
const PENDING_REQUEST: ReadonlySet<QuoteRequest['status']> = new Set(['sent', 'viewed', 'questions_asked', 'counteroffer_sent']);
const CLOSED_SAMPLE: ReadonlySet<Sample['status']> = new Set(['delivered', 'approved', 'rejected', 'cancelled']);
const OPEN_ORDER: ReadonlySet<ProductionOrder['status']> = new Set(['pending', 'active', 'on_hold']);

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function later(a: string | undefined, b: string | undefined): string {
  if (!a) return b ?? '';
  if (!b) return a;
  return a > b ? a : b;
}

interface Tally {
  manufacturerId: string;
  name?: string;
  photo?: string;
  location?: string;
  pendingRequests: number;
  quotesReceived: number;
  openSamples: number;
  samplesToReview: number;
  openOrders: number;
  awaitingPayment: number;
  unread: number;
  lastActivityAt: string;
}

export function buildMyManufacturers(sources: MyManufacturerSources): MyManufacturerRow[] {
  const byId = new Map<string, Tally>();
  const tally = (manufacturerId: string | undefined, at?: string): Tally | undefined => {
    if (!manufacturerId) return undefined;
    let entry = byId.get(manufacturerId);
    if (!entry) {
      entry = {
        manufacturerId, pendingRequests: 0, quotesReceived: 0, openSamples: 0, samplesToReview: 0,
        openOrders: 0, awaitingPayment: 0, unread: 0, lastActivityAt: '',
      };
      byId.set(manufacturerId, entry);
    }
    entry.lastActivityAt = later(entry.lastActivityAt, at);
    return entry;
  };

  for (const rel of sources.relationships ?? []) {
    if (rel.status === 'archived') continue;
    const entry = tally(rel.manufacturerId, later(rel.lastMessageAt, rel.updatedAt || rel.createdAt))!;
    if (rel.manufacturer) {
      entry.name = rel.manufacturer.businessName;
      entry.photo = rel.manufacturer.photo ?? undefined;
      entry.location = [rel.manufacturer.city, rel.manufacturer.country].filter(Boolean).join(', ');
    }
    entry.unread = Math.max(entry.unread, rel.unreadCount ?? 0);
    entry.awaitingPayment = Math.max(entry.awaitingPayment, rel.awaitingPayment ?? 0);
    entry.openOrders = Math.max(entry.openOrders, rel.activeOrders ?? 0);
  }

  for (const conv of sources.conversations ?? []) {
    const entry = tally(conv.manufacturerId, conv.lastMessageAt ?? conv.createdAt);
    if (!entry) continue;
    entry.name ??= conv.manufacturerName;
    entry.unread = Math.max(entry.unread, conv.unreadCount ?? 0);
  }

  // A request that already has a quote back counts once, as "Quote received".
  const quotedRequestIds = new Set<string>();
  for (const quote of sources.quotes ?? []) {
    if (quote.status !== 'quote_received') continue;
    quotedRequestIds.add(quote.quoteRequestId);
    const entry = tally(quote.manufacturerId, quote.receivedAt);
    if (entry) entry.quotesReceived += 1;
  }
  for (const req of sources.quoteRequests ?? []) {
    if (req.isDraft || req.status === 'draft' || quotedRequestIds.has(req.id)) continue;
    const entry = tally(req.manufacturerId, req.updatedAt);
    if (!entry) continue;
    if (req.status === 'quote_received') entry.quotesReceived += 1;
    else if (PENDING_REQUEST.has(req.status)) entry.pendingRequests += 1;
  }

  // Bulk orders come back from the same endpoint as samples; count each once.
  const orderIds = new Set((sources.orders ?? []).map((order) => order.id));
  for (const sample of sources.samples ?? []) {
    if (orderIds.has(sample.id) || sample.orderType === 'bulk') continue;
    const entry = tally(sample.manufacturerId, sample.updatedAt);
    if (!entry) continue;
    entry.name ??= sample.manufacturerName;
    if (CLOSED_SAMPLE.has(sample.status)) continue;
    entry.openSamples += 1;
    if (sample.status === 'review_needed') entry.samplesToReview += 1;
  }

  for (const order of sources.orders ?? []) {
    if (!OPEN_ORDER.has(order.status)) continue;
    const entry = tally(order.manufacturerId, order.updatedAt);
    if (!entry) continue;
    entry.name ??= order.manufacturerName;
  }
  // Relationship counts are the server's own tally; fall back to counting.
  const openOrderCounts = new Map<string, number>();
  for (const order of sources.orders ?? []) {
    if (OPEN_ORDER.has(order.status)) openOrderCounts.set(order.manufacturerId, (openOrderCounts.get(order.manufacturerId) ?? 0) + 1);
  }
  for (const [id, count] of openOrderCounts) {
    const entry = byId.get(id);
    if (entry) entry.openOrders = Math.max(entry.openOrders, count);
  }

  const profiles = new Map((sources.profiles ?? []).map((profile) => [profile.id, profile]));
  const rows: MyManufacturerRow[] = [];
  for (const entry of byId.values()) {
    const profile = profiles.get(entry.manufacturerId);
    const name = entry.name || profile?.name;
    if (!name) continue;
    const location = entry.location || (profile ? [profile.city, profile.country].filter(Boolean).join(', ') : '');
    const parts = [
      entry.quotesReceived ? (entry.quotesReceived === 1 ? 'Quote received' : `${entry.quotesReceived} quotes received`) : null,
      entry.pendingRequests ? (entry.pendingRequests === 1 ? 'Quote pending' : `${entry.pendingRequests} quotes pending`) : null,
      entry.awaitingPayment ? 'Payment due' : null,
      entry.samplesToReview ? (entry.samplesToReview === 1 ? 'Sample to review' : `${entry.samplesToReview} samples to review`) : null,
      entry.openSamples - entry.samplesToReview > 0 ? plural(entry.openSamples - entry.samplesToReview, 'sample') : null,
      entry.openOrders ? plural(entry.openOrders, 'active order') : null,
      entry.unread ? `${entry.unread} unread` : null,
    ].filter((part): part is string => !!part);
    rows.push({
      manufacturerId: entry.manufacturerId,
      name,
      photo: entry.photo || profile?.profileImageUri,
      // Three facts at most keeps it to one line at 390pt.
      statusLine: parts.slice(0, 3).join(' · ') || location || 'No open work',
      needsAttention: entry.quotesReceived > 0 || entry.awaitingPayment > 0 || entry.samplesToReview > 0 || entry.unread > 0,
      lastActivityAt: entry.lastActivityAt,
    });
  }

  // Waiting on the seller first, then most recent.
  return rows.sort((a, b) =>
    Number(b.needsAttention) - Number(a.needsAttention)
    || b.lastActivityAt.localeCompare(a.lastActivityAt)
    || a.name.localeCompare(b.name));
}
