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
  /** Additive (item 109): older servers omit it. */
  openRedemptions?: ThreadCashOpenRedemption[];
  config: ThreadCashConfig;
  streak: ThreadCashStreakState;
  /** Additive: older servers omit it. What lapses within the warning window. */
  expiry?: { expiryDays: number | null; expiringSoonCents: number; nextExpiresAt: string | null; buckets: ThreadCashExpiryBucket[] } | null;
};

export type ThreadCashExpiryBucket = { expiresAt: string; amountCents: number };

export type ThreadCashLedgerKind = 'earned' | 'spent' | 'expired';

export type ThreadCashLedgerRow = {
  id: string;
  amountCents: number;
  source: ThreadCashEntry['source'];
  note: string | null;
  createdAt: string;
  kind: ThreadCashLedgerKind;
  balanceAfterCents: number;
  /** Credits only: when what is left of it expires, if ever. */
  expiresAt: string | null;
  remainingCents: number | null;
};

export type ThreadCashLedger = {
  balanceCents: number;
  expiryDays: number | null;
  expiringSoon: { totalCents: number; nextExpiresAt: string | null; buckets: ThreadCashExpiryBucket[] };
  rows: ThreadCashLedgerRow[];
  hasMore: boolean;
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
    | 'send_cancelled' | 'send_expired' | 'redemption_cancelled' | 'referral'
    // Seller-earned Thread Cash (not spendable at checkout, cashable to real
    // payout money — see app/thread-cash-history.tsx): 'live_gift' is
    // credited by the Live-gifting flow, 'send_received' doubles as a
    // buyer-to-seller message payment, 'cash_out' is this seller debiting
    // their balance into their Stripe payout balance.
    | 'live_gift' | 'cash_out';
  referenceId: string | null;
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
