/**
 * Time zone field: shows the saved zone ("New York (GMT-4)") and opens a
 * searchable sheet of IANA zones. Tapping a row selects it and closes.
 * List, labels and search live in lib/timeZones.ts.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { Sheet, SHEET_GUTTER } from '@/components/ui/BottomSheet';
import { OptionRadio } from '@/components/ui/OptionSheet';
import { Icon } from '@/components/ui/Icon';
import { useColors } from '@/hooks/useColors';
import { haptic, haptics } from '@/lib/haptics';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { buildTimeZoneOptions, filterTimeZones, listTimeZones, timeZoneLabel } from '@/lib/timeZones';

export interface TimeZonePickerProps {
  /** IANA id, e.g. "America/New_York". */
  value: string;
  onChange: (timeZone: string) => void;
  /** Sheet title; also the field's accessibility label. */
  title?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function TimeZonePicker({ value, onChange, title = 'Time zone', style, testID = 'time-zone-picker' }: TimeZonePickerProps) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Built when the sheet opens so offsets reflect today's DST.
  const options = useMemo(
    () => (open ? buildTimeZoneOptions(listTimeZones(), new Date(), value || undefined) : []),
    [open, value],
  );
  const results = useMemo(() => filterTimeZones(options, query), [options, query]);
  const label = value ? timeZoneLabel(value) : 'Choose a time zone';

  const close = () => { setOpen(false); setQuery(''); };

  return (
    <>
      <Pressable
        onPress={() => { haptic('sheet'); setOpen(true); }}
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${label}`}
        accessibilityHint="Opens a searchable list of time zones"
        testID={testID}
        style={[styles.field, { backgroundColor: colors.secondary, borderColor: colors.border }, style]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.fieldText, { color: value ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>{label}</Text>
          {value ? <Text style={[styles.fieldSub, { color: colors.mutedForeground }]} numberOfLines={1}>{value}</Text> : null}
        </View>
        <Icon name="chevron-down" size={16} color={colors.mutedForeground} />
      </Pressable>

      <Sheet visible={open} onClose={close} title={title} fullHeight padded={false} testID={`${testID}-sheet`}>
        <View style={[styles.search, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <Icon name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search city, region or GMT offset"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search time zones"
            testID={`${testID}-search`}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
        </View>
        {results.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>No time zones match “{query.trim()}”.</Text>
        ) : results.map((o, i) => {
          const selected = o.id === value;
          return (
            <Pressable
              key={o.id}
              onPress={() => { haptics.selection(); onChange(o.id); close(); }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${o.city}, ${o.offsetLabel}`}
              testID={`${testID}-row-${o.id}`}
              style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>{o.city}</Text>
                <Text style={[styles.rowSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {o.region ? `${o.region} · ${o.offsetLabel}` : o.offsetLabel}
                </Text>
              </View>
              <OptionRadio selected={selected} color={colors.foreground} />
            </Pressable>
          );
        })}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    borderRadius: RADIUS.sm, borderWidth: 1,
    paddingHorizontal: SP.md, paddingVertical: SP.sm, minHeight: 44,
  },
  fieldText: { fontSize: FS.base, lineHeight: 19, fontFamily: FONT.regular },
  fieldSub: { fontSize: FS.xs, lineHeight: 15, fontFamily: FONT.regular },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    marginHorizontal: SHEET_GUTTER, marginBottom: SP.sm,
    borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: SP.md, minHeight: 44,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: FS.base, fontFamily: FONT.regular, paddingVertical: SP.sm },
  empty: { paddingHorizontal: SHEET_GUTTER, paddingVertical: SP.lg, fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SHEET_GUTTER, paddingVertical: SP.sm + SP.xs, minHeight: 56 },
  rowTitle: { fontSize: FS.base, lineHeight: 20, fontFamily: FONT.medium },
  rowSub: { fontSize: FS.sm, lineHeight: 17, fontFamily: FONT.regular, marginTop: 2 },
});
