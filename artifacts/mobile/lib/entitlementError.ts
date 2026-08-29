import { ApiError } from './networkNotice';

export type EntitlementRejection = {
  code: 'PLAN_REQUIRED' | 'PLAN_LIMIT_REACHED';
  requiredPlan: 'growth' | 'scale';
  message: string;
};

export function getEntitlementRejection(error: unknown): EntitlementRejection | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code !== 'PLAN_REQUIRED' && error.code !== 'PLAN_LIMIT_REACHED') return null;
  try {
    const body = JSON.parse(error.body) as Record<string, unknown>;
    const requiredPlan = body.requiredPlan;
    if (requiredPlan !== 'growth' && requiredPlan !== 'scale') return null;
    return {
      code: error.code,
      requiredPlan,
      message: typeof body.message === 'string'
        ? body.message
        : `Upgrade to ${requiredPlan === 'growth' ? 'Growth' : 'Scale'} to continue.`,
    };
  } catch {
    return null;
  }
}
