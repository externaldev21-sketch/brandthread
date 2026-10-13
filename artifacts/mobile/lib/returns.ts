/**
 * Buyer return requests (item 108): pure helpers shared by the request
 * form (app/buyer-return-request.tsx), the status screen both sides open
 * (app/return-detail.tsx), and the buyer / seller order screens.
 *
 * The server's vocabulary is the only one used here (routes/returns.ts,
 * returns.status): pending → approved → refunded, or pending → denied.
 * "approved" means the seller approved but the refund was not confirmed
 * yet; approving again retries the same refund.
 */
import { RETURN_REASON_OPTIONS } from '@/services/cartTypes';
import { refundExpectedLabel } from '@/lib/refundEta';
import { parseDecimalToCents } from '@/lib/money';

export type ReturnStatusKey = 'pending' | 'approved' | 'denied' | 'refunded';
export type ReturnViewer = 'buyer' | 'seller';

/** How a refund is paid back (items 113/114). */
export type RefundMethodKey = 'original' | 'thread_cash' | 'store_credit';

/** returns.resolutionRequested → the refund method approval pays out. */
export function refundMethodForResolution(resolution: unknown): RefundMethodKey {
  if (resolution === 'thread_cash') return 'thread_cash';
  if (resolution === 'store_credit') return 'store_credit';
  return 'original';
}

/** The refund method → the resolution a return request sends. */
export function resolutionForRefundMethod(method: RefundMethodKey): 'refund' | 'thread_cash' | 'store_credit' {
  return method === 'original' ? 'refund' : method;
}

/** Where the money goes, phrased for who is reading. */
export function refundDestination(
  method: RefundMethodKey,
  viewer: ReturnViewer,
  names: { buyerName: string; sellerName: string },
): string {
  if (method === 'thread_cash') return viewer === 'seller' ? `${names.buyerName}’s Thread Cash` : 'your Thread Cash';
  if (method === 'store_credit') return viewer === 'seller' ? 'store credit at your store' : `store credit at ${names.sellerName}`;
  return viewer === 'seller' ? `${names.buyerName}’s original payment` : 'your original payment';
}

export interface ReturnItem {
  lineItemId: string;
  productName: string;
  variantTitle: string;
  quantity: number;
  unitPriceCents: number;
}

export interface ReturnView {
  id: string;
  orderId: string;
  orderNumber: string;
  buyerId: string;
  sellerId: string;
  buyerName: string;
  sellerName: string;
  status: ReturnStatusKey;
  reason: string;
  notes: string;
  evidenceUrls: string[];
  items: ReturnItem[];
  refundAmountCents: number | null;
  /** What the buyer asked for, or — once refunded — how it was actually paid. */
  refundMethod: RefundMethodKey;
  orderTotalCents: number;
  sellerResponse: string | null;
  createdAt: string;
  updatedAt: string;
  /** Prepaid return label (migration 241); null until the seller buys one. */
  returnLabelUrl?: string | null;
  returnCarrier?: string | null;
  returnTrackingNumber?: string | null;
  /** Approved; wait for the first carrier scan before refunding. */
  refundOnScan?: boolean;
}

const STATUSES: ReturnStatusKey[] = ['pending', 'approved', 'denied', 'refunded'];

/** A GET /api/returns(/:id|/buyer) row → the screens' shape. */
export function adaptReturnRow(row: any): ReturnView {
  const status = STATUSES.includes(row?.status) ? row.status as ReturnStatusKey : 'pending';
  const items = Array.isArray(row?.requestedItems) ? row.requestedItems : [];
  return {
    id: String(row?.id ?? ''),
    orderId: String(row?.orderId ?? ''),
    orderNumber: String(row?.orderNumber ?? ''),
    buyerId: String(row?.buyerId ?? ''),
    sellerId: String(row?.sellerId ?? ''),
    buyerName: row?.buyerName || 'Buyer',
    sellerName: row?.sellerName || 'Seller',
    status,
    reason: String(row?.reason ?? 'other'),
    notes: typeof row?.notes === 'string' ? row.notes : '',
    evidenceUrls: Array.isArray(row?.evidenceUrls) ? row.evidenceUrls.filter((u: unknown) => typeof u === 'string') : [],
    items: items.map((item: any, index: number) => ({
      lineItemId: String(item?.lineItemId ?? index),
      productName: item?.productName ?? 'Item',
      variantTitle: item?.variantTitle ?? '',
      quantity: Number(item?.quantity ?? 1) || 1,
      unitPriceCents: Number(item?.unitPriceCents ?? 0) || 0,
    })),
    refundAmountCents: typeof row?.refundAmountCents === 'number' ? row.refundAmountCents : null,
    refundMethod: refundMethodForResolution(row?.refundMethod === 'original' ? 'refund' : (row?.refundMethod ?? row?.resolutionRequested)),
    orderTotalCents: Number(row?.totalCents ?? 0) || 0,
    sellerResponse: row?.sellerResponse ?? null,
    createdAt: row?.createdAt ?? new Date(0).toISOString(),
    updatedAt: row?.updatedAt ?? row?.createdAt ?? new Date(0).toISOString(),
    refundOnScan: row?.refundOnScan === true,
    returnLabelUrl: typeof row?.returnLabelUrl === 'string' && row.returnLabelUrl ? row.returnLabelUrl : null,
    returnCarrier: typeof row?.returnCarrier === 'string' && row.returnCarrier ? row.returnCarrier : null,
    returnTrackingNumber: typeof row?.returnTrackingNumber === 'string' && row.returnTrackingNumber ? row.returnTrackingNumber : null,
  };
}

