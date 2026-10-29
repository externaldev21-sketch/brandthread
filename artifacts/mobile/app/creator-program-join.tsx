/**
 * Join / apply to a brand's creator program. Route: /creator-program-join?brand=<username|sellerId>
 * Reached from a brand's program link or the "Join a brand" field in /creator-program.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RetryRow } from '@/components/ui/RetryRow';
import { isBuyerDevPreview, isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import type { BrandProgramInfo } from '@/lib/affiliateTypes';
import { ActionButton, Card, InlineError, KeyStatRow, pct } from '@/components/affiliate/AffiliateUI';
import { friendlyError } from '@/lib/friendlyError';

export default function CreatorProgramJoinScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { isLoaded, isSignedIn } = useAuth();
  const params = useLocalSearchParams<{ brand?: string }>();
  const ref = typeof params.brand === 'string' ? params.brand : '';
  const previewOnly = (isBuyerDevPreview() || isSellerDevPreview()) && (!isLoaded || !isSignedIn);

  const [info, setInfo] = useState<BrandProgramInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which action is in flight: apply/join, or accepting/declining an invite.
  const [saving, setSaving] = useState<'apply' | 'accept' | 'decline' | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  // An apply / invite failure. Kept apart from `error` (load state) so a
  // failed tap doesn't replace the program details with an error page.
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ref) { setLoading(false); setError('No brand selected.'); return; }
    if (previewOnly) {
      setInfo(isPreviewDemoMode() ? {
        sellerId: 'demo-brand-1', brandName: 'Northline Studio', username: ref, imageUrl: null,
        program: { enabled: true, commissionPercent: 10, buyerDiscountPercent: 10, windowDays: 30, autoApprove: false },
        mine: null, isOwnBrand: false,
      } : null);
      setError(isPreviewDemoMode() ? null : 'Sign in to join a creator program.');
      setLoading(false);
      return;
    }
    try {
      setInfo(await api.affiliate.brand(ref));
      setError(null);
    } catch (e: any) {
      setError(e?.status === 404 ? 'We couldn\'t find that brand.' : 'retry');
    } finally {
      setLoading(false);
    }
  }, [api, ref, previewOnly]);

  useEffect(() => { void load(); }, [load]);

  const apply = async () => {
    if (!info || saving) return;
    setSaving('apply');
    setActionError(null);
    try {
      const res = previewOnly ? { status: info.program.autoApprove ? 'active' : 'pending' } : await api.affiliate.apply(info.sellerId);
      setApplied(res.status);
    } catch (e) {
      setActionError(friendlyError(e, "Couldn't apply. Try again."));
    } finally {
      setSaving(null);
    }
  };

  // The brand already invited this viewer: answer the invite rather than apply.
  const respond = async (accept: boolean) => {
    if (!info?.mine || saving) return;
    setSaving(accept ? 'accept' : 'decline');
    setActionError(null);
    try {
      const res = previewOnly ? { status: accept ? 'active' : 'declined' } : await api.affiliate.respondToInvite(info.mine.id, accept);
      setApplied(res.status);
    } catch (e) {
      setActionError(friendlyError(e, accept ? "Couldn't accept the invite. Try again." : "Couldn't decline the invite. Try again."));
    } finally {
      setSaving(null);
    }
  };

  const s = useMemo(() => StyleSheet.create({
    content: { paddingHorizontal: SP.md, paddingTop: SP.md },
    name: { fontFamily: FONT.bold, fontSize: FS.xxl, letterSpacing: -0.4, color: theme.text },
    sub: { fontFamily: FONT.regular, fontSize: FS.base, color: theme.muted, marginTop: SP.xs, marginBottom: SP.md, lineHeight: 22 },
  }), [theme]);

  const open = info?.program.enabled && !info.isOwnBrand;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title="Creator program" />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}>
        {loading ? <ActivityIndicator color={theme.text} /> : error === 'retry' ? (
          <RetryRow label="Couldn't load this program" onRetry={load} />
        ) : !info ? (
          <>
            <Text style={s.sub}>{error}</Text>
            <ActionButton label="Open creator program" outline onPress={() => router.replace('/creator-program' as any)} />
          </>
        ) : (
          <>
            <Text style={s.name}>{info.brandName}</Text>
            <Text style={s.sub}>
              {info.isOwnBrand
                ? "This is your own brand, so you can't join its program."
                : info.program.enabled
                  ? `Promote ${info.brandName} and earn a commission on every order you bring in.`
                  : `${info.brandName} isn't accepting creators right now.`}
            </Text>
            {open ? (
              <Card>
                <KeyStatRow label="Commission" value={pct(info.program.commissionPercent)} />
                <KeyStatRow label="Buyer discount" value={info.program.buyerDiscountPercent > 0 ? `${pct(info.program.buyerDiscountPercent)} off` : 'None'} />
                <KeyStatRow label="Attribution window" value={`${info.program.windowDays} days`} last />
              </Card>
            ) : null}
            {applied ? (
              <>
                <Text style={s.sub}>
                  {applied === 'active' ? 'You\'re in. Your code and link are ready.'
                    : applied === 'declined' ? 'Invite declined.'
                      : 'Application sent. The brand will review it.'}
                </Text>
                <ActionButton label="Open creator program" outline={applied === 'declined'} onPress={() => router.replace('/creator-program' as any)} />
              </>
            ) : open ? (
              info.mine?.status === 'invited' ? (
                <>
                  <Text style={s.sub}>{info.brandName} invited you to their creator program.</Text>
                  <View style={{ flexDirection: 'row', gap: SP.sm }}>
                    <ActionButton label="Accept invite" flex loading={saving === 'accept'} loadingLabel="Accepting…" disabled={saving === 'decline'} onPress={() => respond(true)} />
                    <ActionButton label="Decline" flex outline loading={saving === 'decline'} loadingLabel="Declining…" disabled={saving === 'accept'} onPress={() => respond(false)} />
                  </View>
                </>
              ) : info.mine && info.mine.status !== 'removed' && info.mine.status !== 'declined' ? (
                // A pending application has no code yet — don't promise one.
                <ActionButton label={info.mine.status === 'pending' ? 'View your application' : 'View your code'} onPress={() => router.replace('/creator-program' as any)} />
              ) : (
                <ActionButton
                  label={info.program.autoApprove ? 'Join program' : 'Apply'}
                  loading={saving === 'apply'}
                  onPress={apply}
                />
              )
            ) : null}
            <InlineError message={actionError} style={{ marginTop: SP.md }} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
