import React from 'react';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { isSellerDevPreview } from '@/lib/devPreview';
import { requiresSellerPreviewSignIn } from '@/lib/sellerPreviewRoutes';

export function SellerPreviewRouteGate({
  route,
  isTab = false,
  children,
}: {
  route: string;
  isTab?: boolean;
  children: React.ReactNode;
}) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  if (!isSellerDevPreview() || !requiresSellerPreviewSignIn(route, isTab) || (isLoaded && isSignedIn && userId)) {
    return <>{children}</>;
  }

  const label = route.replace(/^\(tabs\)\/?/, '').replace(/-/g, ' ');
  return (
    <View
      testID="seller-preview-sign-in-prompt"
      style={{
        flex: 1,
        backgroundColor: theme.background,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 28,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 100,
      }}
    >
      <Text style={{ color: theme.text, fontFamily: 'Inter_700Bold', fontSize: 22, textAlign: 'center' }}>
        Sign in to view {label}
      </Text>
      <Text style={{ color: theme.muted, fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center', marginTop: 12, marginBottom: 24 }}>
        This development preview shows sample dashboard data only. Seller details and actions require an account.
      </Text>
      <PrimaryButton label="Sign in" style={{ width: 220, marginBottom: 12 }} onPress={() => router.push('/sign-in')} />
      <PrimaryButton label="Back to dashboard" style={{ width: 220 }} onPress={() => router.replace('/(tabs)' as never)} />
    </View>
  );
}