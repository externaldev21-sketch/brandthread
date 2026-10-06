import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { goBackOr } from '@/lib/navigation/goBackOr';

/**
 * Automations aren't built yet and nothing in the app links here. The route
 * stays registered only so an old deep link backs out to where the user came
 * from (or the seller dashboard) instead of a placeholder screen.
 */
export default function AutomationScreen() {
  const router = useRouter();
  useEffect(() => { goBackOr(router, '/(tabs)/' as never); }, [router]);
  return <View style={{ flex: 1, backgroundColor: 'transparent' }} />;
}
