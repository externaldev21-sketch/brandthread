/**
 * Brandthread — Connect Meta (Facebook & Instagram)
 * Route: /meta-ads-connect
 *
 * OAuth connect → pick Business → Ad Account → Facebook Page (with its
 * linked Instagram account, read-only) → POST connection/select.
 * Meta bills the seller's ad account directly — Brandthread never touches
 * ad spend here.
 *
 * Return deep link: brandthread://meta-ads-connect?oauth=code&code=…&state=…
 *                    brandthread://meta-ads-connect?oauth=error&message=…
 * The code is handed to POST /meta-ads/oauth/complete by this signed-in
 * screen; the server only accepts it for the seller who started the flow.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Icon } from '@/components/ui/Icon';

import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/hooks/useApi';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  BrandthreadScreen, BrandthreadCard,
  PrimaryButton, TertiaryButton, EmptyState,
} from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { friendlyError } from '@/lib/friendlyError';
import {
  buildMetaAdsReturnUrl, parseMetaOAuthReturn, metaOAuthReturnFromParams, metaConnectionState,
  isMetaReconnectError, META_CONNECTION_CHECK_FAILED,
} from '@/services/metaAdsService';
import type { MetaAdsConnection, MetaBusiness, MetaAdAccount, MetaPage } from '@/lib/api';

// 'load_error': GET /meta-ads/connection itself failed (network / 5xx). Kept
// apart from 'not_connected' so a failed check never offers Connect Meta.
// 'needs_reconnect': connected before, but the Meta login expired or was revoked.
type Step =
  | 'loading' | 'load_error' | 'not_configured' | 'not_connected' | 'needs_reconnect'
  | 'oauth_error' | 'picker' | 'connected';

// Meta's Graph API returns `account_status` as a numeric code; show the
// seller words, never the raw number.
const AD_ACCOUNT_STATUS: Record<string, string> = {
  '1': 'Active', '2': 'Disabled', '3': 'Unsettled', '7': 'In risk review',
  '8': 'Pending settlement', '9': 'In grace period', '100': 'Pending closure', '101': 'Closed',
};
function adAccountStatusLabel(status: string | number): string {
  return AD_ACCOUNT_STATUS[String(status)] ?? (/^\d+$/.test(String(status)) ? 'Status unknown' : String(status));
}

export default function MetaAdsConnectScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ oauth?: string; message?: string; code?: string; state?: string }>();
  const colors = useColors();
  const { theme } = useAppTheme();
  const api = useApi();

  const [step, setStep] = useState<Step>('loading');
  const [connection, setConnection] = useState<MetaAdsConnection | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  function applyConnection(conn: MetaAdsConnection) {
    setConnection(conn);
    switch (metaConnectionState(conn)) {
      case 'not_configured': setStep('not_configured'); break;
      case 'connected': setStep('connected'); break;
      case 'needs_reconnect': setStep('needs_reconnect'); break;
      case 'pending_selection':
        setStep('picker');
        void loadBusinesses();
        break;
      default: setStep('not_connected');
    }
  }

  const loadConnection = useCallback(async () => {
    setLoadError(null);
    try {
      applyConnection(await api.metaAds.connection());
    } catch (err) {
      setLoadError(friendlyError(err, META_CONNECTION_CHECK_FAILED));
      setStep('load_error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // Meta's code (from the auth session or the deep link) → server token exchange.
  async function completeOAuth(code: string, state: string) {
    setStep('loading');
    try {
      applyConnection(await api.metaAds.oauthComplete(code, state));
    } catch (err) {
      setOauthError(friendlyError(err, "Couldn't finish connecting Meta. Try again."));
      setStep('oauth_error');
    }
  }

  useEffect(() => {
    const returned = metaOAuthReturnFromParams(params);
    if (returned?.kind === 'error') {
      setOauthError(returned.message);
      setStep('oauth_error');
      return;
    }
    if (returned?.kind === 'code') {
      void completeOAuth(returned.code, returned.state);
      return;
    }
    void loadConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.oauth, params.code]);

  async function loadBusinesses() {
    setPickerLoading(true);
    setPickerError(null);
    try {
      const { businesses: list } = await api.metaAds.businesses();
      setBusinesses(list);
      if (list.length === 1) void handleSelectBusiness(list[0].id);
    } catch (err) {
      if (isMetaReconnectError(err)) { setStep('needs_reconnect'); return; }
      setPickerError(friendlyError(err, "Couldn't load your Meta businesses. Try again."));
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
    } catch (err) {
      if (isMetaReconnectError(err)) { setStep('needs_reconnect'); return; }
      setPickerError(friendlyError(err, "Couldn't load ad accounts and pages for this business. Try again."));
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
        const returned = parseMetaOAuthReturn(result.url);
        if (returned?.kind === 'error') {
          setOauthError(returned.message);
          setStep('oauth_error');
        } else if (returned?.kind === 'code') {
          await completeOAuth(returned.code, returned.state);
        } else {
          await loadConnection();
        }
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        // Not an error — the seller simply backed out. Stay on this screen.
      } else {
        setOauthError("Connection didn't finish. Try again.");
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
    } catch (err) {
      if (isMetaReconnectError(err)) { setStep('needs_reconnect'); return; }
      Alert.alert("Couldn't save your selection", friendlyError(err, 'Try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  function handleDisconnect() {
    Alert.alert(
      'Disconnect Meta?',
      'Your running campaigns will keep serving on Meta, but Brandthread will no longer be able to manage them until you reconnect.',
      [
        { text: 'Stay connected', style: 'cancel' },
        {
          text: 'Disconnect Meta', style: 'destructive', onPress: async () => {
            setDisconnecting(true);
            try {
              await api.metaAds.disconnect();
              setConnection(null);
              setBusinessId(null); setAdAccountId(null); setPageId(null);
              setBusinesses(null); setAdAccounts(null); setPages(null);
              setStep('not_connected');
            } catch {
              Alert.alert("Couldn't disconnect Meta", 'Try again.');
            } finally {
              setDisconnecting(false);
            }
          },
        },
      ],
    );
  }

  return (
    <BrandthreadScreen noSafeTop>
      <ScreenHeader title="Connect Meta" onBack={() => goBackOr(router)} />
      <ScrollView
        contentContainerStyle={{ padding: SP.md, paddingBottom: SP.lg, gap: SP.md }}
        keyboardShouldPersistTaps="handled"
      >
        {step === 'loading' && (
          <View style={s.center}>
            <ActivityIndicator color={theme.accentLight} size="large" />
          </View>
        )}

        {step === 'load_error' && (
          <ErrorState
            message={loadError ?? "Couldn't check your Meta connection."}
            onRetry={() => { setStep('loading'); void loadConnection(); }}
          />
        )}

        {step === 'not_connected' && (
          <View style={{ gap: SP.lg }}>
            <View style={[s.introCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Icon name="facebook" size={ICON.lg} color={theme.accentLight} />
              <Text style={[s.introTitle, { color: colors.foreground }]}>Run real ads on Facebook & Instagram</Text>
              <Text style={[s.introBody, { color: colors.mutedForeground }]}>
                Link your Meta business account to launch and manage campaigns from Brandthread. Meta bills
                your ad account directly — Brandthread never touches your ad spend.
              </Text>
            </View>
            <PrimaryButton label="Connect Meta" icon="link" onPress={handleConnect} loading={connecting} />
          </View>
        )}

        {step === 'needs_reconnect' && (
          <View style={{ gap: SP.lg }}>
            <View style={[s.introCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Icon name="refresh-cw" size={ICON.lg} color={theme.accentLight} />
              <Text style={[s.introTitle, { color: colors.foreground }]}>Reconnect Meta</Text>
              <Text style={[s.introBody, { color: colors.mutedForeground }]}>
                {connection?.reconnectReason ?? 'Your Meta login expired.'} Your campaigns keep running on Meta — reconnect
                to manage them from Brandthread again.
              </Text>
            </View>
            <PrimaryButton label="Reconnect Meta" icon="link" onPress={handleConnect} loading={connecting} />
            <TertiaryButton label="Disconnect" icon="log-out" onPress={handleDisconnect} disabled={disconnecting} />
          </View>
        )}

        {step === 'not_configured' && (
          <EmptyState
            icon="link"
            title="Meta / Instagram not configured"
            description={connection?.configurationError ?? 'Facebook and Instagram connections are not configured for this app yet.'}
          />
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
            <Text style={[s.stepTitle, { color: colors.foreground }]}>Choose your business</Text>
            {pickerLoading && !businesses && <ActivityIndicator color={theme.accentLight} style={{ marginVertical: SP.lg }} />}
            {pickerError && (
              <EmptyState icon="alert-circle" title="Couldn't load Meta accounts" description={pickerError} action={{ label: 'Retry', onPress: loadBusinesses }} />
            )}
            {businesses && businesses.length === 0 && !pickerError && (
              <EmptyState icon="briefcase" title="No businesses found" description="Create a Meta Business Manager account first, then retry." action={{ label: 'Retry', onPress: loadBusinesses }} />
            )}
            {businesses?.map((b) => (
              <PickerRow key={b.id} label={b.name} selected={businessId === b.id} onPress={() => handleSelectBusiness(b.id)} />
            ))}

            {businessId && (
              <>
                <Text style={[s.stepTitle, { color: colors.foreground, marginTop: SP.md }]}>Choose an ad account</Text>
                {pickerLoading && <ActivityIndicator color={theme.accentLight} style={{ marginVertical: SP.md }} />}
                {adAccounts?.length === 0 && <Text style={[s.introBody, { color: colors.mutedForeground }]}>No ad accounts found for this business.</Text>}
                {adAccounts?.map((a) => (
                  <PickerRow key={a.id} label={a.name} sub={`${a.currency} · ${adAccountStatusLabel(a.accountStatus)}`} selected={adAccountId === a.id} onPress={() => setAdAccountId(a.id)} />
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
                <Icon name="check" size={22} color={colors.success} />
              </View>
              <Text style={[s.introTitle, { color: colors.foreground }]}>Meta connected</Text>
              <SummaryRow label="Business" value={connection.businessName} colors={colors} />
              <SummaryRow label="Ad account" value={`${connection.adAccountName ?? ''}${connection.adAccountCurrency ? ` (${connection.adAccountCurrency})` : ''}`} colors={colors} />
              <SummaryRow label="Facebook Page" value={connection.pageName} colors={colors} />
              <SummaryRow label="Instagram" value={connection.instagramUsername ? `@${connection.instagramUsername}` : 'Not linked'} colors={colors} />
              {connection.sandbox && (
                <Text style={[s.rowSub, { color: colors.mutedForeground }]}>
                  Sandbox mode: ads go to a Meta test ad account and never deliver or spend.
                </Text>
              )}
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
    <BrandthreadCard
      onPress={onPress}
      style={selected ? { borderColor: theme.accent } : undefined}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
    >
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
  introBody:   { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
  checkCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: SP.xs },
  stepTitle:   { fontSize: FS.base, fontFamily: FONT.bold, marginBottom: SP.xs },
  radio:       { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioFill:   { width: 9, height: 9, borderRadius: 5 },
  rowLabel:    { fontSize: FS.base, fontFamily: FONT.semibold },
  rowSub:      { fontSize: FS.meta, fontFamily: FONT.regular, marginTop: 2 },
});
