import { ApiError } from './networkNotice';

export type EntitlementRejection = {
  code: 'PLAN_REQUIRED' | 'PLAN_LIMIT_REACHED';
  requiredPlan: 'starter' | 'growth' | 'pro';
  message: string;
};

export function getEntitlementRejection(error: unknown): EntitlementRejection | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code !== 'PLAN_REQUIRED' && error.code !== 'PLAN_LIMIT_REACHED') return null;
  try {
    const body = JSON.parse(error.body) as Record<string, unknown>;
    const requiredPlan = body.requiredPlan;
    // 'starter': a seller on the free limits (no paid subscription, BT-002).
    if (requiredPlan !== 'starter' && requiredPlan !== 'growth' && requiredPlan !== 'pro') return null;
    return {
      code: error.code,
      requiredPlan,
      message: typeof body.message === 'string'
        ? body.message
        : requiredPlan === 'starter'
          ? 'Start a plan to continue.'
          : `Upgrade to ${requiredPlan === 'growth' ? 'Growth' : 'Pro'} to continue.`,
    };
  } catch {
    return null;
  }
}
