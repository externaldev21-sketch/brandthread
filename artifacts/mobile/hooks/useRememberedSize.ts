/**
 * Preselects the shopper's last size on a product page and remembers each
 * size they pick (less-AI pass, item 110; see lib/lastSize.ts). Never
 * overrides a size that is already selected (e.g. editing a bag item).
 */
import { useEffect, useRef } from 'react';
import type { BuyerProduct } from '@/services/cartTypes';
import { loadLastSize, pickRememberedSize, saveLastSize, sizeOptionOf } from '@/lib/lastSize';

export function useRememberedSize(
  product: BuyerProduct | null,
  selections: Record<string, string>,
  setSelections: (update: (prev: Record<string, string>) => Record<string, string>) => void,
) {
  const appliedFor = useRef<string | null>(null);

  // Preselect once per product, after it loads.
  useEffect(() => {
    if (!product || appliedFor.current === product.id) return;
    appliedFor.current = product.id;
    let cancelled = false;
    void loadLastSize().then((memory) => {
      if (cancelled) return;
      const pick = pickRememberedSize(product, memory);
      if (!pick) return;
      setSelections((prev) => (prev[pick.optionId] ? prev : { ...prev, [pick.optionId]: pick.valueId }));
    });
    return () => { cancelled = true; };
  }, [product, setSelections]);

  // Remember whichever size ends up selected.
  const sizeOption = product ? sizeOptionOf(product) : null;
  const selectedValueId = sizeOption ? selections[sizeOption.id] : undefined;
  useEffect(() => {
    if (!product || !sizeOption || !selectedValueId) return;
    const label = sizeOption.values.find((v) => v.id === selectedValueId)?.label;
    if (label) void saveLastSize(product.category, label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, selectedValueId]);
}
