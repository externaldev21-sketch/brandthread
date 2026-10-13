/**
 * Preview as buyer — full-screen buyer product page for the listing being
 * edited in app/add-product.tsx. The form hands its current values over in
 * memory (lib/draftBuyerPreview.ts); nothing is saved or fetched here.
 */
import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/layout';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { getDraftPreviewRow } from '@/lib/draftBuyerPreview';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import {
  BuyerProductPreview,
  BuyerProductPreviewActionBar,
  buyerProductFromDraftRow,
} from '@/components/product/BuyerProductPreview';

export default function ProductPreviewAsBuyerScreen() {
  useHideTabBar();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const product = useMemo(() => {
    const row = getDraftPreviewRow();
    return row ? buyerProductFromDraftRow(row) : null;
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title="Preview" />
      {product ? (
        <>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 144 }}
            testID="product-preview-as-buyer"
          >
            <BuyerProductPreview product={product} />
          </ScrollView>
          <BuyerProductPreviewActionBar product={product} />
        </>
      ) : (
        <EmptyState
          icon="eye"
          message="Open this from a listing to see it as a buyer."
          actionLabel="Go back"
          onAction={() => goBackOr(router, '/add-product')}
          testID="product-preview-as-buyer-empty"
        />
      )}
    </View>
  );
}
