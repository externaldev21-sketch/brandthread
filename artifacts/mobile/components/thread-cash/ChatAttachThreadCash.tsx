/**
 * Send-in-chat (Apple-Cash-style) Thread Cash. Deliberately self-contained:
 * the 'Messaging + search' session owns app/chat/[id].tsx and its message
 * list — this file only exports the pieces a chat composer/attach-menu needs
 * to trigger a send, plus the bubble+claim/cancel UI for rendering one in
 * the thread. Wiring a Thread Cash message into the actual message
 * list/bubble renderer is left for that session; nothing here reaches into
 * it.
 *
 * Friends (mutual follow) can send freely — the server re-checks mutual
 * follow and blocks at both send and claim, so a stale UI state here can
 * never bypass that. Layout follows a Venmo/Up-style big-amount number pad
 * (see PR description for references), rendered in Brandthread's own
 * monochrome tokens/components.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, Alert, ActivityIndicator, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { randomUUID } from 'expo-crypto';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS, COMP } from '@/lib/theme';
import { Button } from '@/components/ui';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import type { ThreadCashTransferStatus } from '@/lib/threadCashTypes';

const MAX_NOTE_LENGTH = 140;
const NUMPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

function formatAmountDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

type SendStep = 'amount' | 'confirm' | 'success';

/** The "+" attach-menu entry. Render only when useFeatureFlag('threadCashSend'). */
export function ThreadCashAttachButton({
  recipientId,
  recipientName,
  conversationId,
  onSent,
  renderTrigger,
}: {
  recipientId: string;
  /** Shown on the confirm step ("Send $5.00 to Mila"). Falls back to "your friend". */
  recipientName?: string;
  /** Omit when sending from a profile rather than an open chat thread. */
  conversationId?: string;
  onSent: (result: { transferId: string; amountCents: number; note: string | null }) => void;
  /** Custom trigger element (e.g. a profile action button) instead of the default icon button. */
  renderTrigger?: (open: () => void) => React.ReactNode;
}) {
  const { theme } = useAppTheme();
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<SendStep>('amount');
  const [cents, setCents] = useState(0);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const successScale = useMemo(() => new Animated.Value(0.6), []);
  const idempotencyKey = useMemo(() => (open ? randomUUID() : null), [open]);
  const displayName = recipientName?.trim() || 'your friend';

  function openSheet() {
    setStep('amount');
    setCents(0);
    setNote('');
    setOpen(true);
  }

  function closeSheet() {
    setOpen(false);
  }

  function pressKey(key: string) {
    void Haptics.selectionAsync();
    if (key === '⌫') {
      setCents((c) => Math.floor(c / 10));
      return;
    }
    if (key === '.') return; // cents-only entry keypad — decimal is implicit
    setCents((c) => {
      const next = c * 10 + Number(key);
      return next > 100_000_00 ? c : next; // hard client-side ceiling; server is authoritative
    });
  }

  function goToConfirm() {
    if (cents < 1) {
      Alert.alert('Enter an amount', 'Enter how much Thread Cash to send.');
      return;
    }
    void Haptics.selectionAsync();
    setStep('confirm');
  }

  async function handleConfirmSend() {
    if (!idempotencyKey) return;
    setSending(true);
    try {
      const result = await api.threadCash.send({
        recipientId,
        conversationId: conversationId || undefined,
        amountCents: cents,
        note: note.trim() || undefined,
        idempotencyKey,
      });
      onSent({ transferId: result.transferId, amountCents: cents, note: note.trim() || null });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      successScale.setValue(0.6);
      setStep('success');
      Animated.spring(successScale, { toValue: 1, useNativeDriver: true, friction: 6 }).start();
    } catch (error: any) {
      Alert.alert('Could not send Thread Cash', error?.message ?? 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {renderTrigger ? renderTrigger(openSheet) : (
        <TouchableOpacity
          onPress={openSheet}
          accessibilityRole="button"
          accessibilityLabel="Send Thread Cash"
          style={[styles.attachButton, { borderColor: theme.borderSubtle }]}
        >
          <Feather name="dollar-sign" size={18} color={theme.accent} />
        </TouchableOpacity>
      )}
      <Modal transparent animationType="slide" visible={open} onRequestClose={closeSheet}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.sheetHandleWrap}><View style={[styles.sheetHandle, { backgroundColor: theme.borderSubtle }]} /></View>

            {step === 'amount' && (
              <>
                <View style={styles.sheetHeader}>
                  <Text style={[styles.sheetTitle, { color: theme.text }]}>Send Thread Cash</Text>
                  <TouchableOpacity onPress={closeSheet} accessibilityRole="button" accessibilityLabel="Close">
                    <Feather name="x" size={22} color={theme.muted} />
                  </TouchableOpacity>
                </View>
                <Text style={[styles.recipientLine, { color: theme.muted }]}>To {displayName}</Text>

                <Text
                  style={[styles.bigAmount, { color: cents > 0 ? theme.text : theme.subtle }]}
                  accessibilityLabel={`Amount ${formatAmountDisplay(cents)}`}
                >
                  {formatAmountDisplay(cents)}
                </Text>

                <TextInput
                  style={[styles.noteInput, { color: theme.text, borderColor: theme.borderSubtle, backgroundColor: theme.cardElevated }]}
                  placeholder="Add a note (optional)"
                  placeholderTextColor={theme.subtle}
                  value={note}
                  onChangeText={(t) => setNote(t.slice(0, MAX_NOTE_LENGTH))}
                  maxLength={MAX_NOTE_LENGTH}
                  accessibilityLabel="Note"
                />

                <View style={styles.numpad}>
                  {NUMPAD_KEYS.map((key) => (
                    <TouchableOpacity
                      key={key}
                      style={styles.numpadKey}
                      onPress={() => pressKey(key)}
                      accessibilityRole="button"
                      accessibilityLabel={key === '⌫' ? 'Backspace' : `Digit ${key}`}
                    >
                      <Text style={[styles.numpadKeyText, { color: theme.text }]}>{key}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Button label="Next" onPress={goToConfirm} disabled={cents < 1} fullWidth icon="arrow-right" />
              </>
            )}

            {step === 'confirm' && (
              <>
                <View style={styles.sheetHeader}>
                  <TouchableOpacity onPress={() => setStep('amount')} accessibilityRole="button" accessibilityLabel="Back">
                    <Feather name="chevron-left" size={22} color={theme.muted} />
                  </TouchableOpacity>
                  <Text style={[styles.sheetTitle, { color: theme.text }]}>Review</Text>
                  <TouchableOpacity onPress={closeSheet} accessibilityRole="button" accessibilityLabel="Close">
                    <Feather name="x" size={22} color={theme.muted} />
                  </TouchableOpacity>
                </View>

                <View style={styles.confirmHero}>
                  <View style={[styles.confirmIcon, { backgroundColor: theme.accentDim }]}>
                    <Feather name="gift" size={26} color={theme.accent} />
                  </View>
                  <Text style={[styles.confirmAmount, { color: theme.text }]}>{formatAmountDisplay(cents)}</Text>
                  <Text style={[styles.confirmTo, { color: theme.muted }]}>to {displayName}</Text>
                </View>

                <View style={[styles.confirmCard, { borderColor: theme.borderSubtle, backgroundColor: theme.cardElevated }]}>
                  <View style={styles.confirmRow}>
                    <Text style={[styles.confirmLabel, { color: theme.muted }]}>Amount</Text>
                    <Text style={[styles.confirmValue, { color: theme.text }]}>{formatAmountDisplay(cents)}</Text>
                  </View>
                  {note.trim() ? (
                    <View style={[styles.confirmRow, styles.confirmRowBorder, { borderColor: theme.borderSubtle }]}>
                      <Text style={[styles.confirmLabel, { color: theme.muted }]}>Note</Text>
                      <Text style={[styles.confirmValue, { color: theme.text, flex: 1, textAlign: 'right' }]} numberOfLines={2}>{note.trim()}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.confirmFootnote, { color: theme.subtle }]}>
                  Thread Cash — not real money. {displayName} has 14 days to claim it or it's returned to you.
                </Text>

                <Button label={sending ? 'Sending…' : 'Send'} onPress={handleConfirmSend} loading={sending} disabled={sending} fullWidth icon="send" />
              </>
            )}

            {step === 'success' && (
              <View style={styles.successWrap}>
                <Animated.View style={[styles.successIcon, { backgroundColor: theme.accent, transform: [{ scale: successScale }] }]}>
                  <Feather name="check" size={32} color={theme.onAccent} />
                </Animated.View>
                <Text style={[styles.successAmount, { color: theme.text }]}>{formatAmountDisplay(cents)} sent!</Text>
                <Text style={[styles.successSub, { color: theme.muted }]}>{displayName} will get a notification to claim it.</Text>
                <Button label="Done" onPress={closeSheet} fullWidth variant="secondary" style={{ marginTop: SP.lg }} />
              </View>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

/**
 * In-thread bubble for a Thread Cash send: amount, optional note, and a
 * status-appropriate action (Claim for a pending recipient, Cancel for a
 * pending sender, or a plain status label once resolved).
 */
export function ThreadCashMessageCard({
  amountCents,
  note,
  status,
  isRecipient,
  isSender,
  onClaim,
  onCancel,
}: {
  amountCents: number;
  note?: string | null;
  status: ThreadCashTransferStatus;
  isRecipient: boolean;
  isSender: boolean;
  onClaim: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
}) {
  const { theme } = useAppTheme();
  const [busy, setBusy] = useState(false);

  async function run(action: () => void | Promise<void>) {
    setBusy(true);
    try {
      await Promise.resolve(action());
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      Alert.alert('Something went wrong', error?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const statusLabel: Record<Exclude<ThreadCashTransferStatus, 'pending'>, string> = {
    claimed: 'Claimed',
    cancelled: 'Cancelled',
    expired: 'Expired — returned to sender',
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}>
      <Feather name="gift" size={22} color={theme.accent} />
      <Text style={[styles.cardAmount, { color: theme.text }]}>{formatCents(amountCents)} Thread Cash</Text>
      {note ? <Text style={[styles.cardNote, { color: theme.muted }]} numberOfLines={2}>“{note}”</Text> : null}

      {status !== 'pending' ? (
        <Text style={[styles.cardStatus, { color: theme.muted }]}>{statusLabel[status]}</Text>
      ) : isRecipient ? (
        <TouchableOpacity
          style={[styles.claimBtn, { backgroundColor: theme.accent }]}
          onPress={() => run(onClaim)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Claim Thread Cash"
        >
          {busy ? <ActivityIndicator color={theme.onAccent} size="small" /> : <Text style={[styles.claimBtnText, { color: theme.onAccent }]}>Claim</Text>}
        </TouchableOpacity>
      ) : isSender && onCancel ? (
        <View style={{ alignItems: 'center', gap: SP.xs }}>
          <Text style={[styles.cardStatus, { color: theme.muted }]}>Waiting to be claimed</Text>
          <TouchableOpacity onPress={() => run(onCancel)} disabled={busy} accessibilityRole="button" accessibilityLabel="Cancel send">
            <Text style={[styles.cancelLink, { color: theme.muted }]}>{busy ? 'Cancelling…' : 'Cancel'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={[styles.cardStatus, { color: theme.muted }]}>Waiting to be claimed</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  attachButton: { width: 36, height: 36, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: '#000000A0', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, borderWidth: 1, padding: SP.lg },
  sheetHandleWrap: { alignItems: 'center', marginBottom: SP.sm },
  sheetHandle: { width: 36, height: 4, borderRadius: 2 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.xs },
  sheetTitle: { fontSize: FS.lg, fontFamily: FONT.bold },
  recipientLine: { fontSize: FS.sm, fontFamily: FONT.medium, textAlign: 'center', marginBottom: SP.xs },
  bigAmount: { fontSize: 56, fontFamily: FONT.bold, textAlign: 'center', marginVertical: SP.md },
  noteInput: { borderWidth: 1, borderRadius: RADIUS.md, padding: SP.sm, fontSize: FS.base, fontFamily: FONT.regular, marginBottom: SP.md, minHeight: COMP.minTouchTarget },
  numpad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: SP.md },
  numpadKey: { width: '32%', height: COMP.buttonH, alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm },
  numpadKeyText: { fontSize: FS.xl, fontFamily: FONT.semibold },
  card: { borderWidth: 1, borderRadius: RADIUS.lg, padding: SP.md, alignItems: 'center', gap: SP.xs, minWidth: 200, maxWidth: 260 },
  confirmHero: { alignItems: 'center', marginBottom: SP.lg },
  confirmIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm },
  confirmAmount: { fontSize: FS.xxl, fontFamily: FONT.bold },
  confirmTo: { fontSize: FS.sm, fontFamily: FONT.medium, marginTop: 2 },
  confirmCard: { borderWidth: 1, borderRadius: RADIUS.md, marginBottom: SP.sm, overflow: 'hidden' },
  confirmRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  confirmRowBorder: { borderTopWidth: StyleSheet.hairlineWidth },
  confirmLabel: { fontSize: FS.sm, fontFamily: FONT.regular },
  confirmValue: { fontSize: FS.sm, fontFamily: FONT.semibold },
  confirmFootnote: { fontSize: FS.xs, fontFamily: FONT.regular, textAlign: 'center', lineHeight: 16, marginBottom: SP.lg },
  successWrap: { alignItems: 'center', paddingVertical: SP.lg },
  successIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md },
  successAmount: { fontSize: FS.xl, fontFamily: FONT.bold },
  successSub: { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', marginTop: SP.xs, paddingHorizontal: SP.md },
  cardAmount: { fontSize: FS.lg, fontFamily: FONT.bold },
  cardNote: { fontSize: FS.xs, fontFamily: FONT.regular, fontStyle: 'italic', textAlign: 'center' },
  cardStatus: { fontSize: FS.xs, fontFamily: FONT.regular },
  claimBtn: { paddingHorizontal: SP.md, paddingVertical: SP.xs, borderRadius: RADIUS.pill, marginTop: SP.xs, minHeight: 36, justifyContent: 'center' },
  claimBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  cancelLink: { fontSize: FS.xs, fontFamily: FONT.medium, textDecorationLine: 'underline' },
});
