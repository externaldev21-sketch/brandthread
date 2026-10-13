/**
 * Poll editor for a Thread — X's poll composer (Mobbin: X "Publishing a
 * poll"), on the create flow's black canvas: "Choice 1" / "Choice 2" fields,
 * a + beside the last field adds a choice (up to 4), an x removes the poll,
 * and a "Poll length" row (default 1 day) that opens Days / Hours / Minutes
 * columns. The caption is the question, as on X.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FONT } from '@/lib/theme';
import { CP, PillButton, SubPage, tap } from '@/components/create-post/ui';
import {
  cleanPollDraft, emptyPollDraft, formatPollLength, joinMinutes, splitMinutes,
  POLL_MAX_DAYS, POLL_MAX_OPTIONS, POLL_OPTION_MAX, type PollDraft,
} from '@/lib/postPolls';

const ROW = 36;

function Column({ label, count, value, onChange, testID }: {
  label: string; count: number; value: number; onChange: (n: number) => void; testID: string;
}) {
  const initial = useRef(Math.max(0, value - 2) * ROW).current;
  return (
    <View style={s.col}>
      <Text style={s.colLabel}>{label}</Text>
      <ScrollView style={s.colScroll} contentOffset={{ x: 0, y: initial }} showsVerticalScrollIndicator={false} nestedScrollEnabled testID={testID}>
        {Array.from({ length: count }, (_, n) => (
          <Pressable key={n} onPress={() => { tap(); onChange(n); }} style={[s.colRow, n === value && s.colRowOn]} accessibilityRole="radio" accessibilityState={{ selected: n === value }} accessibilityLabel={`${n} ${label.toLowerCase()}`} testID={`${testID}-${n}`}>
            <Text style={[s.colText, n === value && s.colTextOn]}>{n}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export function PollPage({ value, onChange, onBack }: {
  value: PollDraft | null; onChange: (poll: PollDraft | null) => void; onBack: () => void;
}) {
  const [draft, setDraft] = useState<PollDraft>(() => value ?? emptyPollDraft());
  const [lengthOpen, setLengthOpen] = useState(false);
  const parts = useMemo(() => splitMinutes(draft.durationMinutes), [draft.durationMinutes]);
  const valid = cleanPollDraft(draft);
  const setOption = (i: number, text: string) => setDraft((d) => ({ ...d, options: d.options.map((o, j) => (j === i ? text : o)) }));
  const setLength = (days: number, hours: number, minutes: number) => setDraft((d) => ({ ...d, durationMinutes: joinMinutes(days, hours, minutes) }));
  const atMaxDays = parts.days >= POLL_MAX_DAYS;

  return (
    <SubPage title="Poll" onBack={() => { if (valid) onChange(valid); onBack(); }} testID="poll-page">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16 }}>
        <View style={s.box}>
          <View style={s.choices}>
            <View style={{ flex: 1, gap: 10 }}>
              {draft.options.map((o, i) => (
                <TextInput
                  key={i}
                  value={o}
                  onChangeText={(t) => setOption(i, t)}
                  placeholder={`Choice ${i + 1}${i >= 2 ? ' (optional)' : ''}`}
                  placeholderTextColor={CP.silverDim}
                  maxLength={POLL_OPTION_MAX}
                  style={s.input}
                  selectionColor={CP.white}
                  cursorColor={CP.white}
                  testID={`poll-choice-input-${i}`}
                  accessibilityLabel={`Choice ${i + 1}`}
                />
              ))}
            </View>
            <View style={s.sideCol}>
              <Pressable onPress={() => { tap(); onChange(null); onBack(); }} style={s.remove} accessibilityRole="button" accessibilityLabel="Remove poll" testID="poll-remove" hitSlop={8}>
                <Feather name="x" size={16} color={CP.black} />
              </Pressable>
              <View style={{ flex: 1 }} />
              {draft.options.length < POLL_MAX_OPTIONS ? (
                <Pressable onPress={() => { tap(); setDraft((d) => ({ ...d, options: [...d.options, ''] })); }} style={s.add} accessibilityRole="button" accessibilityLabel="Add a choice" testID="poll-add-choice" hitSlop={8}>
                  <Feather name="plus" size={22} color={CP.white} />
                </Pressable>
              ) : null}
            </View>
          </View>
          <Pressable onPress={() => { tap(); setLengthOpen((v) => !v); }} style={s.lengthRow} accessibilityRole="button" accessibilityState={{ expanded: lengthOpen }} testID="poll-length">
            <Text style={s.lengthLabel}>Poll length</Text>
            <Text style={s.lengthValue}>{formatPollLength(draft.durationMinutes)}</Text>
            <Feather name={lengthOpen ? 'chevron-up' : 'chevron-down'} size={20} color={CP.silver} />
          </Pressable>
          {lengthOpen ? (
            <View style={s.columns}>
              <Column label="Days" count={POLL_MAX_DAYS + 1} value={parts.days} onChange={(d) => setLength(d, d >= POLL_MAX_DAYS ? 0 : parts.hours, d >= POLL_MAX_DAYS ? 0 : parts.minutes)} testID="poll-days" />
              <Column label="Hours" count={atMaxDays ? 1 : 24} value={parts.hours} onChange={(h) => setLength(parts.days, h, parts.minutes)} testID="poll-hours" />
              <Column label="Minutes" count={atMaxDays ? 1 : 60} value={parts.minutes} onChange={(m) => setLength(parts.days, parts.hours, m)} testID="poll-minutes" />
            </View>
          ) : null}
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        <PillButton label="Done" disabled={!valid} onPress={() => { if (valid) { onChange(valid); onBack(); } }} testID="poll-done" flex={false} />
      </View>
    </SubPage>
  );
}

const s = StyleSheet.create({
  box: { borderWidth: 1, borderColor: CP.line, borderRadius: 16, overflow: 'hidden' },
  choices: { flexDirection: 'row', gap: 10, padding: 12 },
  input: {
    height: 48, borderRadius: 8, borderWidth: 1, borderColor: CP.surface2, paddingHorizontal: 12,
    color: CP.white, fontFamily: FONT.regular, fontSize: 16, outlineStyle: 'none' as any,
  },
  sideCol: { width: 32, alignItems: 'center', paddingBottom: 12 },
  remove: { width: 28, height: 28, borderRadius: 14, backgroundColor: CP.white, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  add: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  lengthRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 52, borderTopWidth: 1, borderTopColor: CP.line },
  lengthLabel: { flex: 1, color: CP.white, fontFamily: FONT.semibold, fontSize: 15 },
  lengthValue: { color: CP.silver, fontFamily: FONT.semibold, fontSize: 15 },
  columns: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  col: { flex: 1 },
  colLabel: { color: CP.silverDim, fontFamily: FONT.semibold, fontSize: 12, textAlign: 'center', marginBottom: 6 },
  colScroll: { height: ROW * 5, borderRadius: 8, backgroundColor: CP.surface },
  colRow: { height: ROW, alignItems: 'center', justifyContent: 'center' },
  colRowOn: { backgroundColor: CP.surface2 },
  colText: { color: CP.silver, fontFamily: FONT.regular, fontSize: 16 },
  colTextOn: { color: CP.white, fontFamily: FONT.bold },
});
