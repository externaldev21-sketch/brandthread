import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticPrimaryAction } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';

export type SearchTag = { tag: string; postCount: number };

/** Tags tab row — "#tag" + post count, Instagram's Tags row shape. Derived
 *  client-side from matched posts' own captions (no dedicated hashtag-search
 *  endpoint exists yet), so postCount reflects only the posts this search
 *  already surfaced, not every post on the platform carrying that tag. */
export function TagRow({ tag, onPress }: { tag: SearchTag; onPress: () => void }) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const scale = React.useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      onPress={() => { hapticPrimaryAction(); onPress(); }}
      onPressIn={() => pressScaleAnim(scale, PRESS_SCALE).start()}
      onPressOut={() => pressScaleAnim(scale, 1).start()}
      accessibilityRole="button"
      accessibilityLabel={`#${tag.tag}, ${tag.postCount} posts`}
      style={styles.row}
    >
      <Animated.View style={[styles.rowInner, { transform: [{ scale }] }]}>
        <View style={[styles.avatar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Feather name="hash" size={18} color={theme.muted} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>#{tag.tag}</Text>
          <Text style={[styles.sub, { color: theme.muted }]}>{tag.postCount} {tag.postCount === 1 ? 'post' : 'posts'}</Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  row: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2 },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  avatar: { width: 44, height: 44, borderRadius: RADII.avatar, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  name: { ...TYPE_SCALE.body, fontFamily: FONT.semibold },
  sub: { ...TYPE_SCALE.caption, marginTop: 2 },
});
