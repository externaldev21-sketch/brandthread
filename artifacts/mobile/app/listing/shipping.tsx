/**
 * Shipping — Vinted's "Parcel size" screen (Small / Medium / Large radio
 * rows with what fits in each, then Done), with Depop's choice of who pays
 * for shipping above it.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { GroupTitle, ListingBottomBar, RadioRow, SectionGap } from '@/components/listing/ListingRows';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { updateListing, useListing } from '@/lib/listing/listingStore';
import { PARCEL_SIZES, SHIPPING_PAYERS } from '@/lib/listing/taxonomy';

export default function ListingShippingScreen() {
  useHideTabBar();
  const { theme } = useAppTheme();
  const router = useRouter();
  const form = useListing();
  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]} testID="listing-shipping-screen">
      <ScreenHeader title="Shipping" />
      <ScrollView contentContainerStyle={styles.content}>
        <GroupTitle>Parcel size</GroupTitle>
        {PARCEL_SIZES.map(p => (
          <RadioRow
            key={p.value}
            label={p.label}
            description={p.description}
            selected={form.parcelSize === p.value}
            onPress={() => updateListing({ parcelSize: p.value })}
            testID={`listing-parcel-${p.value}`}
          />
        ))}
        <SectionGap />
        <GroupTitle>Who pays for shipping</GroupTitle>
        {SHIPPING_PAYERS.map(p => (
          <RadioRow
            key={p.value}
            label={p.label}
            description={p.description}
            selected={form.shippingPayer === p.value}
            onPress={() => updateListing({ shippingPayer: p.value })}
            testID={`listing-payer-${p.value}`}
          />
        ))}
      </ScrollView>
      <ListingBottomBar primaryLabel="Done" onPrimary={() => router.back()} primaryTestID="listing-shipping-done" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 24 },
});