/**
 * The seller's refund amount field: "24.99" → 2499. Must be more than $0 and
 * no more than what the order can refund.
 */
export function parseRefundAmount(text: string, maxCents: number): { cents: number } | { error: string } {
  const cents = parseDecimalToCents(text.replace(/^\$/, ''));
  if (cents == null || cents <= 0) return { error: 'Enter an amount, like 24.99.' };
  if (maxCents > 0 && cents > maxCents) return { error: 'That’s more than this order can refund.' };
  return { cents };
}

/**
 * The server's error text from an ApiError body. Routes answer either
 * `{ error: "…" }` or `{ error: { message, code } }`; anything else → fallback.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const raw = (err as { body?: unknown } | null)?.body;
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    const error = JSON.parse(raw)?.error;
    if (typeof error === 'string' && error.trim()) return error;
    if (error && typeof error.message === 'string' && error.message.trim()) return error.message;
  } catch { /* not JSON */ }
  return fallback;
}

/**
 * Toast after a one-tap approve from the returns list. The server answers
 * "refunded" once the refund went through; "approved" means it was approved
 * but the refund didn't confirm (open the return to retry).
 */
export function quickApproveMessage(response: any, money: (cents: number) => string): string {
  if (response?.status === 'refunded') {
    return typeof response.refundAmountCents === 'number' ? `Refunded ${money(response.refundAmountCents)}` : 'Refunded';
  }
  return 'Approved. Open the return to retry the refund.';
}

export function returnReasonLabel(key: string): string {
  return RETURN_REASON_OPTIONS.find(option => option.key === key)?.label ?? key.replace(/_/g, ' ');
}

export function itemsTotalCents(items: Pick<ReturnItem, 'quantity' | 'unitPriceCents'>[]): number {
  return items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
}

/**
 * Buyers can start a return once the order is delivered (the order screen's
 * existing rule; the server also accepts shipped orders, so this is never
 * looser than it).
 */
export function isReturnEligible(orderStatus: string | undefined): boolean {
  return orderStatus === 'delivered';
}

/**
 * On its way but not delivered yet (not arrived, damaged in transit, seller
 * gone quiet): the buyer can ask for a refund without returning anything.
 * The server takes requests for shipped / fulfilled / delivered orders;
 * delivered ones go through the return flow instead.
 */
export function isRefundEligible(orderStatus: string | undefined): boolean {
  return orderStatus === 'shipped' || orderStatus === 'fulfilled';
}

/** An active request blocks a new one (the server answers 409); a declined one doesn't. */
export function activeReturnFor<T extends { orderId?: string; status?: string }>(rows: T[], orderId: string): T | null {
  return rows.find(row => row.orderId === orderId && row.status !== 'denied') ?? null;
}

export function statusLabel(status: ReturnStatusKey): string {
  switch (status) {
    case 'pending': return 'Requested';
    case 'approved': return 'Approved';
    case 'refunded': return 'Refunded';
    case 'denied': return 'Declined';
  }
}

