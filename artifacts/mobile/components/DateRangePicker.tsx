import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { Sheet, SheetButton, SHEET_GUTTER } from '@/components/ui/BottomSheet';
import { OptionRadio } from '@/components/ui/OptionSheet';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PresetId =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'last90'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom';

export interface DateRange {
  start: Date;
  end: Date;
  presetId: PresetId;
  label: string;
}

interface Props {
  visible: boolean;
  current: DateRange;
  onApply: (range: DateRange) => void;
  onClose: () => void;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function today0(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function inRange(d: Date, s: Date, e: Date): boolean {
  return d >= s && d <= e;
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtFull(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_LABELS = ['S','M','T','W','T','F','S'];

// ─── Presets ──────────────────────────────────────────────────────────────────

export function buildPresets(): Array<{ id: PresetId; label: string; hint: string; range: () => { start: Date; end: Date } }> {
  const t = today0();
  return [
    {
      id: 'today',
      label: 'Today',
      hint: fmtShort(t),
      range: () => ({ start: t, end: t }),
    },
    {
      id: 'yesterday',
      label: 'Yesterday',
      hint: fmtShort(addDays(t, -1)),
      range: () => ({ start: addDays(t, -1), end: addDays(t, -1) }),
    },
    {
      id: 'last7',
      label: 'Last 7 days',
      hint: `${fmtShort(addDays(t, -6))} – ${fmtShort(t)}`,
      range: () => ({ start: addDays(t, -6), end: t }),
    },
    {
      id: 'last30',
      label: 'Last 30 days',
      hint: `${fmtShort(addDays(t, -29))} – ${fmtShort(t)}`,
      range: () => ({ start: addDays(t, -29), end: t }),
    },
    {
      id: 'last90',
      label: 'Last 90 days',
      hint: `${fmtShort(addDays(t, -89))} – ${fmtShort(t)}`,
      range: () => ({ start: addDays(t, -89), end: t }),
    },
    {
      id: 'thisMonth',
      label: 'This month',
      hint: `${fmtShort(startOfMonth(t))} – ${fmtShort(t)}`,
      range: () => ({ start: startOfMonth(t), end: t }),
    },
    {
      id: 'lastMonth',
      label: 'Last month',
      hint: (() => {
        const s = startOfMonth(addDays(startOfMonth(t), -1));
        const e = endOfMonth(addDays(startOfMonth(t), -1));
        return `${fmtShort(s)} – ${fmtShort(e)}`;
      })(),
      range: () => {
        const prev = addDays(startOfMonth(t), -1);
        return { start: startOfMonth(prev), end: endOfMonth(prev) };
      },
    },
    {
      id: 'custom',
      label: 'Custom range',
      hint: 'Pick dates',
      range: () => ({ start: addDays(t, -29), end: t }),
    },
  ];
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

interface CalendarProps {
  month: Date;          // first day of displayed month
  rangeStart: Date | null;
  rangeEnd: Date | null;
  onDayPress: (d: Date) => void;
  colors: ReturnType<typeof useColors>;
  isDark: boolean;
}

function Calendar({ month, rangeStart, rangeEnd, onDayPress, colors, isDark }: CalendarProps) {
  const year = month.getFullYear();
  const mon = month.getMonth();
  const daysInMonth = new Date(year, mon + 1, 0).getDate();
  const firstDow = new Date(year, mon, 1).getDay(); // 0=Sun

  // Build cells array: nulls for padding + day numbers
  const cells: Array<number | null> = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  const primary = colors.primary;
  const rangeBg = colors.muted;
  const rangeEdgeBg = primary;
  const todayD = today0();

  function getDateObj(day: number): Date {
    return new Date(year, mon, day);
  }

  function isStart(day: number) {
    return rangeStart != null && sameDay(getDateObj(day), rangeStart);
  }
  function isEnd(day: number) {
    return rangeEnd != null && sameDay(getDateObj(day), rangeEnd);
  }
  function isMiddle(day: number) {
    if (!rangeStart || !rangeEnd) return false;
    const d = getDateObj(day);
    return d > rangeStart && d < rangeEnd;
  }
  function isTodayDay(day: number) {
    return sameDay(getDateObj(day), todayD);
  }

  const rows: Array<Array<number | null>> = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <View style={calStyles.calendar}>
      {/* Weekday headers */}
      <View style={calStyles.weekRow}>
        {DAY_LABELS.map((d, i) => (
          <View key={i} style={calStyles.dayCell}>
            <Text style={[calStyles.weekLabel, { color: colors.mutedForeground }]}>{d}</Text>
          </View>
        ))}
      </View>

      {/* Day rows */}
      {rows.map((row, ri) => (
        <View key={ri} style={calStyles.weekRow}>
          {row.map((day, ci) => {
            if (day == null) return <View key={ci} style={calStyles.dayCell} />;

            const start = isStart(day);
            const end = isEnd(day);
            const middle = isMiddle(day);
            const edge = start || end;
            const isToday = isTodayDay(day);

            // Range background: extends across the full cell for middles,
            // half for start (right side) and half for end (left side).
            const hasLeft = middle || end;
            const hasRight = middle || start;

            return (
              <TouchableOpacity
                key={ci}
                style={calStyles.dayCell}
                onPress={() => onDayPress(getDateObj(day))}
                activeOpacity={0.7}
              >
                {/* Range strip */}
                {(hasLeft || hasRight) && (
                  <>
                    {hasLeft && (
                      <View style={[calStyles.strip, calStyles.stripLeft, { backgroundColor: rangeBg }]} />
                    )}
                    {hasRight && (
                      <View style={[calStyles.strip, calStyles.stripRight, { backgroundColor: rangeBg }]} />
                    )}
                  </>
                )}

                {/* Day circle */}
                <View
                  style={[
                    calStyles.dayCircle,
                    edge && { backgroundColor: rangeEdgeBg },
                    isToday && !edge && { borderWidth: 1.5, borderColor: primary },
                  ]}
                >
                  <Text
                    style={[
                      calStyles.dayText,
                      {
                        color: edge
                          ? '#FFFFFF'
                          : isToday
                          ? primary
                          : colors.foreground,
                        fontFamily: edge ? 'Inter_700Bold' : 'Inter_400Regular',
                      },
                    ]}
                  >
                    {day}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const calStyles = StyleSheet.create({
  calendar: { marginTop: 4 },
  weekRow: { flexDirection: 'row' },
  dayCell: {
    flex: 1,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  weekLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  strip: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    width: '50%',
  },
  stripLeft: { left: 0 },
  stripRight: { right: 0 },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: { fontSize: 13 },
});

// ─── Main Picker ──────────────────────────────────────────────────────────────

export default function DateRangePicker({ visible, current, onApply, onClose }: Props) {
  const colors = useColors();
  const isDark = colors.background === '#121110' || colors.background.startsWith('#0');

  const PRESETS = buildPresets();

  const [selectedId, setSelectedId] = useState<PresetId>(current.presetId);
  const [calMonth, setCalMonth] = useState<Date>(() => {
    const t = today0();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const [rangeStart, setRangeStart] = useState<Date | null>(current.start);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(current.end);


  function selectPreset(id: PresetId) {
    setSelectedId(id);
    if (id !== 'custom') {
      const preset = PRESETS.find((p) => p.id === id)!;
      const { start, end } = preset.range();
      setRangeStart(start);
      setRangeEnd(end);
    }
  }

  const handleDayPress = useCallback((d: Date) => {
    if (rangeStart == null || rangeEnd != null) {
      // Start fresh selection
      setRangeStart(d);
      setRangeEnd(null);
    } else {
      // Second tap — set end (or swap if before start)
      if (d < rangeStart) {
        setRangeEnd(rangeStart);
        setRangeStart(d);
      } else {
        setRangeEnd(d);
      }
    }
  }, [rangeStart, rangeEnd]);

  function handleApply() {
    if (!rangeStart) return;
    const end = rangeEnd ?? rangeStart;
    const preset = PRESETS.find((p) => p.id === selectedId)!;
    onApply({
      start: rangeStart,
      end,
      presetId: selectedId,
      label: selectedId === 'custom'
        ? `${fmtShort(rangeStart)} – ${fmtShort(end)}`
        : preset.label,
    });
  }

  function prevMonth() {
    setCalMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }
  function nextMonth() {
    setCalMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }

  const rangeLabel = rangeStart
    ? rangeEnd
      ? sameDay(rangeStart, rangeEnd)
        ? fmtFull(rangeStart)
        : `${fmtFull(rangeStart)} – ${fmtFull(rangeEnd)}`
      : `${fmtFull(rangeStart)} – select end`
    : 'Select a start date';

  // Shopify "Date range" sheet: preset rows with a trailing radio, a month
  // calendar for a custom range, and the selected range above Apply.
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Date range"
      padded={false}
      maxHeightRatio={0.88}
      testID="date-range-sheet"
      footer={(
        <>
          <View style={styles.rangeLabel}>
            <Feather name="calendar" size={13} color={colors.mutedForeground} />
            <Text style={[styles.rangeLabelText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {rangeLabel}
            </Text>
          </View>
          <SheetButton label="Apply" onPress={handleApply} disabled={!rangeStart} />
        </>
      )}
    >
      {/* Preset list */}
      <View style={styles.presetSection}>
        {PRESETS.map((p, i) => {
          const active = selectedId === p.id;
          return (
            <React.Fragment key={p.id}>
              <TouchableOpacity
                style={styles.presetRow}
                onPress={() => selectPreset(p.id)}
                activeOpacity={0.7}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={p.label}
              >
                <Text style={[styles.presetLabel, { color: colors.foreground }]}>{p.label}</Text>
                <Text style={[styles.presetHint, { color: colors.mutedForeground }]}>{p.hint}</Text>
                <OptionRadio selected={active} color={colors.foreground} />
              </TouchableOpacity>
              {i < PRESETS.length - 1 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
            </React.Fragment>
          );
        })}
      </View>

      {/* Calendar (custom range only) */}
      {selectedId === 'custom' && (
        <View style={[styles.calSection, { borderTopColor: colors.border }]}>
          {/* Month navigation */}
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={prevMonth} activeOpacity={0.7} style={styles.navBtn} accessibilityRole="button" accessibilityLabel="Previous month">
              <Feather name="chevron-left" size={18} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[styles.monthTitle, { color: colors.foreground }]}>
              {MONTH_NAMES[calMonth.getMonth()]} {calMonth.getFullYear()}
            </Text>
            <TouchableOpacity onPress={nextMonth} activeOpacity={0.7} style={styles.navBtn} accessibilityRole="button" accessibilityLabel="Next month">
              <Feather name="chevron-right" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <Calendar
            month={calMonth}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            onDayPress={handleDayPress}
            colors={colors}
            isDark={isDark}
          />

          {/* Tap hint */}
          <Text style={[styles.calHint, { color: colors.mutedForeground }]}>
            {rangeStart && !rangeEnd ? 'Tap a second date to set the end' : 'Tap a date to start selection'}
          </Text>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // Presets
  presetSection: { paddingHorizontal: SHEET_GUTTER },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 12,
    gap: 12,
  },
  divider: { height: StyleSheet.hairlineWidth },
  presetLabel: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium' },
  presetHint: { fontSize: 12, fontFamily: 'Inter_400Regular' },

  // Calendar
  calSection: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  navBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  monthTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  calHint: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 10 },

  // Footer
  rangeLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rangeLabelText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },
});
