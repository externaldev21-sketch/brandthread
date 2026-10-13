/**
 * Store gift cards: shared types and the small pure helpers the screens use.
 * The server (api-server routes/gift-cards.ts) owns every rule; nothing here
 * decides what a card is worth or where it can be spent.
 */
import { formatCents } from '@/lib/money';
import { fmtDate } from '@/lib/format';

export type GiftCardStatus = 'pending_payment' | 'active' | 'void' | 'expired' | 'depleted';

export type GiftCard = {
  id: string;
  sellerId: string;
  storeName?: string;
  last4: string | null;
  initialCents: number;
  balanceCents: number;
  status: GiftCardStatus;
  expiresAt: string | null;
  createdAt: string;
  role: 'owner' | 'purchaser' | 'seller';
  recipientName: string | null;
  recipientEmail?: string | null;
  recipientPhoneLast4?: string | null;
  message: string | null;
};

export type GiftCardStoreInfo = {
  sellerId: string;
  storeName: string;
  enabled: boolean;
  denominations: number[];
  allowCustom: boolean;
  minCents: number;
  maxCents: number;
  /** The server texts cards sent to a phone itself (Twilio configured). */
  smsDelivery?: boolean;
};

export type GiftCardSettings = {
  sellerId: string;
  enabled: boolean;
  denominations: number[];
  allowCustom: boolean;
  expiryMonths: number | null;
  minCents: number;
  maxCents: number;
};

export type GiftCardHistoryEntry = {
  id: string;
  type: 'issue' | 'redeem' | 'settle' | 'release' | 'refund' | 'adjust' | 'void';
  amountCents: number;
  balanceAfterCents: number;
  note: string | null;
  createdAt: string;
};

/** Cards that can still be spent. */
export function spendableCards(cards: GiftCard[], sellerId?: string): GiftCard[] {
  return cards.filter(card => card.role === 'owner' && card.status === 'active' && (!sellerId || card.sellerId === sellerId));
}

export function giftCardMask(card: Pick<GiftCard, 'last4'>): string {
  return card.last4 ? `•••• ${card.last4}` : 'Gift card';
}

export function giftCardStatusLabel(card: Pick<GiftCard, 'status' | 'expiresAt'>): string {
  switch (card.status) {
    case 'void': return 'Voided';
    case 'expired': return 'Expired';
    case 'depleted': return 'Fully used';
    case 'pending_payment': return 'Awaiting payment';
    default:
      return card.expiresAt ? `Expires ${fmtDate(card.expiresAt)}` : 'No expiry';
  }
}

export function giftCardBalanceLine(card: Pick<GiftCard, 'balanceCents' | 'initialCents'>): string {
  return card.balanceCents === card.initialCents
    ? formatCents(card.balanceCents)
    : `${formatCents(card.balanceCents)} of ${formatCents(card.initialCents)}`;
}

/** Whole-dollar text a person typed ("25", "$25.50") to cents, or null. */
export function amountTextToCents(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * US-first E.164, the same rule as the server (api-server lib/sms/phone.ts):
 * 10 digits or 1 + 10 digits become +1…, otherwise it must start with +.
 */
export function toE164(raw: string): string | null {
  const value = raw.trim();
  if (!value || /[a-z]/i.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  let e164: string;
  if (value.startsWith('+')) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith('1')) e164 = `+${digits}`;
  else return null;
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return null;
  if (e164.startsWith('+1') && !/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(e164)) return null;
  return e164;
}

export const GIFT_CARD_CLAIM_URL = 'https://brandthread.app/gift-cards';

/** The note the buyer sends from Messages when the server doesn't text it. */
export function giftCardTextBody(input: { storeName: string; amountCents: number; code: string }): string {
  const amount = input.amountCents % 100 === 0 ? `$${(input.amountCents / 100).toLocaleString('en-US')}` : formatCents(input.amountCents);
  return `Here’s a ${amount} ${input.storeName} gift card.\nCode: ${input.code}\nClaim it: ${GIFT_CARD_CLAIM_URL}`;
}

/** What the buy screen still needs before Pay can start. Null when ready. */
export function giftCardPurchaseIssue(input: {
  amountCents: number | null; info: Pick<GiftCardStoreInfo, 'denominations' | 'allowCustom' | 'minCents' | 'maxCents'>;
  email: string;
  /** Sending by text: the phone is checked instead of the email. */
  phone?: string | null;
}): string | null {
  const { amountCents, info } = input;
  if (!amountCents) return 'Choose an amount';
  if (!info.allowCustom && !info.denominations.includes(amountCents)) return 'Choose one of the amounts this store offers';
  if (amountCents < info.minCents || amountCents > info.maxCents) {
    return `Amounts run from ${formatCents(info.minCents)} to ${formatCents(info.maxCents)}`;
  }
  if (input.phone != null) return toE164(input.phone) ? null : 'Enter the recipient’s phone number';
  if (!EMAIL_PATTERN.test(input.email.trim())) return 'Enter the recipient’s email';
  return null;
}
