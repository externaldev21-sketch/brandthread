import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';
import type { SearchCategory } from '@/lib/searchData';

/** "Shop top categories" tile — rounded image with a label overlay, eBay-style. */
export function CategoryTile({ item, width, onPress }: {
  item: SearchCategory;
  width: number;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const scale = React.useRef(new Animated.Value(1)).current;
  const height = width;

  return (
    <Pressable
      onPress={() => { onPress(); }}
      onPressIn={() => pressScaleAnim(scale, PRESS_SCALE).start()}
      onPressOut={() => pressScaleAnim(scale, 1).start()}
      accessibilityRole="button"
      accessibilityLabel={`Shop ${item.category}, ${item.productCount} items`}
    >
      <Animated.View style={[styles.card, { width, height, transform: [{ scale }] }]}>
        {item.imageUri ? (
          <CachedImage source={{ uri: item.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: item.color }]} />
        )}
        <View style={styles.scrim} pointerEvents="none" />
        <Text style={styles.label} numberOfLines={1}>{item.category}</Text>
      </Animated.View>
    </Pressable>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  card: {
    borderRadius: RADII.card, overflow: 'hidden', justifyContent: 'flex-end',
    padding: SPACING.xs + 2,
  },
  scrim: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: '60%',
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  label: {
    color: '#FFFFFF', ...TYPE_SCALE.footnote, fontFamily: FONT.bold,
    textTransform: 'capitalize',
  },
});
