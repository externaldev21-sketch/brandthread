import React, { useRef } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Feather } from '@expo/vector-icons';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { EmptyState } from '@/components/BrandthreadUI';
import { setPendingTileTransition } from '@/lib/tileTransition';

export type GridPost = {
  id: string;
  mediaUrl?: string | null;
  mediaColors?: string[];
  type?: string; // 'photo' | 'video' | 'slideshow'
};

type Props = {
  posts: GridPost[];
  onPressPost: (post: GridPost, index: number) => void;
  columns?: number;
  gap?: number;
  emptyMessage?: string;
};

/**
 * Square profile-grid of a user's posts. Self-contained so it can be dropped
 * into any profile layout without depending on that screen's structure.
 */
export default function PostGrid({ posts, onPressPost, columns = 3, gap = 1, emptyMessage }: Props) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const cellSize = (width - gap * (columns - 1)) / columns;
  const styles = React.useMemo(() => makeStyles(theme, cellSize, gap), [theme, cellSize, gap]);

  if (posts.length === 0) {
    return (
      <EmptyState
        icon="grid"
        title="No posts yet"
        description={emptyMessage ?? 'Posts will appear here.'}
      />
    );
  }

  return (
    <FlashList
      data={posts}
      key={`post-grid-${columns}`}
      numColumns={columns}
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => (
        <GridCell item={item} index={index} onPressPost={onPressPost} theme={theme} styles={styles} />
      )}
    />
  );
}

function GridCell({
  item, index, onPressPost, theme, styles,
}: {
  item: GridPost;
  index: number;
  onPressPost: (post: GridPost, index: number) => void;
  theme: AppThemePreset;
  styles: ReturnType<typeof makeStyles>;
}) {
  const cellRef = useRef<View>(null);

  function handlePress() {
    cellRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        setPendingTileTransition({ postId: item.id, uri: item.mediaUrl ?? null, rect: { x, y, width, height } });
      }
      onPressPost(item, index);
    });
  }

  return (
    <Pressable
      ref={cellRef}
      testID={`post-grid-cell-${item.id}`}
      onPress={handlePress}
      style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}
    >
      {item.mediaUrl ? (
        <CachedImage
          source={{ uri: item.mediaUrl }}
          style={styles.image}
          recyclingKey={item.id}
        />
      ) : (
        <View style={[styles.image, { backgroundColor: item.mediaColors?.[0] ?? theme.cardElevated }]} />
      )}
      {item.type === 'slideshow' && (
        <Feather name="copy" size={14} color="#FFFFFF" style={styles.badge} />
      )}
      {item.type === 'video' && (
        <Feather name="play" size={14} color="#FFFFFF" style={styles.badge} />
      )}
    </Pressable>
  );
}

const makeStyles = (theme: AppThemePreset, cellSize: number, gap: number) => StyleSheet.create({
  cell: {
    width: cellSize,
    height: cellSize,
    marginRight: gap,
    marginBottom: gap,
    backgroundColor: theme.cardElevated,
  },
  cellPressed: { opacity: 0.85 },
  image: { width: '100%', height: '100%' },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
