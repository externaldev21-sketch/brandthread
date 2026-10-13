/**
 * Buyer onboarding finale — Pinterest's "Meet your home feed"
 * (https://mobbin.com/flows/181f0864-8d03-4f31-9aef-99dd251b93cb): instead
 * of a "You're all set" checklist, a first look at what their feed holds,
 * built from real catalogue products for the interests they just picked,
 * and one button into it. With nothing to show, it's the headline and the
 * button only.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useApi } from '@/lib/api';
import { pickFeedPreviewPhotos } from '@/lib/onboardingInterests';
import { PillButton } from './OnboardingUI';
import { SPACE, TYPE } from './onboardingTokens';

const GAP = 6;
const MAX_TILES = 6;

export function FeedPreviewStep({
  interests,
  onFinish,
  finishing,
}: {
  interests: readonly string[];
  onFinish: () => void;
  finishing?: boolean;
}) {
  const { theme } = useAppTheme();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const { width } = useWindowDimensions();
  const [photos, setPhotos] = useState<string[]>([]);
  const tileWidth = Math.floor((Math.min(width, 600) - SPACE.lg * 2 - GAP) / 2);

  useEffect(() => {
    let active = true;
    const queries = interests.slice(0, 4);
    Promise.all(queries.map((q) => api.public.search({ q, limit: 8 }).then((r) => r?.results ?? []).catch(() => [])))
      .then((responses) => { if (active) setPhotos(pickFeedPreviewPhotos(responses, MAX_TILES)); });
    return () => { active = false; };
    // Interests are fixed by the time the finale shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns = [photos.filter((_, i) => i % 2 === 0), photos.filter((_, i) => i % 2 === 1)];

  return (
    <View style={[styles.root, { backgroundColor: theme.background, paddingTop: headerTopInset + SPACE.lg, paddingBottom: insets.bottom + SPACE.lg }]} testID="onboarding-feed-preview">
      <Text style={[TYPE.title1, { color: theme.text }]}>Your feed is ready</Text>

      <View style={styles.preview}>
        {photos.length > 0 ? (
          <View style={styles.grid}>
            {columns.map((col, c) => (
              // Second column starts lower, like a real masonry feed.
              <View key={c} style={[styles.column, c === 1 && styles.columnOffset]}>
                {col.map((uri) => (
                  <CachedImage
                    key={uri}
                    source={{ uri }}
                    style={[styles.tile, { width: tileWidth, height: Math.round(tileWidth * 4 / 3) }]}
                    contentFit="cover"
                    recyclingKey={uri}
                    accessibilityIgnoresInvertColors
                  />
                ))}
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <PillButton
        testID="onboarding-see-feed"
        label={finishing ? 'Saving…' : 'See my feed'}
        onPress={onFinish}
        loading={finishing}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: SPACE.lg },
  preview: { flex: 1, marginVertical: SPACE.lg, overflow: 'hidden' },
  grid: { flexDirection: 'row', gap: GAP },
  column: { gap: GAP },
  columnOffset: { marginTop: SPACE.xl },
  tile: { borderRadius: 12, backgroundColor: '#1C1C1E' },
});
