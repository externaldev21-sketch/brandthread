/**
 * Refer a brand (BT-313): a brand that brings another brand gets a free month
 * on its plan, and so does the new brand, once the new brand's first paid
 * month goes through. Server: /api/seller-referrals (off unless Dev sets
 * SELLER_REFERRAL_ENABLED=true; the Marketing row hides itself until then).
 *
 * Layout reference (one app, copied 1:1, reskinned): NordVPN "Refer a friend"
 * — headline, one line of terms, "How it works" steps, the link with a copy
 * button, and the share button at the bottom. No illustration (Brandthread
 * design rules). Below it, the brands you referred, like NordVPN's
 * referral history.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi, type SellerReferralOverview } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { hapticLight } from '@/lib/haptics';
import { FONT, FS, SP } from '@/lib/theme';

const DEMO: SellerReferralOverview = {
  enabled: true,
  freeMonths: 1,
  code: 'K7M2PQ',
  link: 'https://brandthread.app/invite/K7M2PQ',
  canApplyCode: false,
  referred: [
    { id: 'd1', name: 'Northline Studio', status: 'rewarded', createdAt: '2026-09-02T00:00:00Z' },
    { id: 'd2', name: 'Field Notes Goods', status: 'pending', createdAt: '2026-10-01T00:00:00Z' },
  ],
};

const months = (n: number) => (n === 1 ? 'a free month' : `${n} free months`);

export default function SellerReferScreen() {
  const api = useApi();
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<SellerReferralOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState('');
  const [applyState, setApplyState] = useState<{ busy: boolean; error: string | null; done: boolean }>({ busy: false, error: null, done: false });

  const load = useCallback(() => {
    if (isPreviewDemoMode()) { setData(DEMO); return; }
    setFailed(false);
    api.sellerReferrals.overview().then(setData).catch(() => setFailed(true));
  }, [api]);
  useFocusEffect(load);
  // Program switched off: nothing to show here (the Marketing row is hidden too).
  useEffect(() => { if (data && !data.enabled) router.back(); }, [data, router]);

  if (failed) {
    return (
      <View style={[styles.root, { backgroundColor: c.background }]}>
        <ScreenHeader title="Refer a brand" />
        <View style={styles.center}>
          <Text style={[styles.body, { color: c.mutedForeground, textAlign: 'center' }]}>Couldn't load your referrals.</Text>
          <Button label="Try again" variant="secondary" onPress={load} style={{ marginTop: SP.md }} />
        </View>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={[styles.root, { backgroundColor: c.background }]}>
        <ScreenHeader title="Refer a brand" />
        <ActivityIndicator color={c.foreground} style={{ marginTop: 80 }} />
      </View>
    );
  }
  if (!data.enabled) return <View style={[styles.root, { backgroundColor: c.background }]} />;

  const link = data.link ?? '';
  const free = months(data.freeMonths);
  const copy = async () => {
    hapticLight();
    try { await Clipboard.setStringAsync(link); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ }
  };
  const share = () => {
    hapticLight();
    Share.share({ message: `Sell on Brandthread with me. Use my link and we both get ${free} on our plan: ${link}`, url: link }).catch(() => {});
  };
  const apply = async () => {
    const value = code.trim();
    if (!value) return;
    setApplyState({ busy: true, error: null, done: false });
    try {
      await api.sellerReferrals.apply(value);
      setApplyState({ busy: false, error: null, done: true });
      load();
    } catch (e: any) {
      setApplyState({ busy: false, error: e?.message || "That code didn't work.", done: false });
    }
  };

  const steps = [
    { icon: 'send' as const, title: 'Invite a brand', body: "Share your link with a brand that isn't on Brandthread yet." },
    { icon: 'credit-card' as const, title: 'They start selling', body: 'They pick a plan and pay for their first month after the free trial.' },
    { icon: 'gift' as const, title: `You both get ${free}`, body: 'Credited to your next Brandthread bill.' },
  ];

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <ScreenHeader title="Refer a brand" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: SP.lg, paddingBottom: insets.bottom + 120 }}>
        <Text style={[styles.headline, { color: c.foreground }]}>Get {free} for every brand you refer</Text>
        <Text style={[styles.body, { color: c.mutedForeground }]}>The brand you refer gets {free} too.</Text>

        <Text style={[styles.section, { color: c.foreground }]}>How it works</Text>
        {steps.map((s) => (
          <View key={s.title} style={styles.step}>
            <Feather name={s.icon} size={20} color={c.foreground} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>{s.title}</Text>
              <Text style={[styles.stepBody, { color: c.mutedForeground }]}>{s.body}</Text>
            </View>
          </View>
        ))}

        {link ? (
          <Pressable
            onPress={copy}
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Link copied' : 'Copy your referral link'}
            style={[styles.linkRow, { borderColor: c.border }]}
          >
            <Text style={[styles.link, { color: c.foreground }]} numberOfLines={1}>{link.replace(/^https:\/\//, '')}</Text>
            <Feather name={copied ? 'check' : 'copy'} size={18} color={c.foreground} />
          </Pressable>
        ) : null}

        {data.referred.length > 0 ? (
          <>
            <Text style={[styles.section, { color: c.foreground }]}>Brands you referred</Text>
            {data.referred.map((r) => (
              <View key={r.id} style={[styles.refRow, { borderBottomColor: c.border }]}>
                <Text style={[styles.refName, { color: c.foreground }]} numberOfLines={1}>{r.name}</Text>
                <Text style={[styles.refStatus, { color: c.mutedForeground }]}>
                  {r.status === 'rewarded' ? 'Free month earned' : r.status === 'capped' ? 'Limit reached' : 'Waiting for first paid month'}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {data.canApplyCode && !applyState.done ? (
          <>
            <Text style={[styles.section, { color: c.foreground }]}>Referred by a brand?</Text>
            <View style={styles.applyRow}>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
                placeholder="Their code"
                placeholderTextColor={c.mutedForeground}
                autoCapitalize="characters"
                autoCorrect={false}
                style={[styles.input, { color: c.foreground, borderColor: c.border }]}
                accessibilityLabel="Referral code from another brand"
              />
              <Button label="Add" variant="secondary" size="small" loading={applyState.busy} onPress={apply} disabled={!code.trim()} />
            </View>
            {applyState.error ? <Text style={[styles.stepBody, { color: c.mutedForeground, marginTop: 6 }]}>{applyState.error}</Text> : null}
          </>
        ) : null}
        {applyState.done ? (
          <Text style={[styles.body, { color: c.mutedForeground, marginTop: SP.md }]}>Code added. You both get {free} after your first paid month.</Text>
        ) : null}
      </ScrollView>
      {link ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + SP.sm, backgroundColor: c.background }]}>
          <Button label="Share link" fullWidth onPress={share} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.lg },
  headline: { fontSize: FS.h2, fontFamily: FONT.bold, lineHeight: 36, marginTop: SP.md },
  body: { fontSize: FS.base, fontFamily: FONT.regular, lineHeight: 21, marginTop: SP.sm },
  section: { fontSize: FS.md, fontFamily: FONT.semibold, marginTop: SP.xl, marginBottom: SP.sm },
  step: { flexDirection: 'row', gap: SP.md, paddingVertical: 10 },
  stepTitle: { fontSize: FS.base, fontFamily: FONT.semibold },
  stepBody: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18, marginTop: 2 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: SP.md, minHeight: 50, marginTop: SP.lg },
  link: { flex: 1, fontSize: FS.base, fontFamily: FONT.regular },
  refRow: { minHeight: 56, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  refName: { fontSize: FS.base, fontFamily: FONT.medium },
  refStatus: { fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 2 },
  applyRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'center' },
  input: { flex: 1, minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: SP.md, fontSize: FS.base, fontFamily: FONT.regular },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: SP.lg, paddingTop: SP.sm },
});
