/**
 * Hidden posts — posts marked "Not interested" in a feed.
 * Server-backed (GET/DELETE /api/feed/not-interested); "Show again" lets the
 * post appear in feeds again.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { useApi, type HiddenFeedPost } from '@/lib/api';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button, ListRow, ErrorState } from '@/components/ui';
import { EmptyState } from '@/components/BrandthreadUI';
import { hapticSelection } from '@/lib/haptics';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

export function hiddenPostTitle(item: HiddenFeedPost): string {
  const caption = (item.caption ?? '').trim();
  if (caption) return caption.length > 60 ? `${caption.slice(0, 57)}…` : caption;
  return item.mediaType === 'video' ? 'Video post' : 'Post';
}

export default function HiddenPostsScreen() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const styles = makeStyles(theme, palette);
  const insets = useSafeAreaInsets();
  const api = useApi();
  const [items, setItems] = useState<HiddenFeedPost[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await api.feed.notInterested();
      setItems(page.items ?? []);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, [api]);
  const pull = usePullToRefresh(load);

  useEffect(() => { load(); }, [load]);

  const handleRestore = async (item: HiddenFeedPost) => {
    hapticSelection();
    setRestoring(item.postId);
    try {
      await api.feed.undoNotInterested(item.postId);
      setItems(prev => prev.filter(p => p.postId !== item.postId));
    } catch {
      Alert.alert('Could not show this post again', 'Try again.');
    } finally {
      setRestoring(null);
    }
  };

  return (
    <View style={styles.page}>
      <ScreenHeader title="Hidden posts" />

      <View style={styles.intro}>
        <Text style={styles.introText}>
          Posts you marked "Not interested" won't show in your feeds. Tap Show again to undo.
        </Text>
      </View>

      {loadError && items.length === 0 ? (
        <ErrorState message="Couldn't load hidden posts." onRetry={load} />
      ) : (
        <FlatList
          data={items}
          refreshControl={pull.refreshControl}
          keyExtractor={item => item.postId}
          contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingBottom: insets.bottom + 40 }}
          ListEmptyComponent={loaded ? (
            <EmptyState
              icon="eye-off"
              title="No hidden posts"
              description="Posts you mark Not interested will appear here."
              style={{ marginTop: SPACING.lg }}
            />
          ) : null}
          renderItem={({ item }) => (
            <ListRow
              avatar={{ name: item.authorName ?? item.authorUsername ?? 'Post' }}
              title={hiddenPostTitle(item)}
              subtitle={item.authorUsername ? `@${item.authorUsername}` : (item.authorName ?? undefined)}
              right={(
                <Button
                  label="Show again"
                  onPress={() => handleRestore(item)}
                  variant="secondary"
                  size="small"
                  loading={restoring === item.postId}
                  accessibilityHint="Lets this post appear in your feeds again"
                />
              )}
            />
          )}
        />
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme'], _palette: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.background },
  intro: { padding: SPACING.md },
  introText: { color: theme.muted, ...TYPE_SCALE.footnote, lineHeight: 19 },
});
