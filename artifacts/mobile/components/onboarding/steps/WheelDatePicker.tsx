/**
 * Inline month / day / year wheel docked at the bottom of the birthday step,
 * like Instagram's. Pure JS (snapping ScrollViews) so it behaves the same on
 * iOS, Android and the web preview without a native date-picker module.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { daysInMonth, MONTH_NAMES } from '@/lib/ageGate';
import { FILL_ELEVATED, TEXT } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { radius } from '@/constants/radii';

const ROW = 36;
const VISIBLE = 5;
const PAD = ROW * Math.floor(VISIBLE / 2);

export interface WheelDate { year: number; month: number; day: number }

function Column({
  values,
  index,
  onIndex,
  width,
  testID,
  label,
}: {
  values: string[];
  index: number;
  onIndex: (i: number) => void;
  width: number | `${number}%`;
  testID: string;
  label: string;
}) {
  const palette = useColors();
  const ref = useRef<ScrollView>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastIndex = useRef(index);

  // Keep the wheel on the selected row when the value changes from outside
  // (e.g. the day clamps after switching to a shorter month).
  useEffect(() => {
    if (lastIndex.current === index) return;
    lastIndex.current = index;
    ref.current?.scrollTo({ y: index * ROW, animated: false });
  }, [index]);

  const settle = (y: number) => {
    const next = Math.max(0, Math.min(values.length - 1, Math.round(y / ROW)));
    if (next !== lastIndex.current) {
      lastIndex.current = next;
      onIndex(next);
    }
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Web has no momentum-end event; settle shortly after scrolling stops.
    if (Platform.OS !== 'web') return;
    const y = e.nativeEvent.contentOffset.y;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => settle(y), 120);
  };

  return (
    <View style={{ width, height: ROW * VISIBLE }} accessibilityLabel={label} accessibilityValue={{ text: values[index] }}>
      <ScrollView
        ref={ref}
        testID={testID}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        contentOffset={{ x: 0, y: index * ROW }}
        onLayout={() => ref.current?.scrollTo({ y: lastIndex.current * ROW, animated: false })}
        contentContainerStyle={{ paddingVertical: PAD }}
        onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.y)}
        onScrollEndDrag={(e) => { if (Platform.OS !== 'web') settle(e.nativeEvent.contentOffset.y); }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        nestedScrollEnabled
      >
        {values.map((v, i) => (
          <View key={v} style={styles.row}>
            <Text
              onPress={() => { lastIndex.current = i; ref.current?.scrollTo({ y: i * ROW, animated: true }); onIndex(i); }}
              style={[styles.value, { color: i === index ? palette.foreground : palette.mutedForeground }]}
            >
              {v}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export function WheelDatePicker({ value, onChange, minYear, maxYear }: {
  value: WheelDate;
  onChange: (next: WheelDate) => void;
  minYear: number;
  maxYear: number;
}) {
  const insets = useSafeAreaInsets();
  const years = useMemo(() => {
    const list: string[] = [];
    for (let y = minYear; y <= maxYear; y++) list.push(String(y));
    return list;
  }, [minYear, maxYear]);
  const dayCount = daysInMonth(value.year, value.month);
  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => String(i + 1)), [dayCount]);

  const update = (patch: Partial<WheelDate>) => {
    const next = { ...value, ...patch };
    const max = daysInMonth(next.year, next.month);
    if (next.day > max) next.day = max;
    onChange(next);
  };

  return (
    <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]} testID="onboarding-birthday-wheel">
      <View pointerEvents="none" style={styles.band} />
      <View style={styles.columns}>
        <Column
          label="Month"
          testID="onboarding-birthday-month"
          values={[...MONTH_NAMES]}
          index={value.month - 1}
          onIndex={(i) => update({ month: i + 1 })}
          width="44%"
        />
        <Column
          label="Day"
          testID="onboarding-birthday-day"
          values={days}
          index={value.day - 1}
          onIndex={(i) => update({ day: i + 1 })}
          width="20%"
        />
        <Column
          label="Year"
          testID="onboarding-birthday-year"
          values={years}
          index={Math.max(0, value.year - minYear)}
          onIndex={(i) => update({ year: minYear + i })}
          width="28%"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    backgroundColor: FILL_ELEVATED,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: 12,
    marginHorizontal: -16,
  },
  columns: { flexDirection: 'row', justifyContent: 'center' },
  band: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 12 + PAD,
    height: ROW,
    borderRadius: radius.sm,
    backgroundColor: '#2C2C2E',
  },
  row: { height: ROW, alignItems: 'center', justifyContent: 'center' },
  value: { ...TEXT.body, fontVariant: ['tabular-nums'] },
});
