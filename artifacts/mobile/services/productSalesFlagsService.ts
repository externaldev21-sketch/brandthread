import { serviceRequest } from '@/lib/serviceConfig';
import { parseSalesFlags, type SalesFlagMap } from '@/lib/productSalesFlags';

/** GET /api/products/sales-flags — only flagged products are returned. */
export async function getProductSalesFlags(): Promise<SalesFlagMap> {
  return parseSalesFlags(await serviceRequest<unknown>('/api/products/sales-flags', {}, false));
}
