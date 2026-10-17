/**
 * Seller Orders bulk actions + CSV export helpers (pure, unit-tested).
 *
 * Bulk actions call the existing per-order endpoints for each selected
 * order and report partial failures honestly instead of a blanket
 * success/failure.
 */
import { buildCsv, type CsvCell } from '@/lib/csvExport';

export interface BulkFailure { id: string; label: string; message: string }
export interface BulkResult { succeeded: string[]; failed: BulkFailure[] }

export async function runBulk(
  ids: string[],
  fn: (id: string) => Promise<unknown>,
  opts: { label?: (id: string) => string; errorMessage?: (e: unknown) => string; concurrency?: number } = {},
): Promise<BulkResult> {
  const label = opts.label ?? ((id: string) => id);
  const errorMessage = opts.errorMessage ?? ((e: unknown) => (e instanceof Error ? e.message : 'Request failed'));
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const succeeded: string[] = [];
  const failed: BulkFailure[] = [];
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        await fn(id);
        succeeded.push(id);
      } catch (e) {
        failed.push({ id, label: label(id), message: errorMessage(e) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  // Keep the caller's order for stable messages.
  const pos = new Map(ids.map((id, i) => [id, i]));
  succeeded.sort((a, b) => pos.get(a)! - pos.get(b)!);
  failed.sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
  return { succeeded, failed };
}

/** Alert title + body for a bulk run, or null when everything succeeded. */
export function summarizeBulk(result: BulkResult, actionLabel: string): { title: string; message: string } | null {
  if (result.failed.length === 0) return null;
  const total = result.succeeded.length + result.failed.length;
  const lines = result.failed.slice(0, 5).map(f => `• ${f.label}: ${f.message}`);
  if (result.failed.length > 5) lines.push(`…and ${result.failed.length - 5} more`);
  return {
    title: result.succeeded.length === 0 ? `Couldn't ${actionLabel}` : `${result.succeeded.length} of ${total} updated`,
    message: lines.join('\n'),
  };
}

export interface ExportableOrder {
  id: string;
  orderNumber?: string | null;
  createdAt: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus?: string | null;
  customer?: { name?: string | null; email?: string | null } | null;
  payment: { totalCents: number };
  listItemCount?: number;
  lineItems: unknown[];
  shipments?: Array<{ carrier?: string | null; trackingNumber?: string | null }>;
}

/** Orders to export: only the selected ones when a selection exists. */
export function ordersForExport<T extends { id: string }>(orders: T[], selectedIds: string[]): T[] {
  if (selectedIds.length === 0) return orders;
  const set = new Set(selectedIds);
  return orders.filter(o => set.has(o.id));
}

export function ordersToCsv(orders: ExportableOrder[], formatMoney: (cents: number) => string): string {
  const rows: CsvCell[][] = orders.map(o => [
    o.orderNumber ?? o.id.slice(0, 8),
    o.customer?.name || o.customer?.email || 'Unknown',
    o.customer?.email ?? '',
    new Date(o.createdAt).toLocaleDateString('en-US'),
    o.status,
    o.paymentStatus,
    o.fulfillmentStatus ?? 'unfulfilled',
    o.listItemCount ?? o.lineItems.length,
    formatMoney(o.payment.totalCents),
    o.shipments?.[0]?.carrier ?? '',
    o.shipments?.[0]?.trackingNumber ?? '',
  ]);
  return buildCsv(
    ['Order #', 'Customer', 'Email', 'Date', 'Status', 'Payment', 'Fulfillment', 'Items', 'Total', 'Carrier', 'Tracking'],
    rows,
  );
}
