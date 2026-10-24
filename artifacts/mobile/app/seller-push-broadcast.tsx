/**
 * Seller -> followers push. Compose (title, message, optional link), review a
 * live notification preview, then send. One broadcast per rolling 24 hours,
 * enforced by the server; this screen shows when the next one opens.
 * Mobbin reference: Instagram "New reel" share form (rows + bottom Share button).
 * Audience picker (Followers / Past buyers): Instagram "Audience" screen rows.
 * Past buyers have their own server-enforced window (one per 7 days, capped
 * recipients) next to the follower push's 24 hours.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { RetryRow } from '@/components/ui/RetryRow';
import { ListRow } from '@/components/ui/ListRow';
import { OptionSheet } from '@/components/ui/OptionSheet';
import { SectionHeader } from '@/components/SectionHeader';
import { FONT, FS, SP } from '@/lib/theme';
import { formatDay, formatNextSend, pushLinkLabel } from '@/lib/sellerEngagement';
import { friendlyError } from '@/lib/friendlyError';
import { PressableScale } from '@/components/BrandthreadUI';
import { hapticSelection } from '@/lib/haptics';

const TITLE_MAX = 50;
const BODY_MAX = 178;

type LinkOption = { id: string; label: string; type: 'product' | 'drop' | 'post' | 'none'; refId: string | null };

// Audience picker (Instagram "Audience" rows: icon, title, subtitle, radio).
// Each audience has its own server-enforced window.
type Audience = 'followers' | 'past_buyers';
const AUDIENCE_WINDOW_MS: Record<Audience, number> = { followers: 24 * 3600_000, past_buyers: 7 * 24 * 3600_000 };
const AUDIENCE_NOUN: Record<Audience, [string, string]> = { followers: ['follower', 'followers'], past_buyers: ['past buyer', 'past buyers'] };
const people = (n: number, a: Audience) => `${n.toLocaleString()} ${AUDIENCE_NOUN[a][n === 1 ? 0 : 1]}`;

export default function SellerPushBroadcastScreen() {
  const api = useApi();
  const router = useRouter();
  const colors = useColors();
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState<LinkOption>({ id: 'none', label: 'None', type: 'none', refId: null });
  const [linkOptions, setLinkOptions] = useState<LinkOption[]>([]);
  const [sheet, setSheet] = useState(false);
  const [review, setReview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<any>(null);
  // A sent push clears the form, so only an unsent title or message counts.
  const onBack = useUnsavedChangesGuard(title.trim().length > 0 || body.trim().length > 0);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      setStatus(await api.sellerPush.status());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const opts: LinkOption[] = [{ id: 'none', label: 'None', type: 'none', refId: null }];
      const [products, drops, posts] = await Promise.allSettled([api.products.list(), api.drops.list(), api.sellerGiveaways.myPosts()]);
      if (products.status === 'fulfilled' && Array.isArray(products.value)) {
        for (const p of (products.value as any[]).filter((x) => x.status === 'active').slice(0, 8)) opts.push({ id: `product:${p.id}`, label: p.name, type: 'product', refId: p.id });
      }
      if (drops.status === 'fulfilled' && Array.isArray(drops.value)) {
        for (const d of (drops.value as any[]).filter((x) => x.status === 'active').slice(0, 5)) opts.push({ id: `drop:${d.id}`, label: d.name, type: 'drop', refId: d.id });
      }
      if (posts.status === 'fulfilled' && Array.isArray(posts.value)) {
        for (const p of (posts.value as any[]).filter((x) => x.postStatus === 'published' || x.status === 'published').slice(0, 5)) opts.push({ id: `post:${p.id}`, label: p.caption || 'Untitled post', type: 'post', refId: p.id });
      }
      if (!cancelled) setLinkOptions(opts);
    })();
    return () => { cancelled = true; };
  }, [api]);

  const [audience, setAudience] = useState<Audience>('followers');
  // Older servers don't report a past-buyer audience: offer followers only.
  const hasPastBuyers = !!status?.pastBuyers;
  const selected = audience === 'past_buyers' ? status?.pastBuyers : status;
  const limited = selected && !selected.canSendNow;
  const valid = title.trim().length > 0 && body.trim().length > 0;
  const payload = useMemo(() => ({
    title: title.trim(), body: body.trim(),
    deeplinkType: link.type === 'none' ? null : link.type, deeplinkId: link.refId,
    audience,
  }), [title, body, link, audience]);

  function chooseAudience(next: Audience) {
    if (next === audience) return;
    hapticSelection();
    setAudience(next);
    setReview(null);
    setError(null);
  }

  async function onReview() {
    setBusy(true); setError(null);
    try {
      setReview(await api.sellerPush.preview(payload));
    } catch (e: any) {
      setError(friendlyError(e, "Couldn't review this push."));
    } finally { setBusy(false); }
  }

  async function onSend() {
    setBusy(true); setError(null);
    try {
      const res = await api.sellerPush.send(payload);
      setSent(res);
      setReview(null); setTitle(''); setBody('');
      load();
    } catch (e: any) {
      setError(friendlyError(e, "Couldn't send this push."));
      load();
    } finally { setBusy(false); }
  }

  const c = colors;
  const previewCard = (t: string, b: string) => (
    <View style={[styles.preview, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={[styles.appDot, { backgroundColor: c.foreground }]}><Text style={[styles.appDotText, { color: c.background }]}>B</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.previewTitle, { color: c.foreground }]} >{t || 'Your title'}</Text>
        <Text style={[styles.previewBody, { color: c.mutedForeground }]}>{b || 'Your message shows here.'}</Text>
      </View>
      <Text style={[styles.previewNow, { color: c.mutedForeground }]}>now</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="Follower push" onBack={onBack} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: SP.xl }} keyboardShouldPersistTaps="handled">
          {loading ? <ActivityIndicator color={c.foreground} style={{ marginVertical: 40 }} /> : loadError ? (
            <RetryRow label="Couldn't load follower push" onRetry={() => { setLoading(true); load(); }} />
          ) : (
            <>
              <Text style={[styles.lead, { color: c.foreground }]}>
                {audience === 'past_buyers'
                  ? limited
                    ? `You can message past buyers again ${formatNextSend(selected.nextSendAt)}.`
                    : (selected?.audience?.recipients ?? 0) > 0
                      ? `Send one push to ${people(selected.audience.recipients, 'past_buyers')} who can receive it. You can send one every 7 days.`
                      : 'None of your past buyers can receive a push yet. You can send one every 7 days.'
                  : limited
                    ? `You can send your next push ${formatNextSend(status.nextSendAt)}.`
                    : (status?.audience?.recipients ?? 0) > 0
                      ? `Send one push to ${people(status.audience.recipients, 'followers')} who can receive it. You can send one every 24 hours.`
                      : 'None of your followers can receive a push yet. You can send one every 24 hours.'}
              </Text>

              {sent ? (
                <View style={[styles.banner, { borderColor: c.border }]}>
                  <Icon name="check-circle" size={18} color={c.success} />
                  <Text style={[styles.note, { color: c.foreground, flex: 1 }]}>
                    Sent to {people(sent.delivery.sent ?? 0, sent.audienceType === 'past_buyers' ? 'past_buyers' : 'followers')}. Your next push opens {formatNextSend(sent.nextSendAt)}.
                  </Text>
                </View>
              ) : null}

              {hasPastBuyers && !review ? (
                <View style={styles.audienceGroup} accessibilityRole="radiogroup">
                  <SectionHeader title="Audience" />
                  {([
                    { key: 'followers', icon: 'users', label: 'Followers', state: status },
                    { key: 'past_buyers', icon: 'shopping-bag', label: 'Past buyers', state: status.pastBuyers },
                  ] as const).map((a) => {
                    const checked = audience === a.key;
                    const reach = a.state?.audience?.recipients ?? 0;
                    const sub = a.state && !a.state.canSendNow && a.state.nextSendAt
                      ? `Next one ${formatNextSend(a.state.nextSendAt)}`
                      : `${reach.toLocaleString()} reachable · 1 every ${a.key === 'past_buyers' ? '7 days' : '24 hours'}`;
                    return (
                      <PressableScale key={a.key} onPress={() => chooseAudience(a.key)} style={styles.audienceRow}
                        accessibilityRole="radio" accessibilityLabel={`${a.label}, ${sub}`} accessibilityState={{ checked }}>
                        <Icon name={a.icon} size={20} color={c.foreground} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.audienceTitle, { color: c.foreground }]}>{a.label}</Text>
                          <Text style={[styles.audienceSub, { color: c.mutedForeground }]} numberOfLines={1}>{sub}</Text>
                        </View>
                        <View style={[styles.radio, { borderColor: checked ? c.foreground : c.border }]}>
                          {checked ? <View style={[styles.radioDot, { backgroundColor: c.foreground }]} /> : null}
                        </View>
                      </PressableScale>
                    );
                  })}
                </View>
              ) : null}

              {!limited && !review ? (
                <>
                  <Text style={[styles.label, { color: c.mutedForeground }]}>Title</Text>
                  <TextInput returnKeyType="done" value={title} onChangeText={(t) => setTitle(t.slice(0, TITLE_MAX))} placeholder="New drop Friday" placeholderTextColor={c.mutedForeground}
                    style={[styles.input, { color: c.foreground, borderColor: c.border }]} accessibilityLabel="Push title" />
                  <Text style={[styles.count, { color: c.mutedForeground }]}>{title.length}/{TITLE_MAX}</Text>
                  <Text style={[styles.label, { color: c.mutedForeground }]}>Message</Text>
                  <TextInput value={body} onChangeText={(t) => setBody(t.slice(0, BODY_MAX))} multiline placeholder="Doors open at 6pm. Limited stock." placeholderTextColor={c.mutedForeground}
                    style={[styles.input, styles.multiline, { color: c.foreground, borderColor: c.border }]} accessibilityLabel="Push message" />
                  <Text style={[styles.count, { color: c.mutedForeground }]}>{body.length}/{BODY_MAX}</Text>
                  <ListRow icon="link" title="Link" value={pushLinkLabel(link)} chevron onPress={() => setSheet(true)} />
                  <SectionHeader title="Preview" />
                  {previewCard(title, body)}
                </>
              ) : null}

              {review ? (
                <>
                  <SectionHeader title="Review" />
                  {previewCard(review.notification.title, review.notification.body)}
                  <Text style={[styles.note, { color: c.mutedForeground, marginTop: SP.sm }]}>
                    {review.audienceType === 'past_buyers'
                      ? `Goes to ${review.audience.recipients} of your ${review.audience.buyers} past buyers.${review.audience.eligible > review.audience.recipients ? ` Your ${review.audience.cap.toLocaleString()} most recent buyers get it.` : ''} People who muted brand announcements, turned push off or blocked you are skipped.`
                      : `Goes to ${review.audience.recipients} of your ${review.audience.followers} followers. People who muted brand announcements, turned push off or blocked you are skipped.`}
                  </Text>
                  <Text style={[styles.note, { color: c.mutedForeground, marginTop: SP.sm }]}>
                    {review.canSendNow
                      ? `After this, your next one opens ${formatNextSend(new Date(Date.now() + AUDIENCE_WINDOW_MS[audience]).toISOString())}.`
                      : review.nextSendAt ? `Your next one opens ${formatNextSend(review.nextSendAt)}.` : ''}
                  </Text>
                </>
              ) : null}

              {!limited ? (
                <View style={styles.actions}>
                  {review ? (
                    <View style={{ flexDirection: 'row', gap: SP.sm }}>
                      <View style={{ flex: 1 }}><Button label="Edit" variant="secondary" fullWidth onPress={() => setReview(null)} /></View>
                      <View style={{ flex: 1 }}><Button label={`Send to ${review.audience.recipients}`} fullWidth loading={busy} disabled={!review.canSendNow || review.audience.recipients === 0} onPress={onSend} /></View>
                    </View>
                  ) : (
                    <Button label="Review" fullWidth loading={busy} disabled={!valid} onPress={onReview} />
                  )}
                </View>
              ) : null}

              {error ? <Text style={[styles.error, { color: c.destructive }]}>{error}</Text> : null}

              {status?.history?.length ? (
                <>
                  <SectionHeader title="Past pushes" />
                  {status.history.map((h: any) => (
                    <ListRow key={h.id} title={h.title} subtitle={`${h.audience === 'past_buyers' ? 'Past buyers · ' : ''}${h.sentCount} sent · ${formatDay(h.createdAt)}`} chevron
                      onPress={() => router.push(`/seller-push-broadcast-results?id=${encodeURIComponent(h.id)}` as never)} />
                  ))}
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>


      <OptionSheet
        visible={sheet} onClose={() => setSheet(false)} title="Link" description="Where the notification opens."
        options={(linkOptions.length ? linkOptions : [link]).map((o) => ({ id: o.id, label: o.label }))}
        selectedId={link.id}
        onSelect={(id) => { const o = linkOptions.find((x) => x.id === id); if (o) setLink(o); setSheet(false); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: FS.base, fontFamily: FONT.semibold, marginBottom: SP.md, lineHeight: 22 },
  label: { fontSize: FS.xs, fontFamily: FONT.medium, marginTop: SP.md, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: FS.base, fontFamily: FONT.regular },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  count: { fontSize: FS.xs, fontFamily: FONT.regular, textAlign: 'right', marginTop: 4, marginBottom: SP.sm, fontVariant: ['tabular-nums'] },
  note: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
  error: { fontSize: FS.sm, fontFamily: FONT.medium, marginTop: SP.md },
  banner: { flexDirection: 'row', gap: 10, alignItems: 'center', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: SP.md },
  preview: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderWidth: 1, borderRadius: 16, padding: 12 },
  appDot: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  appDotText: { fontFamily: FONT.bold, fontSize: FS.sm },
  previewTitle: { fontFamily: FONT.semibold, fontSize: FS.sm },
  previewBody: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2 },
  previewNow: { fontFamily: FONT.regular, fontSize: FS.xs },
  actions: { marginTop: SP.lg, marginBottom: SP.sm },
  audienceGroup: { marginBottom: SP.sm },
  audienceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8 },
  audienceTitle: { fontFamily: FONT.medium, fontSize: FS.base },
  audienceSub: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 12, height: 12, borderRadius: 6 },
});
