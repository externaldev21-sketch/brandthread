/**
 * Chat cards for the RFQ / quote-comparison and "send sample request" flows,
 * matching OrderCardBubble's visual style.
 *
 * NOT YET WIRED INTO THE LIVE MESSAGE FEED: manufacturer-messages.tsx only
 * ever renders `messageType` values the server sends — 'text' | 'image' |
 * 'sample_card' | 'bulk_card' | 'system' (see ApiMessage in that file). The
 * server has no 'rfq_card' or 'sample_request_card' messageType/cardData
 * contract yet, and this task is scoped to the mobile app only (no API/DB
 * changes), so these components are ready to drop into that switch the day a
 * backend messageType for them ships, but nothing constructs a fake message
 * to render them today — per this codebase's rule against faking success.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BORDER, CARD, CARD_ELEVATED, FG, FONT, FS, MUTED, RADIUS, SP, SUBTLE, SUCCESS } from '@/lib/theme';
import { formatCents } from '@/lib/money';

// ─── RFQ / quote-summary card ──────────────────────────────────────────────────

export interface RfqSummarySnapshot {
  id: string;
  garmentType: string;
  quantity: number;
  manufacturersCount: number;
  quotesReceivedCount: number;
  bestPriceCents?: number | null;
}

export function RfqSummaryCardBubble({
  rfq, fromMe, time, onOpenCompare,
}: { rfq: RfqSummarySnapshot; fromMe: boolean; time: string; onOpenCompare: (rfq: RfqSummarySnapshot) => void }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.row, fromMe ? styles.right : styles.left]}>
      <TouchableOpacity activeOpacity={0.85} style={styles.card} onPress={() => onOpenCompare(rfq)} testID={`rfq-card-bubble-${rfq.id}`}>
        <View style={styles.head}>
          <View style={styles.icon}><Feather name="send" size={18} color={FG} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>REQUEST FOR QUOTATION</Text>
            <Text style={styles.title} numberOfLines={2}>{rfq.garmentType}</Text>
            <Text style={styles.meta}>{rfq.quantity.toLocaleString('en-US')} units · sent to {rfq.manufacturersCount}</Text>
          </View>
        </View>
        <View style={styles.bodyPad}>
          <View style={styles.statusRow}>
            <View style={[styles.pill, { borderColor: rfq.quotesReceivedCount > 0 ? SUCCESS : SUBTLE }]}>
              <Text style={[styles.pillText, { color: rfq.quotesReceivedCount > 0 ? SUCCESS : SUBTLE }]}>
                {rfq.quotesReceivedCount} of {rfq.manufacturersCount} quoted
              </Text>
            </View>
            {rfq.bestPriceCents != null && <Text style={styles.price}>from {formatCents(rfq.bestPriceCents)}</Text>}
          </View>
          <TouchableOpacity style={[styles.primary, { backgroundColor: theme.accent }]} onPress={() => onOpenCompare(rfq)}>
            <Feather name="bar-chart-2" size={14} color={theme.onAccent} />
            <Text style={[styles.primaryText, { color: theme.onAccent }]}>Compare quotes</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
      <Text style={[styles.time, fromMe && { textAlign: 'right' }]}>{time}</Text>
    </View>
  );
}

// ─── Send sample request card ───────────────────────────────────────────────────

export interface SampleRequestSnapshot {
  id: string;
  productName: string;
  manufacturerName: string;
  costCents?: number | null;
}

export function SampleRequestCardBubble({
  request, fromMe, time, onOpen,
}: { request: SampleRequestSnapshot; fromMe: boolean; time: string; onOpen: (request: SampleRequestSnapshot) => void }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.row, fromMe ? styles.right : styles.left]}>
      <TouchableOpacity activeOpacity={0.85} style={styles.card} onPress={() => onOpen(request)} testID={`sample-request-card-bubble-${request.id}`}>
        <View style={styles.head}>
          <View style={styles.icon}><Feather name="scissors" size={18} color={FG} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>SAMPLE REQUEST</Text>
            <Text style={styles.title} numberOfLines={2}>{request.productName}</Text>
            <Text style={styles.meta}>{request.manufacturerName}</Text>
          </View>
          {request.costCents != null && <Text style={styles.price}>{formatCents(request.costCents)}</Text>}
        </View>
        <View style={styles.bodyPad}>
          <TouchableOpacity style={[styles.primary, { backgroundColor: theme.accent }]} onPress={() => onOpen(request)}>
            <Feather name="eye" size={14} color={theme.onAccent} />
            <Text style={[styles.primaryText, { color: theme.onAccent }]}>View sample request</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
      <Text style={[styles.time, fromMe && { textAlign: 'right' }]}>{time}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: SP.md, marginVertical: 6 },
  right: { alignItems: 'flex-end' },
  left: { alignItems: 'flex-start' },
  card: { width: '88%', maxWidth: 340, backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  head: { flexDirection: 'row', gap: SP.sm + 2, padding: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER, alignItems: 'flex-start' },
  icon: { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: 10, fontFamily: FONT.semibold, color: SUBTLE, letterSpacing: 1 },
  title: { fontSize: FS.base, fontFamily: FONT.bold, color: FG, marginTop: 1 },
  meta: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },
  price: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  bodyPad: { padding: SP.md, gap: SP.sm },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pill: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 14, height: 40, borderRadius: RADIUS.md },
  primaryText: { fontSize: FS.sm, fontFamily: FONT.bold },
  time: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 3, paddingHorizontal: 2 },
});
