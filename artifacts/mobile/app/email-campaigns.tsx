/**
 * Seller email campaigns: Audience + Settings entry rows and the campaign list.
 * Route: /email-campaigns (pushed from Marketing).
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useApi, type EmailCampaign, type EmailMarketingStatus } from '@/lib/api';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/BrandthreadUI';
import { RetryRow } from '@/components/ui/RetryRow';
import { Hairline, Heading, Notice, SolidButton } from '@/components/email/EmailUI';
import {
  AUDIENCE_LABEL, DEMO_CAMPAIGNS, DEMO_STATUS, FRESH_STATUS, STATUS_LABEL, emailMode, formatWhen,
} from '@/lib/emailMarketing';
import { FONT, FS, ICON, SP } from '@/lib/theme';

function NavRow({ icon, title, sub, onPress }: { icon: keyof typeof Feather.glyphMap; title: string; sub?: string; onPress: () => void }) {
  const c = useColors();
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={st.navRow}>
      <Feather name={icon} size={ICON.md} color={c.foreground} />
      <View style={{ flex: 1 }}>
        <Text style={[st.navTitle, { color: c.foreground }]}>{title}</Text>
        {sub ? <Text style={[st.navSub, { color: c.mutedForeground }]}>{sub}</Text> : null}
      </View>
      <Feather name="chevron-right" size={ICON.sm} color={c.mutedForeground} />
    </PressableScale>
  );
}

export default function EmailCampaignsScreen() {
  const c = useColors();
  const router = useRouter();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const [campaigns, setCampaigns] = useState<EmailCampaign[] | null>(null);
  const [status, setStatus] = useState<EmailMarketingStatus | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    const mode = emailMode();
    if (mode !== 'live') {
      setCampaigns(mode === 'demo' ? DEMO_CAMPAIGNS : []);
      setStatus(mode === 'demo' ? DEMO_STATUS : FRESH_STATUS);
      setError(false);
      return;
    }
    Promise.all([api.emailMarketing.campaigns(), api.emailMarketing.status()])
      .then(([list, s]) => { setCampaigns(list.campaigns); setStatus(s); setError(false); })
      .catch(() => setError(true));
  }, [api]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = (cmp: EmailCampaign) => {
    if (cmp.status === 'draft') router.push(`/email-campaign-compose?id=${cmp.id}` as never);
    else router.push(`/email-campaign-results?id=${cmp.id}` as never);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="Email" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 140 }} showsVerticalScrollIndicator={false}>
        {status && !status.enabled && (
          <Notice text={status.message ?? 'Email sending isn\'t set up yet. Drafts are saved and nothing is sent.'} />
        )}
        <View style={{ marginBottom: 8 }}><SolidButton label="New campaign" onPress={() => router.push('/email-campaign-compose' as never)} /></View>
        <NavRow icon="users" title="Audience" sub="Subscribers from your store" onPress={() => router.push('/email-audience' as never)} />
        <Hairline />
        <NavRow icon="settings" title="Sender details" sub="Name, reply-to and mailing address" onPress={() => router.push('/email-settings' as never)} />
        <Hairline />

        <Heading>Campaigns</Heading>
        {error ? (
          <RetryRow label="Couldn't load campaigns" onRetry={load} />
        ) : campaigns === null ? (
          <ActivityIndicator color={c.foreground} style={{ marginTop: 24 }} />
        ) : campaigns.length === 0 ? (
          <Text style={[st.empty, { color: c.mutedForeground }]}>No campaigns yet.</Text>
        ) : (
          campaigns.map((cmp, i) => (
            <View key={cmp.id}>
              {i > 0 && <Hairline />}
              <PressableScale onPress={() => open(cmp)} accessibilityRole="button" accessibilityLabel={cmp.subject || 'Untitled campaign'} style={st.campRow}>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={[st.navTitle, { color: c.foreground }]}>{cmp.subject || 'Untitled campaign'}</Text>
                  <Text numberOfLines={1} style={[st.navSub, { color: c.mutedForeground }]}>
                    {STATUS_LABEL[cmp.status]} · {AUDIENCE_LABEL[cmp.audience]}
                    {cmp.status === 'sent' && cmp.sentAt ? ` · ${formatWhen(cmp.sentAt)}` : ''}
                    {cmp.status === 'scheduled' && cmp.scheduledAt ? ` · ${formatWhen(cmp.scheduledAt)}` : ''}
                  </Text>
                </View>
                <Feather name="chevron-right" size={ICON.sm} color={c.mutedForeground} />
              </PressableScale>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingVertical: 8 },
  campRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 8 },
  navTitle: { fontFamily: FONT.semibold, fontSize: FS.md },
  navSub: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2 },
  empty: { fontFamily: FONT.regular, fontSize: FS.md, marginTop: 8 },
});
