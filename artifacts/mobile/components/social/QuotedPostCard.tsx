/**
 * Embedded card for a quoted (reposted-with-comment) post.
 *
 * Renders the direct original's author, caption and still image, or a plain
 * "unavailable" state once the original is deleted, hidden or blocked. Used
 * by the post viewer and the quote composer's original-post preview.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { RADII } from '@/constants/radii';
import { FONT, FS } from '@/lib/theme';
import type { QuotedPostSummary } from '@/services/socialTypes';

const THUMB = 64;

export function quotedAuthorName(q: { author: { displayName: string | null; brandName: string | null; username: string | null } }): string {
  return q.author.brandName || q.author.displayName || (q.author.username ? `@${q.author.username}` : 'Brandthread');
}

interface Props {
  quotedPost: QuotedPostSummary;
  onPress?: (postId: string) => void;
  testID?: string;
}

export function QuotedPostCard({ quotedPost, onPress, testID = 'quoted-post-card' }: Props) {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);

  if ('unavailable' in quotedPost) {
    return (
      <View style={[styles.card, styles.unavailable]} testID={`${testID}-unavailable`} accessibilityLabel="This post is unavailable">
        <Feather name="slash" size={18} color={theme.muted} />
        <Text style={styles.unavailableText}>This post is unavailable</Text>
      </View>
    );
  }

  const name = quotedAuthorName(quotedPost);
  const body = (
    <>
      {quotedPost.thumbnailUrl ? (
        <CachedImage source={{ uri: quotedPost.thumbnailUrl }} style={styles.thumb} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Feather name={quotedPost.mediaType === 'video' ? 'video' : 'image'} size={20} color={theme.muted} />
        </View>
      )}
      <View style={styles.text}>
        <Text style={styles.author} numberOfLines={1}>{name}</Text>
        {quotedPost.caption ? <Text style={styles.caption} numberOfLines={3}>{quotedPost.caption}</Text> : null}
      </View>
    </>
  );

  if (!onPress) {
    return <View style={styles.card} testID={testID}>{body}</View>;
  }
  return (
    <Pressable
      style={styles.card}
      onPress={() => onPress(quotedPost.id)}
      accessibilityRole="button"
      accessibilityLabel={`Open post by ${name}`}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

const makeStyles = (theme: { surface: string; border: string; text: string; muted: string }) => StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: RADII.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  thumb: { width: THUMB, height: THUMB, borderRadius: RADII.chip, backgroundColor: theme.border },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 4 },
  author: { fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text },
  caption: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18, color: theme.muted },
  unavailable: { paddingVertical: 16 },
  unavailableText: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm, color: theme.muted },
});
