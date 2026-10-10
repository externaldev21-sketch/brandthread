import { Alert } from 'react-native';
import { getEntitlementRejection } from './entitlementError';

type Pusher = { push: (href: never) => void };

/**
 * When the server refuses an action because of the seller's plan
 * (403 PLAN_REQUIRED / PLAN_LIMIT_REACHED), show the upgrade prompt with the
 * server's own sentence instead of a generic error. Same dialog as Boost,
 * Team and the Manufacturer Hub. Returns false for any other error so the
 * caller shows its usual message.
 */
export function promptUpgradeOnPlanGate(error: unknown, router: Pusher): boolean {
  const rejection = getEntitlementRejection(error);
  if (!rejection) return false;
  Alert.alert(`Upgrade to ${rejection.requiredPlan === 'pro' ? 'Pro' : 'Growth'}`, rejection.message, [
    { text: 'Not now', style: 'cancel' },
    { text: 'View plans', onPress: () => router.push('/subscription' as never) },
  ]);
  return true;
}
