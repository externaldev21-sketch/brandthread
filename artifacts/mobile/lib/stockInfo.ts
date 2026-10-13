/**
 * Public stock-info for the product page (GET /api/catalog-public/products/
 * :id/stock-info, no auth). One request per product: <StockCounter> and the
 * selected size's stock line both read it through useStockInfo, so the two
 * never disagree and the page never stacks two stock lines.
 */
import { useEffect, useState } from 'react';
import { API_BASE_URL } from './api';
import type { StockInfo } from './stockLine';

export { stockCounterText, variantStockLine, DEFAULT_LOW_STOCK_THRESHOLD, type StockInfo } from './stockLine';

const TTL_MS = 10_000;
const cache = new Map<string, { at: number; promise: Promise<StockInfo | null> }>();

export function fetchStockInfo(productId: string): Promise<StockInfo | null> {
  const hit = cache.get(productId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = fetch(`${API_BASE_URL}/api/catalog-public/products/${encodeURIComponent(productId)}/stock-info`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => (data && typeof data.soldOut === 'boolean' ? (data as StockInfo) : null))
    .catch(() => null);
  cache.set(productId, { at: Date.now(), promise });
  return promise;
}

export function useStockInfo(productId?: string | null): StockInfo | null {
  const [info, setInfo] = useState<StockInfo | null>(null);
  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    setInfo(null);
    void fetchStockInfo(productId).then((data) => { if (!cancelled) setInfo(data); });
    return () => { cancelled = true; };
  }, [productId]);
  return info;
}
