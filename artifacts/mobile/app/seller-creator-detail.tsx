/** One creator in the seller's program. Route: /seller-creator-detail?id=<affiliateId> */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RetryRow } from '@/components/ui/RetryRow';
import { isSellerDevPreview } from '@/lib/devPreview';
import { getPreviewSellerOverview } from '@/lib/previewAffiliate';
import type { SellerCreator } from '@/lib/affiliateTypes';
import { ActionButton, InlineError, KeyStatRow, Pill, SectionTitle } from '@/components/affiliate/AffiliateUI';
import { formatMoney } from '@/lib/format';
import { CommissionStepper } from '@/components/affiliate/CommissionStepper';
import { confirmAlert } from '@/lib/actionSheet';
import { friendlyError } from '@/lib/friendlyError';
import { commissionError } from '@/lib/creatorProgramValidation';

const STATUS_LABEL: Record<string, string> = {
  active: 'Active', pending: 'Needs approval', paused: 'Paused', invited: 'Invited', removed: 'Removed', declined: 'Declined',
};

export default function SellerCreatorDetailScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { isLoaded, isSignedIn } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const previewOnly = isSellerDevPreview() && (!isLoaded || !isSignedIn);

  const [creator, setCreator] = useState<SellerCreator | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rate, setRate] = useState(10);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Brief "Saved" on the Save rate button after a rate change lands.
  const [rateSaved, setRateSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const load = useCallback(async () => {
    try {
      const overview = previewOnly ? getPreviewSellerOverview() : await api.affiliate.seller.overview();
      const c = overview.creators.find((x) => x.id === id) ?? null;
      setCreator(c);
      if (c) setRate(c.commissionPercent);
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [api, id, previewOnly]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const run = async (key: string, fn: () => Promise<unknown>, leave?: boolean): Promise<boolean> => {
    setBusy(key);
    setMsg(null);
    try {
      if (!previewOnly) await fn();
      if (leave) router.back(); else await load();
      return true;
    } catch (e) { setMsg(friendlyError(e, "Couldn't save that change. Try again.")); return false; }
    finally { setBusy(null); }
  };

  const flashSaved = () => {
    setRateSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setRateSaved(false), 2000);
  };

  const saveRate = async (id: string, commissionPercent: number | null) => {
    if (await run('rate', () => api.affiliate.seller.update(id, { commissionPercent }))) flashSaved();
  };

  const remove = async (target: SellerCreator) => {
    const name = target.displayName ?? (target.username ? `@${target.username}` : 'this creator');
    const ok = await confirmAlert({
      title: 'Remove creator?',
      message: `${name} leaves your program and their code stops working right away.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (ok) await run('remove', () => api.affiliate.seller.remove(target.id), true);
  };

  const c = creator;
  const rateError = c && rate !== c.commissionPercent ? commissionError(rate, c.commissionPercent) : null;
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title={c?.displayName ?? (c?.username ? `@${c.username}` : 'Creator')} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        {loading ? <ActivityIndicator color={theme.text} /> : error ? <RetryRow label="Couldn't load this creator" onRetry={load} /> : !c ? (
          <Text style={{ fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted }}>This creator isn't in your program.</Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm }}>
              <Text style={{ fontFamily: FONT.bold, fontSize: FS.xl, color: theme.text }}>{c.code}</Text>
              <Pill label={c.status === 'active' ? 'Active' : c.status === 'pending' ? 'Needs approval' : c.status === 'paused' ? 'Paused' : 'Invited'} tone={c.status === 'active' ? 'strong' : 'neutral'} />
            </View>
            {c.username ? <Text style={{ fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, marginBottom: SP.sm }}>@{c.username}</Text> : null}

            <SectionTitle>Performance</SectionTitle>
            <KeyStatRow label="Clicks" value={String(c.stats.clicks)} />
            <KeyStatRow label="Orders" value={String(c.stats.orders)} />
            <KeyStatRow label="Revenue" value={formatMoney(c.stats.revenueCents)} />
            <KeyStatRow label="Commission owed" value={formatMoney(c.stats.pendingCents + c.stats.payableCents)} note={`${formatMoney(c.stats.payableCents)} payable now`} />
            <KeyStatRow label="Commission paid" value={formatMoney(c.stats.paidCents)} last />

            <SectionTitle>Commission</SectionTitle>
            <View style={{ marginBottom: SP.sm }}>
              <CommissionStepper label={c.hasOverride ? 'Commission for this creator' : 'Commission (program default)'} value={rate} onChange={(v) => { setRate(v); setRateSaved(false); }} testID="creator-commission-stepper" />
              <InlineError message={rateError} />
            </View>
            <View style={{ flexDirection: 'row', gap: SP.sm, marginBottom: SP.lg }}>
              <ActionButton label={rateSaved ? 'Saved' : 'Save rate'} flex loading={busy === 'rate'} disabled={rate === c.commissionPercent || !!rateError}
                onPress={() => { if (!rateError) void saveRate(c.id, rate); }} />
              <ActionButton label="Use default" flex outline disabled={!c.hasOverride || busy === 'rate'}
                onPress={() => saveRate(c.id, null)} />
            </View>
            <Text style={{ fontFamily: FONT.regular, fontSize: FS.meta, color: theme.muted, marginBottom: SP.lg }}>
              A new rate applies to future orders. Existing commissions keep the rate they were earned at.
            </Text>

            {msg ? <Text style={{ fontFamily: FONT.medium, color: theme.error, marginBottom: SP.sm }}>{msg}</Text> : null}
            {c.status === 'pending' ? (
              <ActionButton label="Approve" loading={busy === 'approve'} onPress={() => run('approve', () => api.affiliate.seller.approve(c.id))} />
            ) : null}
            {c.status === 'active' || c.status === 'paused' ? (
              <ActionButton
                label={c.status === 'active' ? 'Pause creator' : 'Resume creator'}
                outline
                loading={busy === 'status'}
                onPress={() => run('status', () => api.affiliate.seller.update(c.id, { status: c.status === 'active' ? 'paused' : 'active' }))}
              />
            ) : null}
            <View style={{ height: SP.sm }} />
            <ActionButton
              label="Remove creator"
              destructive
              loading={busy === 'remove'}
              loadingLabel="Removing…"
              onPress={() => remove(c)}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}
