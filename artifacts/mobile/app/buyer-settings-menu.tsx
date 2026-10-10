import { Redirect } from 'expo-router';

/** Legacy menu links lead to the consolidated settings screen. */
export default function BuyerSettingsMenuScreen() {
  return <Redirect href="/buyer-settings" />;
}
