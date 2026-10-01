/**
 * Long-press a product review to report it: opens the shared ReportSheet
 * directly (no intermediate menu, no visible button added to the review card).
 */
import { useCallback } from 'react';
import { useAuth } from '@clerk/expo';
import { useReportSheet } from '@/components/safety/ReportSheet';

export interface ReviewActionTarget {
  id: string;
  buyerId?: string | null;
  buyerName?: string | null;
}

export function useReviewActions(enabled = true): (review: ReviewActionTarget) => void {
  const { openReport } = useReportSheet();
  const { userId } = useAuth();

  return useCallback((review: ReviewActionTarget) => {
    if (!enabled || !review.id) return;
    const ownerId = review.buyerId || undefined;
    if (ownerId && ownerId === userId) return;
    const ownerName = review.buyerName || 'this reviewer';
    openReport({
      targetType: 'review',
      targetId: review.id,
      label: `${ownerName}’s review`,
      ownerId,
      ownerName,
    });
  }, [enabled, openReport, userId]);
}
