/**
 * Pick a pre-order's ship-by date: a month calendar in a sheet, only the days
 * a pre-order may promise (tomorrow … PREORDER_WINDOW_DAYS out) enabled.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { StoreSheet } from '@/components/store/StoreSheet';
import { monthGrid, shipByRange, toDay } from '@/lib/storeBlocks';

import { FONT } from '@/lib/theme';
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function ShipDateSheet({ visible, value, onPick, onClose }: {
  visible: boolean;
  value: string | null;
  onPick: (day: string) => void;
  onClose: () => void;
}) {
  const { theme } = useAppTheme();
  const range = shipByRange();
  const start = new Date(`${value ?? range.min}T00:00:00Z`);
  const [cursor, setCursor] = useState({ y: start.getUTCFullYear(), m: start.getUTCMonth() });
  const monthStart = toDay(new Date(Date.UTC(cursor.y, cursor.m, 1)));
  const monthEnd = toDay(new Date(Date.UTC(cursor.y, cursor.m + 1, 0)));
  const canPrev = monthStart > range.min;
  const canNext = monthEnd < range.max;
  const shift = (n: number) => setCursor((c) => {
    const d = new Date(Date.UTC(c.y, c.m + n, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });
  const title = new Date(Date.UTC(cursor.y, cursor.m, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <StoreSheet visible={visible} title="Ships by" onClose={onClose} testID="ship-date-sheet">
      <View style={s.body}>
        <View style={s.monthRow}>
          <Pressable onPress={() => shift(-1)} disabled={!canPrev} style={s.nav} accessibilityRole="button" accessibilityLabel="Previous month">
            <Icon name="chevron-left" size={22} color={theme.text} style={!canPrev ? s.past : undefined} />
          </Pressable>
          <Text style={[s.month, { color: theme.text }]}>{title}</Text>
          <Pressable onPress={() => shift(1)} disabled={!canNext} style={s.nav} accessibilityRole="button" accessibilityLabel="Next month" testID="ship-date-next-month">
            <Icon name="chevron-right" size={22} color={theme.text} style={!canNext ? s.past : undefined} />
          </Pressable>
        </View>
        <View style={s.week}>
          {WEEKDAYS.map((d, i) => <Text key={i} style={[s.wd, { color: theme.muted }]}>{d}</Text>)}
        </View>
        {monthGrid(cursor.y, cursor.m).map((week, wi) => (
          <View key={wi} style={s.week}>
            {week.map((day, di) => {
              if (!day) return <View key={di} style={s.cell} />;
              const enabled = day >= range.min && day <= range.max;
              const on = day === value;
              return (
                <Pressable
                  key={day}
                  onPress={() => { onPick(day); onClose(); }}
                  disabled={!enabled}
                  style={s.cell}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: !enabled }}
                  accessibilityLabel={new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}
                  testID={`ship-date-${day}`}
                >
                  <View style={[s.dot, on && { backgroundColor: theme.text }]}>
                    <Text style={[s.dayText, { color: on ? theme.background : enabled ? theme.text : theme.muted }, !enabled && s.past]}>{Number(day.slice(8))}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </StoreSheet>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingBottom: 8 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  nav: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  month: { fontSize: 17, fontFamily: FONT.semibold },
  week: { flexDirection: 'row' },
  wd: { flex: 1, textAlign: 'center', fontSize: 13, fontFamily: FONT.semibold, paddingVertical: 6 },
  cell: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 16, fontVariant: ['tabular-nums'] },
  past: { opacity: 0.3 },
});
