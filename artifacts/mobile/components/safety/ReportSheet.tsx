/**
 * ReportSheet — the one reusable "Report" bottom sheet.
 *
 * Mirrors the Instagram flow, kept minimal: "Why are you reporting this ...?"
 * with the fixed reason list; a reason is sent in one tap (only "Something
 * else" asks for a note) and the sheet shows the sent confirmation inline.
 * Nothing else pops up. Blocking stays in the existing menus. All state and server calls
 * live in lib/useReportFlow (shared with the full-screen route
 * app/buyer-report.tsx); reasons come from lib/safety.
 *
 * Surfaces do not render this themselves: they call
 * `useReportSheet().openReport({ targetType, targetId, ownerId, ownerName })`
 * and the ReportSheetProvider (mounted once in app/_layout.tsx) presents it.
 * Without a provider (tests, isolated screens) openReport falls back to the
 * full-screen report route, so callers never need a guard.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import ReanimatedAnimated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { Icon } from '@/components/ui/Icon';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useSheetTransition } from '@/components/ui/BottomSheet';
import { PressableScale, PrimaryButton } from '@/components/BrandthreadUI';
import {
  REPORT_NOTE_LIMIT, REPORT_REASONS, TARGET_LABELS, normalizeReportTarget, reportHref,
  type ReportTarget,
} from '@/lib/safety';
import { useReportFlow } from '@/lib/useReportFlow';

export interface ReportSheetTarget extends Omit<ReportTarget, 'targetType'> {
  targetType: ReportTarget['targetType'];
}

interface ReportSheetProps {
  visible: boolean;
  target: ReportSheetTarget;
  onClose: () => void;
}

export function ReportSheet({ visible, target, onClose }: ReportSheetProps) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { modalVisible, sheetStyle, backdropStyle, panGesture, onSheetLayout } = useSheetTransition(visible, () => {});

  const targetType = normalizeReportTarget(target.targetType);
  const noun = TARGET_LABELS[targetType];
  const flow = useReportFlow({ targetType, targetId: target.targetId });

  if (!modalVisible) return null;

  const { step } = flow;

  return (
    <Modal transparent animationType="none" visible={modalVisible} onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ReanimatedAnimated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable style={s.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        </ReanimatedAnimated.View>
        <GestureDetector gesture={panGesture}>
          <ReanimatedAnimated.View
            testID="report-sheet"
            onLayout={onSheetLayout}
            style={[s.sheet, { paddingBottom: insets.bottom + SP.md }, sheetStyle]}
          >
            <View style={s.handle} />
            <View style={s.header}>
              {step === 'details' ? (
                <PressableScale onPress={() => flow.setStep('reason')} style={s.headerSide} accessibilityLabel="Back">
                  <Icon name="chevron-left" size={22} color={theme.text} />
                </PressableScale>
              ) : <View style={s.headerSide} />}
              <Text style={s.title}>Report</Text>
              <PressableScale onPress={onClose} style={[s.headerSide, { alignItems: 'flex-end' }]} accessibilityLabel="Close">
                <Icon name="x" size={20} color={theme.text} />
              </PressableScale>
            </View>

            {!target.targetId ? (
              <View style={s.doneWrap}>
                <Text style={s.doneTitle}>Nothing to report</Text>
                <Text style={s.body}>This content is no longer available.</Text>
              </View>
            ) : step === 'reason' ? (
              <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} bounces={false}>
                <Text style={s.question}>Why are you reporting this {noun}?</Text>
                <View style={s.list}>
                  {REPORT_REASONS.map((option, index) => (
                    <PressableScale
                      key={option.id}
                      // "Something else" needs a note; every other reason is sent in one tap.
                      onPress={() => (option.id === 'other' ? flow.chooseReason(option.id) : void flow.submit(option.id))}
                      disabled={flow.submitting}
                      accessibilityRole="button"
                      accessibilityLabel={option.label}
                      style={[s.row, index > 0 && s.rowDivider]}
                    >
                      <Text style={[s.rowLabel, { flex: 1 }]}>{option.label}</Text>
                      {flow.submitting && flow.reason === option.id
                        ? <ActivityIndicator size="small" color={theme.text} />
                        : <Icon name="chevron-right" size={18} color={theme.subtle} />}
                    </PressableScale>
                  ))}
                </View>
                {flow.error ? <Text style={s.error}>{flow.error}</Text> : null}
              </ScrollView>
            ) : step === 'details' ? (
              <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text style={s.fieldLabel}>Tell us what’s wrong</Text>
                <TextInput
                  style={s.input}
                  value={flow.note}
                  onChangeText={(v) => flow.setNote(v.slice(0, REPORT_NOTE_LIMIT))}
                  placeholder="Describe the problem"
                  placeholderTextColor={theme.subtle}
                  multiline
                  textAlignVertical="top"
                  accessibilityLabel="Report details"
                  maxLength={REPORT_NOTE_LIMIT}
                />
                {flow.error ? <Text style={s.error}>{flow.error}</Text> : null}
                <PrimaryButton
                  label="Submit report"
                  onPress={() => { void flow.submit(); }}
                  loading={flow.submitting}
                  disabled={!flow.canSubmit}
                  style={{ marginTop: SP.lg }}
                />
              </ScrollView>
            ) : (
              <View style={s.doneWrap}>
                <View style={s.doneIcon}><Icon name="check" size={26} color={theme.onAccent} /></View>
                <Text style={s.doneTitle}>
                  {flow.alreadyReported ? 'You’ve already reported this' : 'Thanks for letting us know'}
                </Text>
                <View style={{ width: '100%', marginTop: SP.lg }}>
                  <PrimaryButton label="Done" onPress={onClose} />
                </View>
              </View>
            )}
          </ReanimatedAnimated.View>
        </GestureDetector>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Provider + hook ──────────────────────────────────────────────────────────

interface ReportSheetContextValue {
  openReport: (target: ReportSheetTarget) => void;
}

const ReportSheetContext = createContext<ReportSheetContextValue | null>(null);

export function ReportSheetProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<ReportSheetTarget | null>(null);
  const [visible, setVisible] = useState(false);
  const [session, setSession] = useState(0);
  const openRef = useRef<(t: ReportSheetTarget) => void>(() => {});
  openRef.current = (next) => {
    // A fresh key resets the flow state for every new report. iOS can't present
    // a Modal while the menu that triggered this is still dismissing.
    const present = () => {
      setSession((n) => n + 1);
      setTarget(next);
      setVisible(true);
    };
    if (Platform.OS === 'ios') setTimeout(present, 300);
    else present();
  };
  const openReport = useCallback((next: ReportSheetTarget) => openRef.current(next), []);
  const value = useMemo(() => ({ openReport }), [openReport]);
  return (
    <ReportSheetContext.Provider value={value}>
      {children}
      {target ? <ReportSheet key={session} visible={visible} target={target} onClose={() => setVisible(false)} /> : null}
    </ReportSheetContext.Provider>
  );
}

/**
 * `openReport({ targetType, targetId, ownerId, ownerName, label })` opens the
 * report sheet. Falls back to the full-screen report route when no provider is
 * mounted.
 */
