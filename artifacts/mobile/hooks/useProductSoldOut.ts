/**
 * `true` once the public stock-info endpoint reports `productId` sold out;
 * `false` while in stock, unknown, or not yet asked. Only fetches while
 * `enabled` (the feed passes the active cell and its neighbours), and each
 * product is fetched at most once per session — see lib/productStockInfo.ts.
 */
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { createSoldOutLookup } from '@/lib/productStockInfo';

const lookup = createSoldOutLookup((productId) => (
  fetch(`${API_BASE_URL}/api/catalog-public/products/${encodeURIComponent(productId)}/stock-info`)
    .then((r) => (r.ok ? r.json() : null))
));

export function useProductSoldOut(productId: string | undefined, enabled: boolean): boolean {
  const [state, setState] = useState<{ productId?: string; soldOut: boolean }>({ soldOut: false });
  useEffect(() => {
    if (!productId || !enabled) return undefined;
    let active = true;
    void lookup.get(productId).then((value) => { if (active) setState({ productId, soldOut: value === true }); });
    return () => { active = false; };
  }, [productId, enabled]);
  // Keeps the last answer when the cell scrolls out of range (no flicker
  // back to the price); a different product never inherits it.
  return state.productId === productId && state.soldOut;
}
