/**
 * Select stories — the stories step of a highlight. Reached from the
 * Highlights manager's create / edit sheet. Shows my live and archived
 * stories as a 3-column grid; tapping toggles a story in the highlight.
 * The server snapshots the media, so a highlight outlives the 24 h story.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Alert, useWindowDimensions } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { hapticSelection, hapticSuccessAction } from '@/lib/haptics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/BrandthreadUI';
import { StickyBottomCTA } from '@/components/ui';
import { CachedImage } from '@/components/CachedImage';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useApi, type HighlightPickerStory } from '@/lib/api';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { previewHighlightPickerStories } from '@/lib/previewHighlights';

const GAP = 2;
const COLUMNS = 3;

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function BuyerHighlightStories() {
  const { theme } = useAppTheme();
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { highlightId } = useLocalSearchParams<{ highlightId?: string }>();
  const demo = isPreviewDemoMode();

  const [stories, setStories] = useState<HighlightPickerStory[]>([]);
  // storyId -> highlight item id for stories already in the highlight.
  const [existing, setExisting] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    (async () => {
      try {
        if (demo) {
          const list = previewHighlightPickerStories();
          if (!alive) return;
          setStories(list);
          setExisting(new Map());
          setSelected(new Set(list.slice(0, 2).map((s) => s.storyId)));
          return;
        }
        if (!highlightId) throw new Error('missing highlight');
        const [pickable, mine] = await Promise.all([api.social.highlightStories(), api.social.myHighlights()]);
        if (!alive) return;
        const current = mine.find((h) => h.id === highlightId);
        const map = new Map<string, string>();
        (current?.items ?? []).forEach((i) => { if (i.storyId) map.set(i.storyId, i.id); });
        setStories(pickable);
        setExisting(map);
        setSelected(new Set(map.keys()));
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [api, demo, highlightId]);

  useFocusEffect(load);

  const toggle = (storyId: string) => {
    hapticSelection();
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(storyId) ? next.delete(storyId) : next.add(storyId);
      return next;
    });
  };

  const save = async () => {
    if (saving) return;
    if (demo || !highlightId) { goBackOr(router); return; }
    setSaving(true);
    try {
      const toAdd = [...selected].filter((id) => !existing.has(id));
      const toRemove = [...existing.entries()].filter(([storyId]) => !selected.has(storyId));
      for (const storyId of toAdd) await api.social.addHighlightItem(highlightId, storyId);
      for (const [, itemId] of toRemove) await api.social.removeHighlightItem(highlightId, itemId);
      hapticSuccessAction();
      goBackOr(router);
    } catch {
      Alert.alert('Could not save', 'Your highlight was not updated. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const cell = useMemo(() => (Math.min(width, 520) - GAP * (COLUMNS - 1)) / COLUMNS, [width]);
  const s = useMemo(() => makeStyles(theme, cell), [theme, cell]);

  const renderItem = ({ item }: { item: HighlightPickerStory }) => {
    const on = selected.has(item.storyId);
    return (
      <Pressable
        onPress={() => toggle(item.storyId)}
        style={s.cell}
        accessibilityRole="button"
        accessibilityLabel={`Story from ${dayLabel(item.createdAt)}`}
        accessibilityState={{ selected: on }}
        testID={`highlight-story-${item.storyId}`}
      >
        {item.thumbnailUrl
          ? <CachedImage source={{ uri: item.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={item.storyId} />
          : <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.cardElevated }]} />}
        <Text style={s.date}>{dayLabel(item.createdAt)}</Text>
        <View style={[s.check, on && s.checkOn]}>
          {on ? <Icon name="check" size={14} color={theme.background} /> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={s.page}>
      <ScreenHeader title="Select stories" />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.text} /></View>
      ) : failed ? (
        <EmptyState icon="alert-circle" title="Couldn't load your stories" description="Check your connection and try again."
          action={{ label: 'Try again', onPress: () => { load(); } }} />
      ) : (
        <FlatList
          data={stories}
          keyExtractor={(item) => item.storyId}
          numColumns={COLUMNS}
          renderItem={renderItem}
          columnWrapperStyle={{ gap: GAP }}
          ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
          ListEmptyComponent={
            <EmptyState icon="image" title="No stories yet" description="Stories you post show up here, and stay here after they expire." />
          }
        />
      )}
      <StickyBottomCTA
        label={selected.size > 0 ? `Done (${selected.size})` : 'Done'}
        onPress={() => { void save(); }}
        loading={saving}
      />
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme'], cell: number) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cell: { width: cell, height: cell * (16 / 9) * 0.8, backgroundColor: theme.cardElevated, overflow: 'hidden' },
  date: {
    position: 'absolute', left: SPACING.xs, bottom: SPACING.xs, color: theme.text, backgroundColor: theme.background,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADII.chip, overflow: 'hidden',
    fontFamily: FONT.semibold, ...TYPE_SCALE.caption,
  },
  check: {
    position: 'absolute', top: SPACING.xs, right: SPACING.xs, width: 24, height: 24, borderRadius: RADII.full,
    borderWidth: 2, borderColor: theme.text, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: theme.text },
});
