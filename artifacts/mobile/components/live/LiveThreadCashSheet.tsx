import { haptics, hapticLight, hapticSuccess } from '@/lib/haptics';
/**
 * LIVE viewer Thread Cash gift sheet — the rail's bill icon. TikTok LIVE
 * gift-sheet structure (balance at top, grid of tip amounts, one Send CTA),
 * in the app's own monochrome + Thread Cash green tokens, on the shared
 * `<Sheet>` with Send pinned above the home indicator.
 *
 * When `recipientId` and `streamId` are both real (the app/live.tsx pager),
 * sending is a real `api.threadCash.liveGift()` call — instant, never
 * gated on mutual follow (a viewer gifting a host they're watching rarely
 * follows them back), unlike `api.threadCash.send()`'s friend-to-friend
 * transfer. Only a `previewOnly` sheet (app/live-feed.tsx's `&demo=1`
 * sample rooms, which have no real host account) or a dev web preview stays
 * local-only. Anything else without a real `recipientId` + `streamId` fails
 * visibly instead of reporting a gift that never happened.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { randomUUID } from 'expo-crypto';
import { Sheet } from '@/components/ui/BottomSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { THREAD_CASH_GREEN_MID, ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { isPreviewThreadCashEnabled, getPreviewThreadCashStatus, PREVIEW_THREAD_CASH_STATUS } from '@/lib/previewThreadCash';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';

// Dev preview role only (not every __DEV__ build): demo shows the sample balance, fresh shows the empty one.
const isPreviewRole = () => __DEV__ && (isBuyerDevPreview() || isSellerDevPreview());
import { radius } from '@/constants/radii';
import { apiErrorMessage } from '@/lib/safety';

const TIP_AMOUNTS_CENTS = [100, 500, 1000, 2000, 5000, 10000];

export function LiveThreadCashSheet({
  visible, brandName, recipientId, streamId, previewOnly = false, onClose, onSent, onSendFailed,
}: {
  visible: boolean;
  brandName: string;
  /** Real host userId to gift. Omit for a sample room with no real
   *  account behind it — sending then stays local-only (see module doc). */
  recipientId?: string | null;
  /** Real live stream id, required alongside `recipientId` for a real gift
   *  (the server looks up the authoritative host from it). */
  streamId?: string | null;
  /** A demo sample room with no real host: the gift is shown locally only. */
  previewOnly?: boolean;
  onClose: () => void;
  /** Fires once the gift is actually sent (transferred, or locally mocked
   *  when there's no `recipientId`) — the caller posts the chat line. */
  onSent: (amountCents: number) => void;
  /** Fires when a real transfer attempt fails — the caller shows feedback. */
  onSendFailed?: (message: string) => void;
}) {
  const { theme } = useAppTheme();
  const api = useApi();
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  // Shown inside the sheet: a toast from the caller would sit behind this Modal.
  const [sendError, setSendError] = useState<string | null>(null);
  const [justSentCents, setJustSentCents] = useState<number | null>(null);
  const pop = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    setSelected(null);
    setJustSentCents(null);
    setSendError(null);
    // Same short-circuit ChatAttachThreadCash.tsx uses: there's no backend
    // to answer this in the dev-web preview, so attempting the real call
    // first just means a multi-second wait for it to time out before the
    // fallback balance ever appears — check preview first instead.
    if (isPreviewRole()) {
      setBalanceCents(getPreviewThreadCashStatus().balanceCents);
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
    if (recipientId && streamId && !isPreviewThreadCashEnabled()) {
      try {
        await api.threadCash.liveGift({
          streamId,
          amountCents: selected,
          idempotencyKey: randomUUID(),
        });
      } catch (error: any) {
        setSending(false);
        const message = apiErrorMessage(error, 'Could not send Thread Cash. Try again.');
        setSendError(message);
        onSendFailed?.(message);
        return;
      }
    }
    haptics.success();
    setBalanceCents(prev => (prev == null ? prev : Math.max(0, prev - selected)));
    hapticSuccess();
    setJustSentCents(selected);
    onSent(selected);
    setSending(false);
    setSelected(null);
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Send Thread Cash"
      testID="live-thread-cash-sheet"
      primaryAction={{
        label: selected ? `Send ${formatCents(selected)}` : 'Select an amount',
        onPress: () => { void handleSend(); },
        disabled: !selected || sending || balanceCents == null || selected > balanceCents,
        loading: sending,
        accessibilityLabel: selected ? `Send ${formatCents(selected)}` : 'Send',
      }}
    >
      <Text style={[styles.sub, { color: theme.muted }]}>To {brandName}</Text>

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
                { borderColor: isSelected ? theme.accent : theme.border },
                isSelected && { backgroundColor: theme.accent },
                !affordable && styles.tipDisabled,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected, disabled: !affordable }}
              accessibilityLabel={`Select ${formatCents(cents)}`}
            >
              <ThreadCashBillIcon size={18} style={isSelected ? { opacity: 0.85 } : undefined} />
              <Text style={[styles.tipText, { color: isSelected ? theme.onAccent : theme.text }]}>{formatCents(cents)}</Text>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sub: { fontFamily: FONT.regular, fontSize: FS.xs, marginBottom: SP.sm },
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
});
