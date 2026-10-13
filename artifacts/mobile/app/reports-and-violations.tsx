/**
 * Reports and violations (features 68 + 72), copied from Instagram's Help →
 * Reports and violations: "Your reports" lists what you reported and what
 * happened; "Violations" lists every strike on your account, active or
 * expired. Opened from Account status.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SegmentedControl, ThemedRefreshControl } from '@/components/ui';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { apiErrorMessage } from '@/lib/safety';
import { shortDate, type MyReport, type Strike } from '@/lib/accountStatus';
import { FONT, FS, SP } from '@/lib/theme';

type Tab = 'reports' | 'violations';

export default function ReportsAndViolationsScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const api = useApi();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'violations' ? 'violations' : 'reports');
  const [reports, setReports] = useState<MyReport[] | null>(null);
  const [strikes, setStrikes] = useState<Strike[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [r, st] = await Promise.allSettled([api.accountStatus.myReports(), api.accountStatus.get()]);
    if (r.status === 'fulfilled') setReports(r.value.reports);
    if (st.status === 'fulfilled') setStrikes(st.value.strikes);
    const failed = r.status === 'rejected' ? r.reason : st.status === 'rejected' ? st.reason : null;
    setError(failed ? apiErrorMessage(failed, 'We couldn’t load this.') : null);
  }, [api]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const loading = tab === 'reports' ? reports === null : strikes === null;
  const tabs = (
    <SegmentedControl
      options={[{ id: 'reports', label: 'Your reports' }, { id: 'violations', label: 'Violations' }]}
      selectedId={tab}
      onChange={(id) => setTab(id as Tab)}
      testID="reports-violations-tabs"
      style={s.tabs}
    />
  );

  return (
    <View style={s.root}>
      <ScreenHeader title="Reports and violations" />
      {tabs}
      {loading && error ? (
        <ErrorState message={error} onRetry={() => { void load(); }} style={{ flex: 1 }} />
      ) : loading ? (
        <View style={{ padding: SP.md, gap: SP.md }}>
          {[0, 1, 2].map((i) => <SkeletonBlock key={i} width="100%" height={44} />)}
        </View>
      ) : tab === 'reports' ? (
        <FlatList
          data={reports ?? []}
          keyExtractor={(item) => item.id}
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + SP.xl }]}
          ListEmptyComponent={<Text style={s.empty}>When you report something, you’ll see what happened here.</Text>}
          renderItem={({ item }) => (
            <View style={s.row} testID="my-report-row">
              <View style={s.flex}>
                <Text style={s.title} numberOfLines={2}>
                  You reported {item.targetLabel ? `“${item.targetLabel}”` : `a ${item.targetType.toLowerCase()}`}
                </Text>
                <Text style={s.meta}>{item.reasonLabel}, {shortDate(item.createdAt)}</Text>
              </View>
              <Text style={[s.status, item.status === 'removed' && s.statusStrong]}>{item.statusLabel}</Text>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={strikes ?? []}
          keyExtractor={(item) => item.id}
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + SP.xl }]}
          ListEmptyComponent={<Text style={s.empty}>No violations on your account.</Text>}
          renderItem={({ item }) => (
            <View style={s.row} testID="violation-row">
              <View style={s.flex}>
                <Text style={s.title} numberOfLines={2}>{item.title}</Text>
                <Text style={s.meta}>{item.reasonLabel}, {shortDate(item.issuedAt)}</Text>
              </View>
              <Text style={[s.status, item.active && s.statusStrong]}>
                {item.active ? `Until ${shortDate(item.expiresAt)}` : 'Expired'}
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    tabs: { marginHorizontal: SP.md, marginTop: SP.sm, marginBottom: SP.sm },
    list: { paddingHorizontal: SP.md },
    flex: { flex: 1, minWidth: 0 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: SP.md, minHeight: 60, paddingVertical: SP.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
    },
    title: { fontFamily: FONT.medium, fontSize: FS.base, color: theme.text },
    meta: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, marginTop: 2 },
    status: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, textAlign: 'right', maxWidth: 140 },
    statusStrong: { fontFamily: FONT.semibold, color: theme.text },
    empty: { fontFamily: FONT.regular, fontSize: FS.base, color: theme.muted, paddingTop: SP.lg },
  });
}
