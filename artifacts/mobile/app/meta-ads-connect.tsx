/**
 * Brandthread — Connect Meta (Facebook & Instagram)
 * Route: /meta-ads-connect
 *
 * OAuth connect → pick Business → Ad Account → Facebook Page (with its
 * linked Instagram account, read-only) → POST connection/select.
 * Meta bills the seller's ad account directly — Brandthread never touches
 * ad spend here.
 *
 * Return deep link: brandthread://meta-ads-connect?oauth=success
 *                    brandthread://meta-ads-connect?oauth=error&message=…
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Feather } from '@expo/vector-icons';

import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/hooks/useApi';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  BrandthreadScreen, BrandthreadHeader, BrandthreadCard,
  PrimaryButton, TertiaryButton, EmptyState,
} from '@/components/BrandthreadUI';
import { buildMetaAdsReturnUrl } from '@/services/metaAdsService';
import type { MetaAdsConnection, MetaBusiness, MetaAdAccount, MetaPage } from '@/lib/api';

type Step = 'loading' | 'not_connected' | 'oauth_error' | 'picker' | 'connected';

export default function MetaAdsConnectScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ oauth?: string; message?: string }>();
  const colors = useColors();
  const { theme } = useAppTheme();
  const api = useApi();

  const [step, setStep] = useState<Step>('loading');
  const [connection, setConnection] = useState<MetaAdsConnection | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Picker state
  const [businesses, setBusinesses] = useState<MetaBusiness[] | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [adAccounts, setAdAccounts] = useState<MetaAdAccount[] | null>(null);
  const [adAccountId, setAdAccountId] = useState<string | null>(null);
  const [pages, setPages] = useState<MetaPage[] | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadConnection = useCallback(async () => {
    try {
      const conn = await api.metaAds.connection();
      setConnection(conn);
      if (conn.connected && conn.status === 'connected') {
        setStep('connected');
      } else if (conn.status === 'pending_selection') {
        setStep('picker');
        void loadBusinesses();
      } else {
        setStep('not_connected');
      }
    } catch {
      setStep('not_connected');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    if (params.oauth === 'error') {
      setOauthError(params.message ?? 'Meta declined the connection. Please try again.');
      setStep('oauth_error');
      return;
    }
    if (params.oauth === 'success') {
      void loadConnection();
      return;
    }
    void loadConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.oauth]);

  async function loadBusinesses() {
    setPickerLoading(true);
    setPickerError(null);
    try {
      const { businesses: list } = await api.metaAds.businesses();
      setBusinesses(list);
      if (list.length === 1) void handleSelectBusiness(list[0].id);
    } catch {
      setPickerError('Could not load your Meta businesses. Please try again.');
    } finally {
      setPickerLoading(false);
    }
  }

  async function handleSelectBusiness(id: string) {
    setBusinessId(id);
    setAdAccountId(null);
    setPageId(null);
    setAdAccounts(null);
    setPages(null);
    setPickerLoading(true);
    setPickerError(null);
    try {
      const [accountsRes, pagesRes] = await Promise.all([
        api.metaAds.adAccounts(id),
        api.metaAds.pages(id),
      ]);
      setAdAccounts(accountsRes.adAccounts);
      setPages(pagesRes.pages);
    } catch {
      setPickerError('Could not load ad accounts and pages for this business. Please try again.');
    } finally {
      setPickerLoading(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    try {
      const { authUrl } = await api.metaAds.oauthStart();
      const returnUrl = buildMetaAdsReturnUrl();
      const result = await WebBrowser.openAuthSessionAsync(authUrl, returnUrl);
      if (result.type === 'success' && result.url) {
        const url = new URL(result.url.replace('brandthread://', 'https://x/'));
        if (url.searchParams.get('oauth') === 'error') {
          setOauthError(url.searchParams.get('message') ?? 'Meta declined the connection. Please try again.');
          setStep('oauth_error');
        } else {
          await loadConnection();
        }
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        // Not an error — the seller simply backed out. Stay on this screen.
      } else {
        setOauthError('Connection did not complete. Please try again.');
        setStep('oauth_error');
      }
    } catch {
      setOauthError('Could not start the Meta connection. Check your network and try again.');
      setStep('oauth_error');
    } finally {
      setConnecting(false);
    }
  }

  async function handleFinishSelection() {
    if (!businessId || !adAccountId || !pageId) return;
    const business = businesses?.find((b) => b.id === businessId);
    const adAccount = adAccounts?.find((a) => a.id === adAccountId);
    const page = pages?.find((p) => p.id === pageId);
    if (!business || !adAccount || !page) return;

    setSubmitting(true);
    try {
      const conn = await api.metaAds.selectConnection({
        businessId: business.id,
        businessName: business.name,
        adAccountId: adAccount.id,
        adAccountName: adAccount.name,
        adAccountCurrency: adAccount.currency,
        pageId: page.id,
        pageName: page.name,
        instagramActorId: page.instagramBusinessAccount?.id,
        instagramUsername: page.instagramBusinessAccount?.username,
      });
      setConnection(conn);
      setStep('connected');
    } catch {
      Alert.alert('Could not connect', 'Something went wrong saving your selection. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleDisconnect() {
    Alert.alert(
      'Disconnect Meta?',
      'Your running campaigns will keep serving on Meta, but Brandthread will no longer be able to manage them until you reconnect.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect', style: 'destructive', onPress: async () => {
            setDisconnecting(true);
            try {
              await api.metaAds.disconnect();
              setConnection(null);
              setBusinessId(null); setAdAccountId(null); setPageId(null);
              setBusinesses(null); setAdAccounts(null); setPages(null);
              setStep('not_connected');
            } catch {
              Alert.alert('Error', 'Could not disconnect. Please try again.');
            } finally {
              setDisconnecting(false);
            }
          },
        },
      ],
    );
  }

  return (
    <BrandthreadScreen>
      <BrandthreadHeader title="Connect Meta" onBack={() => goBackOr(router)} />
      <ScrollView contentContainerStyle={{ padding: SP.md, gap: SP.md }} keyboardShouldPersistTaps="handled">
        {step === 'loading' && (
          <View style={s.center}>
            <ActivityIndicator color={theme.accentLight} size="large" />
          </View>
        )}

        {step === 'not_connected' && (
          <View style={{ gap: SP.lg }}>
            <View style={[s.introCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="facebook" size={ICON.lg} color={theme.accentLight} />
              <Text style={[s.introTitle, { color: colors.foreground }]}>Run real ads on Facebook & Instagram</Text>
              <Text style={[s.introBody, { color: colors.mutedForeground }]}>
                Connect your Facebook & Instagram to run real ads. Meta bills your ad account directly —
                Brandthread never touches your ad spend.
              </Text>
            </View>
            <PrimaryButton label="Connect Meta" icon="link" onPress={handleConnect} loading={connecting} />
          </View>
        )}

        {step === 'oauth_error' && (
          <EmptyState
            icon="alert-circle"
            title="Connection failed"
            description={oauthError ?? 'Meta declined the connection.'}
            action={{ label: 'Try again', onPress: () => { setStep('not_connected'); setOauthError(null); } }}
          />
        )}

        {step === 'picker' && (
          <View style={{ gap: SP.lg }}>
            <Text style={[s.stepTitle, { color: colors.foreground }]}>Choose your Business</Text>
            {pickerLoading && !businesses && <ActivityIndicator color={theme.accentLight} style={{ marginVertical: SP.lg }} />}
            {pickerError && (
              <EmptyState icon="alert-circle" title="Something went wrong" description={pickerError} action={{ label: 'Retry', onPress: loadBusinesses }} />
            )}
            {businesses && businesses.length === 0 && !pickerError && (
              <EmptyState icon="briefcase" title="No businesses found" description="Create a Meta Business Manager account first, then retry." action={{ label: 'Retry', onPress: loadBusinesses }} />
            )}
            {businesses?.map((b) => (
              <PickerRow key={b.id} label={b.name} selected={businessId === b.id} onPress={() => handleSelectBusiness(b.id)} />
            ))}

            {businessId && (
              <>
                <Text style={[s.stepTitle, { color: colors.foreground, marginTop: SP.md }]}>Choose an Ad Account</Text>
                {pickerLoading && <ActivityIndicator color={theme.accentLight} style={{ marginVertical: SP.md }} />}
                {adAccounts?.length === 0 && <Text style={[s.introBody, { color: colors.mutedForeground }]}>No ad accounts found for this business.</Text>}
                {adAccounts?.map((a) => (
                  <PickerRow key={a.id} label={a.name} sub={`${a.currency} · ${a.accountStatus}`} selected={adAccountId === a.id} onPress={() => setAdAccountId(a.id)} />
                ))}
              </>
            )}

            {businessId && (
              <>
                <Text style={[s.stepTitle, { color: colors.foreground, marginTop: SP.md }]}>Choose a Facebook Page</Text>
                {pages?.length === 0 && <Text style={[s.introBody, { color: colors.mutedForeground }]}>No Facebook Pages found for this business.</Text>}
                {pages?.map((p) => (
                  <PickerRow
                    key={p.id}
                    label={p.name}
                    sub={p.instagramBusinessAccount ? `Instagram: @${p.instagramBusinessAccount.username}` : 'No linked Instagram account'}
                    selected={pageId === p.id}
                    onPress={() => setPageId(p.id)}
                  />
                ))}
              </>
            )}

            <PrimaryButton
              label="Finish connecting"
              onPress={handleFinishSelection}
              disabled={!businessId || !adAccountId || !pageId}
              loading={submitting}
            />
          </View>
        )}

        {step === 'connected' && connection && (
          <View style={{ gap: SP.lg }}>
            <View style={[s.introCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[s.checkCircle, { backgroundColor: colors.success + '22' }]}>
                <Feather name="check" size={22} color={colors.success} />
              </View>
              <Text style={[s.introTitle, { color: colors.foreground }]}>Meta connected</Text>
              <SummaryRow label="Business" value={connection.businessName} colors={colors} />
              <SummaryRow label="Ad account" value={`${connection.adAccountName ?? ''}${connection.adAccountCurrency ? ` (${connection.adAccountCurrency})` : ''}`} colors={colors} />
              <SummaryRow label="Facebook Page" value={connection.pageName} colors={colors} />
              <SummaryRow label="Instagram" value={connection.instagramUsername ? `@${connection.instagramUsername}` : 'Not linked'} colors={colors} />
            </View>
            <PrimaryButton label="Continue" icon="arrow-right" onPress={() => router.push('/meta-ads-setup')} />
            <TertiaryButton label="Disconnect" icon="log-out" onPress={handleDisconnect} disabled={disconnecting} />
          </View>
        )}
      </ScrollView>
    </BrandthreadScreen>
  );
}

function PickerRow({ label, sub, selected, onPress }: { label: string; sub?: string; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  const { theme } = useAppTheme();
  return (
    <BrandthreadCard onPress={onPress} style={selected ? { borderColor: theme.accent } : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm }}>
        <View style={[s.radio, { borderColor: selected ? theme.accentLight : colors.mutedForeground }]}>
          {selected && <View style={[s.radioFill, { backgroundColor: theme.accentLight }]} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.rowLabel, { color: colors.foreground }]}>{label}</Text>
          {!!sub && <Text style={[s.rowSub, { color: colors.mutedForeground }]}>{sub}</Text>}
        </View>
      </View>
    </BrandthreadCard>
  );
}

function SummaryRow({ label, value, colors }: { label: string; value?: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: SP.sm }}>
      <Text style={[s.rowSub, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[s.rowLabel, { color: colors.foreground, flexShrink: 1, textAlign: 'right' }]}>{value || '—'}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  center:      { paddingVertical: SP.xxl, alignItems: 'center' },
  introCard:   { borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.lg, gap: SP.sm },
  introTitle:  { fontSize: FS.lg, fontFamily: FONT.bold },
  introBody:   { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
  checkCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: SP.xs },
  stepTitle:   { fontSize: FS.base, fontFamily: FONT.bold, marginBottom: SP.xs },
  radio:       { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioFill:   { width: 9, height: 9, borderRadius: 5 },
  rowLabel:    { fontSize: FS.base, fontFamily: FONT.semibold },
  rowSub:      { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
});
