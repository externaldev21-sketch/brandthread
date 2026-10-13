/**
 * useAutoSelectSize — preselects the buyer's saved size once per product
 * (rules in lib/autoSelectSize.ts). Shared by the product page and the
 * buy-now VariantPickerSheet.
 */
import { useEffect, useRef } from 'react';
import { useBuyerPreferences } from '@/hooks/useBuyerPreferences';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { pickAutoSelectSize, type AutoSizeProduct } from '@/lib/autoSelectSize';
import type { SizeBadgeModel } from '@/lib/sizeBadge';
import { DEMO_PREFERENCES } from '@/components/SizeRecommendationBadge';

export function useAutoSelectSize({ product, selections, badgeModel, enabled = true, onSelect }: {
  product: (AutoSizeProduct & { id: string }) | null | undefined;
  selections: Record<string, string>;
  badgeModel: SizeBadgeModel | null;
  /** false while another preselect owns the size (cart edit). */
  enabled?: boolean;
  onSelect: (optionId: string, valueId: string) => void;
}) {
  const { preferences, status } = useBuyerPreferences();
  const appliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!product || !enabled || appliedFor.current === product.id) return;
    // Wait for the saved sizes; the decision is made exactly once per product.
    if (status === 'loading') return;
    appliedFor.current = product.id;
    const prefs = status === 'signed-out' && isPreviewDemoMode() ? DEMO_PREFERENCES : preferences;
    const pick = pickAutoSelectSize({ product, selections, badgeModel, preferences: prefs });
    if (pick) onSelect(pick.optionId, pick.valueId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, enabled, status, badgeModel]);
}
