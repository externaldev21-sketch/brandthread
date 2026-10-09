/** One creator in the seller's program. Route: /seller-creator-detail?id=<affiliateId> */
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, TextInput, ActivityIndicator } from 'react-native';
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
import { ActionButton, KeyStatRow, Pill, SectionTitle } from '@/components/affiliate/AffiliateUI';

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
  const [override, setOverride] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const overview = previewOnly ? getPreviewSellerOverview() : await api.affiliate.seller.overview();
      const c = overview.creators.find((x) => x.id === id) ?? null;
      setCreator(c);
      setOverride(c?.hasOverride ? String(c.commissionPercent) : '');
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [api, id, previewOnly]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const run = async (key: string, fn: () => Promise<unknown>, leave?: boolean) => {
    setBusy(key);
    try {
      if (!previewOnly) await fn();
      if (leave) router.back(); else await load();
    } catch (e: any) { setMsg(e?.message ?? 'Something went wrong.'); }
    finally { setBusy(null); }
  };

  const c = creator;
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title={c?.displayName ?? c?.username ?? 'Creator'} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        {loading ? <ActivityIndicator color={theme.text} /> : error ? <RetryRow label="Couldn't load this creator" onRetry={load} /> : !c ? (
          <Text style={{ fontFamily: FONT.regular, color: theme.muted }}>This creator isn't in your program.</Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm }}>
              <Text style={{ fontFamily: FONT.bold, fontSize: FS.xl, color: theme.text }}>{c.code}</Text>
              <Pill label={c.status === 'active' ? 'Active' : c.status === 'pending' ? 'Needs approval' : c.status === 'paused' ? 'Paused' : 'Invited'} tone={c.status === 'active' ? 'strong' : 'neutral'} />
            </View>
            {c.username ? <Text style={{ fontFamily: FONT.regular, color: theme.muted, marginBottom: SP.sm }}>@{c.username}</Text> : null}

            <SectionTitle>Performance</SectionTitle>
            <KeyStatRow label="Clicks" value={String(c.stats.clicks)} />
            <KeyStatRow label="Orders" value={String(c.stats.orders)} />
            <KeyStatRow label="Revenue" value={formatCents(c.stats.revenueCents)} />
            <KeyStatRow label="Commission owed" value={formatCents(c.stats.pendingCents + c.stats.payableCents)} note={`${formatCents(c.stats.payableCents)} payable now`} />
            <KeyStatRow label="Commission paid" value={formatCents(c.stats.paidCents)} last />

            <SectionTitle>Commission</SectionTitle>
            <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, borderRadius: RADIUS.md, paddingHorizontal: SP.md, minHeight: 48, marginBottom: SP.sm }}>
              <TextInput
                value={override}
                onChangeText={setOverride}
                placeholder={`${c.commissionPercent} (program default)`}
                placeholderTextColor={theme.muted}
                keyboardType="decimal-pad"
                style={{ flex: 1, fontFamily: FONT.regular, fontSize: FS.base, color: theme.text }}
                accessibilityLabel="Commission override"
              />
              <Text style={{ fontFamily: FONT.medium, color: theme.muted }}>%</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: SP.sm, marginBottom: SP.lg }}>
              <ActionButton label="Save rate" flex loading={busy === 'rate'} disabled={override.trim() === '' || !Number.isFinite(Number(override))}
                onPress={() => run('rate', () => api.affiliate.seller.update(c.id, { commissionPercent: Number(override) }))} />
              <ActionButton label="Use default" flex outline disabled={!c.hasOverride || busy === 'rate'}
                onPress={() => run('rate', () => api.affiliate.seller.update(c.id, { commissionPercent: null }))} />
            </View>
            <Text style={{ fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted, marginBottom: SP.lg }}>
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
              label={confirmRemove ? 'Tap again to remove' : 'Remove creator'}
              outline
              loading={busy === 'remove'}
              onPress={() => confirmRemove ? run('remove', () => api.affiliate.seller.remove(c.id), true) : setConfirmRemove(true)}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}
