/**
 * "Gift this" at checkout: an optional To / From / message that rides on the
 * checkout session and is copied onto every order it creates. A gift order's
 * packing slip prints as a gift receipt with prices hidden.
 */
import { z } from "@workspace/api-zod";
import { evaluateContent } from "./contentModerator";

export const GIFT_NAME_MAX = 60;
export const GIFT_MESSAGE_MAX = 250;

/** Trims, collapses an empty string to undefined, then enforces the limit. */
const optionalText = (max: number) => z.preprocess(
  (value) => (typeof value === "string" ? (value.trim() || undefined) : value),
  z.string().max(max).optional(),
);

export const giftSchema = z.object({
  to: optionalText(GIFT_NAME_MAX),
  from: optionalText(GIFT_NAME_MAX),
  message: optionalText(GIFT_MESSAGE_MAX),
}).strict();

export type GiftInput = z.infer<typeof giftSchema>;

export type GiftColumns = {
  isGift: boolean;
  giftTo: string | null;
  giftFrom: string | null;
  giftMessage: string | null;
};

/** Columns for a checkout session row. No gift object = not a gift. */
export function giftColumns(gift: GiftInput | null | undefined): GiftColumns | Record<string, never> {
  if (!gift) return {};
  return {
    isGift: true,
    giftTo: gift.to ?? null,
    giftFrom: gift.from ?? null,
    giftMessage: gift.message ?? null,
  };
}

/**
 * The note is a private message from the buyer to the recipient, printed by
 * the seller. It is moderated like a DM: abuse, hate, spam and sexual content
 * are rejected; casual language passes.
 */
export function moderateGift(gift: GiftInput | null | undefined): { ok: true } | { ok: false; reason: string } {
  if (!gift) return { ok: true };
  const text = [gift.to, gift.from, gift.message].filter(Boolean).join("\n");
  const decision = evaluateContent(text, "dm");
  return decision.action === "reject" ? { ok: false, reason: decision.reason } : { ok: true };
}

/** The gift fields an order detail response exposes (null when not a gift). */
export function giftResponse(order: { isGift?: boolean | null; giftTo?: string | null; giftFrom?: string | null; giftMessage?: string | null }) {
  if (!order.isGift) return { isGift: false, gift: null };
  return {
    isGift: true,
    gift: { to: order.giftTo ?? null, from: order.giftFrom ?? null, message: order.giftMessage ?? null },
  };
}
