import { describe, expect, it } from 'vitest';

import { isPayoutsNotReadyError, resolvePublishStatus, shouldShowFinishPayoutBanner } from '../payoutGate';

describe('resolvePublishStatus', () => {
  it('holds a new go-live as a draft while payouts are not set up', () => {
    expect(resolvePublishStatus({ requested: 'active', payoutsReady: false, alreadyLive: false }))
      .toEqual({ status: 'draft', heldForPayouts: true });
  });

  it('keeps a listing that was already live live (no auto-unpublish)', () => {
    expect(resolvePublishStatus({ requested: 'active', payoutsReady: false, alreadyLive: true }))
      .toEqual({ status: 'active', heldForPayouts: false });
  });

  it('publishes when payouts are ready, or tries when readiness is unknown (server still gates)', () => {
    expect(resolvePublishStatus({ requested: 'active', payoutsReady: true, alreadyLive: false }).status).toBe('active');
    expect(resolvePublishStatus({ requested: 'active', payoutsReady: null, alreadyLive: false }).status).toBe('active');
  });

  it('never changes a draft save', () => {
    expect(resolvePublishStatus({ requested: 'draft', payoutsReady: false, alreadyLive: false }))
      .toEqual({ status: 'draft', heldForPayouts: false });
  });
});

describe('shouldShowFinishPayoutBanner', () => {
  it('shows only when live listings exist and payouts are incomplete', () => {
    expect(shouldShowFinishPayoutBanner({ ready: false, liveProductCount: 2 })).toBe(true);
    expect(shouldShowFinishPayoutBanner({ ready: false, liveProductCount: 0 })).toBe(false);
    expect(shouldShowFinishPayoutBanner({ ready: true, liveProductCount: 2 })).toBe(false);
    expect(shouldShowFinishPayoutBanner({ ready: null, liveProductCount: 2 })).toBe(false);
  });
});

describe('isPayoutsNotReadyError', () => {
  it('matches the API error code', () => {
    expect(isPayoutsNotReadyError({ code: 'PAYOUTS_NOT_READY' })).toBe(true);
    expect(isPayoutsNotReadyError({ code: 'PLAN_LIMIT_REACHED' })).toBe(false);
    expect(isPayoutsNotReadyError(null)).toBe(false);
  });
});
