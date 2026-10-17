/**
 * The signed-in buyer's return requests (item 108), for My Orders' Returns
 * tab. Reads GET /api/returns/buyer, the same endpoint the order screen and
 * the return request form use, and adapts rows with lib/returns.ts so every
 * screen speaks the server's statuses. A failed request throws; the screen
 * shows an error with retry rather than an empty "no returns" state.
 */
import { serviceRequest } from '@/lib/serviceConfig';
import { adaptReturnRow, type ReturnView } from '@/lib/returns';

export async function getBuyerReturns(): Promise<ReturnView[]> {
  const rows = await serviceRequest('/api/returns/buyer') as unknown;
  if (!Array.isArray(rows)) throw new Error('Unexpected buyer returns response');
  return rows.map(adaptReturnRow).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
