/**
 * Legacy `/push-notifications` link. It used to render a local-only list of
 * store-admin toggles ("Fulfillments", "Setup tips"…) that were never saved.
 * Notification preferences now live in the real, server-backed screens:
 * buyer → Settings › Notifications, seller → Notification settings.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useRole } from '@/contexts/RoleContext';
import { BrandedLoadingState } from '@/components/BrandthreadUI';

export default function PushNotificationsRedirect() {
  const router = useRouter();
  const { role, isLoaded } = useRole();

  useEffect(() => {
    if (!isLoaded) return;
    router.replace((role === 'seller' ? '/notifications-settings' : '/buyer-settings-detail?section=notifications') as never);
  }, [isLoaded, role, router]);

  return (
    <View style={{ flex: 1 }}>
      <BrandedLoadingState />
    </View>
  );
}
