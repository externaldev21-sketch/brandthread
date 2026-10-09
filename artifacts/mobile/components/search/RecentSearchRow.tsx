import React from 'react';
import { Animated, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticPrimaryAction, hapticSelection } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';

/**
 * Recent Searches row (Mobbin "Instagram iOS Clearing search history" /
 * "Searching Instagram"). Instagram's own recent list mixes visited-profile
 * rows (avatar) with plain-query rows (clock icon) — our search history is
 * query-only (server-logged text searches, not profile visits), so every
 * row here is honestly the clock-icon variant rather than a fabricated
 * avatar for a query that was never actually a profile visit.
 */
export function RecentSearchRow({ term, onPress, onRemove, icon = 'clock' }: {
  term: string;
  onPress: () => void;
  /** Omit for rows that can't be removed (trending searches). */
  onRemove?: () => void;
  icon?: 'clock' | 'trending-up';
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const scale = React.useRef(new Animated.Value(1)).current;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => { hapticPrimaryAction(); onPress(); }}
        onPressIn={() => pressScaleAnim(scale, PRESS_SCALE).start()}
        onPressOut={() => pressScaleAnim(scale, 1).start()}
        accessibilityRole="button"
        accessibilityLabel={`Search ${term}`}
        style={styles.tapArea}
      >
        <Animated.View style={[styles.tapAreaInner, { transform: [{ scale }] }]}>
          <View style={[styles.iconWrap, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Feather name={icon} size={18} color={theme.muted} />
          </View>
          <Text style={[styles.term, { color: theme.text }]} numberOfLines={1}>{term}</Text>
        </Animated.View>
      </Pressable>
      {onRemove ? (
      <TouchableOpacity
        onPress={() => { hapticSelection(); onRemove(); }}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${term} from recent searches`}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.removeBtn}
      >
        <Feather name="x" size={18} color={theme.muted} />
      </TouchableOpacity>
      ) : null}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2 },
  tapArea: { flex: 1 },
  tapAreaInner: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  iconWrap: { width: 44, height: 44, borderRadius: RADII.avatar, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  term: { ...TYPE_SCALE.body, fontFamily: FONT.medium, flex: 1 },
  removeBtn: { paddingLeft: SPACING.sm, paddingVertical: 4 },
});
