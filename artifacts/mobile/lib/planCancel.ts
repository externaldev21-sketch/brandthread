/**
 * Settings → Plan → "Cancel plan" (Dev's trial decision). A plan bought in
 * the app is cancelled in the App Store / Google Play subscription page; a
 * web (Stripe) plan is cancelled directly. Cancelling during the trial means
 * no charge; access continues until the end date, then the seller picks a
 * plan to keep selling (their data is kept). One tap resubscribes.
 */
export type PlanCancelStatus = {
  status: string;
  effectiveProvider: string;
  cancelAtPeriodEnd?: boolean;
  accessEndsAt?: string | null;
  manageUrl?: string | null;
};

export type PlanCancelAction = 'cancel' | 'resubscribe' | 'manage';

/** What the plan screen's cancel button does for this subscription. */
export function planCancelAction(s: PlanCancelStatus): PlanCancelAction {
  const live = s.status === 'trialing' || s.status === 'active' || s.status === 'past_due'
    || s.status === 'trial' || s.status === 'grace';
  if (!live || (s.effectiveProvider !== 'stripe' && s.effectiveProvider !== 'revenuecat')) return 'manage';
  return s.cancelAtPeriodEnd ? 'resubscribe' : 'cancel';
}

/** "Oct 20" */
export function accessEndLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The confirmation before cancelling; the words match what happens (App Store 3.1.2). */
export function cancelConfirmCopy(s: PlanCancelStatus): { title: string; message: string } {
  const until = accessEndLabel(s.accessEndsAt);
  const inTrial = s.status === 'trialing' || s.status === 'trial';
  const access = until ? `You can keep selling until ${until}.` : 'You can keep selling until the end of this period.';
  const message = `${inTrial ? "You won't be charged." : "You won't be charged again."} ${access} After that, pick a plan to keep selling. Your store and products are kept.`;
  if (s.effectiveProvider === 'revenuecat') {
    return { title: 'Cancel your plan?', message: `${message}\n\nThis plan was bought in the app, so you'll finish cancelling in your store subscriptions.` };
  }
  return { title: 'Cancel your plan?', message };
}
