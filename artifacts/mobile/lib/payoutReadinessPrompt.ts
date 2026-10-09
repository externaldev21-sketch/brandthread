/**
 * The system alert shown before something goes live while payouts are
 * missing (BT-206). Resolves true to publish, false when the seller chose to
 * set up payouts (they're taken to payout setup) or cancelled.
 */
import { Alert, Platform } from 'react-native';
import { PAYOUTS_MISSING_MESSAGE, PAYOUTS_MISSING_TITLE, payoutsMissingForPublish } from './payoutReadiness';

type ConnectApi = { seller: { connect: { status: () => Promise<unknown> } } };
type Navigator = { push: (href: never) => void };

export async function confirmPublishWithoutPayouts(api: ConnectApi, router: Navigator): Promise<boolean> {
  // Alert.alert is a no-op on web; checkout itself still guards payments there.
  if (Platform.OS === 'web') return true;
  let raw: unknown = null;
  try {
    raw = await Promise.race([
      api.seller.connect.status(),
      new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
  } catch {
    return true;
  }
  if (!payoutsMissingForPublish(raw)) return true;
  return new Promise((resolve) => {
    Alert.alert(PAYOUTS_MISSING_TITLE, PAYOUTS_MISSING_MESSAGE, [
      {
        text: 'Set Up Payouts',
        onPress: () => {
          resolve(false);
          router.push('/payout-setup' as never);
        },
      },
      { text: 'Publish Anyway', onPress: () => resolve(true) },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
