/**
 * Condition — Vinted's five-step scale, radio rows with a one-line
 * description; picking one returns to the form.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RadioRow } from '@/components/listing/ListingRows';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { updateListing, useListing } from '@/lib/listing/listingStore';
import { CONDITIONS } from '@/lib/listing/taxonomy';

export default function ListingConditionScreen() {
  useHideTabBar();
  const { theme } = useAppTheme();
  const router = useRouter();
  const form = useListing();
  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]} testID="listing-condition-screen">
      <ScreenHeader title="Condition" />
      <ScrollView contentContainerStyle={styles.content}>
        {CONDITIONS.map(c => (
          <RadioRow
            key={c.value}
            label={c.label}
            description={c.description}
            selected={form.condition === c.value}
            onPress={() => { updateListing({ condition: c.value }); router.back(); }}
            testID={`listing-condition-${c.value}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 48 },
});
