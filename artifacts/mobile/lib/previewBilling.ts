/**
 * Seller web preview (`?bt_preview=seller`) data for the Plan & billing
 * screen. The preview can't call the API, so `&demo=1` shows a Growth plan
 * with sample invoices; fresh mode shows no plan and no bills.
 */
import type { PlanBillingStatus } from './sellerPlanBilling';

export interface PreviewInvoice {
  id: string;
  created: string;
  description: string;
  amountCents: number;
  currency: string;
  status: 'paid' | 'unpaid';
}

function shortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Sample Growth plan for `&demo=1` only. */
export function demoBillingStatus(now: Date = new Date()): PlanBillingStatus {
  return {
    plan: 'growth',
    status: 'active',
    trialEnd: null,
    renewsOn: shortDate(addDays(now, 23)),
    amountCents: 7900,
    paymentMethodLabel: 'Visa ···· 4242',
    cancelAtPeriodEnd: false,
    effectiveProvider: 'stripe',
  };
}

/** Sample monthly invoices for `&demo=1` only. */
export function demoInvoices(now: Date = new Date()): PreviewInvoice[] {
  return [7, 37, 67].map((daysAgo, index) => ({
    id: `in_demo_${3 - index}`,
    created: addDays(now, -daysAgo).toISOString(),
    description: 'Brandthread Growth Plan',
    amountCents: 7900,
    currency: 'usd',
    status: 'paid' as const,
  }));
}
