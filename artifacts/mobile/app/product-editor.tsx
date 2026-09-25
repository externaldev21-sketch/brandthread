/**
 * Product Editor — redirect into the real Add/Edit Product screen.
 *
 * This used to be a second, parallel "create a product" form whose rows
 * (description, category, shipping, type, vendor, collections, tags, SEO...)
 * only fired a haptic and did nothing — a dead end wherever it was reached
 * from, and a duplicate of the fully-wired add-product.tsx (photos with
 * one-tap background removal, pricing, variant/stock grid, publish). Rather
 * than maintain two product forms, this route now forwards into the real
 * one, passing `id` through as `editId` so it opens pre-filled for editing.
 */
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';

export default function ProductEditorRedirect() {
  const { theme } = useAppTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(id ? `/add-product?editId=${id}` : '/add-product');
  }, [id, router]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
      <ActivityIndicator color={theme.accent} />
    </View>
  );
}
