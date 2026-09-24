/**
 * THREAD CASH HOOK POINT — chat.
 *
 * Send-in-chat (Apple-Cash-style) Thread Cash. Deliberately self-contained:
 * the 'Messaging + search' session owns app/chat/[id].tsx and its message
 * list — this file only exports the pieces a chat composer/attach-menu needs
 * to trigger a send, plus the card+claim UI for rendering one in the thread.
 * Wiring a Thread Cash message into the actual message list/bubble renderer
 * is left for that session; nothing here reaches into it.
 *
 * OFF by default behind the 'threadCashSend' feature flag: peer-to-peer
 * transfer of cash-like value can trigger money-transmitter and App Store
 * rules — Dev should confirm with a lawyer before turning it on.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';

/** The "+" attach-menu entry. Render only when useFeatureFlag('threadCashSend'). */
export function ThreadCashAttachButton({
  recipientId,
  conversationId,
  onSent,
}: {
  recipientId: string;
  conversationId: string;
  onSent: (result: { transferId: string; amountCents: number }) => void;
}) {
  const { theme } = useAppTheme();
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const amountCents = Math.round(Number(amountInput) * 100);
    if (!Number.isFinite(amountCents) || amountCents < 1) {
      Alert.alert('Enter an amount', 'Enter how much Thread Cash to send.');
      return;
    }
    setSending(true);
    try {
      const result = await api.threadCash.send({ recipientId, conversationId, amountCents });
      onSent({ transferId: result.transferId, amountCents });
      setOpen(false);
      setAmountInput('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      Alert.alert('Could not send Thread Cash', error?.message ?? 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Send Thread Cash"
        style={[styles.attachButton, { borderColor: theme.borderSubtle }]}
      >
        <Feather name="dollar-sign" size={18} color={theme.accent} />
      </TouchableOpacity>
      <Modal transparent animationType="slide" visible={open} onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.sheetTitle, { color: theme.text }]}>Send Thread Cash</Text>
            <TextInput
              style={[styles.amountInput, { color: theme.text, borderColor: theme.borderSubtle }]}
              placeholder="$0.00"
              placeholderTextColor={theme.subtle}
              keyboardType="decimal-pad"
              value={amountInput}
              onChangeText={setAmountInput}
              autoFocus
              accessibilityLabel="Thread Cash amount to send"
            />
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: theme.accent }]}
              onPress={handleSend}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel="Confirm send"
            >
              {sending ? <ActivityIndicator color={theme.onAccent} /> : <Text style={[styles.sendBtnText, { color: theme.onAccent }]}>Send</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setOpen(false)}>
              <Text style={[styles.cancelText, { color: theme.muted }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

/** Animated in-thread card for a Thread Cash send, with a claim flow. */
export function ThreadCashMessageCard({
  amountCents,
  claimed,
  isRecipient,
  onClaim,
}: {
  amountCents: number;
  claimed: boolean;
  isRecipient: boolean;
  onClaim: () => void;
}) {
  const { theme } = useAppTheme();
  const [claiming, setClaiming] = useState(false);

  async function handleClaim() {
    setClaiming(true);
    try {
      await Promise.resolve(onClaim());
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setClaiming(false);
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}>
      <Feather name="gift" size={22} color={theme.accent} />
      <Text style={[styles.cardAmount, { color: theme.text }]}>{formatCents(amountCents)} Thread Cash</Text>
      {claimed ? (
        <Text style={[styles.cardStatus, { color: theme.muted }]}>Claimed</Text>
      ) : isRecipient ? (
        <TouchableOpacity
          style={[styles.claimBtn, { backgroundColor: theme.accent }]}
          onPress={handleClaim}
          disabled={claiming}
          accessibilityRole="button"
          accessibilityLabel="Claim Thread Cash"
        >
          {claiming ? <ActivityIndicator color={theme.onAccent} size="small" /> : <Text style={[styles.claimBtnText, { color: theme.onAccent }]}>Claim</Text>}
        </TouchableOpacity>
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
  sheetTitle: { fontSize: FS.lg, fontFamily: FONT.bold, marginBottom: SP.md },
  amountInput: { borderWidth: 1, borderRadius: RADIUS.sm, padding: SP.sm, fontSize: FS.xl, fontFamily: FONT.semibold, textAlign: 'center', marginBottom: SP.md },
  sendBtn: { paddingVertical: SP.sm, borderRadius: RADIUS.md, alignItems: 'center', marginBottom: SP.sm },
  sendBtnText: { fontSize: FS.base, fontFamily: FONT.semibold },
  cancelText: { fontSize: FS.sm, fontFamily: FONT.medium, textAlign: 'center' },
  card: { borderWidth: 1, borderRadius: RADIUS.lg, padding: SP.md, alignItems: 'center', gap: SP.xs, minWidth: 180 },
  cardAmount: { fontSize: FS.lg, fontFamily: FONT.bold },
  cardStatus: { fontSize: FS.xs, fontFamily: FONT.regular },
  claimBtn: { paddingHorizontal: SP.md, paddingVertical: SP.xs, borderRadius: RADIUS.pill, marginTop: SP.xs },
  claimBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold },
});
