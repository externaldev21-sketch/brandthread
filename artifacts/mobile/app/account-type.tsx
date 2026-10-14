/**
 * Old deep link. The buyer/seller choice now lives on the onboarding Sign up
 * screen as two plain rows, so this route only forwards there.
 */
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

export type AccountType = 'buyer' | 'seller';

export default function AccountTypeScreen() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/onboarding' as never);
  }, [router]);

  return <View style={{ flex: 1, backgroundColor: 'transparent' }} />;
}
