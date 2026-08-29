import { describe, expect, it } from 'vitest';
import { ApiError } from './networkNotice';
import { getEntitlementRejection } from './entitlementError';

describe('getEntitlementRejection', () => {
  it('maps feature gates to an upgrade target', () => {
    const error = new ApiError(403, JSON.stringify({
      code: 'PLAN_REQUIRED',
      requiredPlan: 'growth',
      message: 'Upgrade to unlock it.',
    }));
    expect(getEntitlementRejection(error)).toEqual({
      code: 'PLAN_REQUIRED',
      requiredPlan: 'growth',
      message: 'Upgrade to unlock it.',
    });
  });

  it('maps exhausted limits to the next plan', () => {
    const error = new ApiError(403, JSON.stringify({
      code: 'PLAN_LIMIT_REACHED',
      requiredPlan: 'scale',
      message: 'Upgrade to add more.',
    }));
    expect(getEntitlementRejection(error)?.requiredPlan).toBe('scale');
  });

  it('does not turn unrelated failures into upgrade prompts', () => {
    expect(getEntitlementRejection(new ApiError(500, '{"error":"failed"}'))).toBeNull();
  });
});