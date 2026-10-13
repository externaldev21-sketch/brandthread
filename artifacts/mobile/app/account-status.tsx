/**
 * Account status (feature 72), copied from Instagram's Help → Account Status:
 * one line about your standing up top, your strikes out of 3, then the
 * Community Guidelines and your reports and violations.
 * Opened from Accounts Center (buyer) and Security (seller).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListRow } from '@/components/ui';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { apiErrorMessage } from '@/lib/safety';
import { shortDate, standingDetail, type AccountStatus } from '@/lib/accountStatus';
import { FONT, FS, SP } from '@/lib/theme';

export default function AccountStatusScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.accountStatus.get());
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t load your account status.'));
    }
  }, [api]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const good = status?.standing === 'good';
  const active = status?.strikes.filter((x) => x.active) ?? [];

  return (
    <View style={s.root}>
      <ScreenHeader title="Account status" />
      {!status && error ? (
        <ErrorState message={error} onRetry={() => { void load(); }} style={{ flex: 1 }} />
      ) : !status ? (
        <View style={{ padding: SP.md, gap: SP.md }}>
          <SkeletonBlock width="70%" height={22} />
          <SkeletonBlock width="100%" height={13} />
          <SkeletonBlock width="100%" height={44} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + SP.xl }]}>
          <View style={s.hero} testID="account-status-hero">
            <Feather name={good ? 'check-circle' : 'alert-circle'} size={28} color={theme.text} />
            <View style={s.flex}>
              <Text style={s.headline}>{status.headline}</Text>
              <Text style={s.detail}>{standingDetail(status)}</Text>
            </View>
          </View>

          <Text style={s.section}>Strikes</Text>
          <View style={s.meter} accessibilityLabel={`${status.activeStrikes} of ${status.strikeLimit} strikes`}>
            {Array.from({ length: status.strikeLimit }, (_, i) => (
              <View key={i} style={[s.meterCell, i < status.activeStrikes && s.meterOn]} />
            ))}
          </View>
          <Text style={s.meterLabel}>{status.activeStrikes} of {status.strikeLimit} active</Text>
          {active.length === 0 ? (
            <Text style={s.empty}>No active strikes.</Text>
          ) : active.map((strike) => (
            <View key={strike.id} style={s.strike}>
              <Text style={s.strikeTitle}>{strike.title}</Text>
              <Text style={s.strikeMeta}>{strike.reasonLabel}, {shortDate(strike.issuedAt)}. Expires {shortDate(strike.expiresAt)}.</Text>
            </View>
          ))}

          <View style={s.rows}>
            <ListRow
              icon="flag"
              title="Reports and violations"
              subtitle="What you reported and any rules you broke"
              chevron
              onPress={() => router.push('/reports-and-violations' as never)}
              testID="account-status-reports"
            />
            <ListRow
              icon="book-open"
              title="Community Guidelines"
              subtitle="What’s allowed on Brandthread"
              chevron
              onPress={() => router.push('/community-guidelines' as never)}
            />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    content: { paddingHorizontal: SP.md, paddingTop: SP.sm },
    flex: { flex: 1 },
    hero: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.md, paddingVertical: SP.md },
    headline: { fontFamily: FONT.semibold, fontSize: FS.lg, color: theme.text },
    detail: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, color: theme.muted, marginTop: 4 },
    section: { fontFamily: FONT.semibold, fontSize: FS.md, color: theme.text, marginTop: SP.md, marginBottom: SP.sm },
    meter: { flexDirection: 'row', gap: 6 },
    meterCell: { flex: 1, height: 6, borderRadius: 3, backgroundColor: theme.border },
    meterOn: { backgroundColor: theme.text },
    meterLabel: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, marginTop: SP.sm },
    empty: { fontFamily: FONT.regular, fontSize: FS.base, color: theme.muted, marginTop: SP.sm },
    strike: { paddingVertical: SP.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
    strikeTitle: { fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text },
    strikeMeta: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, marginTop: 2 },
    rows: { marginTop: SP.lg },
  });
}
