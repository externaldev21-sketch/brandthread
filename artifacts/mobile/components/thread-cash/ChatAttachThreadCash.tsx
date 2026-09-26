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
 * never bypass that.
 *
 * Layout: Yubo "Send a Blast" (collapse chevron, balance pill, overlapping
 * circular badge, huge bold title, italic subtitle + link, note pill, preset
 * amount chips, one full-width pill CTA), reproduced in Brandthread's own
 * monochrome tokens/fonts — never Yubo's purple. The custom-amount keypad
 * is Cash-App-style (huge amount up top, plain 3-column numeric pad).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, Pressable, Alert, Animated, Easing } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ThreadCashBill, ThreadCashCoin } from './ThreadCashBill';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { SheetRise } from '@/components/motion/SheetRise';
import * as Haptics from 'expo-haptics';
import { randomUUID } from 'expo-crypto';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { isPreviewConversationId } from '@/lib/previewInbox';
import { authenticateForAppLock, getDeviceSecurity } from '@/lib/appLock';
import type { ThreadCashTransferStatus } from '@/lib/threadCashTypes';

const MAX_NOTE_LENGTH = 140;
const NUMPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
const PRESET_DOLLARS = [5, 10, 20] as const;
const BADGE_SIZE = 56;

function formatAmountDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * The Thread Cash mark, wherever a small coin glyph is needed inline (the
 * attach button, the sheet's balance pill and badge, the message card).
 * Renders the owner's actual Thread Cash coin art (see ThreadCashBill.tsx)
 * rather than a generic dollar-sign glyph. `color`/`accent` are kept as
 * no-op props for call-site compatibility; only `size` and `disabled`
 * (dimmed via opacity) affect the render.
 */
export function ThreadCashCoinMark({
  size = 20,
  disabled = false,
}: {
  size?: number;
  color?: string;
  accent?: string;
  disabled?: boolean;
}) {
  return <ThreadCashCoin size={size} style={disabled ? { opacity: 0.5 } : undefined} />;
}

type SheetStep = 'amount' | 'keypad' | 'confirm';

/** The "+" attach-menu entry. Render only when useFeatureFlag('threadCashSend'). */
export function ThreadCashAttachButton({
  recipientId,
  recipientName,
  recipientHandle,
  conversationId,
  onSent,
  renderTrigger,
  disabled = false,
  disabledReason,
}: {
  recipientId: string;
  /** Shown in the sheet's subtitle ("To @handle"). Falls back gracefully when omitted. */
  recipientName?: string;
  recipientHandle?: string;
  /** Omit when sending from a profile rather than an open chat thread. */
  conversationId?: string;
  onSent: (result: { transferId: string; amountCents: number; note: string | null }) => void;
  /** Custom trigger element (e.g. a profile action button) instead of the default icon button. */
  renderTrigger?: (open: () => void) => React.ReactNode;
  /**
   * When true, the entry point still renders (never hidden) but tapping it
   * explains why instead of opening the send sheet — e.g. not yet a mutual
   * follow. This is an affordance check only: the server independently
   * re-validates mutual follow at send AND claim, so it is never the actual
   * security boundary.
   */
  disabled?: boolean;
  /** Shown when `disabled` and the entry point is tapped. */
  disabledReason?: string;
}) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const api = useApi();
  const preview = isPreviewConversationId(conversationId ?? '');

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<SheetStep>('amount');
  const [selectedChip, setSelectedChip] = useState<number | 'custom' | null>(null);
  const [cents, setCents] = useState(0);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const idempotencyKey = useMemo(() => (open ? randomUUID() : null), [open]);

  useEffect(() => {
    if (!open) return;
    if (preview) { setBalanceCents(12_500); return; }
    let cancelled = false;
    api.threadCash.get()
      .then((status) => { if (!cancelled) setBalanceCents(status.balanceCents); })
      .catch(() => { if (!cancelled) setBalanceCents(null); });
    return () => { cancelled = true; };
  }, [open, preview, api]);

  function requestOpen() {
    if (disabled) {
      Alert.alert('Thread Cash', disabledReason || 'Follow each other to send Thread Cash.');
      return;
    }
    reset();
    setOpen(true);
  }

  function reset() {
    setStep('amount');
    setSelectedChip(null);
    setCents(0);
    setNote('');
    setConfirming(false);
  }

  function pickChip(dollars: number) {
    void Haptics.selectionAsync();
    setSelectedChip(dollars);
    setCents(dollars * 100);
  }

  function pickCustom() {
    void Haptics.selectionAsync();
    setSelectedChip('custom');
    setCents(0);
    setStep('keypad');
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

  async function handleConfirmAndSend() {
    if (cents < 1 || confirming || sending) return;
    setConfirming(true);
    try {
      const device = await getDeviceSecurity();
      if (device.supported && device.hasDeviceSecurity) {
        const result = await authenticateForAppLock({
          reason: `Confirm sending ${formatAmountDisplay(cents)} Thread Cash`,
        });
        if (!result.success) {
          setConfirming(false);
          if (!result.cancelled) Alert.alert('Could not confirm', 'Please try again.');
          return;
        }
      }
      // No biometric hardware/enrollment on this device — the confirm
      // screen itself (recipient + amount + explicit tap) is the fallback
      // confirm step, per spec.
      await handleSend();
    } finally {
      setConfirming(false);
    }
  }

  async function handleSend() {
    if (cents < 1) return;
    setSending(true);
    try {
      let transferId: string;
      if (preview || !idempotencyKey) {
        // No real backend to post to in preview — mock the send locally so
        // the whole flow is clickable end-to-end.
        transferId = `preview-${randomUUID()}`;
      } else {
        const result = await api.threadCash.send({
          recipientId,
          conversationId: conversationId || undefined,
          amountCents: cents,
          note: note.trim() || undefined,
          idempotencyKey,
        });
        transferId = result.transferId;
      }
      onSent({ transferId, amountCents: cents, note: note.trim() || null });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOpen(false);
      reset();
    } catch (error: any) {
      Alert.alert('Could not send Thread Cash', error?.message ?? 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  const handle = recipientHandle ? `@${recipientHandle.replace(/^@/, '')}` : (recipientName || 'them');
  const canProceedToConfirm = cents > 0;

  return (
    <>
      {renderTrigger ? renderTrigger(requestOpen) : (
        <TouchableOpacity
          onPress={requestOpen}
          accessibilityRole="button"
          accessibilityLabel={disabled ? `Thread Cash — ${disabledReason || 'unavailable'}` : 'Send Thread Cash'}
          accessibilityState={{ disabled }}
          style={[styles.attachButton, { borderColor: theme.borderSubtle }, disabled && styles.attachButtonDisabled]}
        >
          <ThreadCashCoinMark size={18} color={theme.text} accent={theme.accent} disabled={disabled} />
        </TouchableOpacity>
      )}
      <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} testID="thread-cash-backdrop" />
        <SheetRise style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {/* Circular badge, half in / half out of the sheet's top edge */}
          <View style={[styles.badge, { backgroundColor: theme.accent, borderColor: theme.card }]}>
            <ThreadCashCoinMark size={26} color={theme.onAccent} accent={theme.onAccent} />
          </View>

          <View style={styles.sheetHeader}>
            <TouchableOpacity
              onPress={() => setOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="thread-cash-collapse"
            >
              <Feather name="chevron-down" size={22} color={theme.muted} />
            </TouchableOpacity>
            <View style={[styles.balancePill, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}>
              <ThreadCashCoinMark size={14} color={theme.text} accent={theme.accent} />
              <Text style={[styles.balanceText, { color: theme.text }]} testID="thread-cash-balance">
                {balanceCents == null ? '···' : formatCents(balanceCents)}
              </Text>
            </View>
          </View>

          {step === 'keypad' ? (
            <>
              <Text
                style={[styles.bigAmount, { color: cents > 0 ? theme.text : theme.subtle }]}
                accessibilityLabel={`Amount ${formatAmountDisplay(cents)}`}
                testID="thread-cash-amount"
              >
                {formatAmountDisplay(cents)}
              </Text>
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
              <TouchableOpacity onPress={() => setStep('amount')} style={styles.backToChips}>
                <Text style={[styles.backToChipsText, { color: theme.muted }]}>Back to presets</Text>
              </TouchableOpacity>
            </>
          ) : step === 'confirm' ? (
            <View style={styles.confirmBlock}>
              <Text style={[styles.title, { color: theme.text }]}>{formatAmountDisplay(cents)}</Text>
              <Text style={[styles.subtitle, { color: theme.muted }]}>to {handle}</Text>
              {note.trim() ? <Text style={[styles.confirmNote, { color: theme.muted }]} numberOfLines={2}>“{note.trim()}”</Text> : null}
            </View>
          ) : (
            <>
              <Text style={[styles.title, { color: theme.text }]}>Send Thread Cash</Text>
              <Text style={[styles.subtitle, { color: theme.muted }]}>
                To {handle} · they follow you back{'  '}
                <Text
                  style={[styles.learnMore, { color: theme.text }]}
                  onPress={() => { setOpen(false); router.push('/thread-cash' as never); }}
                  testID="thread-cash-learn-more"
                >
                  How it works
                </Text>
              </Text>

              <TextInput
                style={[styles.noteInput, { color: theme.text, backgroundColor: theme.cardElevated, borderColor: theme.border }]}
                placeholder="Add a note"
                placeholderTextColor={theme.subtle}
                value={note}
                onChangeText={(t) => setNote(t.slice(0, MAX_NOTE_LENGTH))}
                maxLength={MAX_NOTE_LENGTH}
                accessibilityLabel="Note"
              />

              <View style={styles.chipRow}>
                {PRESET_DOLLARS.map((dollars) => {
                  const isSelected = selectedChip === dollars;
                  return (
                    <TouchableOpacity
                      key={dollars}
                      onPress={() => pickChip(dollars)}
                      style={[
                        styles.chip,
                        isSelected
                          ? { backgroundColor: theme.text, borderColor: theme.text }
                          : { backgroundColor: 'transparent', borderColor: theme.border },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`$${dollars}`}
                      testID={`thread-cash-chip-${dollars}`}
                    >
                      <Text style={[styles.chipText, { color: isSelected ? theme.background : theme.text }]}>${dollars}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  onPress={pickCustom}
                  style={[
                    styles.chip,
                    selectedChip === 'custom'
                      ? { backgroundColor: theme.text, borderColor: theme.text }
                      : { backgroundColor: 'transparent', borderColor: theme.border },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Custom amount"
                  testID="thread-cash-chip-custom"
                >
                  <Text style={[styles.chipText, { color: selectedChip === 'custom' ? theme.background : theme.text }]}>Custom</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          <Button
            label={step === 'confirm'
              ? `Confirm & Send · ${formatAmountDisplay(cents)}`
              : step === 'keypad'
                ? `Continue · ${formatAmountDisplay(cents)}`
                : `Send · ${formatAmountDisplay(cents)}`}
            variant="primary"
            fullWidth
            loading={sending || confirming}
            disabled={!canProceedToConfirm || sending || confirming}
            onPress={() => { step === 'confirm' ? handleConfirmAndSend() : setStep('confirm'); }}
            accessibilityLabel={step === 'confirm' ? 'Confirm and send' : 'Continue'}
            testID={step === 'confirm' ? 'thread-cash-confirm-send' : 'thread-cash-continue'}
          />
        </SheetRise>
      </Modal>
    </>
  );
}

/**
 * A moving highlight sweep across whatever it wraps — used on the payment
 * bubble's amount text. Same pulsing-animation technique as
 * components/layout/Skeleton.tsx's SkeletonBlock, adapted into a diagonal
 * translateX sweep instead of an opacity pulse.
 */
function ShimmerSweep({ width, height }: { width: number; height: number }) {
  const translate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translate, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(translate, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [translate]);

  const translateX = translate.interpolate({ inputRange: [0, 1], outputRange: [-width, width] });

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden', width, height }]}>
      <Animated.View style={{ width: width * 0.6, height, transform: [{ translateX }] }}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.35)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

/**
 * In-thread payment bubble — Apple-Cash-in-iMessage style: a solid card in
 * the theme's accent, the coin mark, a big amount with a subtle shimmer
 * sweep, a one-line status, and (for the receiver of a pending transfer) an
 * Accept action (wired to the existing claim handler).
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
  const [amountWidth, setAmountWidth] = useState(0);

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

  const statusLabel: Record<ThreadCashTransferStatus, string> = {
    pending: isSender ? 'Sent' : 'Pending',
    claimed: 'Accepted',
    cancelled: 'Cancelled',
    expired: 'Expired — returned to sender',
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.accent, overflow: 'hidden' }]}>
      <View style={styles.cardBillWatermark} pointerEvents="none">
        <ThreadCashBill width={260} />
      </View>
      <ThreadCashCoinMark size={28} color={theme.onAccent} accent={theme.onAccent} />
      <View style={styles.cardAmountWrap} onLayout={(e) => setAmountWidth(e.nativeEvent.layout.width)}>
        <Text style={[styles.cardAmount, { color: theme.onAccent }]}>{formatCents(amountCents)}</Text>
        {status === 'pending' && amountWidth > 0 && <ShimmerSweep width={amountWidth} height={34} />}
      </View>
      {note ? <Text style={[styles.cardNote, { color: theme.onAccent, opacity: 0.75 }]} numberOfLines={2}>“{note}”</Text> : null}
      <Text style={[styles.cardStatus, { color: theme.onAccent, opacity: 0.8 }]}>{statusLabel[status]}</Text>

      {status === 'pending' && isRecipient && (
        <TouchableOpacity
          style={[styles.acceptBtn, { backgroundColor: theme.onAccent }]}
          disabled={busy}
          onPress={() => run(onClaim)}
          accessibilityRole="button"
          accessibilityLabel="Accept Thread Cash"
          testID="thread-cash-accept"
        >
          <Text style={[styles.acceptBtnText, { color: theme.accent }]}>{busy ? 'Accepting…' : 'Accept'}</Text>
        </TouchableOpacity>
      )}
      {status === 'pending' && isSender && onCancel && (
        <TouchableOpacity onPress={() => run(onCancel)} disabled={busy} accessibilityRole="button" accessibilityLabel="Cancel send">
          <Text style={[styles.cancelLink, { color: theme.onAccent }]}>{busy ? 'Cancelling…' : 'Cancel'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  attachButton: { width: 36, height: 36, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  attachButtonDisabled: { opacity: 0.45 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000A0' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    borderWidth: 1, padding: SP.lg, paddingTop: SP.lg + BADGE_SIZE / 2,
  },
  badge: {
    position: 'absolute', top: -BADGE_SIZE / 2, alignSelf: 'center',
    width: BADGE_SIZE, height: BADGE_SIZE, borderRadius: BADGE_SIZE / 2,
    borderWidth: 3, alignItems: 'center', justifyContent: 'center',
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.md },
  balancePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 5,
  },
  balanceText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  title: { fontSize: FS.h1, fontFamily: FONT.bold, textAlign: 'center', letterSpacing: -0.5 },
  subtitle: { fontSize: FS.sm, fontFamily: FONT.regular, fontStyle: 'italic', textAlign: 'center', marginTop: SP.xs, marginBottom: SP.md },
  learnMore: { fontFamily: FONT.semibold, textDecorationLine: 'underline', fontStyle: 'normal' },
  noteInput: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: SP.md, paddingVertical: SP.sm, fontSize: FS.base, fontFamily: FONT.regular, marginBottom: SP.md },
  chipRow: { flexDirection: 'row', gap: SP.xs, marginBottom: SP.lg },
  chip: { flex: 1, borderWidth: 1, borderRadius: RADIUS.pill, paddingVertical: SP.sm, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: FS.base, fontFamily: FONT.bold },
  bigAmount: { fontSize: 56, fontFamily: FONT.bold, textAlign: 'center', marginVertical: SP.md },
  numpad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: SP.sm },
  numpadKey: { width: '32%', height: 56, alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm },
  numpadKeyText: { fontSize: FS.xl, fontFamily: FONT.semibold },
  backToChips: { alignSelf: 'center', marginBottom: SP.md },
  backToChipsText: { fontSize: FS.sm, fontFamily: FONT.medium, textDecorationLine: 'underline' },
  confirmBlock: { alignItems: 'center', marginBottom: SP.lg },
  confirmNote: { fontSize: FS.xs, fontFamily: FONT.regular, fontStyle: 'italic', marginTop: SP.xs },
  card: { borderRadius: RADIUS.lg, padding: SP.md, alignItems: 'center', gap: SP.xs, minWidth: 200, maxWidth: 240 },
  cardBillWatermark: { position: 'absolute', top: -10, left: '50%', marginLeft: -130, opacity: 0.18 },
  cardAmountWrap: { position: 'relative' },
  cardAmount: { fontSize: FS.xxl, fontFamily: FONT.bold },
  cardNote: { fontSize: FS.xs, fontFamily: FONT.regular, fontStyle: 'italic', textAlign: 'center' },
  cardStatus: { fontSize: FS.xs, fontFamily: FONT.semibold, textTransform: 'uppercase', letterSpacing: 0.5 },
  acceptBtn: { borderRadius: RADIUS.pill, paddingHorizontal: SP.lg, paddingVertical: SP.sm, marginTop: SP.xs },
  acceptBtnText: { fontSize: FS.sm, fontFamily: FONT.bold },
  cancelLink: { fontSize: FS.xs, fontFamily: FONT.medium, textDecorationLine: 'underline', marginTop: SP.xs },
});
