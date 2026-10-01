/** Per-campaign results, limited to what the email provider actually reports. Route: /email-campaign-results?id= */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useApi, type EmailCampaign } from '@/lib/api';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RetryRow } from '@/components/ui/RetryRow';
import { Hairline, Heading, SolidButton } from '@/components/email/EmailUI';
import { AUDIENCE_LABEL, DEMO_CAMPAIGNS, STATUS_LABEL, emailMode, formatWhen, pct } from '@/lib/emailMarketing';
import { FONT, FS } from '@/lib/theme';

export default function EmailCampaignResultsScreen() {
  const c = useColors();
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [camp, setCamp] = useState<EmailCampaign | null>(null);
  const [error, setError] = useState(false);
  const mode = emailMode();

  const load = useCallback(() => {
    if (mode !== 'live') { setCamp(mode === 'demo' ? DEMO_CAMPAIGNS.find((x) => x.id === id) ?? null : null); return; }
    api.emailMarketing.campaign(String(id)).then((r) => { setCamp(r); setError(false); }).catch(() => setError(true));
  }, [api, id, mode]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const unschedule = async () => {
    try { await api.emailMarketing.unschedule(String(id)); router.replace(`/email-campaign-compose?id=${id}` as never); }
    catch { Alert.alert('Not changed', "Couldn't cancel the schedule."); }
  };

  const s = camp?.stats;
  const tracking = !!camp?.tracking;
  const Stat = ({ label, value, sub }: { label: string; value: string | number; sub?: string }) => (
    <View style={{ flex: 1, minWidth: '45%', marginBottom: 20 }}>
      <Text style={[st.num, { color: c.foreground }]}>{value}</Text>
      <Text style={[st.label, { color: c.mutedForeground }]}>{label}{sub ? ` · ${sub}` : ''}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="Results" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 140 }} showsVerticalScrollIndicator={false}>
        {error ? <RetryRow label="Couldn't load results" onRetry={load} /> : !camp ? (
          <ActivityIndicator color={c.foreground} style={{ marginTop: 32 }} />
        ) : (
          <>
            <Text style={[st.subject, { color: c.foreground }]}>{camp.subject}</Text>
            <Text style={[st.label, { color: c.mutedForeground }]}>
              {STATUS_LABEL[camp.status]} · {AUDIENCE_LABEL[camp.audience]}
              {camp.sentAt ? ` · ${formatWhen(camp.sentAt)}` : camp.scheduledAt ? ` · ${new Date(camp.scheduledAt).toLocaleString()}` : ''}
            </Text>
            <Heading>Delivery</Heading>
            <View style={st.grid}>
              <Stat label="Recipients" value={camp.recipientCount} />
              <Stat label="Sent" value={s?.sent ?? 0} />
              <Stat label="Failed" value={s?.failed ?? 0} />
              <Stat label="Skipped" value={s?.skipped ?? 0} />
              {(s?.queued ?? 0) > 0 && <Stat label="Waiting to send" value={s?.queued ?? 0} />}
            </View>
            <Hairline />
            <Heading>Engagement</Heading>
            {tracking ? (
              <View style={st.grid}>
                <Stat label="Delivered" value={s?.delivered ?? 0} sub={pct(s?.delivered ?? 0, s?.sent ?? 0)} />
                <Stat label="Opened" value={s?.opened ?? 0} sub={pct(s?.opened ?? 0, s?.sent ?? 0)} />
                <Stat label="Clicked" value={s?.clicked ?? 0} sub={pct(s?.clicked ?? 0, s?.sent ?? 0)} />
                <Stat label="Bounced" value={s?.bounced ?? 0} />
              </View>
            ) : (
              <Text style={[st.label, { color: c.mutedForeground, lineHeight: 20 }]}>
                Delivery events aren't connected, so opens and clicks aren't reported.
              </Text>
            )}
            {camp.status === 'scheduled' && mode === 'live' && (
              <View style={{ marginTop: 24 }}><SolidButton label="Cancel schedule" outline onPress={unschedule} /></View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  subject: { fontFamily: FONT.bold, fontSize: FS.xl, marginTop: 8, marginBottom: 4 },
  label: { fontFamily: FONT.regular, fontSize: FS.sm },
  num: { fontFamily: FONT.bold, fontSize: 28 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 0, marginTop: 4 },
});
