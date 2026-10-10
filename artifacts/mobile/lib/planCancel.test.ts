import { describe, expect, it } from 'vitest';
import { accessEndLabel, cancelConfirmCopy, planCancelAction } from './planCancel';

describe('Settings → Plan → Cancel plan', () => {
  it('offers Cancel on a live plan, Resubscribe once cancelled, and the old Manage otherwise', () => {
    expect(planCancelAction({ status: 'trialing', effectiveProvider: 'stripe' })).toBe('cancel');
    expect(planCancelAction({ status: 'trial', effectiveProvider: 'revenuecat' })).toBe('cancel');
    expect(planCancelAction({ status: 'active', effectiveProvider: 'stripe', cancelAtPeriodEnd: true })).toBe('resubscribe');
    expect(planCancelAction({ status: 'none', effectiveProvider: 'none' })).toBe('manage');
    expect(planCancelAction({ status: 'canceled', effectiveProvider: 'stripe' })).toBe('manage');
  });

  it('says there is no charge in the trial and when access ends', () => {
    const iso = new Date(2026, 9, 20, 12).toISOString();
    expect(accessEndLabel(iso)).toBe('Oct 20');
    expect(accessEndLabel(null)).toBeNull();
    expect(cancelConfirmCopy({ status: 'trialing', effectiveProvider: 'stripe', accessEndsAt: iso }).message)
      .toBe("You won't be charged. You can keep selling until Oct 20. After that, pick a plan to keep selling. Your store and products are kept.");
    expect(cancelConfirmCopy({ status: 'active', effectiveProvider: 'stripe' }).message).toContain("You won't be charged again.");
    expect(cancelConfirmCopy({ status: 'trial', effectiveProvider: 'revenuecat' }).message).toContain('store subscriptions');
  });
});
