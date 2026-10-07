/** Thread Cash — platform-funded, non-cash reward credit. Types shared between
 *  lib/api.ts and the wallet / check-in UI. */

export type ThreadCashConfig = {
  dailyAmountCents: number;
  streakBonusCents: number;
  streakBonusDays: number;
  graceHours: number;
  expiryDays: number | null;
  maxRedemptionPerOrderCents: number | null;
};

export type ThreadCashStreakState = {
  currentStreak: number;
  longestStreak: number;
  lastCheckInDate: string | null;
  timezone: string;
  alreadyCheckedInToday: boolean;
  dayInCycle: number;
  streakBonusDays?: number;
};

/** A checkout redemption holding balance but neither spent nor attached to a payment. */
export type ThreadCashOpenRedemption = { token: string; amountCents: number; createdAt: string };

export type ThreadCashStatus = {
  balanceCents: number;
  /** The part of balanceCents a seller may cash out — Thread Cash earned
   *  from Live gifts and payments, never reward credit. Older servers omit it. */
  cashableCents?: number;
  /** Promo credit (platform rewards, incl. promo a buyer gifted): spendable in
   *  Brandthread, never withdrawable. Older servers omit it. */
  promoCents?: number;
  /** Paid-funded Thread Cash in the balance. Older servers omit it. */
  paidCents?: number;
  /** Additive (item 109): older servers omit it. */
  openRedemptions?: ThreadCashOpenRedemption[];
  config: ThreadCashConfig;
  streak: ThreadCashStreakState;
};

export type ThreadCashCheckInResult = {
  ok: true;
  earnedCents: number;
  streakBonusCents: number;
  streakBroken: boolean;
  balanceCents: number;
  streak: ThreadCashStreakState;
};

export type ThreadCashEntry = {
  id: string;
  buyerId: string;
  amountCents: number;
  source:
    | 'daily_checkin' | 'streak_bonus' | 'redemption' | 'checkout_spend'
    | 'refund_credit' | 'expiry' | 'admin_adjustment' | 'send_sent' | 'send_received'
    | 'send_cancelled' | 'send_expired' | 'redemption_cancelled'
    // Seller-earned Thread Cash (not spendable at checkout, cashable to real
    // payout money — see app/thread-cash-history.tsx): 'live_gift' is
    // credited by the Live-gifting flow, 'send_received' doubles as a
    // buyer-to-seller message payment, 'cash_out' is this seller debiting
    // their balance into their Stripe payout balance.
    | 'live_gift' | 'cash_out' | 'live_gift_sent' | 'purchase';
  referenceId: string | null;
  /** 'promo' (rewards) or 'paid' (bought with real money). Older servers omit it. */
  funding?: 'promo' | 'paid';
  note: string | null;
  createdAt: string;
};

/** A Thread Cash send-in-chat transfer (Apple-Cash-style). */
export type ThreadCashTransferStatus = 'pending' | 'claimed' | 'expired' | 'cancelled';

export type ThreadCashTransfer = {
  id: string;
  senderId: string;
  recipientId: string;
  conversationId: string | null;
  amountCents: number;
  status: ThreadCashTransferStatus;
  note: string | null;
  claimedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};
