/**
 * Legacy `/settings` deep link. Buyer and seller settings are now separate
 * screens (app/buyer-settings.tsx, app/seller-settings.tsx) with different
 * sections for each mode — this route just forwards to the right one so old
 * links and the gear icon keep working.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useRole } from '@/contexts/RoleContext';
import { BrandedLoadingState } from '@/components/BrandthreadUI';

export default function SettingsRedirect() {
  const router = useRouter();
  const { role, isLoaded } = useRole();

  useEffect(() => {
    if (!isLoaded) return;
    router.replace((role === 'seller' ? '/seller-settings' : '/buyer-settings') as never);
  }, [isLoaded, role, router]);

  return (
    <View style={{ flex: 1 }}>
      <BrandedLoadingState />
    </View>
  );
}
