/**
 * Report flow — the single place anyone reports anything on Brandthread
 * (posts, videos, live streams, comments, live chat, stories, products,
 * profiles and DMs). Presented as a modal from every surface via reportHref().
 *
 * Steps: choose a reason → add details (required for "Something else") and
 * optionally block the owner → confirmation. Reports are stored server-side
 * and land in the moderation queue; reporters stay anonymous.
 */
import React, { useMemo, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, TextInput, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import {
  PressableScale, PrimaryButton, SecondaryButton, HapticSwitch, AnimatedEntrance,
} from '@/components/BrandthreadUI';
import {
  REPORT_REASONS, TARGET_ICONS, TARGET_LABELS, apiErrorMessage, normalizeReportTarget,
  BLOCK_EXPLAINER,
} from '@/lib/safety';
import type { ReportReasonId } from '@/lib/safetyTypes';

const NOTE_LIMIT = 1000;

type Step = 'reason' | 'details' | 'done';

export default function ReportScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const params = useLocalSearchParams<{
    targetType?: string;
    targetId?: string;
    targetLabel?: string;
    targetUserId?: string;
    targetUserName?: string;
  }>();

  const targetType = normalizeReportTarget(params.targetType);
  const targetNoun = TARGET_LABELS[targetType];
  const ownerId = params.targetUserId || (targetType === 'profile' ? params.targetId : undefined);
  const ownerName = params.targetUserName || (targetType === 'profile' ? params.targetLabel : undefined) || 'this account';

  const [step, setStep] = useState<Step>('reason');
  const [reason, setReason] = useState<ReportReasonId | null>(null);
  const [note, setNote] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyReported, setAlreadyReported] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [blocking, setBlocking] = useState(false);

  const selected = REPORT_REASONS.find((r) => r.id === reason) ?? null;
  const noteRequired = reason === 'other';
  const noteTooShort = noteRequired && note.trim().length < 3;
  const canSubmit = !!reason && !noteTooShort && !submitting && !!params.targetId;

  function close() {
    if (router.canGoBack()) goBackOr(router);
    else router.replace('/');
  }

  function chooseReason(id: ReportReasonId) {
    Haptics.selectionAsync();
    setReason(id);
    setError(null);
    setStep('details');
  }

  async function submit() {
    if (!canSubmit || !params.targetId || !reason) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.reports.submit({
        targetType,
        targetId: params.targetId,
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setAlreadyReported(result?.status === 'already_reported');
      if (alsoBlock && ownerId) {
        try {
          await api.social.block(ownerId);
          setBlocked(true);
        } catch {
          // The report itself succeeded; the block can be retried from the
          // confirmation screen.
        }
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep('done');
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t send your report. Check your connection and try again.'));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  }

  async function blockNow() {
    if (!ownerId || blocking) return;
    setBlocking(true);
    try {
      await api.social.block(ownerId);
      setBlocked(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t block this account. Try again.'));
    } finally {
      setBlocking(false);
    }
  }

  const header = (
    <View style={s.header}>
      <PressableScale
        onPress={step === 'details' ? () => setStep('reason') : close}
        style={s.headerBtn}
        accessibilityLabel={step === 'details' ? 'Back to reasons' : 'Close'}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Feather name={step === 'details' ? 'arrow-left' : 'x'} size={ICON.md} color={theme.text} />
      </PressableScale>
      <Text style={s.headerTitle}>Report</Text>
      <View style={s.headerBtn} />
    </View>
  );

  if (!params.targetId) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        {header}
        <View style={s.centerState}>
          <Feather name="alert-circle" size={36} color={theme.muted} />
          <Text style={s.doneTitle}>Nothing to report</Text>
          <Text style={s.doneBody}>This content is no longer available.</Text>
          <PrimaryButton label="Close" onPress={close} style={{ alignSelf: 'stretch', marginTop: SP.lg }} />
        </View>
      </View>
    );
  }

  if (step === 'done') {
    return (
      <View style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom + SP.md }]}>
        <ScrollView contentContainerStyle={s.doneScroll} showsVerticalScrollIndicator={false}>
          <AnimatedEntrance>
            <View style={s.doneIcon}>
              <Feather name="check" size={30} color={theme.onAccent} />
            </View>
          </AnimatedEntrance>
          <Text style={s.doneTitle}>
            {alreadyReported ? 'You’ve already reported this' : 'Thanks for letting us know'}
          </Text>
          <Text style={s.doneBody}>
            {alreadyReported
              ? 'Your earlier report is still open. Our team will review it soon.'
              : 'Your report is anonymous. Our safety team reviews reports within 24 hours.'}
          </Text>

          <View style={s.nextCard}>
            <Text style={s.nextLabel}>WHAT HAPPENS NEXT</Text>
            {[
              { icon: 'search' as const, text: `We review the ${targetNoun} against our Community Guidelines.` },
              { icon: 'shield' as const, text: 'If it breaks the rules, we remove it and may suspend the account.' },
              { icon: 'bell' as const, text: 'Serious or repeated violations are escalated immediately.' },
            ].map((row) => (
              <View key={row.text} style={s.nextRow}>
                <View style={s.nextIcon}><Feather name={row.icon} size={14} color={theme.text} /></View>
                <Text style={s.nextText}>{row.text}</Text>
              </View>
            ))}
          </View>

          {ownerId ? (
            blocked ? (
              <View style={s.blockedNotice}>
                <Feather name="slash" size={16} color={theme.text} />
                <Text style={s.blockedNoticeText}>You blocked {ownerName}. Manage blocked accounts in Settings.</Text>
              </View>
            ) : (
              <View style={s.blockOffer}>
                <Text style={s.blockOfferTitle}>Want to stop seeing {ownerName}?</Text>
                <Text style={s.blockOfferBody}>{BLOCK_EXPLAINER}</Text>
                <SecondaryButton
                  label={blocking ? 'Blocking…' : `Block ${ownerName}`}
                  icon="slash"
                  onPress={blockNow}
                  disabled={blocking}
                  accent={theme.text}
                  style={{ marginTop: SP.md }}
                />
              </View>
            )
          ) : null}
          {error ? <Text style={s.errorInline}>{error}</Text> : null}
        </ScrollView>
        <View style={s.footer}>
          <PrimaryButton label="Done" onPress={close} />
          <PressableScale onPress={() => router.push('/community-guidelines' as never)} style={s.linkBtn}>
            <Text style={s.linkText}>Read the Community Guidelines</Text>
          </PressableScale>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[s.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {header}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.xxl }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.contextCard}>
          <View style={s.contextIcon}>
            <Feather name={TARGET_ICONS[targetType]} size={18} color={theme.text} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.contextEyebrow}>REPORTING {targetNoun.toUpperCase()}</Text>
            <Text style={s.contextLabel} numberOfLines={2}>
              {params.targetLabel || `This ${targetNoun}`}
            </Text>
          </View>
        </View>

        {step === 'reason' ? (
          <>
            <Text style={s.question}>Why are you reporting this {targetNoun}?</Text>
            <Text style={s.helper}>Your report is anonymous. The person you report won’t know it was you.</Text>
            <View style={s.reasonList}>
              {REPORT_REASONS.map((option, index) => (
                <PressableScale
                  key={option.id}
                  onPress={() => chooseReason(option.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${option.label}. ${option.description}`}
                  style={[s.reasonRow, index > 0 && s.reasonRowDivider]}
                >
                  <View style={s.reasonIcon}>
                    <Feather name={option.icon} size={16} color={theme.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.reasonLabel}>{option.label}</Text>
                    <Text style={s.reasonDesc}>{option.description}</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={theme.subtle} />
                </PressableScale>
              ))}
            </View>
          </>
        ) : (
          <>
            {selected ? (
              <PressableScale onPress={() => setStep('reason')} style={s.selectedReason} accessibilityLabel="Change reason">
                <View style={s.reasonIcon}>
                  <Feather name={selected.icon} size={16} color={theme.text} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.reasonLabel}>{selected.label}</Text>
                  <Text style={s.reasonDesc}>{selected.description}</Text>
                </View>
                <Text style={s.changeText}>Change</Text>
              </PressableScale>
            ) : null}

            <Text style={s.fieldLabel}>
              {noteRequired ? 'Tell us what’s wrong' : 'Add details'}
              {!noteRequired ? <Text style={s.optional}>  Optional</Text> : null}
            </Text>
            <TextInput
              style={s.noteInput}
              value={note}
              onChangeText={(value) => setNote(value.slice(0, NOTE_LIMIT))}
              placeholder={noteRequired
                ? 'Describe the problem so our team can review it'
                : 'Links, context, or anything that helps our review'}
              placeholderTextColor={theme.subtle}
              multiline
              textAlignVertical="top"
              accessibilityLabel="Report details"
              maxLength={NOTE_LIMIT}
            />
            <View style={s.noteMeta}>
              <Text style={[s.noteHint, noteTooShort && note.length > 0 && { color: theme.warning }]}>
                {noteRequired ? 'Required for “Something else”' : 'Helps us act faster'}
              </Text>
              <Text style={s.noteHint}>{note.length}/{NOTE_LIMIT}</Text>
            </View>

            {ownerId ? (
              <View style={s.blockRow}>
                <View style={{ flex: 1, paddingRight: SP.md }}>
                  <Text style={s.blockTitle}>Also block {ownerName}</Text>
                  <Text style={s.blockDesc}>You won’t see each other’s content or messages.</Text>
                </View>
                <HapticSwitch
                  value={alsoBlock}
                  onValueChange={setAlsoBlock}
                  trackColor={{ false: theme.border, true: theme.accent }}
                  thumbColor={alsoBlock ? theme.onAccent : theme.text}
                  {...({ activeThumbColor: theme.onAccent } as object)}
                  accessibilityLabel={`Also block ${ownerName}`}
                />
              </View>
            ) : null}

            {error ? (
              <View style={s.errorCard}>
                <Feather name="alert-circle" size={16} color={theme.error} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}

            <PrimaryButton
              label="Submit report"
              icon="flag"
              onPress={submit}
              loading={submitting}
              disabled={!canSubmit}
              style={{ marginTop: SP.lg }}
            />
            <Text style={s.legalNote}>
              False reports and abuse of reporting tools violate our Community Guidelines.
            </Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
  },
  headerBtn: { width: 40, height: 40, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.md },
  contextCard: {
    flexDirection: 'row', alignItems: 'center', gap: SP.md,
    backgroundColor: theme.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border,
    padding: SP.md, marginTop: SP.sm,
  },
  contextIcon: {
    width: 40, height: 40, borderRadius: RADIUS.sm, backgroundColor: theme.cardElevated,
    borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center',
  },
  contextEyebrow: { color: theme.subtle, fontFamily: FONT.semibold, fontSize: 11, letterSpacing: 1 },
  contextLabel: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base, marginTop: 3 },
  question: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.xl, letterSpacing: -0.4, marginTop: SP.lg },
  helper: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, marginTop: 6 },
  reasonList: {
    marginTop: SP.md, backgroundColor: theme.card, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: theme.border, overflow: 'hidden',
  },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.md, paddingVertical: 14 },
  reasonRowDivider: { borderTopWidth: 1, borderTopColor: theme.borderSubtle },
  reasonIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: theme.cardElevated,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border,
  },
  reasonLabel: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base },
  reasonDesc: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs + 1, marginTop: 2, lineHeight: 17 },
  selectedReason: {
    flexDirection: 'row', alignItems: 'center', gap: SP.md, marginTop: SP.lg,
    backgroundColor: theme.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.text,
    padding: SP.md,
  },
  changeText: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm, textDecorationLine: 'underline' },
  fieldLabel: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base, marginTop: SP.lg, marginBottom: SP.sm },
  optional: { color: theme.subtle, fontFamily: FONT.regular, fontSize: FS.sm },
  noteInput: {
    minHeight: 120, backgroundColor: theme.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border,
    color: theme.text, fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22,
    paddingHorizontal: SP.md, paddingTop: 14, paddingBottom: 14,
  },
  noteMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  noteHint: { color: theme.subtle, fontFamily: FONT.regular, fontSize: FS.xs },
  blockRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: SP.lg,
    backgroundColor: theme.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, padding: SP.md,
  },
  blockTitle: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base },
  blockDesc: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2, lineHeight: 18 },
  errorCard: {
    flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start', marginTop: SP.md,
    backgroundColor: theme.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.error + '66', padding: SP.md,
  },
  errorText: { flex: 1, color: theme.text, fontFamily: FONT.medium, fontSize: FS.sm, lineHeight: 19 },
  errorInline: { color: theme.error, fontFamily: FONT.medium, fontSize: FS.sm, textAlign: 'center', marginTop: SP.md },
  legalNote: { color: theme.subtle, fontFamily: FONT.regular, fontSize: FS.xs, textAlign: 'center', marginTop: SP.md, lineHeight: 16 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl, gap: SP.sm },
  doneScroll: { paddingHorizontal: SP.lg, paddingTop: SP.xxl, paddingBottom: SP.lg, alignItems: 'center' },
  doneIcon: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: theme.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: SP.lg,
  },
  doneTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.xxl, letterSpacing: -0.5, textAlign: 'center' },
  doneBody: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 23, textAlign: 'center', marginTop: SP.sm },
  nextCard: {
    alignSelf: 'stretch', marginTop: SP.xl, backgroundColor: theme.card, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: theme.border, padding: SP.md, gap: SP.md,
  },
  nextLabel: { color: theme.subtle, fontFamily: FONT.semibold, fontSize: 11, letterSpacing: 1 },
  nextRow: { flexDirection: 'row', gap: SP.md, alignItems: 'flex-start' },
  nextIcon: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: theme.cardElevated,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border,
  },
  nextText: { flex: 1, color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20, paddingTop: 4 },
  blockOffer: {
    alignSelf: 'stretch', marginTop: SP.md, backgroundColor: theme.card, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: theme.border, padding: SP.md,
  },
  blockOfferTitle: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base },
  blockOfferBody: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, marginTop: 4 },
  blockedNotice: {
    alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.md,
    backgroundColor: theme.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, padding: SP.md,
  },
  blockedNoticeText: { flex: 1, color: theme.text, fontFamily: FONT.medium, fontSize: FS.sm, lineHeight: 19 },
  footer: { paddingHorizontal: SP.md, paddingTop: SP.sm, gap: SP.xs },
  linkBtn: { alignItems: 'center', paddingVertical: SP.sm },
  linkText: { color: theme.muted, fontFamily: FONT.medium, fontSize: FS.sm, textDecorationLine: 'underline' },
});
