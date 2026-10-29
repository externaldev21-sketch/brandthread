/**
 * "Active dates" form section shared by the discount code form (app/discounts.tsx)
 * and the automatic sale form (app/sales.tsx). Same order as Shopify's
 * discount form: start date + time, "Set end date", end date + time — all in
 * the seller's time zone (device zone by default, changeable from the row
 * below). Day/time chips are the launch scheduler's (LaunchTimePicker).
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LaunchTimePicker } from '@/components/products/LaunchTimePicker';
import { HapticSwitch, PressableScale } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { listSupportedTimeZones } from '@/lib/dropSchedule';
import { hapticSelection } from '@/lib/haptics';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { formatFields, instantFromFields, zoneAbbreviation, type ScheduleForm } from '@/lib/scheduleWindow';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export function ActiveDatesFields({ value, onChange }: {
  value: ScheduleForm;
  onChange: (next: ScheduleForm) => void;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const [zoneOpen, setZoneOpen] = useState(false);
  // Each field's own abbreviation: a start in summer and an end in winter
  // read EDT and EST, not today's abbreviation for both.
  const abbrAt = (date: string, time: string) =>
    zoneAbbreviation(value.zone, instantFromFields(date, time, value.zone) ?? new Date());
  const startAbbr = abbrAt(value.startDate, value.startTime);
  const endAbbr = abbrAt(value.endDate, value.endTime);
  const set = (patch: Partial<ScheduleForm>) => onChange({ ...value, ...patch, touched: true });

  return (
    <View>
      <Text style={s.label}>Active dates</Text>

      <View style={s.fieldHead}>
        <Text style={s.subLabel}>Start date and time ({startAbbr})</Text>
        <Text style={s.picked} numberOfLines={1}>{formatFields(value.startDate, value.startTime)}</Text>
      </View>
      <LaunchTimePicker
        dateValue={value.startDate}
        timeValue={value.startTime}
        onDateChange={(v) => set({ startDate: v, startTouched: true })}
        onTimeChange={(v) => set({ startTime: v, startTouched: true })}
        scrollToSelected
      />

      <View style={s.switchRow}>
        <Text style={s.switchLabel}>Set end date</Text>
        <HapticSwitch value={value.hasEnd} onValueChange={(on) => set({ hasEnd: on })} accessibilityLabel="Set end date" />
      </View>
      {value.hasEnd && (
        <>
          <View style={[s.fieldHead, { marginTop: SP.md }]}>
            <Text style={s.subLabel}>End date and time ({endAbbr})</Text>
            <Text style={s.picked} numberOfLines={1}>{formatFields(value.endDate, value.endTime)}</Text>
          </View>
          <LaunchTimePicker
            dateValue={value.endDate}
            timeValue={value.endTime}
            onDateChange={(v) => set({ endDate: v })}
            onTimeChange={(v) => set({ endTime: v })}
            scrollToSelected
          />
        </>
      )}

      <PressableScale
        style={s.zoneBtn}
        onPress={() => setZoneOpen(true)}
        accessibilityLabel={`Time zone ${value.zone}`}
      >
        <Feather name="globe" size={14} color={theme.muted} />
        <Text style={s.zoneText} numberOfLines={1}>{value.zone.replace(/_/g, ' ')}</Text>
        <Feather name="chevron-down" size={14} color={theme.muted} />
      </PressableScale>

      <TimeZoneSheet
        visible={zoneOpen}
        selected={value.zone}
        onClose={() => setZoneOpen(false)}
        onSelect={(zone) => { set({ zone }); setZoneOpen(false); }}
      />
    </View>
  );
}

function TimeZoneSheet({ visible, selected, onClose, onSelect }: {
  visible: boolean; selected: string; onClose: () => void; onSelect: (zone: string) => void;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const [filter, setFilter] = useState('');
  const zones = useMemo(() => listSupportedTimeZones(), []);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase().replace(/ /g, '_');
    return f ? zones.filter((z) => z.toLowerCase().includes(f)) : zones;
  }, [zones, filter]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaProvider style={{ flex: 1, backgroundColor: theme.background }}>
        <ScreenHeader title="Time zone" variant="modal" onBack={onClose} />
        <TextInput
          style={[s.filter, WEB_INPUT_RESET]}
          value={filter}
          onChangeText={setFilter}
          placeholder="Search time zones"
          placeholderTextColor={theme.muted}
          autoCorrect={false}
          autoCapitalize="none"
        />
        <FlatList
          data={shown}
          keyExtractor={(z) => z}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          renderItem={({ item }) => (
            <PressableScale
              style={s.zoneRow}
              onPress={() => { hapticSelection(); setFilter(''); onSelect(item); }}
              accessibilityState={{ selected: item === selected }}
            >
              <Text style={s.zoneRowText} numberOfLines={1}>{item.replace(/_/g, ' ')}</Text>
              <Text style={s.zoneAbbr}>{zoneAbbreviation(item)}</Text>
              {item === selected && <Feather name="check" size={16} color={theme.text} />}
            </PressableScale>
          )}
        />
      </SafeAreaProvider>
    </Modal>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  label: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm, marginBottom: SP.sm },
  subLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted, flexShrink: 1 },
  picked: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.text },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.md },
  switchLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text },
  zoneBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.md, minHeight: 44,
    backgroundColor: theme.cardElevated, borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm,
  },
  zoneText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  filter: {
    margin: SP.md, backgroundColor: theme.cardElevated, borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.sm,
    paddingHorizontal: SP.sm, paddingVertical: 12, color: theme.text, fontFamily: FONT.regular, fontSize: FS.sm,
  },
  zoneRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 52, paddingHorizontal: SP.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
  },
  zoneRowText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  zoneAbbr: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
});
