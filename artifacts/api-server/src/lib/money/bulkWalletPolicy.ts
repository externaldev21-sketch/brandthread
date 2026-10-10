/**
 * BT-065: held pre-order money may only pay a real, independent manufacturer,
 * for a price the manufacturer quoted, and only up to a share of what the
 * drop has collected.
 *
 * POST /api/sample-orders/:id/pay-from-wallet moves buyers' held pre-order
 * money to a manufacturer as a Stripe transfer before any buyer item ships.
 * Without these rules a seller could create a bulk order against an alt
 * "manufacturer" account they control and convert buyers' money into
 * withdrawable cash; when the drop then fails, buyers are refunded from
 * Brandthread's balance.
 *
 * Rules (all must pass; each failure has its own 4xx code):
 *  1. The bulk order was quoted by the manufacturer (issued_by='manufacturer':
 *     the priced order card the manufacturer sent in chat). A seller-typed
 *     price can still be paid by card, never from held funds.
 *  2. The manufacturer is verified (verified_at set) and active.
 *  3. The manufacturer is not the seller: different user id, different Stripe
 *     account, different email, and not the same company email domain.
 *  4. Wallet-funded bulk payments for a drop never exceed
 *     PREORDER_BULK_MAX_PCT (default 60) % of the pre-order money it holds.
 */

export const DEFAULT_PREORDER_BULK_MAX_PCT = 60;

export function preorderBulkMaxPct(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.PREORDER_BULK_MAX_PCT);
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : DEFAULT_PREORDER_BULK_MAX_PCT;
}

/** Public mailbox providers: sharing one of these says nothing about identity. */
const PUBLIC_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "mail.com",
  "zoho.com", "yandex.com", "qq.com", "163.com", "126.com", "naver.com",
]);

function normalizeEmail(email: string | null | undefined): string | null {
  const value = (email ?? "").trim().toLowerCase();
  return value.includes("@") ? value : null;
}

function emailDomain(email: string | null): string | null {
  return email ? email.slice(email.lastIndexOf("@") + 1) || null : null;
}

export type BulkWalletRefusal = {
  status: 403 | 409;
  code:
    | "BULK_QUOTE_REQUIRED"
    | "MANUFACTURER_NOT_VERIFIED"
    | "MANUFACTURER_SAME_AS_SELLER"
    | "BULK_EXCEEDS_PREORDER_CAP";
  message: string;
  details?: Record<string, number>;
};

export type BulkWalletInput = {
  order: { issuedBy: string | null | undefined; priceCents: number };
  manufacturer: {
    status: string | null | undefined;
    verifiedAt: Date | string | null | undefined;
    clerkId: string | null | undefined;
    stripeAccountId: string | null | undefined;
    /** Contact email on the manufacturer profile and the manufacturer user's login email. */
    emails: Array<string | null | undefined>;
  };
  seller: {
    clerkId: string;
    stripeAccountId: string | null | undefined;
    email: string | null | undefined;
  };
  wallet: {
    /** Pre-order money deposited into this drop's wallet (after fees). */
    balanceCents: number;
    /** Bulk payments already made or in flight from this wallet (excluding this order). */
    bulkPaidCents: number;
  };
  maxPct?: number;
};

export function bulkWalletRefusal(input: BulkWalletInput): BulkWalletRefusal | null {
  if (input.order.issuedBy !== "manufacturer") {
    return {
      status: 409,
      code: "BULK_QUOTE_REQUIRED",
      message: "Held pre-order funds can only pay a bulk order the manufacturer quoted. Ask the manufacturer to send the order card in chat, or pay by card.",
    };
  }

  const mfr = input.manufacturer;
  if (!mfr.verifiedAt || mfr.status !== "active") {
    return {
      status: 409,
      code: "MANUFACTURER_NOT_VERIFIED",
      message: "Held pre-order funds can only pay a verified manufacturer.",
    };
  }

  const sellerEmail = normalizeEmail(input.seller.email);
  const sellerDomain = emailDomain(sellerEmail);
  const mfrEmails = mfr.emails.map(normalizeEmail).filter((e): e is string => Boolean(e));
  const sameUser = Boolean(mfr.clerkId) && mfr.clerkId === input.seller.clerkId;
  const sameStripe = Boolean(mfr.stripeAccountId) && Boolean(input.seller.stripeAccountId)
    && mfr.stripeAccountId === input.seller.stripeAccountId;
  const sameEmail = Boolean(sellerEmail) && mfrEmails.includes(sellerEmail!);
  const sameCompanyDomain = Boolean(sellerDomain) && !PUBLIC_MAIL_DOMAINS.has(sellerDomain!)
    && mfrEmails.some((email) => emailDomain(email) === sellerDomain);
  if (sameUser || sameStripe || sameEmail || sameCompanyDomain) {
    return {
      status: 403,
      code: "MANUFACTURER_SAME_AS_SELLER",
      message: "Held pre-order funds can't pay a manufacturer account linked to your own.",
    };
  }

  const pct = input.maxPct ?? preorderBulkMaxPct();
  const capCents = bulkWalletCapCents(input.wallet.balanceCents, pct);
  const remainingCents = bulkWalletRemainingCents(input.wallet.balanceCents, input.wallet.bulkPaidCents, pct);
  if (input.order.priceCents > remainingCents) {
    return {
      status: 409,
      code: "BULK_EXCEEDS_PREORDER_CAP",
      message: `Held pre-order funds can cover up to ${pct}% of what this drop collected. Pay the rest by card.`,
      details: { capCents, remainingCents, maxPct: pct },
    };
  }
  return null;
}

export function bulkWalletCapCents(balanceCents: number, maxPct = preorderBulkMaxPct()): number {
  return Math.floor((Math.max(0, balanceCents) * maxPct) / 100);
}

/** How much of a wallet can still go to bulk orders (for payment options). */
export function bulkWalletRemainingCents(balanceCents: number, bulkPaidCents: number, maxPct = preorderBulkMaxPct()): number {
  return Math.max(0, bulkWalletCapCents(balanceCents, maxPct) - Math.max(0, bulkPaidCents));
}