/** The status screen's headline for each side. */
export function returnHeadline(view: Pick<ReturnView, 'status' | 'buyerName' | 'sellerName' | 'refundAmountCents' | 'sellerResponse' | 'orderNumber'> & { updatedAt?: string; refundMethod?: RefundMethodKey; refundOnScan?: boolean }, viewer: ReturnViewer, money: (cents: number) => string): { title: string; body: string } {
  const amount = view.refundAmountCents != null ? money(view.refundAmountCents) : null;
  if (view.status === 'approved' && view.refundOnScan) {
    return viewer === 'buyer'
      ? { title: 'Return approved', body: 'Send it back with the prepaid label. Your refund is issued as soon as the carrier scans it.' }
      : { title: 'Approved, refund on first scan', body: `${amount ? `The refund of ${amount}` : 'The refund'} is issued when the carrier first scans ${view.buyerName}’s parcel.` };
  }
  switch (view.status) {
    case 'pending':
      return viewer === 'buyer'
        ? { title: `Waiting for ${view.sellerName}`, body: 'Sellers usually reply within 1–3 business days. Don’t ship anything until your return is approved.' }
        : { title: 'Review this return', body: `${view.buyerName} is asking for a refund on order #${view.orderNumber}. Approve to refund them, or decline with a reason.` };
    case 'approved':
      return viewer === 'buyer'
        ? { title: 'Return approved', body: 'Your refund is being processed. We’ll let you know as soon as it’s issued.' }
        : { title: 'Approved, refund not issued yet', body: 'The refund didn’t go through. Try it again. The buyer is never refunded twice.' };
    case 'refunded': {
      const title = amount ? `Refunded ${amount}` : 'Refunded';
      if (view.refundMethod === 'thread_cash') {
        return viewer === 'buyer'
          ? { title, body: 'Added to your Thread Cash. Spend it on your next order.' }
          : { title, body: `Refunded to ${view.buyerName}’s Thread Cash.` };
      }
      if (view.refundMethod === 'store_credit') {
        return viewer === 'buyer'
          ? { title, body: `Added to your gift cards as ${view.sellerName} store credit. We emailed you the code.` }
          : { title, body: `Refunded as store credit at your store. ${view.buyerName} got a gift card by email.` };
      }
      return viewer === 'buyer'
        ? { title, body: `Back to your original payment method. ${refundExpectedLabel(view.updatedAt) ?? 'It can take 5–10 business days to appear'}.` }
        : { title: amount ? `Refunded ${amount}` : 'Refunded', body: `Refunded to ${view.buyerName}’s original payment method.` };
    }
    case 'denied':
      return viewer === 'buyer'
        ? { title: 'Return declined', body: view.sellerResponse ? `${view.sellerName}: “${view.sellerResponse}”` : `${view.sellerName} declined this return. Message them if you have questions.` }
        : { title: 'Return declined', body: view.sellerResponse ? `You told the buyer: “${view.sellerResponse}”` : 'You declined this return.' };
  }
}

export type ReturnStepState = 'done' | 'current' | 'upcoming';

/** Klarna / Shopee-style vertical steps, from real status + timestamps only. */
export function returnSteps(view: Pick<ReturnView, 'status' | 'createdAt' | 'updatedAt'> & Partial<Pick<ReturnView, 'refundMethod' | 'buyerName' | 'sellerName'>>, viewer: ReturnViewer = 'buyer'): { key: string; label: string; state: ReturnStepState; at?: string }[] {
  const requested = { key: 'requested', label: 'Return requested', state: 'done' as ReturnStepState, at: view.createdAt };
  if (view.status === 'denied') {
    return [requested, { key: 'declined', label: 'Declined by the seller', state: 'current', at: view.updatedAt }];
  }
  if (view.status === 'refunded') {
    // Vinted's refund progress: the last step is the date the money is due.
    const expected = viewer === 'buyer' ? refundExpectedLabel(view.updatedAt) : null;
    return [
      requested,
      { key: 'review', label: 'Approved by the seller', state: 'done' },
      { key: 'refund', label: 'Refund issued', state: 'current', at: view.updatedAt },
      ...(expected ? [{ key: 'arrives', label: `${expected} on your statement`, state: 'upcoming' as ReturnStepState }] : []),
    ];
  }
  if (view.status === 'approved') {
    return [
      requested,
      { key: 'review', label: 'Approved by the seller', state: 'done', at: view.updatedAt },
      { key: 'refund', label: 'Refund processing', state: 'current' },
    ];
  }
  return [
    requested,
    { key: 'review', label: viewer === 'seller' ? 'You review the request' : 'Seller reviews your request', state: 'current' },
    {
      key: 'refund',
      label: (view.refundMethod ?? 'original') === 'original'
        ? (viewer === 'seller' ? 'Refund to the buyer’s original payment' : 'Refund to your original payment')
        : `Refund to ${refundDestination(view.refundMethod!, viewer, { buyerName: view.buyerName ?? 'the buyer', sellerName: view.sellerName ?? 'the seller' })}`,
      state: 'upcoming',
    },
  ];
}

/** Buyer-facing copy for a failed POST /api/returns. */
export function returnSubmitError(error: unknown): { message: string; alreadyExists: boolean } {
  const status = (error as { status?: number } | null)?.status;
  if (status === 409) return { message: 'You already have an open return for this order.', alreadyExists: true };
  if (status === 400) {
    const raw = (error as { body?: string; message?: string } | null)?.body ?? '';
    let serverMessage = '';
    try { serverMessage = JSON.parse(raw)?.error ?? ''; } catch { serverMessage = ''; }
    return { message: serverMessage || 'This order can’t be returned right now.', alreadyExists: false };
  }
  return { message: 'Couldn’t send your request. Check your connection and try again.', alreadyExists: false };
}
