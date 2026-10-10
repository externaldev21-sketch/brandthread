/**
 * Win-back: a week after a seller's plan has ended (cancelled or expired),
 * one email and one push say the store and products are saved and link
 * straight to picking a plan again. Sent once per ended subscription, and
 * only within days 7–14 after the end so an old account isn't surprised
 * months later. Honours Settings → Notifications → Trial & subscription.
 */
import { renderBrandthreadEmail } from "./brandthreadEmail";
import { getWebOrigin } from "./webOrigin";

const DAY_MS = 86_400_000;
export const WINBACK_AFTER_DAYS = 7;
export const WINBACK_UNTIL_DAYS = 14;
export const ENDED_STATUSES = ["canceled", "expired"] as const;

export function isWinbackDue(input: { status: string | null; periodEnd: Date | null }, now: Date): boolean {
  if (!input.status || !(ENDED_STATUSES as readonly string[]).includes(input.status) || !input.periodEnd) return false;
  const since = now.getTime() - input.periodEnd.getTime();
  return since >= WINBACK_AFTER_DAYS * DAY_MS && since < WINBACK_UNTIL_DAYS * DAY_MS;
}

export const WINBACK_PUSH = {
  title: "Your store is saved",
  body: "Your products and orders are still here. Pick a plan to keep selling.",
};

export function winbackEmail(input: { brandName: string | null; productCount: number }): { subject: string; html: string } {
  const store = input.brandName?.trim() || "Your store";
  const products = input.productCount > 0
    ? `Your ${input.productCount} product${input.productCount === 1 ? " is" : "s are"} saved, along with your orders and customers.`
    : "Your store, orders and customers are saved.";
  return {
    subject: `${store} is ready when you are`,
    html: renderBrandthreadEmail({
      preheader: "Pick a plan to keep selling. Everything is where you left it.",
      title: `${store} is ready when you are`,
      subtitle: products,
      bodyHtml: `<p style="margin:0;color:#666666;">Pick a plan and your store is back on, with nothing to set up again.</p>`,
      cta: { label: "Pick a plan", url: `${getWebOrigin()}/plans` },
    }),
  };
}
