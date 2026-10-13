/**
 * "Gift this" at checkout (lululemon "Adding a gift message"): the checkout
 * row and the Add a Gift Message screen share this tiny module store, so the
 * gift needs no prop threading through buyer-checkout.tsx. The checkout sends
 * `giftOptionBody()` with its create call and resets the store after a
 * successful order. The server prints a gift order's packing slip as a gift
 * receipt with prices hidden.
 */
import { useSyncExternalStore } from 'react';

export const GIFT_NAME_MAX = 60;
export const GIFT_MESSAGE_MAX = 250;

export type GiftOption = { to: string; from: string; message: string };

let gift: GiftOption | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getGiftOption(): GiftOption | null {
  return gift;
}

/** Trims each field and applies the limits. */
export function normalizeGiftOption(input: Partial<GiftOption>): GiftOption {
  return {
    to: (input.to ?? '').trim().slice(0, GIFT_NAME_MAX),
    from: (input.from ?? '').trim().slice(0, GIFT_NAME_MAX),
    message: (input.message ?? '').trim().slice(0, GIFT_MESSAGE_MAX),
  };
}

/** Save from the Add a Gift Message screen: the order is now a gift. */
export function setGiftOption(input: Partial<GiftOption>) {
  gift = normalizeGiftOption(input);
  emit();
}

/** Unchecking the row, or a placed order: not a gift any more. */
export function resetGiftOption() {
  if (gift === null) return;
  gift = null;
  emit();
}

export function useGiftOption(): GiftOption | null {
  return useSyncExternalStore(subscribe, getGiftOption, getGiftOption);
}

/** The request field for the checkout create calls; `{}` when not a gift. Empty fields are left out. */
export function giftOptionBody(): { gift?: { to?: string; from?: string; message?: string } } {
  if (!gift) return {};
  return {
    gift: {
      ...(gift.to ? { to: gift.to } : {}),
      ...(gift.from ? { from: gift.from } : {}),
      ...(gift.message ? { message: gift.message } : {}),
    },
  };
}
