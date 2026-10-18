/**
 * Colours — Vinted's colour list: a swatch, the name and a checkbox; up to
 * two colours, confirmed with Done.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CheckRow, GroupNote, ListingBottomBar } from '@/components/listing/ListingRows';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { updateListing, useListing } from '@/lib/listing/listingStore';
import { COLORS, MAX_COLORS } from '@/lib/listing/taxonomy';

export default function ListingColorsScreen() {
  useHideTabBar();
  const { theme } = useAppTheme();
  const router = useRouter();
  const form = useListing();
  const full = form.colors.length >= MAX_COLORS;

  function toggle(name: string) {
    updateListing(prev => ({
      colors: prev.colors.includes(name) ? prev.colors.filter(c => c !== name) : [...prev.colors, name].slice(0, MAX_COLORS),
    }));
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]} testID="listing-colors-screen">
      <ScreenHeader title="Colours" />
      <ScrollView contentContainerStyle={styles.content}>
        <GroupNote>{`Choose up to ${MAX_COLORS} colours.`}</GroupNote>
        {COLORS.map(c => {
          const checked = form.colors.includes(c.name);
          return (
            <CheckRow
              key={c.name}
              label={c.name}
              checked={checked}
              disabled={full && !checked}
              onPress={() => toggle(c.name)}
              leading={(
                <View style={[styles.swatch, { borderColor: theme.border, backgroundColor: c.hex || theme.surface }]}>
                  {!c.hex ? <Feather name="grid" size={12} color={theme.muted} /> : null}
                </View>
              )}
              testID={`listing-color-${c.name}`}
            />
          );
        })}
      </ScrollView>
      <ListingBottomBar primaryLabel="Done" onPrimary={() => router.back()} primaryTestID="listing-colors-done" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 24 },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
});
