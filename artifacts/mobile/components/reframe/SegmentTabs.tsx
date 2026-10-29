import { ChipRow } from '@/components/ui/ChipRow';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticToggle } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { DENSE_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';
import {
  X_GUTTER, X_HAIRLINE, X_SPACE, X_TAB_HEIGHT, X_TAB_INDICATOR, X_TYPE, xColors,
} from '@/constants/reframe';

export interface SegmentTab<K extends string> {
  key: K;
  label: string;
  /** Optional count shown as a small pill after the label (e.g. Requests 3). */
  count?: number;
  testID?: string;
  accessibilityLabel?: string;
}

/**
 * X-style page-level tabs: plain text labels, the active one bold white
 * with a short white underline the width of its label, inactive ones gray,
 * and one hairline under the whole row. Replaces boxed pill chips for
 * page-level filters.
 *
 * `scrollable` lays tabs out left-aligned on the gutter in a horizontal
 * scroller (many filters: Activity, Discover); otherwise tabs share the
 * row's width equally (two or three tabs: Messages Inbox / Requests).
 * `trailing` sits at the row's right edge (e.g. a filter icon).
 */
export function SegmentTabs<K extends string>({
  tabs, value, onChange, scrollable = false, trailing, divider = true, style, testID,
}: {
  tabs: ReadonlyArray<SegmentTab<K>>;
  value: K;
  onChange: (key: K) => void;
  scrollable?: boolean;
  trailing?: React.ReactNode;
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const c = xColors(theme);

  const items = tabs.map((tab) => {
    const active = tab.key === value;
    return (
      <Pressable
        key={tab.key}
        onPress={() => {
          if (active) return;
          hapticToggle();
          onChange(tab.key);
        }}
        style={({ pressed }) => [scrollable ? styles.tabScroll : styles.tabFill, pressed && styles.pressed]}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={tab.accessibilityLabel ?? tab.label}
        testID={tab.testID}
      >
        <View style={styles.labelWrap}>
          <Text
            maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}
            numberOfLines={1}
            style={[X_TYPE.tab, { color: active ? c.text : c.secondary, fontFamily: active ? FONT.bold : FONT.medium }]}
          >
            {tab.label}
          </Text>
          {!!tab.count && tab.count > 0 && (
            <View style={[styles.count, { backgroundColor: active ? theme.accent : c.divider }]}>
              <Text style={[styles.countText, { color: active ? theme.onAccent : c.text }]}>
                {tab.count > 99 ? '99+' : tab.count}
              </Text>
            </View>
          )}
          {active && <View style={[styles.indicator, { backgroundColor: c.text }]} />}
        </View>
      </Pressable>
    );
  });

  return (
    <View
      style={[styles.row, divider && { borderBottomWidth: X_HAIRLINE, borderBottomColor: c.divider }, style]}
      accessibilityRole="tablist"
      testID={testID}
    >
      {scrollable ? (
        <ChipRow
          selectedIndex={tabs.findIndex((tab) => tab.key === value)}
          hapticOnSelect={false}
          showsHorizontalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
          // ChipRow sets flexGrow/flexShrink 0, which outranks the `flex: 1`
          // shorthand on react-native-web and collapsed the row to 0px wide.
          style={styles.scrollFill}
          contentContainerStyle={styles.scrollContent}
        >
          {items}
        </ChipRow>
      ) : (
        <View style={[styles.flex, styles.fillRow]}>{items}</View>
      )}
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', height: X_TAB_HEIGHT },
  flex: { flex: 1 },
  scrollFill: { flexGrow: 1, flexShrink: 1 },
  fillRow: { flexDirection: 'row' },
  scrollContent: { paddingHorizontal: X_GUTTER, gap: X_SPACE[24], alignItems: 'stretch' },
  tabFill: { flex: 1, alignItems: 'center' },
  tabScroll: { alignItems: 'flex-start' },
  pressed: { opacity: 0.6 },
  // The label's own box sets the underline width; the underline sits on the
  // row's bottom edge, over the row hairline, like X.
  labelWrap: {
    height: X_TAB_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: X_TAB_INDICATOR.minWidth,
  },
  indicator: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    height: X_TAB_INDICATOR.height, borderRadius: X_TAB_INDICATOR.radius,
  },
  count: {
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5,
    alignItems: 'center', justifyContent: 'center',
  },
  countText: { fontSize: 11, lineHeight: 14, fontFamily: FONT.bold },
  trailing: { justifyContent: 'center', paddingRight: X_GUTTER - X_SPACE[12] },
});
