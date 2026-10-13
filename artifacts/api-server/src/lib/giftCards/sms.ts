/**
 * The gift card text message. Mirrors the email (purchase.ts deliverGiftCard):
 * who sent it, amount and store, the gift message, the code, and the same
 * link the email's button opens. The buyer's message is shortened and has any
 * links removed so the text can't be used to send someone elsewhere.
 */
import { formatCents } from "../brandthreadEmail";

export const GIFT_CARD_CLAIM_URL = "https://brandthread.app/gift-cards";
export const SMS_MESSAGE_MAX = 120;

const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|app|ly|me|xyz|link|info|biz|us|gg|tv|to|page|site|shop|store)\b\S*/gi;

/** The buyer's note, safe for a text: no links, one line, at most SMS_MESSAGE_MAX characters. */
export function cleanSmsMessage(message: string | null | undefined): string {
  const text = (message ?? "").replace(URL_LIKE, "").replace(/\s+/g, " ").trim();
  if (text.length <= SMS_MESSAGE_MAX) return text;
  return `${text.slice(0, SMS_MESSAGE_MAX - 1).trimEnd()}…`;
}

export function giftCardSmsBody(input: {
  senderName?: string | null; storeName: string; amountCents: number; message?: string | null; code: string;
}): string {
  // "$25", not "$25.00": every character counts in a text.
  const amount = input.amountCents % 100 === 0 ? `$${(input.amountCents / 100).toLocaleString("en-US")}` : formatCents(input.amountCents);
  const opener = input.senderName
    ? `${input.senderName} sent you a ${amount} ${input.storeName} gift card.`
    : `You have a ${amount} ${input.storeName} gift card.`;
  const note = cleanSmsMessage(input.message);
  return [opener, note ? `"${note}"` : null, `Code: ${input.code}`, `Claim it: ${GIFT_CARD_CLAIM_URL}`]
    .filter(Boolean).join("\n");
}
