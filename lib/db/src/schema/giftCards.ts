import { pgTable, uuid, text, integer, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';

// ─── Store gift cards (migration 116) ───────────────────────────────────────
// A gift card is bought for ONE seller's store and redeems only against that
// store's group at checkout. The code is generated server-side, shown once,
// and stored only as a SHA-256 hash plus its last 4 characters.
// `balance_cents` is a cache changed only by a guarded atomic UPDATE in the
// same transaction as the `gift_card_transactions` row it describes.

export const giftCards = pgTable('gift_cards', {
  id:            uuid('id').primaryKey().defaultRandom(),
  sellerId:      text('seller_id').notNull(),
  codeHash:      text('code_hash').unique(),
  codeLast4:     text('code_last4'),
  initialCents:  integer('initial_cents').notNull(),
  balanceCents:  integer('balance_cents').notNull(),
  currency:      text('currency').notNull().default('usd'),
  purchaserId:   text('purchaser_id'),
  /** Set when a buyer claims the card into their wallet (or buys it for themselves). */
  ownerId:       text('owner_id'),
  recipientEmail: text('recipient_email'),
  recipientName: text('recipient_name'),
  message:       text('message'),
  /** 'pending_payment' | 'active' | 'void' */
  status:        text('status').notNull().default('pending_payment'),
  /** 'purchase' | 'seller_issued' */
  source:        text('source').notNull().default('purchase'),
  expiresAt:     timestamp('expires_at', { withTimezone: true }),
  stripePaymentIntentId: text('stripe_payment_intent_id').unique(),
  deliveredAt:   timestamp('delivered_at', { withTimezone: true }),
  voidedAt:      timestamp('voided_at', { withTimezone: true }),
  voidedBy:      text('voided_by'),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  sellerIdx:    index('gift_cards_seller_idx').on(t.sellerId, t.createdAt),
  ownerIdx:     index('gift_cards_owner_idx').on(t.ownerId),
  purchaserIdx: index('gift_cards_purchaser_idx').on(t.purchaserId, t.createdAt),
}));

// Append-only ledger (a DB trigger rejects UPDATE/DELETE).
// type: 'issue' | 'redeem' (reserve at checkout) | 'settle' | 'release' |
//       'refund' | 'adjust' | 'void'
export const giftCardTransactions = pgTable('gift_card_transactions', {
  id:                uuid('id').primaryKey().defaultRandom(),
  giftCardId:        uuid('gift_card_id').notNull().references(() => giftCards.id),
  type:              text('type').notNull(),
  amountCents:       integer('amount_cents').notNull(),
  balanceAfterCents: integer('balance_after_cents').notNull(),
  checkoutSessionId: uuid('checkout_session_id'),
  orderId:           uuid('order_id'),
  actorId:           text('actor_id'),
  note:              text('note'),
  idempotencyKey:    text('idempotency_key').notNull(),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  idemUniq:    uniqueIndex('gift_card_transactions_idem_uniq').on(t.idempotencyKey),
  cardIdx:     index('gift_card_transactions_card_idx').on(t.giftCardId, t.createdAt),
  checkoutIdx: index('gift_card_transactions_checkout_idx').on(t.checkoutSessionId),
  orderIdx:    index('gift_card_transactions_order_idx').on(t.orderId),
}));

export const giftCardSettings = pgTable('gift_card_settings', {
  sellerId:      text('seller_id').primaryKey(),
  enabled:       boolean('enabled').notNull().default(false),
  /** Fixed amounts the store sells, in cents. */
  denominations: integer('denominations').array().notNull().default([2500, 5000, 10000]),
  allowCustom:   boolean('allow_custom').notNull().default(false),
  expiryMonths:  integer('expiry_months'),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
