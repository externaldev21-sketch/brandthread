import { Redirect } from 'expo-router';

/** Preserve older plan links after the provider-aware subscription screen replaced them. */
export default function PlanDetailsRedirect() {
  return <Redirect href="/subscription" />;
}
