/**
 * Custom bid — Whatnot's "Custom" sheet: the piece and current price at the
 * top, the red countdown, a − / amount / + stepper on the bid ladder, and one
 * submit button. (Whatnot's auto "Max bid" is not included.)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { useAuctionClock } from '@/lib/live/useAuctionClock';
import {
  auctionRemainingMs, formatAuctionClock, formatBid, nextBidAbove, prevBid, type LiveAuction,
} from '@/lib/live/liveAuction';
import { LIVE_RED } from './LiveAvatarRing';

export function LiveAuctionBidSheet({ auction, receivedAt, visible, onClose, onSubmit }: {
  auction: LiveAuction; receivedAt: number; visible: boolean; onClose: () => void;
  onSubmit: (amountCents: number) => Promise<string | null>;
}) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const min = auction.nextMinBidCents;
  const [amount, setAmount] = useState(min);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const now = useAuctionClock(visible && auction.status === 'open', 250);
  const left = auction.status === 'open' ? auctionRemainingMs(auction, receivedAt, now) : 0;

  // Someone outbid: the floor moved up under the stepper.
  useEffect(() => { setAmount(a => (a < min ? min : a)); }, [min]);
  useEffect(() => { if (visible) { setAmount(min); setError(''); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setBusy(true);
    setError('');
    const message = await onSubmit(amount);
    setBusy(false);
    if (message) setError(message);
    else onClose();
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} testID="live-auction-bid-sheet">
      <View style={{ paddingHorizontal: SP.md, paddingTop: SP.xs }}>
      <View style={styles.head}>
        <Text style={styles.title} numberOfLines={2}>{auction.productName}</Text>
        <Text style={[styles.current, TABULAR_NUMS]}>{formatBid(auction.currentBidCents ?? auction.startingBidCents)}</Text>
      </View>
      <Text style={[styles.clock, TABULAR_NUMS]}>{formatAuctionClock(left)}</Text>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => setAmount(a => prevBid(a, min))}
          disabled={amount <= min}
          style={[styles.step, amount <= min && styles.stepDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Lower bid"
          testID="live-auction-bid-minus"
        >
          <Feather name="minus" size={22} color={theme.text} />
        </Pressable>
        <Text style={[styles.amount, TABULAR_NUMS]} accessibilityLiveRegion="polite">{formatBid(amount)}</Text>
        <Pressable
          onPress={() => setAmount(a => nextBidAbove(a))}
          style={[styles.step, styles.stepPlus]}
          accessibilityRole="button"
          accessibilityLabel="Raise bid"
          testID="live-auction-bid-plus"
        >
          <Feather name="plus" size={22} color={theme.onAccent} />
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label={`Bid ${formatBid(amount)}`} onPress={() => void submit()} loading={busy} disabled={auction.status !== 'open'} fullWidth testID="live-auction-bid-submit" />
      </View>
    </BottomSheet>
  );
}

function makeStyles(theme: ReturnType<typeof useAppTheme>['theme']) {
  return StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
    title: { flex: 1, fontFamily: FONT.bold, fontSize: FS.base, color: theme.text },
    current: { fontFamily: FONT.bold, fontSize: FS.base, color: theme.text },
    clock: { alignSelf: 'center', marginTop: SP.md, fontFamily: FONT.bold, fontSize: FS.sm, color: LIVE_RED },
    stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: SP.lg },
    step: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.cardElevated },
    stepPlus: { backgroundColor: theme.accent },
    stepDisabled: { opacity: 0.4 },
    amount: { fontFamily: FONT.bold, fontSize: 40, color: theme.text },
    error: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text, textAlign: 'center', marginBottom: SP.sm },
  });
}
