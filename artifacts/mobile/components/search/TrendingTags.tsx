import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { hapticSelection } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII } from '@/constants/radii';

const DEMO_TAGS = ['ootd', 'streetwear', 'thrifted', 'vintage', 'y2k'];

/**
 * "Trending" chip row for the search entry state. Renders nothing until the
 * server returns at least one tag, so an empty platform shows no row at all.
 * In the web preview nothing is fetched; `&demo=1` shows sample tags.
 */
export function TrendingTags({ onPress }: { onPress: (tag: string) => void }) {
  const { theme } = useAppTheme();
  const api = useApi();
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (isBuyerDevPreview()) {
      setTags(isPreviewDemoMode() ? DEMO_TAGS : []);
      return;
    }
    Promise.resolve().then(() => api.hashtags.trending(10))
      .then((res) => { if (!cancelled) setTags(res.tags.map((t) => t.tag)); })
      .catch(() => { if (!cancelled) setTags([]); });
    return () => { cancelled = true; };
  }, [api]);

  if (tags.length === 0) return null;
  return (
    <View testID="search-trending-tags">
      <Text style={[styles.label, { color: theme.muted }]}>Trending</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.track}>
        {tags.map((tag) => (
          <TouchableOpacity
            key={tag}
            onPress={() => { hapticSelection(); onPress(tag); }}
            accessibilityRole="button"
            accessibilityLabel={`Trending hashtag ${tag}`}
            style={[styles.chip, { borderColor: theme.border, backgroundColor: theme.surface }]}
            testID={`trending-tag-${tag}`}
          >
            <Text style={[TYPE_SCALE.footnote, { color: theme.text, fontFamily: FONT.medium }]}>#{tag}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...TYPE_SCALE.caption, fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 1.2, paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.sm, paddingBottom: SPACING.xs },
  track: { flexDirection: 'row', gap: SPACING.xs, paddingHorizontal: SCREEN_GUTTER, paddingBottom: SPACING.sm },
  chip: { height: 34, borderRadius: RADII.pill, borderWidth: 1, paddingHorizontal: SPACING.md, alignItems: 'center', justifyContent: 'center' },
});
