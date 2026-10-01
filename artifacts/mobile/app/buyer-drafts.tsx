/**
 * Buyer's Drafts — the destination behind the Instagram-style "Drafts" tile
 * that's now the first cell of the Posts grid on the buyer's own profile
 * (replacing the removed Published/Drafts/Orders segmented control). A plain
 * grid of the buyer's own draft posts; tapping one resumes it in the
 * composer, exactly like tapping a draft used to work inside the old
 * segmented control.
 */
import React, { useCallback, useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticSelection } from '@/lib/haptics';
import { getMyPosts } from '@/services/socialService';
import type { BuyerPost } from '@/services/socialTypes';
import { ProfileVideoTile, gridItemFromBuyerPost, type ProfileGridItem } from '@/components/profile/ProfileVideoGrid';
import { ProfileGridPlaceholder } from '@/components/profile/ProfileGridStates';
import { profileEmptyState } from '@/components/profile/profileEmptyStates';
import { TILE_ASPECT_3_4, useProfileLayout } from '@/components/profile/profileLayout';

export default function BuyerDraftsScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const layout = useProfileLayout({ tileAspect: TILE_ASPECT_3_4 });

  const [drafts, setDrafts] = useState<BuyerPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const posts = await getMyPosts();
      setDrafts(posts.filter((p) => p.isDraft && !p.isArchived));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); void load(); }, [load]));

  const items: ProfileGridItem[] = drafts.map(gridItemFromBuyerPost);

  const handlePress = useCallback((item: ProfileGridItem) => {
    hapticSelection();
    router.push((`/create-post?accountType=buyer&editId=` + encodeURIComponent(item.id)) as never);
  }, [router]);

  const empty = profileEmptyState('buyer:draft', true);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]} testID="buyer-drafts">
      <ScreenHeader title="Drafts" />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={layout.gridColumns}
        columnWrapperStyle={layout.gridColumns > 1 ? styles.row : undefined}
        renderItem={({ item, index }) => (
          <ProfileVideoTile
            item={item}
            index={index}
            width={layout.tileWidth}
            height={layout.tileHeight}
            onPress={handlePress}
          />
        )}
        ListEmptyComponent={(
          <ProfileGridPlaceholder
            loading={loading}
            error={error}
            onRetry={load}
            layout={layout}
            icon={empty.icon as keyof typeof Feather.glyphMap}
            title={empty.title}
            testID="buyer-drafts-empty"
          />
        )}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, paddingTop: 1 },
  row: { gap: 1 },
});
