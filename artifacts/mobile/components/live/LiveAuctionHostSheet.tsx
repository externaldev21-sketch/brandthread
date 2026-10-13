/**
 * Host: start an auction (Whatnot's host flow) — pick a tagged piece, a
 * starting bid, a timer (10 / 15 / 30 / 60 s) and optionally Sudden death
 * (no time added for late bids). Only 1-of-1s can be auctioned; the server
 * enforces it and its message is shown here.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ListRow } from '@/components/ui/ListRow';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { apiErrorMessage } from '@/lib/safety';
import { AUCTION_DURATIONS, formatBid, minIncrementCents } from '@/lib/live/liveAuction';
import { startLiveAuction } from '@/services/liveAuctionsService';

export function LiveAuctionHostSheet({ streamId, products, visible, onClose, onStarted }: {
  streamId: string;
  products: Array<{ productId: string; productName: string; priceCents?: number }>;
  visible: boolean;
  onClose: () => void;
  onStarted?: () => void;
}) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [productId, setProductId] = useState<string | null>(products[0]?.productId ?? null);
  const [startCents, setStartCents] = useState(100);
  const [duration, setDuration] = useState<number>(15);
  const [suddenDeath, setSuddenDeath] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    if (!productId) return;
    setBusy(true);
    setError('');
    try {
      await startLiveAuction(streamId, { productId, startingBidCents: startCents, durationSeconds: duration, suddenDeath });
      onStarted?.();
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, 'Couldn’t start the auction. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  const step = (dir: 1 | -1) => setStartCents(c => {
    const inc = minIncrementCents(dir > 0 ? c : Math.max(100, c - 1));
    return Math.max(100, c + dir * inc);
  });

  return (
    <BottomSheet visible={visible} onClose={onClose} testID="live-auction-host-sheet">
      <View style={{ paddingHorizontal: SP.md, paddingTop: SP.xs }}>
      <Text style={styles.title}>Start an auction</Text>
      <Text style={styles.label}>Piece</Text>
      <ScrollView style={{ maxHeight: 180 }}>
        {products.map(p => (
          <Pressable
            key={p.productId}
            onPress={() => setProductId(p.productId)}
            style={styles.row}
            accessibilityRole="radio"
            accessibilityState={{ selected: productId === p.productId }}
          >
            <Text style={styles.name} numberOfLines={1}>{p.productName}</Text>
            <Feather name={productId === p.productId ? 'check-circle' : 'circle'} size={18} color={productId === p.productId ? theme.text : theme.muted} />
          </Pressable>
        ))}
        {products.length === 0 ? <Text style={styles.empty}>Tag a product in this live first</Text> : null}
      </ScrollView>

      <Text style={styles.label}>Starting bid</Text>
      <View style={styles.stepper}>
        <Pressable onPress={() => step(-1)} disabled={startCents <= 100} style={[styles.step, startCents <= 100 && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Lower starting bid">
          <Feather name="minus" size={18} color={theme.text} />
        </Pressable>
        <Text style={[styles.amount, TABULAR_NUMS]}>{formatBid(startCents)}</Text>
        <Pressable onPress={() => step(1)} style={styles.step} accessibilityRole="button" accessibilityLabel="Raise starting bid">
          <Feather name="plus" size={18} color={theme.text} />
        </Pressable>
      </View>

      <Text style={styles.label}>Timer</Text>
      <View style={styles.chips}>
        {AUCTION_DURATIONS.map(d => (
          <Chip key={d} label={`${d}s`} selected={duration === d} onPress={() => setDuration(d)} />
        ))}
      </View>
      <ListRow title="Sudden death" subtitle="No extra time for late bids" toggle={{ value: suddenDeath, onChange: setSuddenDeath }} testID="live-auction-sudden-death" />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Start auction" onPress={() => void start()} loading={busy} disabled={!productId} fullWidth testID="live-auction-start" />
      </View>
    </BottomSheet>
  );
}

function makeStyles(theme: ReturnType<typeof useAppTheme>['theme']) {
  return StyleSheet.create({
    title: { fontFamily: FONT.bold, fontSize: FS.base, color: theme.text },
    label: { fontFamily: FONT.medium, fontSize: FS.xs, color: theme.muted, marginTop: SP.md, marginBottom: SP.xs },
    row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
    name: { flex: 1, fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },
    empty: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, paddingVertical: SP.sm },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
    step: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.cardElevated },
    amount: { fontFamily: FONT.bold, fontSize: FS.xl, color: theme.text, minWidth: 80, textAlign: 'center' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.sm },
    error: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text, marginVertical: SP.xs },
  });
}
