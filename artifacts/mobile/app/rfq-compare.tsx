/**
 * RFQ Compare — Fiverr-package-style side-by-side view of every manufacturer's
 * quote against one RFQ (GET /api/seller-hub/rfqs/:id). One column per
 * manufacturer; Accept/Decline reuse the existing 1:1 quote calls, and
 * Counteroffer hands off to quote-detail.tsx's existing counteroffer form
 * since RFQ-originated quotes live in the same seller_quote_requests table.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { Header } from '@/components/layout';
import { EmptyState, StatusBadge } from '@/components/BrandthreadUI';
import { formatCents } from '@/lib/money';
import { acceptQuote, declineQuote } from '@/services/manufacturerService';
import { getRfq, type RfqDetail, type RfqQuote, type RfqQuoteStatus } from '@/services/manufacturerRfq';

const COL_WIDTH = 200;
const LABEL_WIDTH = 120;

function statusVariant(status: RfqQuoteStatus): 'success' | 'info' | 'warning' | 'neutral' | 'error' | 'purple' {
  switch (status) {
    case 'submitted':
    case 'viewed':          return 'info';
    case 'questions_asked':  return 'warning';
    case 'quoted':           return 'success';
    case 'counteroffer_sent': return 'purple';
    case 'accepted':         return 'success';
    case 'declined':
    case 'cancelled':        return 'error';
    default:                 return 'neutral';
  }
}

export default function RfqCompareScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeS(theme), [theme]);
  const router = useRouter();
  const { rfqId } = useLocalSearchParams<{ rfqId: string }>();

  const [rfq, setRfq] = useState<RfqDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!rfqId) { setLoading(false); return; }
    try {
      setRfq((await getRfq(rfqId)) ?? null);
    } catch {
      setRfq(null);
    } finally {
      setLoading(false);
    }
  }, [rfqId]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const quotedQuotes = rfq?.quotes.filter((q) => q.quotedPriceCents != null) ?? [];
  const pendingQuotes = rfq?.quotes.filter((q) => q.quotedPriceCents == null) ?? [];

  async function handleAccept(quote: RfqQuote) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Accept quote', `Accept ${quote.manufacturerName}'s quote of ${formatCents(quote.quotedPriceCents ?? 0)}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Accept', onPress: async () => {
          setBusyId(quote.id);
          try { await acceptQuote(quote.id); await load(); } catch { Alert.alert('Could not accept', 'Please try again.'); } finally { setBusyId(null); }
        },
      },
    ]);
  }

  function handleDecline(quote: RfqQuote) {
    Alert.alert('Decline quote', `Decline ${quote.manufacturerName}'s quote?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline', style: 'destructive', onPress: async () => {
          setBusyId(quote.id);
          try { await declineQuote(quote.id); await load(); } catch { Alert.alert('Could not decline', 'Please try again.'); } finally { setBusyId(null); }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={s.root}>
        <Header title="Compare Quotes" onBack={() => router.back()} />
        <View style={s.center}><ActivityIndicator color={theme.accent} /></View>
      </View>
    );
  }

  if (!rfq) {
    return (
      <View style={s.root}>
        <Header title="Compare Quotes" onBack={() => router.back()} />
        <EmptyState icon="alert-circle" title="RFQ unavailable" description="This request could not be loaded." />
      </View>
    );
  }

  const bestPrice = quotedQuotes.length ? Math.min(...quotedQuotes.map((q) => q.quotedPriceCents ?? Infinity)) : null;

  return (
    <View style={s.root}>
      <Header title="Compare Quotes" onBack={() => router.back()} />
      <View style={s.summary}>
        <Text style={s.summaryTitle} numberOfLines={1}>{rfq.garmentType}</Text>
        <Text style={s.summaryMeta}>{rfq.quantity.toLocaleString('en-US')} units · sent to {rfq.manufacturersCount} manufacturers · {rfq.quotesReceivedCount} quoted</Text>
      </View>

      {quotedQuotes.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="No quotes yet"
          description={`Waiting on ${pendingQuotes.length} ${pendingQuotes.length === 1 ? 'manufacturer' : 'manufacturers'} to respond.`}
        />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
          <View style={s.labelCol}>
            <View style={s.labelHeader} />
            {['Price / unit', 'Quantity', 'Turnaround', 'Valid until', 'Terms', 'Status'].map((label) => (
              <View key={label} style={s.labelCell}><Text style={s.labelText}>{label}</Text></View>
            ))}
          </View>

          {quotedQuotes.map((quote) => {
            const isBest = bestPrice !== null && quote.quotedPriceCents === bestPrice && quotedQuotes.length > 1;
            const isTerminal = quote.status === 'accepted' || quote.status === 'declined';
            return (
              <View key={quote.id} style={[s.col, isBest && s.colBest]}>
                <View style={s.colHeader}>
                  <Text style={s.mfgName} numberOfLines={2}>{quote.manufacturerName}</Text>
                  {quote.manufacturerIsVerified && (
                    <View style={s.verifiedRow}>
                      <Feather name="check-circle" size={11} color={theme.secondary} />
                      <Text style={s.verifiedText}>Verified</Text>
                    </View>
                  )}
                  {quote.manufacturerCountry ? <Text style={s.country}>{quote.manufacturerCountry}</Text> : null}
                  {isBest && (
                    <View style={s.bestBadge}><Feather name="award" size={11} color={theme.onAccent} /><Text style={s.bestBadgeText}>Best price</Text></View>
                  )}
                </View>

                <View style={[s.cell, isBest && s.cellBest]}><Text style={[s.cellText, isBest && s.cellTextBest]}>{formatCents(quote.quotedPriceCents ?? 0)}</Text></View>
                <View style={s.cell}><Text style={s.cellText}>{quote.quantity ? `${quote.quantity.toLocaleString('en-US')} units` : '—'}</Text></View>
                <View style={s.cell}><Text style={s.cellText}>{quote.quotedTurnaround ?? '—'}</Text></View>
                <View style={s.cell}><Text style={s.cellText}>{quote.quoteValidUntil ? new Date(quote.quoteValidUntil).toLocaleDateString() : '—'}</Text></View>
                <View style={s.cell}><Text style={s.cellText} numberOfLines={2}>{quote.notes || '—'}</Text></View>
                <View style={s.cell}><StatusBadge label={quote.status.replace(/_/g, ' ')} variant={statusVariant(quote.status)} small /></View>

                <View style={s.actions}>
                  <TouchableOpacity
                    style={[s.acceptBtn, { backgroundColor: theme.accent }, (isTerminal || busyId === quote.id) && s.btnDisabled]}
                    disabled={isTerminal || busyId === quote.id}
                    onPress={() => handleAccept(quote)}
                    testID={`rfq-accept-${quote.id}`}
                  >
                    <Text style={[s.acceptBtnText, { color: theme.onAccent }]}>{quote.status === 'accepted' ? 'Accepted' : 'Accept'}</Text>
                  </TouchableOpacity>
                  <View style={s.actionRow2}>
                    <TouchableOpacity
                      style={[s.secondaryBtn, (isTerminal || busyId === quote.id) && s.btnDisabled]}
                      disabled={isTerminal || busyId === quote.id}
                      onPress={() => router.push(`/quote-detail?quoteId=${quote.id}` as never)}
                    >
                      <Text style={s.secondaryBtnText}>Counter</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.secondaryBtn, (isTerminal || busyId === quote.id) && s.btnDisabled]}
                      disabled={isTerminal || busyId === quote.id}
                      onPress={() => handleDecline(quote)}
                    >
                      <Text style={[s.secondaryBtnText, { color: theme.error }]}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {pendingQuotes.length > 0 && quotedQuotes.length > 0 && (
        <View style={s.pendingBanner}>
          <Feather name="clock" size={ICON.sm} color={theme.warning} />
          <Text style={s.pendingText}>{pendingQuotes.length} more {pendingQuotes.length === 1 ? 'manufacturer hasn’t' : 'manufacturers haven’t'} responded yet.</Text>
        </View>
      )}
    </View>
  );
}

const makeS = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  summary: { paddingHorizontal: SP.md, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: theme.border },
  summaryTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: theme.text },
  summaryMeta: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  scrollContent: { paddingHorizontal: SP.md, paddingVertical: SP.md, paddingBottom: 40 },
  labelCol: { width: LABEL_WIDTH, marginRight: 1 },
  labelHeader: { height: 92 },
  labelCell: { height: 44, justifyContent: 'center', borderTopWidth: 1, borderTopColor: theme.border, paddingRight: SP.sm },
  labelText: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted },
  col: { width: COL_WIDTH, marginLeft: SP.sm, backgroundColor: theme.cardGlass, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  colBest: { borderColor: theme.accent, borderWidth: 2 },
  colHeader: { height: 92, padding: SP.sm, gap: 3, justifyContent: 'center', backgroundColor: theme.cardElevated },
  mfgName: { fontSize: FS.sm, fontFamily: FONT.bold, color: theme.text },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  verifiedText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.secondary },
  country: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
  bestBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: theme.accent, borderRadius: RADIUS.pill, paddingHorizontal: 6, paddingVertical: 1, alignSelf: 'flex-start', marginTop: 2 },
  bestBadgeText: { fontSize: 10, fontFamily: FONT.bold, color: theme.onAccent },
  cell: { height: 44, justifyContent: 'center', paddingHorizontal: SP.sm, borderTopWidth: 1, borderTopColor: theme.border },
  cellBest: { backgroundColor: theme.accentDim },
  cellText: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text },
  cellTextBest: { color: theme.accentLight, fontFamily: FONT.bold },
  actions: { padding: SP.sm, gap: SP.xs, borderTopWidth: 1, borderTopColor: theme.border },
  acceptBtn: { height: 36, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  acceptBtnText: { fontSize: FS.sm, fontFamily: FONT.bold },
  actionRow2: { flexDirection: 'row', gap: SP.xs },
  secondaryBtn: { flex: 1, height: 32, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.text },
  btnDisabled: { opacity: 0.5 },
  pendingBanner: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, padding: SP.md, borderTopWidth: 1, borderTopColor: theme.border },
  pendingText: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, flex: 1 },
});
