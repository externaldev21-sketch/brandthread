/**
 * Creator program (seller side). Route: /seller-creator-program
 * Turn the program on/off, see creators with clicks/orders/revenue/commission,
 * invite by username, open a creator to pause/remove/override.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TextInput, TouchableOpacity, Switch } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RetryRow } from '@/components/ui/RetryRow';
import { isSellerDevPreview } from '@/lib/devPreview';
import { EMPTY_SELLER_OVERVIEW, getPreviewSellerOverview } from '@/lib/previewAffiliate';
import type { SellerAffiliateOverview } from '@/lib/affiliateTypes';
import { ActionButton, Card, KeyStatRow, Pill, SectionTitle, pct } from '@/components/affiliate/AffiliateUI';

const STATUS_LABEL: Record<string, string> = {
  active: 'Active', pending: 'Needs approval', paused: 'Paused', invited: 'Invited', removed: 'Removed',
};

export default function SellerCreatorProgramScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { isLoaded, isSignedIn } = useAuth();
  const previewOnly = isSellerDevPreview() && (!isLoaded || !isSignedIn);

  const [data, setData] = useState<SellerAffiliateOverview>(EMPTY_SELLER_OVERVIEW);
  const [loading, setLoading] = useState(!previewOnly);
  const [error, setError] = useState(false);
  const [username, setUsername] = useState('');
  const [inviting, setInviting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (previewOnly) { setData(getPreviewSellerOverview()); setLoading(false); return; }
    try { setData(await api.affiliate.seller.overview()); setError(false); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [api, previewOnly]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(null), 2200); };

  const toggle = async (enabled: boolean) => {
    setData((d) => ({ ...d, program: { ...d.program, enabled } }));
    if (previewOnly) return;
    try { await api.affiliate.seller.saveProgram({ enabled }); }
    catch { setData((d) => ({ ...d, program: { ...d.program, enabled: !enabled } })); flash("Couldn't update the program."); }
  };

  const invite = async () => {
    setInviting(true);
    try {
      if (previewOnly) { flash('Invites need a signed-in account.'); return; }
      await api.affiliate.seller.invite(username.trim().replace(/^@/, ''));
      setUsername('');
      flash('Invite sent');
      await load();
    } catch (e: any) { flash(e?.message ?? "Couldn't send the invite."); }
    finally { setInviting(false); }
  };

  const approve = async (id: string) => {
    if (previewOnly) return;
    try { await api.affiliate.seller.approve(id); await load(); } catch { flash("Couldn't approve."); }
  };

  const s = useMemo(() => StyleSheet.create({
    content: { paddingHorizontal: SP.md, paddingTop: SP.sm },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
    title: { fontFamily: FONT.bold, fontSize: FS.lg, color: theme.text },
    body: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20, color: theme.muted, marginTop: 4 },
    input: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, borderRadius: RADIUS.md, paddingHorizontal: SP.md, minHeight: 48, justifyContent: 'center', marginBottom: SP.sm },
    inputText: { fontFamily: FONT.regular, fontSize: FS.base, color: theme.text },
    creatorRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: SP.md, gap: SP.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border, minHeight: 64 },
    name: { fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text },
    meta: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted, marginTop: 2 },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm, minHeight: 44 },
    link: { flex: 1, fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted },
  }), [theme]);

  const p = data.program;
  const t = data.totals;
  const visible = data.creators.filter((c) => c.status !== 'removed');

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title="Creator program" />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 120 }]} keyboardShouldPersistTaps="handled">
        {note ? <Text style={[s.body, { marginBottom: SP.sm }]} accessibilityLiveRegion="polite">{note}</Text> : null}
        {loading ? <ActivityIndicator color={theme.text} style={{ marginTop: SP.xl }} /> : error ? (
          <RetryRow label="Couldn't load the creator program" onRetry={load} />
        ) : (
          <>
            <Card>
              <View style={s.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={s.title}>Creator program</Text>
                  <Text style={s.body}>
                    {p.enabled ? `${pct(p.commissionPercent)} commission · ${p.windowDays}-day window` : 'Off. Creators can\'t join or earn.'}
                  </Text>
                </View>
                <Switch
                  value={p.enabled}
                  onValueChange={toggle}
                  trackColor={{ true: theme.success, false: theme.border }}
                  accessibilityLabel="Creator program"
                />
              </View>
              <TouchableOpacity style={s.linkRow} onPress={() => router.push('/seller-creator-settings' as any)} accessibilityRole="button">
                <Feather name="sliders" size={16} color={theme.text} />
                <Text style={[s.link, { color: theme.text }]}>Commission, window and payout settings</Text>
                <Feather name="chevron-right" size={16} color={theme.muted} />
              </TouchableOpacity>
              <TouchableOpacity
                style={s.linkRow}
                onPress={async () => { await Clipboard.setStringAsync(data.programLink); flash('Program link copied'); }}
                accessibilityRole="button"
              >
                <Feather name="link" size={16} color={theme.text} />
                <Text style={[s.link, { color: theme.text }]}>Copy program link</Text>
                <Feather name="copy" size={16} color={theme.muted} />
              </TouchableOpacity>
              <TouchableOpacity style={s.linkRow} onPress={() => router.push('/creator-program' as any)} accessibilityRole="button">
                <Feather name="user" size={16} color={theme.text} />
                <Text style={[s.link, { color: theme.text }]}>My creator codes</Text>
                <Feather name="chevron-right" size={16} color={theme.muted} />
              </TouchableOpacity>
            </Card>

            <SectionTitle>Key stats</SectionTitle>
            <KeyStatRow label="Revenue from creators" value={formatCents(t.revenueCents)} />
            <KeyStatRow label="Orders" value={String(t.orders)} />
            <KeyStatRow label="Clicks" value={String(t.clicks)} />
            <KeyStatRow label="Commission owed" value={formatCents(t.pendingCents + t.payableCents)} note="Pending plus payable" />
            <KeyStatRow label="Commission paid" value={formatCents(t.paidCents)} note={data.payoutsAvailable ? undefined : 'Payouts are not switched on yet'} last />

            <SectionTitle>Invite a creator</SectionTitle>
            <View style={s.input}>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="Username"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={s.inputText}
                accessibilityLabel="Creator username"
              />
            </View>
            <ActionButton label="Send invite" loading={inviting} disabled={!p.enabled || username.trim().length < 2} onPress={invite} />

            <SectionTitle>Creators</SectionTitle>
            {visible.length === 0 ? (
              <Text style={s.body}>No creators yet. Invite someone by username or share your program link.</Text>
            ) : visible.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={s.creatorRow}
                onPress={() => router.push({ pathname: '/seller-creator-detail' as any, params: { id: c.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Open ${c.displayName ?? c.username ?? 'creator'}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{c.displayName ?? c.username ?? 'Creator'}</Text>
                  <Text style={s.meta}>{c.code}, {c.stats.orders} orders, {formatCents(c.stats.revenueCents)}</Text>
                  <Text style={s.meta}>Owed {formatCents(c.stats.pendingCents + c.stats.payableCents)} · Paid {formatCents(c.stats.paidCents)}</Text>
                </View>
                {c.status === 'pending' ? (
                  <ActionButton label="Approve" onPress={() => approve(c.id)} />
                ) : (
                  <Pill label={STATUS_LABEL[c.status] ?? c.status} tone={c.status === 'active' ? 'strong' : 'neutral'} />
                )}
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}
