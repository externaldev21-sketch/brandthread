/**
 * Sheets the story editor opens from the sticker tray to configure the
 * interactive stickers before they are placed on the canvas:
 *  - PollComposer: question + 2-4 options
 *  - QuestionComposer: the prompt people answer
 *  - CountdownPicker: the seller's upcoming drops
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { Button } from '@/components/ui';
import { FONT, FS } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { useApi } from '@/lib/api';

const POLL_QUESTION_MAX = 80;
const POLL_OPTION_MAX = 30;
const QUESTION_MAX = 100;

function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <ModalSafeArea>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[s.sheet, { backgroundColor: theme.card, paddingBottom: insets.bottom + 16 }]}>
            <View style={[s.handle, { backgroundColor: theme.border }]} />
            <Text style={[s.title, { color: theme.text }]}>{title}</Text>
            {children}
          </View>
        </KeyboardAvoidingView>
      </ModalSafeArea>
    </Modal>
  );
}

function Field({ value, onChangeText, placeholder, max, autoFocus, label }: {
  value: string; onChangeText: (v: string) => void; placeholder: string; max: number; autoFocus?: boolean; label: string;
}) {
  const { theme } = useAppTheme();
  return (
    <TextInput returnKeyType="done"
      style={[s.input, WEB_INPUT_RESET, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.muted}
      maxLength={max}
      autoFocus={autoFocus}
      accessibilityLabel={label}
    />
  );
}

export function PollComposer({ visible, onClose, onAdd }: {
  visible: boolean; onClose: () => void; onAdd: (poll: { question: string; options: string[] }) => void;
}) {
  const { theme } = useAppTheme();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  useEffect(() => { if (visible) { setQuestion(''); setOptions(['', '']); } }, [visible]);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const valid = question.trim().length > 0 && filled.length >= 2;
  return (
    <Sheet visible={visible} title="Poll" onClose={onClose}>
      <Field value={question} onChangeText={setQuestion} placeholder="Ask a question" max={POLL_QUESTION_MAX} autoFocus label="Poll question" />
      {options.map((value, i) => (
        <View key={i} style={s.optionRow}>
          <View style={{ flex: 1 }}>
            <Field
              value={value} placeholder={`Option ${i + 1}`} max={POLL_OPTION_MAX} label={`Poll option ${i + 1}`}
              onChangeText={(v) => setOptions((prev) => prev.map((o, k) => (k === i ? v : o)))}
            />
          </View>
          {options.length > 2 ? (
            <Pressable
              onPress={() => setOptions((prev) => prev.filter((_, k) => k !== i))}
              style={s.iconBtn} accessibilityRole="button" accessibilityLabel={`Remove option ${i + 1}`}
            >
              <Feather name="x" size={18} color={theme.muted} />
            </Pressable>
          ) : null}
        </View>
      ))}
      {options.length < 4 ? (
        <Pressable onPress={() => setOptions((prev) => [...prev, ''])} style={[s.addRow, { borderColor: theme.border }]} accessibilityRole="button" accessibilityLabel="Add option">
          <Feather name="plus" size={16} color={theme.text} />
          <Text style={[s.addText, { color: theme.text }]}>Add option</Text>
        </Pressable>
      ) : null}
      <Button label="Add poll" onPress={() => onAdd({ question: question.trim(), options: filled })} disabled={!valid} fullWidth />
    </Sheet>
  );
}

export function QuestionComposer({ visible, onClose, onAdd }: {
  visible: boolean; onClose: () => void; onAdd: (prompt: string) => void;
}) {
  const [prompt, setPrompt] = useState('');
  useEffect(() => { if (visible) setPrompt(''); }, [visible]);
  return (
    <Sheet visible={visible} title="Question" onClose={onClose}>
      <Field value={prompt} onChangeText={setPrompt} placeholder="Ask me anything" max={QUESTION_MAX} autoFocus label="Question prompt" />
      <Button label="Add question" onPress={() => onAdd(prompt.trim())} disabled={!prompt.trim()} fullWidth />
    </Sheet>
  );
}

export interface UpcomingDrop { id: string; name: string; releaseAt: string }

export function CountdownPicker({ visible, onClose, onPick }: {
  visible: boolean; onClose: () => void; onPick: (drop: UpcomingDrop) => void;
}) {
  const { theme } = useAppTheme();
  const api = useApi();
  const [drops, setDrops] = useState<UpcomingDrop[] | null>(null);
  useEffect(() => {
    if (!visible) return undefined;
    let alive = true;
    setDrops(null);
    (async () => {
      try {
        const rows = (await api.drops.list()) as Array<{ id: string; name: string; status: string; releaseAt: string | null }>;
        const now = Date.now();
        const upcoming = (Array.isArray(rows) ? rows : [])
          .filter((d) => d.status === 'active' && d.releaseAt && new Date(d.releaseAt).getTime() > now)
          .sort((a, b) => new Date(a.releaseAt!).getTime() - new Date(b.releaseAt!).getTime())
          .map((d) => ({ id: d.id, name: d.name, releaseAt: d.releaseAt! }));
        if (alive) setDrops(upcoming);
      } catch {
        if (alive) setDrops([]);
      }
    })();
    return () => { alive = false; };
  }, [visible, api]);
  return (
    <Sheet visible={visible} title="Countdown" onClose={onClose}>
      {drops === null ? (
        <View style={s.center}><ActivityIndicator color={theme.text} /></View>
      ) : drops.length === 0 ? (
        <Text style={[s.empty, { color: theme.muted }]}>No upcoming drops. Schedule a drop with a launch time to count down to it.</Text>
      ) : (
        <ScrollView style={{ maxHeight: 320 }}>
          {drops.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => onPick(d)}
              style={[s.dropRow, { borderBottomColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel={`Count down to ${d.name}`}
              testID={`countdown-drop-${d.id}`}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[s.dropName, { color: theme.text }]}>{d.name}</Text>
                <Text style={[s.dropWhen, { color: theme.muted }]}>
                  {new Date(d.releaseAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={theme.muted} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  sheet: { borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet, paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  handle: { width: 36, height: 4, borderRadius: RADII.pill, alignSelf: 'center', opacity: 0.6, marginBottom: 4 },
  title: { fontFamily: FONT.bold, fontSize: FS.lg },
  input: { height: 48, borderWidth: 1, borderRadius: RADII.input, paddingHorizontal: 16, fontFamily: FONT.regular, fontSize: FS.base },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  addRow: { height: 44, borderWidth: 1, borderRadius: RADII.input, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  addText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  center: { height: 96, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20, paddingVertical: 24, textAlign: 'center' },
  dropRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  dropName: { fontFamily: FONT.semibold, fontSize: FS.base, lineHeight: 20 },
  dropWhen: { fontFamily: FONT.regular, fontSize: FS.sm },
});
