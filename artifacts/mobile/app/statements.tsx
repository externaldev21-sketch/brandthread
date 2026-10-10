import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useAppTheme, AppThemePreset } from '@/contexts/AppThemeContext';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { LoadingSkeleton } from '@/components/BrandthreadUI';
import { EmptyState } from '@/components/layout';
import { useApi } from '@/lib/api';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { TABULAR_NUMS } from '@/constants/typography';
import {
  demoStatementDetail, demoStatementList, formatSignedCents, isStatementMonth,
  statementFileName, STATEMENT_MIME,
  type StatementDetail, type StatementFormat, type StatementList,
} from '@/lib/statements';

function bytesToBlobDownload(bytes: ArrayBuffer, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function StatementsScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const tabBar = useTabBarMetrics(2);
  const router = useRouter();
  const params = useLocalSearchParams<{ month?: string }>();
  const month = isStatementMonth(params.month) ? params.month : null;
  const api = useApi();
  const { isLoaded: authLoaded, isSignedIn, userId } = useAuth();
  const isPreviewMode = isSellerDevPreview();
  // Signed-out ?bt_preview=seller has no token: never call the API. Demo data only with &demo=1.
  const isSignedOutPreview = (isPreviewMode && !userId) || (isPreviewMode && (!authLoaded || !isSignedIn));
  const useDemo = isSignedOutPreview && isPreviewDemoMode();

  const [list, setList] = useState<StatementList | null>(null);
  const [detail, setDetail] = useState<StatementDetail | null>(null);
  const [loading, setLoading] = useState(!isSignedOutPreview || useDemo);
  const [error, setError] = useState<'load' | 'not_connected' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<StatementFormat | null>(null);

  const load = useCallback(async () => {
    setError(null);
    if (isSignedOutPreview) {
      if (useDemo) {
        setList(demoStatementList());
        setDetail(month ? demoStatementDetail(month) : null);
      } else {
        setList({ connected: false, months: [] });
        setDetail(null);
      }
      setLoading(false);
      return;
    }
    try {
      if (month) {
        setDetail(await api.statements.get(month));
      } else {
        setList(await api.statements.list(12));
      }
    } catch (err: any) {
      setError(err?.status === 409 ? 'not_connected' : 'load');
    } finally {
      setLoading(false);
    }
  }, [api, isSignedOutPreview, useDemo, month]);

  useEffect(() => { setLoading(true); setDetail(null); void load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function download(format: StatementFormat) {
    if (!month || busy) return;
    if (isSignedOutPreview) {
      Alert.alert('Sign in to download', 'Statements are available once you are signed in.');
      return;
    }
    setBusy(format);
    try {
      const bytes = await api.statements.download(month, format);
      const name = statementFileName(month, format);
      if (Platform.OS === 'web') {
        bytesToBlobDownload(bytes, name, STATEMENT_MIME[format]);
      } else {
        const file = new File(Paths.cache, name);
        if (file.exists) file.delete();
        file.create();
        file.write(new Uint8Array(bytes));
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, {
            mimeType: STATEMENT_MIME[format],
            UTI: format === 'pdf' ? 'com.adobe.pdf' : 'public.comma-separated-values-text',
            dialogTitle: `Statement ${month}`,
          });
        } else {
          Alert.alert('Saved', `${name} was saved to the app cache.`);
        }
      }
    } catch {
      Alert.alert('Download failed', 'Could not download this statement. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  const bottomPad = tabBar.occupiedHeight + SP.md;
  const refresh = isSignedOutPreview ? undefined : (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.muted} />
  );

  /* ─── Month detail ─── */
  if (month) {
    const t = detail?.totals;
    const rows: { label: string; cents: number; strong?: boolean }[] = t ? [
      { label: 'Gross sales', cents: t.grossSalesCents },
      { label: 'Refunds', cents: t.refundsCents },
      { label: 'Disputes', cents: t.disputesCents },
      { label: 'Platform fees', cents: t.platformFeesCents },
      { label: 'Stripe fees', cents: t.stripeFeesCents },
      { label: 'Adjustments', cents: t.adjustmentsCents },
      { label: 'Net earnings', cents: t.netCents, strong: true },
      { label: 'Payouts', cents: t.payoutsCents },
    ] : [];
    return (
      <View style={styles.root}>
        <ScreenHeader title="Statement" />
        <ScrollView
          refreshControl={refresh}
          contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={{ gap: SP.sm }}>
              <LoadingSkeleton height={84} />
              <LoadingSkeleton height={240} />
            </View>
          ) : error ? (
            <ErrorState
              message={error === 'not_connected' ? 'Connect a payout account to view statements.' : "Couldn't load this statement."}
              onRetry={error === 'load' ? () => { setLoading(true); void load(); } : undefined}
            />
          ) : detail && t ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.heroLabel}>{detail.period.label}</Text>
                <Text style={[styles.heroAmount, TABULAR_NUMS]}>{formatSignedCents(t.netCents)}</Text>
                <Text style={styles.heroSub}>Net earnings · {detail.counts.lines} transactions</Text>
              </View>

              <View style={styles.card}>
                {rows.map((r, i) => (
                  <View key={r.label} style={[styles.sumRow, i > 0 && styles.sumRowBorder]}>
                    <Text style={[styles.sumLabel, r.strong && styles.strong]}>{r.label}</Text>
                    <Text style={[styles.sumValue, TABULAR_NUMS, r.strong && styles.strong]}>{formatSignedCents(r.cents)}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.actions}>
                <Button
                  label="Download PDF"
                  icon="file-text"
                  fullWidth
                  loading={busy === 'pdf'}
                  disabled={busy !== null}
                  onPress={() => void download('pdf')}
                  testID="statement-download-pdf"
                />
                <Button
                  label="Download CSV"
                  icon="download"
                  variant="secondary"
                  fullWidth
                  loading={busy === 'csv'}
                  disabled={busy !== null}
                  onPress={() => void download('csv')}
                  testID="statement-download-csv"
                />
              </View>
            </>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  /* ─── Month list ─── */
  const months = list?.months ?? [];
  return (
    <View style={styles.root}>
      <ScreenHeader title="Statements" />
      <ScrollView
        refreshControl={refresh}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }, months.length === 0 && !loading && styles.centered]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={{ gap: SP.sm }}>
            {[0, 1, 2, 3].map((i) => <LoadingSkeleton key={i} height={64} />)}
          </View>
        ) : error ? (
          <ErrorState message="Couldn't load your statements." onRetry={() => { setLoading(true); void load(); }} />
        ) : months.length === 0 ? (
          <View style={{ alignItems: 'center' }}>
            <EmptyState
              icon="file-text"
              title={list?.connected === false ? 'Connect Stripe to get statements' : 'No statements yet'}
              message=""
              compact
            />
            <Text style={styles.emptyMessage}>
              {list?.connected === false
                ? 'Add a bank account under Payouts to start receiving payments.'
                : 'A statement for each month appears here after your first sale.'}
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            {months.map((m, i) => (
              <TouchableOpacity
                key={m.month}
                testID={`statement-month-${m.month}`}
                activeOpacity={0.75}
                style={[styles.monthRow, i > 0 && styles.sumRowBorder]}
                onPress={() => router.push({ pathname: '/statements', params: { month: m.month } } as any)}
                accessibilityRole="button"
                accessibilityLabel={`${m.label} statement`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.monthLabel}>{m.label}</Text>
                  {m.transactionCount !== null && (
                    <Text style={styles.monthSub}>{m.transactionCount} transactions</Text>
                  )}
                </View>
                {m.netCents !== null && (
                  <Text style={[styles.monthNet, TABULAR_NUMS]}>{formatSignedCents(m.netCents)}</Text>
                )}
                <Icon name="chevron-right" size={18} color={theme.muted} style={{ marginLeft: SP.sm }} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => {
  const { text, muted, card, border } = theme;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    scroll: { paddingHorizontal: SP.md, paddingTop: SP.sm, flexGrow: 1 },
    centered: { justifyContent: 'center' },
    hero: { alignItems: 'center', paddingVertical: SP.sm, paddingBottom: SP.md },
    heroLabel: { color: muted, fontSize: FS.sm, fontFamily: FONT.medium },
    heroAmount: { color: text, fontSize: 40, fontFamily: FONT.bold, letterSpacing: -0.5, marginTop: 6 },
    heroSub: { color: muted, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 4 },
    card: { backgroundColor: card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: border, overflow: 'hidden' },
    sumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: 10 },
    sumRowBorder: { borderTopWidth: 1, borderTopColor: border },
    sumLabel: { color: muted, fontSize: FS.base, fontFamily: FONT.regular },
    sumValue: { color: text, fontSize: FS.base, fontFamily: FONT.medium },
    strong: { color: text, fontFamily: FONT.bold },
    actions: { gap: SP.sm, marginTop: SP.md },
    monthRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.md, minHeight: 64 },
    emptyMessage: { color: muted, fontSize: FS.sm, fontFamily: FONT.medium, textAlign: 'center', maxWidth: 280, marginTop: -4 },
    monthLabel: { color: text, fontSize: FS.base, fontFamily: FONT.semibold },
    monthSub: { color: muted, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
    monthNet: { color: text, fontSize: FS.base, fontFamily: FONT.semibold },
  });
};
