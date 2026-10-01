/**
 * Day + time chip picker over YYYY-MM-DD / HH:MM strings — the same pattern
 * as the drop scheduler (app/seller-drop-create.tsx), with a custom entry
 * for exact values. The wall-clock pair is converted to a UTC instant by the
 * caller with lib/dropSchedule#zonedTimeToUtc.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { WEB_INPUT_RESET } from '@/lib/inputReset';

function pad(n: number) { return String(n).padStart(2, '0'); }

function dayValue(offset: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DAY_CHIPS = Array.from({ length: 28 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() + i);
  const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return { value: dayValue(i), label };
});

const TIME_CHIPS = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.floor(i / 2);
  const minute = i % 2 === 0 ? 0 : 30;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return { value: `${pad(hour)}:${pad(minute)}`, label: `${h12}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}` };
});

export function parseWallClock(dateStr: string, timeStr: string) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
  if (!dm || !tm) return null;
  const year = Number(dm[1]), month = Number(dm[2]), day = Number(dm[3]);
  const hour = Number(tm[1]), minute = Number(tm[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return { year, month, day, hour, minute };
}

export function LaunchTimePicker({
  dateValue, timeValue, onDateChange, onTimeChange,
}: {
  dateValue: string; timeValue: string; onDateChange: (v: string) => void; onTimeChange: (v: string) => void;
}) {
  const colors = useColors();
  const [customOpen, setCustomOpen] = useState(false);
  const showCustom = customOpen
    || (!!dateValue && !DAY_CHIPS.some((c) => c.value === dateValue))
    || (!!timeValue && !TIME_CHIPS.some((c) => c.value === timeValue));

  const chip = (label: string, active: boolean, onPress: () => void, key: string) => (
    <TouchableOpacity
      key={key}
      onPress={onPress}
      style={[s.chip, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.card }]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[s.chipText, { color: active ? colors.primaryForeground : colors.foreground }]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.bleed} contentContainerStyle={s.chipRow}>
        {DAY_CHIPS.map((c) => chip(c.label, dateValue === c.value, () => onDateChange(c.value), c.value))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[s.bleed, { marginTop: 8 }]} contentContainerStyle={s.chipRow}>
        {TIME_CHIPS.map((c) => chip(c.label, timeValue === c.value, () => onTimeChange(c.value), c.value))}
      </ScrollView>
      <TouchableOpacity onPress={() => setCustomOpen((v) => !v)} style={s.customToggle} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Feather name={showCustom ? 'chevron-up' : 'chevron-down'} size={13} color={colors.mutedForeground} />
        <Text style={[s.customText, { color: colors.mutedForeground }]}>Enter an exact date & time</Text>
      </TouchableOpacity>
      {showCustom && (
        <View style={{ flexDirection: 'row', gap: SP.sm, marginTop: 8 }}>
          <TextInput
            style={[s.input, { flex: 1.4, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }, WEB_INPUT_RESET]}
            value={dateValue}
            onChangeText={onDateChange}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.mutedForeground}
          />
          <TextInput
            style={[s.input, { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }, WEB_INPUT_RESET]}
            value={timeValue}
            onChangeText={onTimeChange}
            placeholder="HH:MM"
            placeholderTextColor={colors.mutedForeground}
          />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  // Rows run edge to edge (the parent has a SP.md gutter) so chips scroll off the screen edge, not a padded box.
  bleed: { marginHorizontal: -SP.md },
  chipRow: { flexDirection: 'row', gap: 8, paddingHorizontal: SP.md },
  chip: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 14, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  customToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, alignSelf: 'flex-start' },
  customText: { fontFamily: FONT.medium, fontSize: FS.xs },
  input: { minWidth: 0, borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: FS.sm, fontFamily: FONT.medium },
});
