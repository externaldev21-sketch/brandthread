/**
 * useSubscriptionPlan — fetches and caches the current seller's plan level.
 *
 * The result is cached at module level so the API is only hit once per app
 * session (subsequent calls on different screens reuse the same promise).
 * Call invalidatePlanCache() after a successful subscription change.
 */

import { useState, useEffect } from 'react';
import { useApi } from '@/lib/api';

export type PlanId = 'starter' | 'growth' | 'pro';

// Module-level cache so the fetch is shared across all hook instances.
let _cache: PlanId | null = null;
let _promise: Promise<PlanId> | null = null;

export function invalidatePlanCache() {
  _cache = null;
  _promise = null;
}

export function useSubscriptionPlan() {
  const api = useApi();
  const [plan, setPlan] = useState<PlanId | null>(_cache);
  const [loading, setLoading] = useState(_cache === null);

  useEffect(() => {
    if (_cache !== null) {
      setPlan(_cache);
      setLoading(false);
      return;
    }

    if (!_promise) {
      _promise = api.seller.subscription
        .status()
        .then((data: any) => {
          const p: PlanId =
            data.plan === 'growth' ? 'growth'
            : data.plan === 'pro'  ? 'pro'
            : 'starter';
          _cache = p;
          return p;
        })
        .catch(() => {
          // Default to starter if the call fails
          _cache = 'starter';
          _promise = null; // allow retry next mount
          return 'starter' as PlanId;
        });
    }

    _promise.then((p) => {
      setPlan(p);
      setLoading(false);
    });
  }, []);

  /** True if the user's plan meets or exceeds `minPlan`. */
  function hasPlan(minPlan: PlanId): boolean {
    const order: Record<PlanId, number> = { starter: 0, growth: 1, pro: 2 };
    return (order[plan ?? 'starter'] ?? 0) >= (order[minPlan] ?? 1);
  }

  return { plan: plan ?? 'starter', loading, hasPlan };
}
