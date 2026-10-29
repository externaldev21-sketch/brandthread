import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/expo';
import { useFocusEffect } from 'expo-router';

import { useApi } from '@/hooks/useApi';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import { atHandle, buyerDisplayName, firstNameOf, personName, sellerDisplayName } from '@/lib/identity';
import { PREVIEW_SELLER_IDENTITY } from '@/lib/previewIdentity';
import { previewBuyerIdentity } from '@/lib/previewBuyerIdentity';

/**
 * The signed-in account's own identity, read from the canonical profile
 * fields onboarding writes (GET /api/auth/me; sellers also GET
 * /api/seller/profile for the signed photo URL). One shared copy for every
 * screen: refetched whenever a screen using it regains focus, so a name,
 * username or photo changed on Profile shows on the dashboard, Settings,
 * Live and Messages the next time they're on screen.
 */
export interface MyIdentity {
  accountType: 'buyer' | 'seller' | null;
  /** Seller: business name. Buyer: their name. Falls back to @username. */
  displayName: string | null;
  /** The person's own name (display name, then legal name). */
  personName: string | null;
  firstName: string | null;
  username: string | null;
  /** "@username", or null without one. */
  handle: string | null;
  brandName: string | null;
  /** The profile photo the account set; null = show the monogram. */
  avatarUrl: string | null;
}

interface Snapshot { key: string; identity: MyIdentity }

let snapshot: Snapshot | null = null;
let inflight: { key: string; promise: Promise<void> } | null = null;
let lastFetchAt = 0;
const listeners = new Set<() => void>();
/** Focus refetches closer together than this share one request. */
const REFRESH_MIN_MS = 1500;

function publish(next: Snapshot | null) {
  snapshot = next;
  for (const l of [...listeners]) l();
}

export function buildMyIdentity(
  me: { accountType?: 'buyer' | 'seller' | null; brandName?: string | null; displayName?: string | null; name?: string | null; username?: string | null },
  avatarUrl: string | null,
): MyIdentity {
  const accountType = me.accountType ?? null;
  const username = me.username?.trim().replace(/^@+/, '') || null;
  return {
    accountType,
    displayName: accountType === 'seller' ? sellerDisplayName(me) : buyerDisplayName(me),
    personName: personName(me),
    firstName: firstNameOf(me),
    username,
    handle: atHandle(username),
    brandName: me.brandName?.trim() || null,
    avatarUrl: avatarUrl || null,
  };
}

function previewIdentity(): MyIdentity | null {
  if (isSellerDevPreview()) {
    return buildMyIdentity({ ...PREVIEW_SELLER_IDENTITY, accountType: 'seller', name: `${PREVIEW_SELLER_IDENTITY.firstName} ${PREVIEW_SELLER_IDENTITY.lastName}` }, null);
  }
  const buyer = isBuyerDevPreview() ? previewBuyerIdentity() : null;
  return buyer ? buildMyIdentity({ ...buyer, accountType: 'buyer' }, null) : null;
}

export function useMyIdentity(): { identity: MyIdentity | null; refresh: () => Promise<void> } {
  const api = useApi();
  const { userId, isSignedIn } = useAuth();
  const key = isSignedIn && userId ? userId : '';
  const preview = key ? null : previewIdentity();
  const [, setTick] = useState(0);

  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  const refresh = useCallback(async () => {
    if (!key) return;
    if (inflight?.key === key) return inflight.promise;
    if (snapshot?.key === key && Date.now() - lastFetchAt < REFRESH_MIN_MS) return;
    const promise = (async () => {
      try {
        const me = await api.auth.me();
        let avatarUrl: string | null = null;
        if (me.accountType === 'seller') {
          const p = await api.seller.getProfile().catch(() => null) as { avatarPosterUrl?: string | null; profileImageUrl?: string | null } | null;
          avatarUrl = p?.avatarPosterUrl || p?.profileImageUrl || null;
        }
        lastFetchAt = Date.now();
        publish({ key, identity: buildMyIdentity(me, avatarUrl) });
      } catch {
        // Offline: keep the last known identity on screen.
      } finally {
        inflight = null;
      }
    })();
    inflight = { key, promise };
    return promise;
  }, [api, key]);

  // An account switch must never show the previous account's name.
  useEffect(() => {
    if (snapshot && snapshot.key !== key) publish(null);
  }, [key]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const identity = preview ?? (snapshot && snapshot.key === key ? snapshot.identity : null);
  return { identity, refresh };
}
