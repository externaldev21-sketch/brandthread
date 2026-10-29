import { CachedImage as Image } from '@/components/CachedImage';
/**
 * Email campaign composer (Shopify Email-style stacked fields): audience, subject,
 * preview text, headline, text, image, up to 3 product cards, button, live preview,
 * test send, send now or schedule. Route: /email-campaign-compose?id=
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { SP } from '@/lib/theme';
import { RetryRow } from '@/components/ui/RetryRow';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { promptUpgradeOnPlanGate } from '@/lib/planUpgradePrompt';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { friendlyError } from '@/lib/friendlyError';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useApi, type EmailAudience, type EmailCampaignBody, type EmailMarketingStatus } from '@/lib/api';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/BrandthreadUI';
import { Field, Heading, Notice, SolidButton } from '@/components/email/EmailUI';
import {
  AUDIENCE_LABEL, CTA_LABEL_MAX, DEMO_AUDIENCE, DEMO_CAMPAIGNS, DEMO_SETTINGS, DEMO_STATUS, EMPTY_AUDIENCE, FRESH_STATUS,
  HEADLINE_MAX, MAX_PRODUCT_CARDS, PREHEADER_MAX, SUBJECT_MAX, TEXT_MAX, emailMode, emptyBody,
} from '@/lib/emailMarketing';
import { getPreviewSellerProducts } from '@/lib/previewSellerProducts';
import { FONT, FS, ICON, RADIUS } from '@/lib/theme';
import { formatMoney } from '@/lib/format';

type PickProduct = { id: string; name: string; image: string | null; priceCents: number | null };

export default function EmailCampaignComposeScreen() {
  const c = useColors();
  const api = useApi();
  const router = useRouter();
  const { id: routeId } = useLocalSearchParams<{ id?: string }>();
  const mode = emailMode();

  const [id, setId] = useState<string | null>(routeId ? String(routeId) : null);
  const [loading, setLoading] = useState(!!routeId);
  const [subject, setSubject] = useState('');
  const [preheader, setPreheader] = useState('');
  const [audience, setAudience] = useState<EmailAudience>('subscribers');
  const [body, setBody] = useState<EmailCampaignBody>(emptyBody());
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [counts, setCounts] = useState<Record<EmailAudience, number> | null>(null);
  const [status, setStatus] = useState<EmailMarketingStatus | null>(null);
  const [missingAddress, setMissingAddress] = useState(false);
  const [productsList, setProductsList] = useState<PickProduct[]>([]);
  // Schedule and Send now are separate so only the tapped button spins.
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'schedule' | 'send'>(null);
  const [storeName, setStoreName] = useState('Your store');
  // A failed load must not leave an empty, editable form: saving it would
  // overwrite the stored campaign with blanks.
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  // Form contents as last loaded or saved; null until the load settles, so
  // the guard only compares against what's actually stored.
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  // Navigation that waits one render after a save, so the guard has already
  // seen the form as clean and doesn't ask to discard what was just saved.
  const [leaveTo, setLeaveTo] = useState<null | 'back' | string>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      setLoadError(false);
      try {
        if (mode !== 'live') {
          setStatus(mode === 'demo' ? DEMO_STATUS : FRESH_STATUS);
          setCounts((mode === 'demo' ? DEMO_AUDIENCE : EMPTY_AUDIENCE).counts);
          setMissingAddress(mode === 'demo' ? !DEMO_SETTINGS.postalAddress : true);
          if (mode === 'demo') {
            setStoreName(DEMO_SETTINGS.fromName || DEMO_SETTINGS.defaultFromName);
            setProductsList(getPreviewSellerProducts().slice(0, 4).map((p: any) => ({
              id: p.id, name: p.name, image: null, priceCents: p.priceCents ?? p.variants?.[0]?.priceCents ?? null,
            })));
            const d = DEMO_CAMPAIGNS.find((x) => x.id === routeId);
            if (d) {
              setSubject(d.subject); setPreheader(d.preheader); setAudience(d.audience); setBody(d.body);
              setCtaLabel(d.body.cta?.label ?? ''); setCtaUrl(d.body.cta?.url ?? '');
            }
          }
          return;
        }
        const [s, a, prods, settings] = await Promise.all([
          api.emailMarketing.status(), api.emailMarketing.audience(), api.products.list() as Promise<any[]>, api.emailMarketing.settings(),
        ]);
        if (off) return;
        setStatus(s); setCounts(a.counts); setMissingAddress(!settings.postalAddress.trim());
        setStoreName(settings.fromName?.trim() || settings.defaultFromName || 'Your store');
        setProductsList((Array.isArray(prods) ? prods : []).map((p: any) => ({
          id: p.id, name: p.name,
          image: Array.isArray(p.images) && typeof p.images[0] === 'string' && p.images[0].startsWith('https://') ? p.images[0] : null,
          priceCents: p.variants?.[0]?.priceCents ?? p.priceCents ?? null,
        })));
        if (routeId) {
          const cmp = await api.emailMarketing.campaign(String(routeId));
          if (off) return;
          setSubject(cmp.subject); setPreheader(cmp.preheader); setAudience(cmp.audience); setBody(cmp.body);
          setCtaLabel(cmp.body.cta?.label ?? ''); setCtaUrl(cmp.body.cta?.url ?? '');
        }
      } catch {
        if (!off) setLoadError(true);
      } finally { if (!off) setLoading(false); }
    })();
    return () => { off = true; };
  }, [api, routeId, mode, reloadToken]);

  // "Open sender details" pushes /email-settings; re-read the sender settings on
  // return so a newly added mailing address unblocks sending. Only the settings
  // are refetched, so the form being edited is never overwritten.
  const focusedOnce = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!focusedOnce.current) { focusedOnce.current = true; return; }
    if (mode !== 'live') return;
    let off = false;
    api.emailMarketing.settings().then((settings) => {
      if (off) return;
      setMissingAddress(!settings.postalAddress.trim());
      setStoreName(settings.fromName?.trim() || settings.defaultFromName || 'Your store');
    }).catch(() => {});
    return () => { off = true; };
  }, [api, mode]));

  const fullBody = useMemo<EmailCampaignBody>(() => ({
    ...body,
    imageUrl: body.imageUrl?.trim() ? body.imageUrl.trim() : null,
    cta: ctaLabel.trim() || ctaUrl.trim() ? { label: ctaLabel.trim(), url: ctaUrl.trim() } : null,
  }), [body, ctaLabel, ctaUrl]);

  const input = { subject: subject.trim(), preheader: preheader.trim(), audience, body: fullBody };

  const snapshot = JSON.stringify([subject, preheader, audience, body, ctaLabel, ctaUrl]);
  useEffect(() => {
    if (!loading && !loadError && savedSnapshot === null) setSavedSnapshot(snapshot);
  }, [loading, loadError, savedSnapshot, snapshot]);
  const dirty = savedSnapshot !== null && snapshot !== savedSnapshot;
  const onBack = useUnsavedChangesGuard(dirty);

  useEffect(() => {
    if (!leaveTo) return;
    setLeaveTo(null);
    if (leaveTo === 'back') router.back();
    else router.replace(leaveTo as never);
  }, [leaveTo, router]);

  const save = async (): Promise<string | null> => {
    if (mode !== 'live') { setSavedSnapshot(snapshot); return id ?? 'preview'; }
    try {
      const saved = id ? await api.emailMarketing.updateCampaign(id, input) : await api.emailMarketing.createCampaign(input);
      setId(saved.id);
      setSavedSnapshot(snapshot);
      return saved.id;
    } catch (e: any) {
      Alert.alert('Not saved', friendlyError(e, "Couldn't save this campaign."));
      return null;
    }
  };

  // One action at a time: buttons only disable after a re-render, and two
  // overlapping saves of a new campaign would each create a campaign.
  const busyRef = useRef(false);
  const run = async (kind: 'save' | 'test' | 'schedule' | 'send', fn: (cid: string) => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    try { const cid = await save(); if (cid) await fn(cid); } finally { busyRef.current = false; setBusy(null); }
  };

  const saveDraft = () => run('save', async () => { setLeaveTo('back'); });

  const sendTest = () => run('test', async (cid) => {
    if (mode !== 'live') return;
    try { const r = await api.emailMarketing.sendTest(cid); Alert.alert('Test sent', `Sent to ${r.sentTo}.`); }
    catch (e: any) { Alert.alert('Test not sent', friendlyError(e, "Couldn't send the test email.")); }
  });

  const doSend = (scheduleAt?: string) => run(scheduleAt ? 'schedule' : 'send', async (cid) => {
    if (mode !== 'live') return;
    try {
      const r = await api.emailMarketing.send(cid, scheduleAt);
      setLeaveTo(`/email-campaign-results?id=${r.id}`);
    } catch (e: any) {
      if (promptUpgradeOnPlanGate(e, router)) return;
      Alert.alert('Not sent', friendlyError(e, "Couldn't send this campaign."));
    }
  });

  const confirmSend = () => {
    const n = counts?.[audience] ?? 0;
    Alert.alert('Send campaign', `Send "${subject.trim()}" to ${n} ${n === 1 ? 'person' : 'people'} now?`, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Send campaign', onPress: () => doSend() },
    ]);
  };

  const schedule = () => {
    const at = (ms: number) => new Date(Date.now() + ms).toISOString();
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
    Alert.alert('Schedule', 'When should it go out?', [
      { text: 'In 1 hour', onPress: () => doSend(at(3600_000)) },
      { text: 'Tomorrow at 9 AM', onPress: () => doSend(tomorrow.toISOString()) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const toggleProduct = (pid: string) => setBody((b) => {
    const has = b.productIds.includes(pid);
    if (!has && b.productIds.length >= MAX_PRODUCT_CARDS) return b;
    return { ...b, productIds: has ? b.productIds.filter((x) => x !== pid) : [...b.productIds, pid] };
  });

  const selected = body.productIds.map((pid) => productsList.find((p) => p.id === pid)).filter(Boolean) as PickProduct[];
  const hasContent = !!(fullBody.headline || fullBody.text || fullBody.imageUrl || fullBody.productIds.length || fullBody.cta);
  const canSend = mode === 'live' && !!status?.enabled && !!subject.trim() && hasContent && !missingAddress && (counts?.[audience] ?? 0) > 0;
  // The full "not set up" message is already the Notice at the top.
  const sendHint = !status?.enabled
    ? 'Sending is unavailable until email is set up.'
    : missingAddress ? 'Add your mailing address in Sender details before sending.'
    : (counts?.[audience] ?? 0) === 0 ? 'No one in this audience can receive email yet.'
    : !subject.trim() ? 'Add a subject line.' : !hasContent ? 'Add some content.' : null;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <ScreenHeader title="Edit campaign" />
        <ActivityIndicator color={c.foreground} style={{ marginTop: 40 }} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <ScreenHeader title={routeId ? 'Edit campaign' : 'New campaign'} />
        <View style={{ padding: SP.md }}>
          <RetryRow label="Couldn't load this campaign" onRetry={() => { setLoading(!!routeId); setSavedSnapshot(null); setReloadToken((n) => n + 1); }} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title={id ? 'Edit campaign' : 'New campaign'} onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: SP.xl }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {status && !status.enabled && <Notice text={status.message ?? 'Email sending isn\'t set up yet. Drafts are saved and nothing is sent.'} />}

        <Text style={[st.label, { color: c.foreground }]}>To</Text>
        <View style={{ marginBottom: 16 }}>
          {(['subscribers', 'customers', 'followers'] as const).map((a) => (
            <PressableScale key={a} onPress={() => setAudience(a)} accessibilityRole="radio" accessibilityState={{ selected: audience === a }} accessibilityLabel={AUDIENCE_LABEL[a]}
              style={[st.audRow, { borderColor: audience === a ? c.foreground : c.border }]}>
              <Text style={{ flex: 1, color: c.foreground, fontFamily: audience === a ? FONT.semibold : FONT.regular, fontSize: FS.md }}>{AUDIENCE_LABEL[a]}</Text>
              <Text style={{ color: c.mutedForeground, fontFamily: FONT.regular, fontSize: FS.sm }}>{counts?.[a] ?? 0}</Text>
              {audience === a && <Icon name="check" size={ICON.sm} color={c.foreground} style={{ marginLeft: 8 }} />}
            </PressableScale>
          ))}
        </View>

        <Field label="Subject" value={subject} onChangeText={setSubject} max={SUBJECT_MAX} />
        <Field label="Preview text" value={preheader} onChangeText={setPreheader} max={PREHEADER_MAX} />

        <Heading>Content</Heading>
        <Field label="Headline" value={body.headline} onChangeText={(t) => setBody({ ...body, headline: t })} max={HEADLINE_MAX} />
        <Field label="Text" value={body.text} onChangeText={(t) => setBody({ ...body, text: t })} max={TEXT_MAX} multiline />
        <Field label="Image link" value={body.imageUrl ?? ''} onChangeText={(t) => setBody({ ...body, imageUrl: t })} autoCapitalize="none" keyboardType="url" placeholder="https://" />

        <Text style={[st.label, { color: c.foreground }]}>Products ({body.productIds.length}/{MAX_PRODUCT_CARDS})</Text>
        <View style={{ marginBottom: 16 }}>
          {productsList.length === 0 ? (
            <Text style={{ color: c.mutedForeground, fontFamily: FONT.regular, fontSize: FS.sm }}>Add products to your store to feature them here.</Text>
          ) : productsList.map((p) => {
            const on = body.productIds.includes(p.id);
            return (
              <PressableScale key={p.id} onPress={() => toggleProduct(p.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={p.name}
                style={[st.audRow, { borderColor: on ? c.foreground : c.border }]}>
                <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontFamily: on ? FONT.semibold : FONT.regular, fontSize: FS.md }}>{p.name}</Text>
                {on && <Icon name="check" size={ICON.sm} color={c.foreground} />}
              </PressableScale>
            );
          })}
        </View>

        <Field label="Button label" value={ctaLabel} onChangeText={setCtaLabel} max={CTA_LABEL_MAX} />
        <Field label="Button link" value={ctaUrl} onChangeText={setCtaUrl} autoCapitalize="none" keyboardType="url" placeholder="https://" />

        <Heading>Preview</Heading>
        <View style={[st.preview, { borderColor: c.border }]}>
          <Text style={[st.pvStore, { color: c.foreground }]}>{storeName}</Text>
          {fullBody.imageUrl ? <Image cachePolicy="memory-disk" source={{ uri: fullBody.imageUrl }} style={st.pvImage} contentFit="cover" /> : null}
          {fullBody.headline ? <Text style={[st.pvHead, { color: c.foreground }]}>{fullBody.headline}</Text> : null}
          {fullBody.text ? <Text style={[st.pvText, { color: c.foreground }]}>{fullBody.text}</Text> : null}
          {selected.length > 0 && (
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {selected.map((p) => (
                <View key={p.id} style={{ flex: 1 }}>
                  <View style={[st.pvThumb, { backgroundColor: c.secondary }]}>
                    {p.image ? <Image cachePolicy="memory-disk" source={{ uri: p.image }} style={{ flex: 1 }} contentFit="cover" /> : null}
                  </View>
                  <Text numberOfLines={2} style={{ color: c.foreground, fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: 6 }}>{p.name}</Text>
                  {p.priceCents != null && <Text style={{ color: c.mutedForeground, fontFamily: FONT.regular, fontSize: FS.sm }}>{formatMoney(p.priceCents)}</Text>}
                </View>
              ))}
            </View>
          )}
          {fullBody.cta?.label ? (
            <View style={[st.pvBtn, { backgroundColor: c.foreground }]}><Text style={{ color: c.background, fontFamily: FONT.bold, fontSize: FS.sm }}>{fullBody.cta.label}</Text></View>
          ) : null}
          {!hasContent && <Text style={{ color: c.mutedForeground, fontFamily: FONT.regular, fontSize: FS.sm }}>Your email appears here as you write it.</Text>}
          <Text style={[st.pvFoot, { color: c.mutedForeground }]}>Unsubscribe link and mailing address are added automatically.</Text>
        </View>

        <Heading>Send</Heading>
        {sendHint && <Text style={{ color: c.mutedForeground, fontFamily: FONT.regular, fontSize: FS.sm, marginBottom: 12, lineHeight: 18 }}>{sendHint}</Text>}
        {missingAddress && status?.enabled && (
          <View style={{ marginBottom: 12 }}><SolidButton label="Open sender details" outline onPress={() => router.push('/email-settings' as never)} /></View>
        )}
        <View style={{ gap: 10 }}>
          <SolidButton label="Send test to me" outline loading={busy === 'test'} disabled={!status?.enabled || !subject.trim() || !hasContent || mode !== 'live'} onPress={sendTest} />
          <SolidButton label="Schedule" outline loading={busy === 'schedule'} disabled={!canSend || busy === 'send'} onPress={schedule} />
          <SolidButton label="Send now" loading={busy === 'send'} disabled={!canSend || busy === 'schedule'} onPress={confirmSend} />
          <SolidButton label="Save draft" outline loading={busy === 'save'} onPress={saveDraft} />
        </View>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  label: { fontFamily: FONT.semibold, fontSize: FS.sm, marginBottom: 6 },
  audRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: 14, minHeight: 48, marginBottom: 8 },
  preview: { borderWidth: 1, borderRadius: RADIUS.md, padding: 16 },
  pvStore: { fontFamily: FONT.bold, fontSize: FS.xs, marginBottom: 16 },
  pvImage: { width: '100%', height: 160, marginBottom: 14 },
  pvHead: { fontFamily: FONT.bold, fontSize: FS.xl, marginBottom: 10 },
  pvText: { fontFamily: FONT.regular, fontSize: FS.md, lineHeight: 22, marginBottom: 14 },
  pvThumb: { aspectRatio: 1, overflow: 'hidden' },
  pvBtn: { alignSelf: 'flex-start', paddingHorizontal: 22, paddingVertical: 13, marginBottom: 16 },
  pvFoot: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 8, lineHeight: 14 },
});
