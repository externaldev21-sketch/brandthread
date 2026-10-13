/**
 * Server guards on payout actions that need the seller to do something first:
 * two-factor authentication (api-server lib/security/sellerTwoFactor.ts) and
 * identity verification before the first payout (lib/money/firstPayoutGate.ts).
 * Shows one alert with a button to the screen that fixes it.
 */
import { Alert } from 'react-native';
import { ApiError } from '@/lib/networkNotice';

const GUARDS: Record<string, { title: string; message: string; action: string; route: string }> = {
  TWO_FACTOR_REQUIRED: {
    title: 'Turn on two-factor authentication',
    message: 'Payouts need a second sign-in step. It takes a minute with an authenticator app.',
    action: 'Set up',
    route: '/login-methods',
  },
  IDENTITY_REQUIRED: {
    title: 'Verify your identity',
    message: 'Your first payout is sent once you verify with a photo ID.',
    action: 'Verify',
    route: '/seller-verification',
  },
};

export function payoutGuardFor(error: unknown) {
  return error instanceof ApiError && error.code ? GUARDS[error.code] ?? null : null;
}

/** True when the error was a payout guard and an alert was shown. */
export function showPayoutGuard(error: unknown, push: (route: string) => void): boolean {
  const guard = payoutGuardFor(error);
  if (!guard) return false;
  Alert.alert(guard.title, guard.message, [
    { text: 'Not now', style: 'cancel' },
    { text: guard.action, onPress: () => push(guard.route) },
  ]);
  return true;
}
