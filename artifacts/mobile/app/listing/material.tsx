/**
 * Material (recommended) — Vinted's material list; picking one returns to
 * the form, picking it again clears it.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListChoiceRow } from '@/components/listing/ListingRows';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { updateListing, useListing } from '@/lib/listing/listingStore';
import { MATERIALS } from '@/lib/listing/taxonomy';

export default function ListingMaterialScreen() {
  useHideTabBar();
  const { theme } = useAppTheme();
  const router = useRouter();
  const form = useListing();
  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]} testID="listing-material-screen">
      <ScreenHeader title="Material" />
      <ScrollView contentContainerStyle={styles.content}>
        {MATERIALS.map(m => (
          <ListChoiceRow
            key={m}
            label={m}
            selected={form.material === m}
            onPress={() => { updateListing({ material: form.material === m ? undefined : m }); router.back(); }}
            testID={`listing-material-${m}`}
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
