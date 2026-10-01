/**
 * Creator program (creator side). Route: /creator-program
 * Any account (buyer or seller) can promote brands that run a program:
 * Overview (earnings, codes per brand, share links) and Payouts (Stripe
 * account status + history).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Linking, ActivityIndicator, TextInput, Share } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RetryRow } from '@/components/ui/RetryRow';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import {
  EMPTY_CREATOR_OVERVIEW, getPreviewCreatorOverview, getPreviewCreatorPayouts,
} from '@/lib/previewAffiliate';
import type { CreatorOverview, CreatorPayout } from '@/lib/affiliateTypes';
import {
  ActionButton, Card, KeyStatRow, Pill, SectionTitle, SegmentTabs, fmtDate, pct,
} from '@/components/affiliate/AffiliateUI';

type Tab = 'overview' | 'payouts';

export default function CreatorProgramScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { isLoaded, isSignedIn } = useAuth();
  const previewOnly = (isBuyerDevPreview() || isSellerDevPreview()) && (!isLoaded || !isSignedIn);

  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<CreatorOverview>(EMPTY_CREATOR_OVERVIEW);
  const [payouts, setPayouts] = useState<CreatorPayout[]>([]);
  const [loading, setLoading] = useState(!previewOnly);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [brandRef, setBrandRef] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (previewOnly) {
      setData(getPreviewCreatorOverview());
      setPayouts(getPreviewCreatorPayouts());
      setLoading(false);
      return;
    }
    try {
      const [overview, history] = await Promise.all([api.affiliate.overview(), api.affiliate.payouts()]);
      setData(overview);
      setPayouts(history.payouts);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [api, previewOnly]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const copy = async (text: string, what: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(text);
    setNote(`${what} copied`);
    setTimeout(() => setNote(null), 1800);
  };

  const respond = async (id: string, accept: boolean) => {
    setBusy(id);
    try {
      if (!previewOnly) await api.affiliate.respondToInvite(id, accept);
      await load();
    } catch {
      setNote("Couldn't update the invite. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const setupPayouts = async () => {
    setBusy('payouts');
    try {
      const { url } = await api.affiliate.onboardPayouts();
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.href = url;
      else await Linking.openURL(url);
    } catch (e: any) {
      setNote(e?.message ?? "Couldn't open payout setup.");
    } finally {
      setBusy(null);
    }
  };

  const s = useMemo(() => makeStyles(theme), [theme]);
  const invites = data.brands.filter((b) => b.status === 'invited');
  const joined = data.brands.filter((b) => b.status !== 'invited');
  const t = data.totals;

  return (
    <View style={[s.page, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Creator program" />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 96 }]} showsVerticalScrollIndicator={false}>
        <SegmentTabs<Tab>
          tabs={[{ key: 'overview', label: 'Overview' }, { key: 'payouts', label: 'Payouts' }]}
          value={tab}
          onChange={setTab}
        />
        {note ? <Text style={[s.note, { color: theme.muted }]} accessibilityLiveRegion="polite">{note}</Text> : null}

        {loading ? (
          <ActivityIndicator color={theme.text} style={{ marginTop: SP.xl }} />
        ) : error ? (
          <RetryRow label="Couldn't load your creator program" onRetry={load} />
        ) : tab === 'overview' ? (
          <>
            {invites.map((b) => (
              <Card key={b.id}>
                <Text style={[s.cardTitle, { color: theme.text }]}>{b.brandName} invited you</Text>
                <Text style={[s.cardBody, { color: theme.muted }]}>
                  Earn {pct(b.commissionPercent)} on every order you bring in.
                </Text>
                <View style={s.row}>
                  <ActionButton label="Accept" flex loading={busy === b.id} onPress={() => respond(b.id, true)} />
                  <ActionButton label="Decline" flex outline disabled={busy === b.id} onPress={() => respond(b.id, false)} />
                </View>
              </Card>
            ))}

            <SectionTitle>Key stats</SectionTitle>
            <KeyStatRow label="Total earned" value={formatCents(t.earnedCents)} />
            <KeyStatRow label="Pending" value={formatCents(t.pendingCents)} note="Until the order is delivered and the return window ends" />
            <KeyStatRow label="Payable" value={formatCents(t.payableCents)} note="Paid out on the next payout run" />
            <KeyStatRow label="Paid" value={formatCents(t.paidCents)} />
            <KeyStatRow label="Clicks" value={String(t.clicks)} />
            <KeyStatRow label="Orders" value={String(t.orders)} last />

            <SectionTitle>Your codes</SectionTitle>
            {joined.length === 0 ? (
              <Text style={[s.cardBody, { color: theme.muted }]}>
                Join a brand below to get your code and link.
              </Text>
            ) : joined.map((b) => (
              <Card key={b.id}>
                <View style={s.rowBetween}>
                  <Text style={[s.cardTitle, { color: theme.text, flex: 1 }]}>{b.brandName}</Text>
                  <Pill label={b.status === 'active' ? (b.programEnabled ? 'Active' : 'Program paused') : b.status === 'pending' ? 'Pending approval' : 'Paused'} tone={b.status === 'active' && b.programEnabled ? 'strong' : 'neutral'} />
                </View>
                {b.status === 'active' ? (
                  <>
                    <View style={[s.codeBox, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                      <Text style={[s.code, { color: theme.text }]} selectable>{b.code}</Text>
                    </View>
                    <KeyStatRow label="Commission" value={pct(b.commissionPercent)} />
                    <KeyStatRow label="Window" value={`${b.windowDays} days`} />
                    <KeyStatRow label="Buyer discount" value={b.buyerDiscountPercent > 0 ? `${pct(b.buyerDiscountPercent)} off` : 'None'} last />
                    <View style={s.row}>
                      <ActionButton label="Copy code" flex outline onPress={() => copy(b.code, 'Code')} />
                      <ActionButton
                        label="Share link"
                        flex
                        disabled={!b.shareLink}
                        onPress={async () => {
                          if (!b.shareLink) return;
                          if (Platform.OS === 'web') await copy(b.shareLink, 'Link');
                          else await Share.share({ message: b.shareLink });
                        }}
                      />
                    </View>
                    <KeyStatRow label="Clicks" value={String(b.stats.clicks)} />
                    <KeyStatRow label="Orders" value={String(b.stats.orders)} />
                    <KeyStatRow label="Earned" value={formatCents(b.stats.earnedCents)} last />
                  </>
                ) : (
                  <Text style={[s.cardBody, { color: theme.muted }]}>
                    {b.status === 'pending' ? 'The brand will review your application.' : 'Your code is paused by the brand.'}
                  </Text>
                )}
              </Card>
            ))}

            <SectionTitle>Join a brand</SectionTitle>
            <View style={[s.input, { borderColor: theme.border, backgroundColor: theme.card }]}>
              <TextInput
                value={brandRef}
                onChangeText={setBrandRef}
                placeholder="Brand username"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={[s.inputText, { color: theme.text }]}
                accessibilityLabel="Brand username"
              />
            </View>
            <ActionButton
              label="Continue"
              disabled={brandRef.trim().length < 2}
              onPress={() => router.push({ pathname: '/creator-program-join' as any, params: { brand: brandRef.trim().replace(/^@/, '') } })}
            />
          </>
        ) : (
          <>
            <Card>
              <View style={s.rowBetween}>
                <Text style={[s.cardTitle, { color: theme.text }]}>Payout account</Text>
                <Pill
                  label={!data.payout.available ? 'Unavailable' : data.payout.ready ? 'Ready' : 'Action required'}
                  tone={data.payout.ready ? 'strong' : 'neutral'}
                />
              </View>
              <Text style={[s.cardBody, { color: theme.muted }]}>
                {!data.payout.available
                  ? (data.payout.reason ?? 'Payouts are unavailable right now.') + ' Your earnings keep tracking and will be paid once payouts are on.'
                  : data.payout.ready
                    ? 'Your Stripe account can receive payouts.'
                    : 'Finish Stripe onboarding to start receiving payouts.'}
              </Text>
              {data.payout.available && !data.payout.ready ? (
                <ActionButton label={data.payout.connected ? 'Finish verification' : 'Set up payouts'} loading={busy === 'payouts'} onPress={setupPayouts} />
              ) : null}
            </Card>
            <KeyStatRow label="Payable now" value={formatCents(t.payableCents)} note="Paid on the next run once over the brand's minimum" />
            <KeyStatRow label="Paid to date" value={formatCents(t.paidCents)} last />
            <SectionTitle>Payout history</SectionTitle>
            {payouts.length === 0 ? (
              <Text style={[s.cardBody, { color: theme.muted }]}>No payouts yet.</Text>
            ) : payouts.map((p, i) => (
              <KeyStatRow
                key={p.id}
                label={p.brandName}
                value={formatCents(p.amountCents)}
                note={`${p.state === 'paid' ? 'Paid' : p.state === 'failed' ? 'Failed, retrying' : 'Processing'} · ${fmtDate(p.paidAt ?? p.createdAt)}`}
                last={i === payouts.length - 1}
              />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (_theme: unknown) => StyleSheet.create({
  page: { flex: 1 },
  content: { paddingHorizontal: SP.md, paddingTop: SP.sm },
  row: { flexDirection: 'row', gap: SP.sm, marginTop: SP.sm, marginBottom: SP.xs },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm, marginBottom: SP.sm },
  cardTitle: { fontFamily: FONT.bold, fontSize: FS.lg },
  cardBody: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20, marginBottom: SP.sm },
  note: { fontFamily: FONT.medium, fontSize: FS.sm, marginBottom: SP.sm },
  codeBox: { borderWidth: 1, borderRadius: RADIUS.md, paddingVertical: SP.md, alignItems: 'center', marginBottom: SP.sm },
  code: { fontFamily: FONT.bold, fontSize: FS.xl, letterSpacing: 2 },
  input: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SP.md, minHeight: 48, justifyContent: 'center', marginBottom: SP.sm },
  inputText: { fontFamily: FONT.regular, fontSize: FS.base },
});
