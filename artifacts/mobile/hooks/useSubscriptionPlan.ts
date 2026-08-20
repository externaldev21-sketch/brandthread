/**
 * useSubscriptionPlan — fetches and caches the current seller's plan level.
 *
 * The result is cached at module level so the API is only hit once per app
 * session (subsequent calls on different screens reuse the same promise).
 *
 * Call invalidatePlanCache() after a successful subscription change. Every
 * currently-mounted hook instance will immediately re-fetch so gated features
 * unlock across all screens (including persistent tabs like Studio) without
 * requiring a remount or app restart.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useApi } from '@/lib/api';

export type PlanId = 'starter' | 'growth' | 'pro';

/**
 * Development-only visual companion to the server-controlled test override.
 * The API still enforces paid access unless its separate server environment
 * switch is also enabled, so this client value can never grant entitlement.
 */
export const ALLOW_TEST_SUBSCRIPTION_BYPASS =
  __DEV__ && process.env.EXPO_PUBLIC_ENABLE_TEST_SUBSCRIPTION_BYPASS === 'true';

// ─── Module-level state shared across all hook instances ──────────────────────

/** Cached plan — null means not yet loaded. */
let _cache: PlanId | null = null;

/** In-flight fetch promise so concurrent mounts share one request. */
let _promise: Promise<PlanId> | null = null;

/**
 * Every mounted useSubscriptionPlan instance registers a stable callback here.
 * invalidatePlanCache() walks the set and triggers a re-fetch on each one.
 */
const _listeners = new Set<() => void>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Clear the cached plan and tell every mounted hook instance to re-fetch.
 * Call this after a successful checkout redirect or portal return so gated
 * features across all screens unlock immediately.
 */
export function invalidatePlanCache() {
  _cache = null;
  _promise = null;
  _listeners.forEach((fn) => fn());
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSubscriptionPlan() {
  const api = useApi();
  const [plan, setPlan] = useState<PlanId | null>(_cache);
  const [loading, setLoading] = useState(_cache === null);

  /**
   * Keep a ref to the latest fetch function so the stable listener callback
   * (registered once on mount) always calls the most-current version without
   * re-registering on every render.
   */
  const fetchRef = useRef<() => void>(() => {});

  // Rebuild fetchPlan whenever `api` changes (it wraps Clerk tokens).
  useEffect(() => {
    fetchRef.current = function fetchPlan() {
      if (_cache !== null) {
        setPlan(_cache);
        setLoading(false);
        return;
      }

      setLoading(true);

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
            // Default to starter on failure; allow retry next time
            _cache = 'starter';
            _promise = null;
            return 'starter' as PlanId;
          });
      }

      _promise.then((p) => {
        setPlan(p);
        setLoading(false);
      });
    };
  }, [api]);

  // On mount: run initial fetch and register a stable listener for future
  // invalidations. The listener is removed when the component unmounts.
  useEffect(() => {
    // Stable wrapper — always delegates to the latest fetchRef so we never
    // need to re-register when api changes.
    const listener = () => fetchRef.current();

    _listeners.add(listener);
    listener(); // initial load

    return () => {
      _listeners.delete(listener);
    };
  }, []); // intentionally empty — register/unregister once per lifecycle

  /** True if the user's plan meets or exceeds `minPlan`. */
  function hasPlan(minPlan: PlanId): boolean {
    if (ALLOW_TEST_SUBSCRIPTION_BYPASS) return true;

    const order: Record<PlanId, number> = { starter: 0, growth: 1, pro: 2 };
    return (order[plan ?? 'starter'] ?? 0) >= (order[minPlan] ?? 1);
  }

  return { plan: plan ?? 'starter', loading, hasPlan };
}
