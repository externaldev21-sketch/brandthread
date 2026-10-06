/**
 * Single-day calendar picker sheet.
 *
 * Same sheet/calendar look as components/DateRangePicker.tsx (that one is a
 * past-period analytics picker with "Last 7 days"-style presets, which don't
 * fit picking a future day). Works on web and native without a native
 * datetime module. Values are LOCAL day keys ('YYYY-MM-DD', lib/discountDates).
 */
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/ui/Button';
import { SheetRise } from '@/components/motion/SheetRise';
import { parseDayKey, toDayKey, formatDayKey } from '@/lib/discountDates';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Props {
  visible: boolean;
  title: string;
  /** Selected day key, or '' for none. */
  value: string;
  /** Earliest selectable day key (inclusive), e.g. today. */
  minKey?: string;
  onConfirm: (key: string) => void;
  onClose: () => void;
}

export function DayPickerSheet({ visible, title, value, minKey, onConfirm, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState(value);
  const [month, setMonth] = useState(() => firstOfMonth(parseDayKey(value) ?? parseDayKey(minKey ?? '') ?? new Date()));

  useEffect(() => {
    if (!visible) return;
    setSelected(value);
    setMonth(firstOfMonth(parseDayKey(value) ?? parseDayKey(minKey ?? '') ?? new Date()));
  }, [visible, value, minKey]);

  const year = month.getFullYear();
  const mon = month.getMonth();
  const daysInMonth = new Date(year, mon + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array(new Date(year, mon, 1).getDay()).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: Array<Array<number | null>> = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  const todayKey = toDayKey(new Date());

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} accessibilityLabel="Close date picker" />
      <SheetRise style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <View style={[styles.titleRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7} accessibilityLabel="Close date picker">
            <Feather name="x" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <View style={styles.calSection}>
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={() => setMonth(new Date(year, mon - 1, 1))} style={styles.navBtn} accessibilityLabel="Previous month">
              <Feather name="chevron-left" size={18} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[styles.monthTitle, { color: colors.foreground }]}>{MONTH_NAMES[mon]} {year}</Text>
            <TouchableOpacity onPress={() => setMonth(new Date(year, mon + 1, 1))} style={styles.navBtn} accessibilityLabel="Next month">
              <Feather name="chevron-right" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          <View style={styles.weekRow}>
            {DAY_LABELS.map((d, i) => (
              <View key={i} style={styles.dayCell}>
                <Text style={[styles.weekLabel, { color: colors.mutedForeground }]}>{d}</Text>
              </View>
            ))}
          </View>
          {rows.map((row, ri) => (
            <View key={ri} style={styles.weekRow}>
              {row.map((day, ci) => {
                if (day == null) return <View key={ci} style={styles.dayCell} />;
                const key = toDayKey(new Date(year, mon, day));
                const disabled = !!minKey && key < minKey;
                const isSel = key === selected;
                const isToday = key === todayKey;
                return (
                  <TouchableOpacity
                    key={ci}
                    style={styles.dayCell}
                    disabled={disabled}
                    onPress={() => setSelected(key)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSel, disabled }}
                    accessibilityLabel={formatDayKey(key)}
                  >
                    <View style={[
                      styles.dayCircle,
                      isSel && { backgroundColor: colors.primary },
                      isToday && !isSel && { borderWidth: 1.5, borderColor: colors.primary },
                    ]}>
                      <Text style={[
                        styles.dayText,
                        { color: isSel ? colors.primaryForeground : colors.foreground, opacity: disabled ? 0.3 : 1 },
                      ]}>
                        {day}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>

        <View style={[styles.bottomBar, { borderTopColor: colors.border, paddingBottom: Platform.OS === 'ios' ? Math.max(insets.bottom, 16) : 16 }]}>
          <View style={styles.actions}>
            <Button label="Cancel" variant="secondary" size="small" style={styles.flex1} onPress={onClose} />
            <Button label="Done" variant="primary" size="small" style={styles.flex1} disabled={!selected} onPress={() => selected && onConfirm(selected)} />
          </View>
        </View>
      </SheetRise>
    </Modal>
  );
}

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: '#00000055' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  titleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1,
  },
  title: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  calSection: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  navBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  monthTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  weekRow: { flexDirection: 'row' },
  dayCell: { flex: 1, height: 40, alignItems: 'center', justifyContent: 'center' },
  weekLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  dayCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  bottomBar: { borderTopWidth: 1, paddingHorizontal: 20, paddingTop: 14 },
  actions: { flexDirection: 'row', gap: 10 },
  flex1: { flex: 1 },
});
