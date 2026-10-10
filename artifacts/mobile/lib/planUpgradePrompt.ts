import { Alert, Platform } from 'react-native';
import { getEntitlementRejection } from './entitlementError';

type Pusher = { push: (href: never) => void };

/**
 * When the server refuses an action because of the seller's plan
 * (403 PLAN_REQUIRED / PLAN_LIMIT_REACHED), show the upgrade prompt with the
 * server's own sentence instead of a generic error. Same dialog as Boost,
 * Team and the Manufacturer Hub. Returns false for any other error so the
 * caller shows its usual message. On web, where react-native-web's
 * Alert.alert does nothing, the browser's confirm dialog asks instead.
 */
export function promptUpgradeOnPlanGate(error: unknown, router: Pusher): boolean {
  const rejection = getEntitlementRejection(error);
  if (!rejection) return false;
  const title = `Upgrade to ${rejection.requiredPlan === 'pro' ? 'Pro' : 'Growth'}`;
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${rejection.message}`)) router.push('/subscription' as never);
    return true;
  }
  Alert.alert(title, rejection.message, [
    { text: 'Not now', style: 'cancel' },
    { text: 'View plans', onPress: () => router.push('/subscription' as never) },
  ]);
  return true;
}