export function useReportSheet(): ReportSheetContextValue {
  const ctx = useContext(ReportSheetContext);
  const router = useRouter();
  return useMemo(() => ctx ?? {
    openReport: (target: ReportSheetTarget) => router.push(reportHref(target) as never),
  }, [ctx, router]);
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: theme.background, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    borderWidth: 1, borderColor: theme.border, paddingTop: SP.sm, maxHeight: '88%',
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, alignSelf: 'center', marginBottom: SP.sm },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingBottom: SP.sm,
    borderBottomWidth: 1, borderBottomColor: theme.borderSubtle,
  },
  headerSide: { width: 40, height: 32, justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: theme.text, fontFamily: FONT.bold, fontSize: FS.base },
  scroll: { paddingHorizontal: SP.md },
  question: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.lg, marginTop: SP.md },
  body: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, marginTop: 6 },
  list: { marginTop: SP.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: 14 },
  rowDivider: { borderTopWidth: 1, borderTopColor: theme.borderSubtle },
  rowLabel: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base },
  rowDesc: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs + 1, marginTop: 2, lineHeight: 17 },
  selected: {
    flexDirection: 'row', alignItems: 'center', gap: SP.md, marginTop: SP.md,
    backgroundColor: theme.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.text, padding: SP.md,
  },
  change: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm, textDecorationLine: 'underline' },
  fieldLabel: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base, marginTop: SP.lg, marginBottom: SP.sm },
  optional: { color: theme.subtle, fontFamily: FONT.regular, fontSize: FS.sm },
  input: {
    minHeight: 110, backgroundColor: theme.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border,
    color: theme.text, fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22,
    paddingHorizontal: SP.md, paddingVertical: 14,
  },
  noteMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  hint: { color: theme.subtle, fontFamily: FONT.regular, fontSize: FS.xs },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: SP.lg,
    backgroundColor: theme.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, padding: SP.md,
  },
  error: { color: theme.error, fontFamily: FONT.medium, fontSize: FS.sm, textAlign: 'center', marginTop: SP.md },
  doneWrap: { alignItems: 'center', paddingTop: SP.xl, paddingHorizontal: SP.md },
  doneIcon: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: theme.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: SP.md,
  },
  doneTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.xl, textAlign: 'center' },
});
