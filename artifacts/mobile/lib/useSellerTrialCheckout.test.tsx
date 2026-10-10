import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const statusMock = vi.hoisted(() => vi.fn());
vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
  Linking: { openURL: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ useApi: () => ({ seller: { subscription: { status: statusMock, checkout: vi.fn() } } }) }));
vi.mock('@/lib/revenueCat', () => ({ useRevenueCat: () => ({ packages: [], available: false }) }));
vi.mock('@/lib/sellerPlanConfig', async () => {
  const actual = await vi.importActual<typeof import('./sellerPlanConfig')>('./sellerPlanConfig');
  return { ...actual, useSellerPlanConfig: () => actual.DEFAULT_SELLER_PLAN_CONFIG };
});

import { useSellerTrialCheckout } from './useSellerTrialCheckout';

async function trialDaysAfterCheck(status: Record<string, unknown>) {
  statusMock.mockResolvedValue(status);
  let hook!: ReturnType<typeof useSellerTrialCheckout>;
  function Probe() { hook = useSellerTrialCheckout({ onActive: () => {} }); return null; }
  await act(async () => { create(<Probe />); });
  await act(async () => { await hook.checkExisting(); });
  return hook.trialDays('growth');
}

describe('web trial copy follows the server (Apple 3.1.2: never promise a trial Stripe will not give)', () => {
  it('eligible (or an older server without the field): the 7-day trial is offered', async () => {
    expect(await trialDaysAfterCheck({ status: 'none', trialEligible: true })).toBe(7);
    expect(await trialDaysAfterCheck({ status: 'none' })).toBe(7);
  });
  it('this account or device already had a trial: no trial is promised', async () => {
    expect(await trialDaysAfterCheck({ status: 'none', trialEligible: false })).toBeNull();
  });
});
