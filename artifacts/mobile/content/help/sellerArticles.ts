/**
 * Seller help articles — short, factual answers shown in the Help screen's
 * "Selling" section and in the inline "Learn more" links
 * (components/help/HelpLink.tsx).
 *
 * Every statement here describes what the app and api-server actually do;
 * the source of each fact is noted above its article. Numbers appear only
 * where the code fixes them. When the behaviour changes, change the article
 * in the same PR.
 */

export type SellerArticleId =
  | 'payouts'
  | 'fees'
  | 'shipping-labels'
  | 'delivery-deadlines'
  | 'returns-refunds'
  | 'background-removal'
  | 'variants-stock'
  | 'drops-schedule';

export interface SellerArticle {
  id: SellerArticleId;
  title: string;
  /** Text for an inline "Learn more about …" link. */
  linkLabel: string;
  /** One paragraph per entry. */
  body: string[];
}

export const SELLER_ARTICLES: SellerArticle[] = [
  // api-server lib/delivery/policy.ts (PAYOUT_MODE hold), lib/money/payoutSchedule.ts,
  // app/payouts.tsx (Available / Pending, Stripe Connect verification).
  {
    id: 'payouts',
    title: 'How payouts work',
    linkLabel: 'Learn more about payouts',
    body: [
      'Payouts go to the bank account on your Stripe account. You need to connect Stripe and finish verification before you can be paid.',
      'Brandthread holds the money from each order until the order is delivered, plus a short buffer. Delivered means the carrier marked it delivered or the buyer confirmed they received it.',
      'Pending is money that has not cleared yet. Available is money ready to pay out. It goes to your bank on your payout schedule: daily, weekly on a day you choose, or manual, where you start each payout yourself.',
      'Refunds you give and shipping labels you buy are taken from your balance.',
    ],
  },
  // api-server lib/money/fees.ts (PLATFORM_FEE_BPS, STRIPE_PROCESSING_*), routes/returns.ts.
  {
    id: 'fees',
    title: 'Fees on each sale',
    linkLabel: 'Learn more about fees',
    body: [
      'Brandthread keeps 5% of the item price on each sale. The fee is not charged on shipping.',
      'Card processing is charged by Stripe on the whole payment, shipping included. For a US card it is 2.9% + 30¢.',
      'What is left is your payout. When you refund an order, the 5% fee on the refunded amount comes back to you.',
    ],
  },
  // api-server routes/shipping-labels.ts, lib/parcelSuggestion.ts; app/fulfill-order.tsx.
  {
    id: 'shipping-labels',
    title: 'Buying a shipping label',
    linkLabel: 'Learn more about shipping labels',
    body: [
      'Fulfill an order in three steps: pack it, choose a package, then ship it. The suggested package weight comes from the weights saved on your variants, so set them for accurate rates.',
      'Compare the carrier rates and buy one. The label\'s tracking number becomes the order\'s tracking number, the items are marked shipped and the buyer can follow the delivery.',
      'To ship part of an order separately, buy a label for just those items.',
      'For in-stock orders the label cost comes out of your balance. For a pre-order it is paid from that order\'s held money.',
      'If you don\'t use a label, void it. The carrier refunds it and the items go back to not shipped. You can also enter tracking from another carrier by hand.',
    ],
  },
  // api-server lib/delivery/policy.ts (REGULAR_DELIVERY_DAYS, PREORDER_DELIVERY_DAYS, auto refund).
  {
    id: 'delivery-deadlines',
    title: 'Delivery deadlines',
    linkLabel: 'Learn more about delivery deadlines',
    body: [
      'An in-stock order must be delivered within 15 days of payment. A pre-order must be delivered within 60 days.',
      'Delivered means the carrier marked it delivered or the buyer confirmed they received it.',
      'If an order is not delivered by its deadline, the buyer is refunded automatically.',
    ],
  },
  // api-server routes/returns.ts (PATCH /:id/status, refundOnScan, 5 evidence photos), routes/return-labels.ts.
  {
    id: 'returns-refunds',
    title: 'Returns and refunds',
    linkLabel: 'Learn more about returns',
    body: [
      'Buyers request a return from their order and can add up to 5 photos. You get a notification and decide.',
      'Approve to refund right away, either the full amount or an amount you set. A refund can never be more than what is still refundable on the order. Refunding the whole order closes it.',
      'You can also buy a prepaid return label. That approves the return, and the refund is sent when the carrier first scans the buyer\'s parcel.',
      'Refunds come out of your balance, and the 5% fee on the refunded amount is returned to you.',
    ],
  },
  // app/add-product.tsx (openPhotoActionsFor, removeBackgroundForMedia), api-server routes/bg-removal.ts.
  {
    id: 'background-removal',
    title: 'Removing photo backgrounds',
    linkLabel: 'Learn more about background removal',
    body: [
      'Press and hold a photo, then tap Remove background. You get a cutout of your product on a transparent background.',
      'Your original photo is kept. Use the same menu to switch between the cutout and the original, or to redo the removal.',
      'Photos can be JPG, PNG or WebP up to 8 MB. A product can have up to 10 photos, each cropped to 3:4.',
      'If removal fails, tap the photo to try again.',
    ],
  },
  // api-server lib/variantMatrix.ts (sold-out behaviours), lib/stockNotifications.ts; app/product-variants.tsx.
  {
    id: 'variants-stock',
    title: 'Variants and stock',
    linkLabel: 'Learn more about variants and stock',
    body: [
      'Each variant, like a size and colour, has its own price, SKU and stock. A product\'s stock is the total of its variants.',
      'Each variant has a low-stock level. You get an alert the first time a variant drops to it, and another when it sells out.',
      'Choose what happens when a product sells out under Variants & stock: keep it listed as Sold out, hide it until you restock, or archive it. This does not apply to pre-orders or products in a drop.',
      'When you restock, buyers on the waitlist are notified once.',
    ],
  },
  // app/seller-drop-create.tsx; api-server lib/money/dropLaunch.ts, checkoutPlan.ts, dropLifecycle.ts.
  {
    id: 'drops-schedule',
    title: 'Scheduling a drop',
    linkLabel: 'Learn more about scheduling drops',
    body: [
      'Pick the launch date and time in the time zone you choose. Buyers see a countdown in their own time, and checkout opens at launch.',
      'Add an end time to show buyers when the drop closes.',
      'Turn on early access to let your followers buy a set number of minutes before everyone else.',
      'In a pre-order drop buyers pay at checkout and Brandthread holds the money until you ship. Pre-orders are checked out separately from in-stock items.',
      'If a pre-order drop\'s shipping deadline passes with orders still unshipped, or you cancel the drop, every buyer whose order has not shipped is refunded in full automatically.',
    ],
  },
];

export function getSellerArticle(id: string | null | undefined): SellerArticle | null {
  if (!id) return null;
  return SELLER_ARTICLES.find((article) => article.id === id) ?? null;
}
