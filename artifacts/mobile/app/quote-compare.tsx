/**
 * Quote Compare Screen
 * Params: requestId (string)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { getQuotesForRequest, acceptQuote, getManufacturer } from '@/services/manufacturerService';
import { Quote, Manufacturer } from '@/services/manufacturerTypes';
import { BrandthreadHeader, BrandthreadCard, PrimaryButton, StatusBadge } from '@/components/BrandthreadUI';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { formatCents } from '@/lib/money';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(cents: number) { return formatCents(cents); }

function fmtDays(d: number) {
  return `${d} days`;
}

// ─── Row data ──────────────────────────────────────────────────────────────────

type RowKey =
  | 'unitPriceCents' | 'moq' | 'sampleCostCents' | 'setupCostCents'
  | 'packagingCostCents' | 'shippingEstimateCents' | 'totalEstimateCents'
  | 'leadTimeDays' | 'productionDays' | 'paymentTerms'
  | 'rating' | 'verified';

interface RowDef {
  key: RowKey;
  label: string;
  format: (q: Quote, mfg?: Manufacturer) => string;
  lowerIsBetter: boolean;
  numeric: boolean;
}

const ROWS: RowDef[] = [
  { key: 'unitPriceCents',   label: 'Unit Price',       format: (q) => fmt(q.unitPriceCents),     lowerIsBetter: true,  numeric: true },
  { key: 'moq',              label: 'MOQ',              format: (q) => `${q.moq} units`,           lowerIsBetter: true,  numeric: true },
  { key: 'sampleCostCents', label: 'Sample Cost', format: (q) => fmt(q.sampleCostCents), lowerIsBetter: true, numeric: true },
  { key: 'setupCostCents', label: 'Setup / Tooling', format: (q) => fmt(q.setupCostCents), lowerIsBetter: true, numeric: true },
  { key: 'packagingCostCents', label: 'Packaging', format: (q) => fmt(q.packagingCostCents), lowerIsBetter: true, numeric: true },
  { key: 'shippingEstimateCents', label: 'Shipping Est.', format: (q) => fmt(q.shippingEstimateCents), lowerIsBetter: true, numeric: true },
  { key: 'totalEstimateCents', label: 'Total Estimate', format: (q) => fmt(q.totalEstimateCents), lowerIsBetter: true, numeric: true },
  { key: 'leadTimeDays',     label: 'Lead Time',        format: (q) => fmtDays(q.leadTimeDays),    lowerIsBetter: true,  numeric: true },
  { key: 'productionDays',   label: 'Production Days',  format: (q) => fmtDays(q.productionDays), lowerIsBetter: true,  numeric: true },
  { key: 'paymentTerms',     label: 'Payment Terms',    format: (q) => q.paymentTerms,             lowerIsBetter: false, numeric: false },
  {
    key: 'rating',
    label: 'Rating',
    format: (q, mfg) => mfg ? `★ ${mfg.rating.toFixed(1)} (${mfg.reviewCount})` : '—',
    lowerIsBetter: false,
    numeric: true,
  },
  {
    key: 'verified',
    label: 'Verified',
    format: (q, mfg) => mfg?.isVerified ? '✓ Verified' : '✗ Unverified',
    lowerIsBetter: false,
    numeric: false,
  },
];

function getNumericValue(row: RowDef, q: Quote, mfg?: Manufacturer): number {
  switch (row.key) {
    case 'unitPriceCents':   return q.unitPriceCents;
    case 'moq':              return q.moq;
    case 'sampleCostCents': return q.sampleCostCents;
    case 'setupCostCents': return q.setupCostCents;
    case 'packagingCostCents': return q.packagingCostCents;
    case 'shippingEstimateCents': return q.shippingEstimateCents;
    case 'totalEstimateCents': return q.totalEstimateCents;
    case 'leadTimeDays':     return q.leadTimeDays;
    case 'productionDays':   return q.productionDays;
    case 'rating':           return mfg?.rating ?? 0;
    default:                 return 0;
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function QuoteCompareScreen() {
  const colors = useColors();
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [manufacturers, setManufacturers] = useState<Map<string, Manufacturer>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!requestId) { setLoading(false); return; }
    setError('');
    try {
      const qs = await getQuotesForRequest(requestId);
      setQuotes(qs);
      const profiles = await Promise.all([...new Set(qs.map(q => q.manufacturerId))].map(id => getManufacturer(id)));
      const mfgMap = new Map<string, Manufacturer>();
      profiles.forEach(mfg => {
        if (mfg) mfgMap.set(mfg.id, mfg);
      });
      setManufacturers(mfgMap);
    } catch (loadError) {
      setQuotes([]);
      setManufacturers(new Map());
      setError(loadError instanceof Error ? loadError.message : 'Could not load quotes.');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => { load(); }, [load]);

  async function handleAccept(quoteId: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Accept Quote', 'Accept this quote and proceed to production?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Accept', onPress: async () => {
          await acceptQuote(quoteId);
          router.back();
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent', paddingTop: insets.top }}>
      <BrandthreadHeader title="Compare Quotes" onBack={() => router.back()} />

      {!!error && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl }}>
          <Feather name="alert-circle" size={48} color={ORANGE} style={{ marginBottom: SP.md }} />
          <Text style={{ fontSize: FS.lg, fontFamily: FONT.bold, color: FG, marginBottom: 8 }}>Could not load quotes</Text>
          <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginBottom: SP.md }}>{error}</Text>
          <PrimaryButton label="Try again" onPress={load} />
        </View>
      )}

      {!error && quotes.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl }}>
          <Feather name="inbox" size={48} color={SUBTLE} style={{ marginBottom: SP.md }} />
          <Text style={{ fontSize: FS.lg, fontFamily: FONT.bold, color: FG, marginBottom: 8 }}>No Quotes Yet</Text>
          <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center' }}>
            No quotes have been received for this request yet.
          </Text>
        </View>
      )}

      {quotes.length === 1 && (
        <View style={{ paddingHorizontal: SP.md, paddingBottom: SP.md }}>
          <BrandthreadCard style={{ backgroundColor: ORANGE_DIM, borderColor: ORANGE + '40' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm }}>
              <Feather name="info" size={ICON.sm} color={ORANGE} />
              <Text style={{ fontSize: FS.sm, fontFamily: FONT.medium, color: ORANGE }}>
                Only one quote received so far. More may arrive shortly.
              </Text>
            </View>
          </BrandthreadCard>
        </View>
      )}

      {quotes.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: 40 }}
        >
          {/* Row labels column */}
          <View style={s.labelCol}>
            <View style={s.labelHeader}>
              <Text style={s.labelHeaderText}>Compare</Text>
            </View>
            {ROWS.map(row => (
              <View key={row.key} style={s.labelCell}>
                <Text style={s.labelText}>{row.label}</Text>
              </View>
            ))}
            <View style={s.labelFooter} />
          </View>

          {/* Quote columns */}
          {quotes.map((q, colIdx) => {
            const mfg = manufacturers.get(q.manufacturerId);

            // Precompute best values for highlighting
            const bestValues: Partial<Record<RowKey, number>> = {};
            ROWS.filter(r => r.numeric).forEach(row => {
              const vals = quotes.map(qq => getNumericValue(row, qq, manufacturers.get(qq.manufacturerId)));
              bestValues[row.key] = row.lowerIsBetter
                ? Math.min(...vals)
                : Math.max(...vals);
            });

            return (
              <View key={q.id} style={s.quoteCol}>
                {/* Column header */}
                <View style={[s.colHeader, colIdx === 0 && s.colHeaderFirst]}>
                  <Text style={s.mfgName} numberOfLines={2}>{mfg?.name ?? 'Manufacturer'}</Text>
                  {mfg?.isVerified && (
                    <View style={s.verifiedBadge}>
                      <Feather name="check-circle" size={11} color={SUCCESS} />
                      <Text style={s.verifiedText}>Verified</Text>
                    </View>
                  )}
                </View>

                {/* Value rows */}
                {ROWS.map(row => {
                  const displayVal = row.format(q, mfg);
                  const numVal = row.numeric ? getNumericValue(row, q, mfg) : null;
                  const isBest = numVal !== null && bestValues[row.key] === numVal && quotes.length > 1;
                  const isVerifiedRow = row.key === 'verified';
                  const isVerified = mfg?.isVerified;

                  return (
                    <View
                      key={row.key}
                      style={[
                        s.valueCell,
                        isBest && s.bestCell,
                        isVerifiedRow && isVerified && s.bestCell,
                      ]}
                    >
                      <Text style={[
                        s.valueText,
                        isBest && { color: SUCCESS, fontFamily: FONT.bold },
                        isVerifiedRow && isVerified && { color: SUCCESS, fontFamily: FONT.bold },
                        isVerifiedRow && !isVerified && { color: MUTED },
                      ]}>
                        {displayVal}
                      </Text>
                    </View>
                  );
                })}

                {/* Accept button */}
                <View style={s.acceptWrap}>
                  <PrimaryButton
                    label="Accept"
                    onPress={() => handleAccept(q.id)}
                    small
                    disabled={q.status === 'accepted' || q.status === 'declined'}
                  />
                  {q.status === 'accepted' && (
                    <Text style={{ fontSize: FS.xs, fontFamily: FONT.medium, color: SUCCESS, textAlign: 'center', marginTop: 4 }}>
                      ✓ Accepted
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CELL_HEIGHT = 44;
const LABEL_WIDTH = 130;
const COL_WIDTH = 160;

const s = StyleSheet.create({
  labelCol: {
    width: LABEL_WIDTH,
    marginRight: 1,
  },
  labelHeader: {
    height: 72,
    justifyContent: 'flex-end',
    paddingBottom: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  labelHeaderText: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: SUBTLE,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  labelCell: {
    height: CELL_HEIGHT,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingRight: SP.sm,
  },
  labelText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  labelFooter: {
    height: 64,
  },
  quoteCol: {
    width: COL_WIDTH,
    marginLeft: SP.sm,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  colHeader: {
    height: 72,
    justifyContent: 'flex-end',
    paddingHorizontal: SP.sm,
    paddingBottom: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: CARD_ELEVATED,
    gap: 3,
  },
  colHeaderFirst: {
    borderColor: BORDER_ACTIVE,
  },
  mfgName: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: FG,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  verifiedText: {
    fontSize: 10,
    fontFamily: FONT.semibold,
    color: SUCCESS,
  },
  valueCell: {
    height: CELL_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  bestCell: {
    backgroundColor: SUCCESS_DIM,
  },
  valueText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: FG,
  },
  acceptWrap: {
    padding: SP.sm,
  },
});

