/**
 * Store gift cards: shared types and the small pure helpers the screens use.
 * The server (api-server routes/gift-cards.ts) owns every rule; nothing here
 * decides what a card is worth or where it can be spent.
 */
import { formatCents } from '@/lib/money';

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
      return card.expiresAt ? `Expires ${new Date(card.expiresAt).toLocaleDateString()}` : 'No expiry';
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

/** What the buy screen still needs before Pay can start. Null when ready. */
export function giftCardPurchaseIssue(input: {
  amountCents: number | null; info: Pick<GiftCardStoreInfo, 'denominations' | 'allowCustom' | 'minCents' | 'maxCents'>;
  email: string;
}): string | null {
  const { amountCents, info } = input;
  if (!amountCents) return 'Choose an amount';
  if (!info.allowCustom && !info.denominations.includes(amountCents)) return 'Choose one of the amounts this store offers';
  if (amountCents < info.minCents || amountCents > info.maxCents) {
    return `Amounts run from ${formatCents(info.minCents)} to ${formatCents(info.maxCents)}`;
  }
  if (!EMAIL_PATTERN.test(input.email.trim())) return 'Enter the recipient’s email';
  return null;
}
