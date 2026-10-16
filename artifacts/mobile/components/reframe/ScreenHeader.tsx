import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { IconButton } from '@/components/ui/IconButton';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { DENSE_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';
import { X_GUTTER, X_HAIRLINE, X_HEADER_HEIGHT, X_SPACE, X_TYPE, xColors } from '@/constants/reframe';

export interface ReframeHeaderAction {
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  /** A count badge on the icon. */
  badge?: number;
}

/** IconButton's own touch box; its icon sits centered inside it. */
const ICON_BOX = 44;
/** Pulls the first/last icon box outward so the glyph itself lands on the gutter. */
const ICON_EDGE_PULL = (ICON_BOX - 20) / 2;

/**
 * Compact X-style header: one 44pt row under the safe area, title 20 bold
 * left-aligned (or 17 bold centered with `align="center"`), plain icon
 * actions on the right with no boxes or borders. Optional back arrow on
 * the left for pushed screens. Same height on every screen.
 */
export function ScreenHeader({
  title, showBack = false, onBack, backTestID, align = 'left', actions, trailing, divider = false, style, testID = 'screen-header',
}: {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  backTestID?: string;
  align?: 'left' | 'center';
  actions?: ReframeHeaderAction[];
  /** Custom right-edge content, rendered after `actions`. */
  trailing?: React.ReactNode;
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const c = xColors(theme);
  const router = useRouter();
  const topPad = useHeaderTopInset();
  const centered = align === 'center';
  const hasRight = !!actions?.length || !!trailing;

  const back = showBack ? (
    <IconButton
      name="arrow-left"
      variant="plain"
      size={20}
      color={c.text}
      onPress={() => (onBack ? onBack() : goBackOr(router))}
      accessibilityLabel={`Go back from ${title}`}
      testID={backTestID ?? 'screen-header-back'}
      style={styles.backBtn}
    />
  ) : null;

  const right = hasRight ? (
    <View style={styles.actions}>
      {actions?.map((action) => (
        <IconButton
          key={action.accessibilityLabel}
          name={action.icon}
          variant="plain"
          size={20}
          color={c.text}
          onPress={action.onPress}
          accessibilityLabel={action.accessibilityLabel}
          badge={action.badge}
          testID={action.testID}
        />
      ))}
      {trailing}
    </View>
  ) : null;

  return (
    <View
      testID={testID}
      style={[
        { paddingTop: topPad + X_SPACE[4] },
        divider && { borderBottomWidth: X_HAIRLINE, borderBottomColor: c.divider },
        style,
      ]}
    >
      <View style={styles.row}>
        {centered ? (
          <>
            <View style={styles.side}>{back}</View>
            <Text
              testID="screen-header-title"
              accessibilityRole="header"
              maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}
              numberOfLines={1}
              style={[X_TYPE.titleCentered, styles.titleCentered, { color: c.text }]}
            >
              {title}
            </Text>
            <View style={[styles.side, styles.sideRight]}>{right}</View>
          </>
        ) : (
          <>
            {back}
            <Text
              testID="screen-header-title"
              accessibilityRole="header"
              maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}
              numberOfLines={1}
              style={[X_TYPE.title, styles.titleLeft, { color: c.text }]}
            >
              {title}
            </Text>
            {right}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: X_HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: X_GUTTER,
  },
  backBtn: { marginLeft: -ICON_EDGE_PULL, marginRight: X_SPACE[12] - ICON_EDGE_PULL },
  titleLeft: { flex: 1 },
  titleCentered: { flex: 1, textAlign: 'center' },
  side: { width: 88, flexDirection: 'row', alignItems: 'center' },
  sideRight: { justifyContent: 'flex-end' },
  actions: { flexDirection: 'row', alignItems: 'center', marginRight: -ICON_EDGE_PULL },
});
