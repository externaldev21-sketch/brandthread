/**
 * "Best time: Thu 7 PM" — one tappable suggestion under the launch time
 * picker, from when the seller's followers are most active (GET
 * /api/product-launches/best-time). Tapping sets the picker to the next
 * occurrence of that slot; the chip shows as selected once it's applied.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';
import { FONT, FS, ICON, RADIUS } from '@/lib/theme';
import { slotLabel, type ActiveSlot } from '@/lib/productLaunchChecklist';

export function BestTimeSuggestion({ slot, selected, onPress }: { slot: ActiveSlot; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  const label = `Best time: ${slotLabel(slot)}`;
  return (
    <PressableScale
      onPress={() => { hapticSelection(); onPress(); }}
      style={[s.chip, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : colors.card }]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}. Use this time`}
      testID="launch-best-time"
    >
      <Feather name="trending-up" size={ICON.xs} color={selected ? colors.primaryForeground : colors.foreground} />
      <Text style={[s.text, { color: selected ? colors.primaryForeground : colors.foreground }]} numberOfLines={1}>{label}</Text>
    </PressableScale>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 14, minHeight: 40,
  },
  text: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
