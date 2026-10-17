/**
 * Size — Vinted's size list (check on the right), with Depop's "multiple
 * sizes": pick more than one and each picked size gets its own quantity,
 * which publishes as one variant per size.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CheckRow, GroupNote, ListingBottomBar } from '@/components/listing/ListingRows';
import { QuantityStepper } from '@/components/ui/QuantityStepper';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { updateListing, useListing } from '@/lib/listing/listingStore';
import { sizeOptionsFor } from '@/lib/listing/taxonomy';

export default function ListingSizeScreen() {
  useHideTabBar();
  const { theme } = useAppTheme();
  const router = useRouter();
  const form = useListing();
  const options = sizeOptionsFor(form.department, form.category);
  const multi = form.sizes.length > 1;

  function toggle(size: string) {
    updateListing(prev => {
      const picked = prev.sizes.some(sz => sz.size === size);
      if (picked) {
        const rest = prev.sizes.filter(sz => sz.size !== size);
        // Back to one size: its count becomes the listing's quantity again.
        return rest.length === 1 ? { sizes: rest, quantity: rest[0].quantity || 1 } : { sizes: rest };
      }
      // Keep the list in the option order (S, M, L…), not tap order.
      const next = [...prev.sizes, { size, quantity: prev.sizes.length === 0 ? prev.quantity || 1 : 1 }];
      return { sizes: next.sort((a, b) => options.indexOf(a.size) - options.indexOf(b.size)) };
    });
  }

  function setQty(size: string, quantity: number) {
    updateListing(prev => ({ sizes: prev.sizes.map(sz => sz.size === size ? { ...sz, quantity } : sz) }));
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]} testID="listing-size-screen">
      <ScreenHeader title="Size" />
      <ScrollView contentContainerStyle={styles.content}>
        <GroupNote>Selling the same item in more than one size? Select each size and set how many you have.</GroupNote>
        {options.map(size => {
          const picked = form.sizes.find(sz => sz.size === size);
          return (
            <CheckRow
              key={size}
              label={size}
              checked={!!picked}
              onPress={() => toggle(size)}
              right={picked && multi ? (
                <QuantityStepper
                  size="sm"
                  value={picked.quantity}
                  min={0}
                  max={9999}
                  onChange={q => setQty(size, q)}
                  itemLabel={size}
                  testID={`listing-size-qty-${size}`}
                />
              ) : undefined}
              testID={`listing-size-${size}`}
            />
          );
        })}
      </ScrollView>
      <ListingBottomBar primaryLabel="Done" onPrimary={() => router.back()} primaryTestID="listing-size-done" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 24 },
});
