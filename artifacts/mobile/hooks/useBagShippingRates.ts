/**
 * Loads each bag brand's shipping for its current subtotal from the same
 * seller-rate source checkout uses (cartService.fetchShippingRateDetails),
 * so the bag's per-brand lines match what checkout will charge.
 *
 * A failed or missing rate stays unknown (no line, no guessed number).
 * Results are cached per seller + subtotal for the life of the screen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchShippingRateDetails } from '@/services/cartService';
import { shippingRateKey, type BagShippingRates } from '@/lib/cart/bagShipping';

type Entry = number | 'error';

export function useBagShippingRates(
  groups: readonly { sellerId: string; subtotalCents: number }[],
): BagShippingRates {
  const cache = useRef(new Map<string, Entry>());
  const inFlight = useRef(new Set<string>());
  const [version, setVersion] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const keys = groups.map(g => shippingRateKey(g.sellerId, g.subtotalCents));
  const signature = keys.join('|');

  useEffect(() => {
    for (const group of groups) {
      const key = shippingRateKey(group.sellerId, group.subtotalCents);
      if (cache.current.has(key) || inFlight.current.has(key)) continue;
      inFlight.current.add(key);
      fetchShippingRateDetails(group.sellerId, group.subtotalCents)
        .then(rate => { cache.current.set(key, rate.amountCents); })
        .catch(() => { cache.current.set(key, 'error'); })
        .finally(() => {
          inFlight.current.delete(key);
          if (mounted.current) setVersion(v => v + 1);
        });
    }
    // signature covers every seller + subtotal in `groups`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return useMemo(() => {
    const rates: BagShippingRates = {};
    for (const group of groups) {
      const entry = cache.current.get(shippingRateKey(group.sellerId, group.subtotalCents));
      rates[group.sellerId] = typeof entry === 'number' ? entry : undefined;
    }
    return rates;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, version]);
}
