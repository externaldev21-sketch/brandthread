/**
 * aiHelpDocs.ts
 *
 * A small, curated corpus of "how Brandthread works" explainers for
 * Brandthread AI (the seller assistant). Kept short and factual — these are
 * feature explanations, never account data. Each doc carries a `route` so
 * the assistant can link the seller straight to the right screen.
 */

export interface HelpDoc {
  id: string;
  title: string;
  keywords: string[];
  summary: string;
  route: string;
}

export const HELP_DOCS: HelpDoc[] = [
  {
    id: "inventory-low-stock",
    title: "Why inventory looks low",
    keywords: ["inventory", "low stock", "out of stock", "restock", "stock"],
    summary:
      "Each variant (size/color) has its own stock count and a low-stock threshold. A variant shows as low stock once its count drops to or below its threshold, and out of stock at zero. Update stock or the threshold from a product's variant editor.",
    route: "/inventory",
  },
  {
    id: "shipping-setup",
    title: "Setting up shipping, including worldwide",
    keywords: ["shipping", "worldwide", "international", "rates", "delivery"],
    summary:
      "Shipping rates are flat-rate rules you create per store: a base cost, and an optional order-subtotal threshold above which shipping becomes free. To ship worldwide, add a rate without restricting it to specific countries, or add separate rates for the regions you want to charge differently. Manage rates from Shipping settings.",
    route: "/shipping-rates",
  },
  {
    id: "discount-codes",
    title: "Creating and managing discount codes",
    keywords: ["discount", "coupon", "promo", "code", "sale"],
    summary:
      "Discount codes can be percentage-off or fixed-amount, with optional usage limits and expiry dates. Only active codes apply at checkout. Create and toggle codes from the Discounts screen.",
    route: "/discount-codes",
  },
  {
    id: "payouts",
    title: "How payouts work",
    keywords: ["payout", "payment", "bank", "stripe", "money", "balance"],
    summary:
      "Payouts run through your connected Stripe account. Funds from paid orders move to your available balance and pay out on your account's schedule. If your Stripe account status is 'pending' or 'restricted', payouts are held until verification finishes — check Payout settings for what's needed.",
    route: "/finance",
  },
  {
    id: "store-builder",
    title: "Building your storefront",
    keywords: ["store builder", "storefront", "theme", "publish store", "store page"],
    summary:
      "The Store Builder lets you edit your storefront's title, sections, and theme, then publish when ready. A draft store isn't visible to buyers until published — check its status and publish from the Store Builder.",
    route: "/store-editor",
  },
  {
    id: "sales-performance",
    title: "Reading your sales and performance",
    keywords: ["sales", "revenue", "best seller", "performance", "analytics", "sold"],
    summary:
      "Revenue figures shown are gross totals from paid, non-cancelled orders only. Compare 7-day and 30-day figures to spot trends, and check recent orders for what's actually shipping.",
    route: "/analytics",
  },
  {
    id: "orders-fulfillment",
    title: "Fulfilling orders",
    keywords: ["order", "fulfill", "ship order", "tracking", "pending order"],
    summary:
      "Orders move from pending to processing to shipped as you fulfil them. Add tracking when you ship an order so buyers are notified automatically. Unfulfilled orders sitting too long can affect your seller rating.",
    route: "/(tabs)/orders",
  },
  {
    id: "customers",
    title: "Understanding your customers",
    keywords: ["customer", "repeat buyer", "buyer", "clv"],
    summary:
      "The Customers view aggregates order count and spend per buyer without exposing raw contact details in reports. Use it to spot repeat buyers worth a targeted discount or drop invite.",
    route: "/customers",
  },
];

/** Returns the docs whose keywords best match the given text, most relevant first. */
export function matchHelpDocs(text: string, limit = 3): HelpDoc[] {
  const lower = text.toLowerCase();
  const scored = HELP_DOCS
    .map(doc => ({
      doc,
      score: doc.keywords.reduce((s, kw) => (lower.includes(kw) ? s + 1 : s), 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ doc }) => doc);
}

/** Compact reference text for the system prompt — titles + summaries only. */
export function helpDocsForPrompt(): string {
  return HELP_DOCS.map(d => `- ${d.title}: ${d.summary}`).join("\n");
}
