/**
 * LIVE viewer Thread Cash gift sheet — the rail's bill icon. TikTok LIVE
 * gift-sheet structure (balance at top, grid of tip amounts, one Send CTA),
 * in the app's own monochrome + Thread Cash green tokens. Built on the same
 * Modal + SheetRise + useAppTheme() pattern as LiveProductsSheet.tsx.
 *
 * When `recipientId` is a real host userId (the app/live.tsx pager), sending
 * is a real `api.threadCash.send()` transfer, same call
 * components/thread-cash/ChatAttachThreadCash.tsx uses to send in a DM — the
 * server independently re-checks mutual follow at send/claim either way, so
 * this affordance is never the actual security boundary. Without a
 * `recipientId` (app/live-feed.tsx's sample rooms, which have no real host
 * account to transfer to), sending stays local-only: it decrements the
 * shown balance and the caller posts a chat line, same as before.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { randomUUID } from 'expo-crypto';
import { SheetRise } from '@/components/motion/SheetRise';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { THREAD_CASH_GREEN_MID, ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { isPreviewThreadCashEnabled, PREVIEW_THREAD_CASH_STATUS } from '@/lib/previewThreadCash';
import { hapticLight } from '@/lib/haptics';

const TIP_AMOUNTS_CENTS = [100, 500, 1000, 2000, 5000, 10000];

export function LiveThreadCashSheet({
  visible, brandName, recipientId, onClose, onSent, onSendFailed,
}: {
  visible: boolean;
  brandName: string;
  /** Real host userId to transfer to. Omit for a sample room with no real
   *  account behind it — sending then stays local-only (see module doc). */
  recipientId?: string | null;
  onClose: () => void;
  /** Fires once the gift is actually sent (transferred, or locally mocked
   *  when there's no `recipientId`) — the caller posts the chat line. */
  onSent: (amountCents: number) => void;
  /** Fires when a real transfer attempt fails — the caller shows feedback. */
  onSendFailed?: (message: string) => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [justSentCents, setJustSentCents] = useState<number | null>(null);
  const pop = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    setSelected(null);
    setJustSentCents(null);
    // Same short-circuit ChatAttachThreadCash.tsx uses: there's no backend
    // to answer this in the dev-web preview, so attempting the real call
    // first just means a multi-second wait for it to time out before the
    // fallback balance ever appears — check preview first instead.
    if (isPreviewThreadCashEnabled()) {
      setBalanceCents(PREVIEW_THREAD_CASH_STATUS.balanceCents);
      return undefined;
    }
    let cancelled = false;
    api.threadCash.get()
      .then(status => { if (!cancelled) setBalanceCents(status.balanceCents); })
      .catch(() => { if (!cancelled) setBalanceCents(0); });
    return () => { cancelled = true; };
  }, [visible, api]);

  useEffect(() => {
    if (justSentCents == null) return;
    pop.value = 0;
    pop.value = withTiming(1, { duration: 260 });
    const timer = setTimeout(() => setJustSentCents(null), 1100);
    return () => clearTimeout(timer);
  }, [justSentCents, pop]);

  const popStyle = useAnimatedStyle(() => ({
    opacity: pop.value < 1 ? pop.value : 2 - pop.value,
    transform: [{ scale: 0.9 + pop.value * 0.1 }],
  }));

  async function handleSend() {
    if (!selected || sending || balanceCents == null || selected > balanceCents) return;
    setSending(true);
    hapticLight();
    if (recipientId && !isPreviewThreadCashEnabled()) {
      try {
        await api.threadCash.send({
          recipientId,
          amountCents: selected,
          idempotencyKey: randomUUID(),
        });
      } catch (error: any) {
        setSending(false);
        onSendFailed?.(error?.message ?? 'Could not send Thread Cash. Try again.');
        return;
      }
    }
    setBalanceCents(prev => (prev == null ? prev : Math.max(0, prev - selected)));
    setJustSentCents(selected);
    onSent(selected);
    setSending(false);
    setSelected(null);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close Thread Cash" />
      <SheetRise style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + SP.md }]} testID="live-thread-cash-sheet">
        <View style={[styles.handle, { backgroundColor: theme.border }]} />
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: theme.text }]}>Send Thread Cash</Text>
            <Text style={[styles.sub, { color: theme.muted }]}>To {brandName}</Text>
          </View>
          <Pressable onPress={onClose} style={[styles.close, { backgroundColor: theme.cardElevated }]} accessibilityRole="button" accessibilityLabel="Close" hitSlop={6}>
            <Feather name="x" size={18} color={theme.text} />
          </Pressable>
        </View>

        <View style={[styles.balancePill, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}>
          <ThreadCashBillIcon size={16} />
          <Text style={[styles.balanceText, { color: theme.text }]} testID="live-thread-cash-balance">
            {balanceCents == null ? '···' : `${formatCents(balanceCents)} available`}
          </Text>
        </View>

        {justSentCents != null && (
          <Animated.View style={[styles.sentBanner, { borderColor: THREAD_CASH_GREEN_MID }, popStyle]}>
            <Text style={[styles.sentBannerText, { color: theme.text }]}>Sent {formatCents(justSentCents)} 🎉</Text>
          </Animated.View>
        )}

        <View style={styles.grid}>
          {TIP_AMOUNTS_CENTS.map(cents => {
            const isSelected = selected === cents;
            const affordable = balanceCents == null || cents <= balanceCents;
            return (
              <Pressable
                key={cents}
                disabled={!affordable}
                onPress={() => { hapticLight(); setSelected(cents); }}
                style={[
                  styles.tip,
                  { borderColor: isSelected ? theme.text : theme.border },
                  isSelected && { backgroundColor: theme.text },
                  !affordable && styles.tipDisabled,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected, disabled: !affordable }}
                accessibilityLabel={`Select ${formatCents(cents)}`}
              >
                <ThreadCashBillIcon size={18} style={isSelected ? { opacity: 0.85 } : undefined} />
                <Text style={[styles.tipText, { color: isSelected ? theme.background : theme.text }]}>{formatCents(cents)}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={handleSend}
          disabled={!selected || sending || balanceCents == null || selected > balanceCents}
          style={[
            styles.sendBtn,
            { backgroundColor: theme.text },
            (!selected || sending || balanceCents == null || selected > balanceCents) && styles.sendBtnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={selected ? `Send ${formatCents(selected)}` : 'Send'}
        >
          <Text style={[styles.sendBtnText, { color: theme.background }]}>{selected ? `Send ${formatCents(selected)}` : 'Select an amount'}</Text>
        </Pressable>
      </SheetRise>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SP.md, paddingTop: SP.xs,
  },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: SP.sm },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: SP.sm },
  title: { fontFamily: FONT.bold, fontSize: FS.md },
  sub: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  balancePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 6, marginBottom: SP.sm,
  },
  balanceText: { fontFamily: FONT.semibold, fontSize: FS.xs },
  sentBanner: {
    borderWidth: 1, borderRadius: RADIUS.md, paddingVertical: SP.xs, alignItems: 'center', marginBottom: SP.sm,
  },
  sentBannerText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.md },
  tip: {
    width: '31%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderRadius: RADIUS.md, paddingVertical: SP.sm,
  },
  tipDisabled: { opacity: 0.35 },
  tipText: { fontFamily: FONT.bold, fontSize: FS.sm },
  sendBtn: { height: 46, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { fontFamily: FONT.bold, fontSize: FS.sm },
});
