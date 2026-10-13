/**
 * Live auction card — the bottom card from Whatnot's live show, reskinned:
 *
 *   ● ana is winning!
 *   [img] Archive Wool Coat              $42
 *                                     ⏱ 00:06
 *   [ Custom ]  [ Bid: $44  » ]
 *
 * After the clock: "<name> won!" + Sold; the winner gets "Pay now". The host
 * sees the same card without bid buttons (and "Cancel auction" before the
 * first bid). The countdown is red (LIVE red) and is the only colour.
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { FONT, FS, RADIUS } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { radius } from '@/constants/radii';
import { useAuctionClock } from '@/lib/live/useAuctionClock';
import {
  auctionRemainingMs, auctionStatusLine, formatAuctionClock, formatBid, type LiveAuction,
} from '@/lib/live/liveAuction';
import { LIVE_RED } from './LiveAvatarRing';

export function LiveAuctionCard({
  auction, receivedAt, busy = false, onBid, onCustom, onPay, onCancel,
}: {
  auction: LiveAuction;
  receivedAt: number;
  busy?: boolean;
  onBid?: (amountCents: number) => void;
  onCustom?: () => void;
  onPay?: () => void;
  /** Host only, before the first bid. */
  onCancel?: () => void;
}) {
  const open = auction.status === 'open';
  const now = useAuctionClock(open, 250);
  const left = open ? auctionRemainingMs(auction, receivedAt, now) : 0;
  const statusLine = auctionStatusLine(auction);
  const price = auction.currentBidCents ?? auction.startingBidCents;
  const host = auction.isHost === true;
  const styles = useMemo(() => makeStyles(), []);

  return (
    <View style={styles.wrap} testID="live-auction-card">
      {statusLine ? (
        <View style={styles.statusRow}>
          <View style={styles.dot} />
          <Text style={styles.statusText} numberOfLines={1}>{statusLine}</Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <View style={styles.thumb}>
          {auction.imageUri
            ? <CachedImage source={{ uri: auction.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            : <Feather name="tag" size={18} color="#8E8E93" />}
        </View>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={2}>{auction.productName}</Text>
          <Text style={styles.meta}>{auction.bidCount === 1 ? '1 bid' : `${auction.bidCount} bids`}{auction.suddenDeath ? ' · Sudden death' : ''}</Text>
        </View>
        <View style={styles.priceCol}>
          <Text style={[styles.price, TABULAR_NUMS]}>{formatBid(price)}</Text>
          {open ? (
            <View style={styles.clock} accessibilityLabel={`${Math.ceil(left / 1000)} seconds left`}>
              <Feather name="clock" size={11} color={LIVE_RED} />
              <Text style={[styles.clockText, TABULAR_NUMS]} testID="live-auction-clock">{formatAuctionClock(left)}</Text>
            </View>
          ) : (
            <Text style={styles.sold}>{auction.status === 'sold' ? 'Sold' : auction.status === 'unsold' ? 'Unsold' : 'Ended'}</Text>
          )}
        </View>
      </View>

      {open && !host && onBid ? (
        <View style={styles.actions}>
          <Pressable onPress={onCustom} style={styles.custom} accessibilityRole="button" testID="live-auction-custom">
            <Text style={styles.customText}>Custom</Text>
          </Pressable>
          <Pressable
            onPress={() => onBid(auction.nextMinBidCents)}
            disabled={busy || auction.youAreLeading}
            style={[styles.bid, (busy || auction.youAreLeading) && styles.bidDisabled]}
            accessibilityRole="button"
            accessibilityLabel={`Bid ${formatBid(auction.nextMinBidCents)}`}
            testID="live-auction-bid"
          >
            <Text style={styles.bidText}>{`Bid: ${formatBid(auction.nextMinBidCents)}`}</Text>
            <Feather name="chevrons-right" size={18} color="#000" />
          </Pressable>
        </View>
      ) : null}
      {open && host && onCancel && auction.bidCount === 0 ? (
        <Pressable onPress={onCancel} style={styles.wide} accessibilityRole="button" testID="live-auction-cancel">
          <Text style={styles.customText}>Cancel auction</Text>
        </Pressable>
      ) : null}
      {!open && auction.youWon && auction.payable && onPay ? (
        <Pressable onPress={onPay} style={[styles.bid, styles.wideBid]} accessibilityRole="button" testID="live-auction-pay">
          <Text style={styles.bidText}>{`Pay ${formatBid(price)}`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function makeStyles() {
  // Always over video: fixed dark surface + white text, like the pinned product card.
  return StyleSheet.create({
    wrap: { backgroundColor: '#141414', borderRadius: 14, padding: 10, gap: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#3A3A3C' },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
    statusText: { color: '#fff', fontFamily: FONT.semibold, fontSize: FS.xs, flex: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    thumb: { width: 52, height: 52, borderRadius: RADIUS.xs, overflow: 'hidden', backgroundColor: '#2C2C2E', alignItems: 'center', justifyContent: 'center' },
    info: { flex: 1, minWidth: 0 },
    name: { color: '#fff', fontFamily: FONT.semibold, fontSize: FS.sm },
    meta: { color: '#AEAEB2', fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
    priceCol: { alignItems: 'flex-end', gap: 2 },
    price: { color: '#fff', fontFamily: FONT.bold, fontSize: FS.lg },
    clock: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    clockText: { color: LIVE_RED, fontFamily: FONT.bold, fontSize: FS.sm },
    sold: { color: LIVE_RED, fontFamily: FONT.bold, fontSize: FS.xs },
    actions: { flexDirection: 'row', gap: 8 },
    custom: { flex: 1, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
    customText: { color: '#fff', fontFamily: FONT.bold, fontSize: FS.sm },
    bid: { flex: 2, height: 44, borderRadius: radius.md, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    bidDisabled: { backgroundColor: '#8E8E93' },
    bidText: { color: '#000', fontFamily: FONT.bold, fontSize: FS.base },
    wide: { height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
    wideBid: { flex: 0, alignSelf: 'stretch' },
  });
}
