/**
 * "What do you want to see?" as Pinterest's photo-tile grid
 * (https://mobbin.com/flows/181f0864-8d03-4f31-9aef-99dd251b93cb): three
 * square tiles per row, the label under each tile, and a white check badge
 * plus a white ring on the ones picked. Photos are real catalogue products
 * for that interest (lib/onboardingInterests.ts); a tile with no match is a
 * plain #1C1C1E square.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { pickInterestPhoto } from '@/lib/onboardingInterests';
import { SPACE, TYPE } from './onboardingTokens';

const COLUMNS = 3;
const GAP = 8;
// Card surface of the elevation system (#1C1C1E) for tiles without a photo.
const TILE_FILL = '#1C1C1E';

export function InterestTileGrid({
  interests,
  selected,
  onToggle,
  horizontalPadding = SPACE.lg,
}: {
  interests: readonly string[];
  selected: readonly string[];
  onToggle: (interest: string) => void;
  horizontalPadding?: number;
}) {
  const { theme } = useAppTheme();
  const api = useApi();
  const { width } = useWindowDimensions();
  const tile = Math.floor((Math.min(width, 600) - horizontalPadding * 2 - GAP * (COLUMNS - 1)) / COLUMNS);
  const [photos, setPhotos] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let active = true;
    interests.forEach((interest) => {
      api.public.search({ q: interest, limit: 6 })
        .then((res) => { if (active) setPhotos((prev) => ({ ...prev, [interest]: pickInterestPhoto(res?.results) })); })
        .catch(() => { if (active) setPhotos((prev) => ({ ...prev, [interest]: null })); });
    });
    return () => { active = false; };
    // Interests are a fixed list for the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.grid} testID="onboarding-interest-grid">
      {interests.map((interest) => {
        const isOn = selected.includes(interest);
        const photo = photos[interest];
        return (
          <PressableScale
            key={interest}
            style={[styles.cell, { width: tile }]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isOn }}
            accessibilityLabel={interest}
            testID={`onboarding-interest-${interest.toLowerCase().replace(/\s+/g, '-')}`}
            onPress={() => { Haptics.selectionAsync(); onToggle(interest); }}
          >
            <View
              style={[
                styles.tile,
                { width: tile, height: tile, backgroundColor: TILE_FILL, borderColor: isOn ? theme.text : 'transparent' },
              ]}
            >
              {photo ? (
                <CachedImage source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={photo} />
              ) : null}
              {isOn ? (
                <View style={[styles.check, {backgroundColor: theme.text}]}>
                  <Feather name="check" size={14} color={theme.background} />
                </View>
              ) : null}
            </View>
            <Text style={[TYPE.label, styles.label, { color: theme.text }]} numberOfLines={2}>{interest}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, rowGap: SPACE.md, marginTop: SPACE.xl, marginBottom: SPACE.md },
  cell: { alignItems: 'center' },
  tile: { borderRadius: 12, borderWidth: 2, overflow: 'hidden' },
  check: {
    position: 'absolute', top: 6, right: 6,
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  label: { marginTop: 6, textAlign: 'center' },
});
