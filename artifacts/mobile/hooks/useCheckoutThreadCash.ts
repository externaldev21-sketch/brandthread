/**
 * Item 109: Thread Cash on the checkout screen, as one on/off toggle that
 * follows the order live.
 *
 * - On applies all it can: the buyer's balance, capped by what the order can
 *   take and any admin per-order cap (lib/threadCashCheckout.ts). Off gives
 *   the whole amount back to the balance (POST /redeem/:token/cancel). Before
 *   this, turning it off just forgot the token, and the balance was gone.
 * - While on, it follows the total. A promo code, a delivery change or a
 *   removed code changes the ceiling, and the amount is resized to fit
 *   (cancel, then redeem the new amount). If the order can no longer take
 *   any, it's turned off, with a note saying so.
 * - When it loads, it returns leftovers from earlier checkouts the buyer
 *   left, so the balance shown is what they really have.
 *
 * The server stays authoritative. It re-checks the balance, the cap, the
 * frozen-account rule and the 50¢ card minimum when the token is redeemed
 * and again when checkout reserves it. Every request runs one at a time, in
 * order, so a quick on/off/on can't leave two tokens out.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';
import { formatCents } from '@/lib/money';
import type { CheckoutThreadCashRedemption } from '@/services/cartTypes';
import {
  staleRedemptionTokens, threadCashTargetCents, threadCashUnavailableReason,
} from '@/lib/threadCashCheckout';

/** The server's own reason (it words these for buyers), or a fallback for network/5xx failures. */
function threadCashErrorMessage(error: unknown): string {
  const fallback = 'We couldn’t update your Thread Cash. Check your connection and try again.';
  if (!(error instanceof ApiError) || error.status >= 500) return fallback;
  return error.message.replace(/^API \d{3}:\s*/, '').trim() || fallback;
}

export type CheckoutThreadCash = {
  /** False until the balance has loaded. */
  ready: boolean;
  loadFailed: boolean;
  reload: () => void;
  balanceCents: number;
  /** Balance plus what this checkout already holds. */
  availableCents: number;
  /** What "on" applies right now. */
  targetCents: number;
  appliedCents: number;
  unavailable: 'no_balance' | 'order_too_small' | null;
  /** A request is in flight: the switch shows a spinner and Place order waits. */
  busy: boolean;
  /** What the last request failed with, in the server's words. */
  error: string | null;
  /** One-line note after the amount followed the total on its own. */
  notice: string | null;
  setOn: (on: boolean) => void;
};

export function useCheckoutThreadCash({
  enabled, redemption, ceilingCents, onChange,
}: {
  enabled: boolean;
  redemption: CheckoutThreadCashRedemption | null;
  /** threadCashCeilingCents() of the current order. */
  ceilingCents: number;
  /** Persists the session with the new redemption (or none). */
  onChange: (next: CheckoutThreadCashRedemption | undefined) => Promise<void>;
}): CheckoutThreadCash {
  const api = useApi();
  const [wallet, setWallet] = useState<{ balanceCents: number; capCents: number | null } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const redemptionRef = useRef(redemption);
  redemptionRef.current = redemption;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const queue = useRef<Promise<void>>(Promise.resolve());

  const enqueue = useCallback((task: () => Promise<void>) => {
    queue.current = queue.current.then(task, task);
    return queue.current;
  }, []);

  const load = useCallback(() => enqueue(async () => {
    setLoadFailed(false);
    try {
      const status = await api.threadCash.get();
      let balanceCents = status.balanceCents;
      // Return what earlier, abandoned checkouts are still holding.
      for (const token of staleRedemptionTokens(status.openRedemptions, redemptionRef.current?.token)) {
        try {
          balanceCents = (await api.threadCash.cancelRedemption(token)).balanceCents;
        } catch {
          // Stays open; the next visit tries again.
        }
      }
      setWallet({ balanceCents: Math.max(0, balanceCents), capCents: status.config?.maxRedemptionPerOrderCents ?? null });
    } catch {
      setLoadFailed(true);
    }
  }), [api, enqueue]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  const appliedCents = redemption?.discountCents ?? 0;
  const availableCents = (wallet?.balanceCents ?? 0) + appliedCents;
  const targetCents = threadCashTargetCents({ availableCents, ceilingCents, perOrderCapCents: wallet?.capCents });
  const unavailable = wallet ? threadCashUnavailableReason({ availableCents, ceilingCents }) : null;

  /** Moves this checkout to `amountCents` of Thread Cash (0 = off), one request at a time. */
  const applyAmount = useCallback((amountCents: number, why: 'toggle' | 'follow') => enqueue(async () => {
    const held = redemptionRef.current;
    if ((held?.discountCents ?? 0) === amountCents) return;
    setBusy(true);
    setError(null);
    if (why === 'toggle') setNotice(null);
    try {
      let balanceCents: number | null = null;
      if (held) {
        balanceCents = (await api.threadCash.cancelRedemption(held.token)).balanceCents;
        redemptionRef.current = null;
        await onChangeRef.current(undefined);
      }
      if (amountCents >= 1) {
        const result = await api.threadCash.redeem({ amountCents, idempotencyKey: randomUUID() });
        const next = { token: result.token, discountCents: result.discountCents };
        redemptionRef.current = next;
        await onChangeRef.current(next);
        if (balanceCents !== null) balanceCents -= result.discountCents;
        if (why === 'follow') setNotice(`Updated to ${formatCents(result.discountCents)} to fit your new total.`);
      } else if (why === 'follow') {
        setNotice('Thread Cash is off: this order now needs at least $0.50 on your card.');
      }
      if (balanceCents !== null) {
        const known = balanceCents;
        setWallet(current => current && { ...current, balanceCents: Math.max(0, known) });
      } else {
        setWallet(current => current && { ...current, balanceCents: Math.max(0, current.balanceCents - amountCents) });
      }
    } catch (failure) {
      setError(threadCashErrorMessage(failure));
      // Re-read the truth (balance, and whether a token is still out).
      try {
        const status = await api.threadCash.get();
        setWallet(current => ({ balanceCents: Math.max(0, status.balanceCents), capCents: current?.capCents ?? null }));
      } catch {
        // Keep what we have.
      }
    } finally {
      setBusy(false);
    }
  }), [api, enqueue]);

  // Follow the order: while on, keep the amount at what the order can take.
  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One attempt per (token, target): a failed resize shows its error and
  // waits for the buyer, instead of retrying in a loop.
  const lastFollow = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !wallet || !redemption || busy) return;
    if (redemption.discountCents === targetCents) return;
    const attempt = `${redemption.token}:${targetCents}`;
    if (lastFollow.current === attempt) return;
    if (followTimer.current) clearTimeout(followTimer.current);
    followTimer.current = setTimeout(() => {
      lastFollow.current = attempt;
      void applyAmount(targetCents, 'follow');
    }, 300);
    return () => {
      if (followTimer.current) clearTimeout(followTimer.current);
    };
  }, [enabled, wallet, redemption, busy, targetCents, applyAmount]);

  const setOn = useCallback((on: boolean) => {
    void applyAmount(on ? targetCents : 0, 'toggle');
  }, [applyAmount, targetCents]);

  return {
    ready: !!wallet,
    loadFailed,
    reload: () => { void load(); },
    balanceCents: wallet?.balanceCents ?? 0,
    availableCents,
    targetCents,
    appliedCents,
    unavailable,
    busy,
    error,
    notice,
    setOn,
  };
}
