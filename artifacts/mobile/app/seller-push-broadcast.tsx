/**
 * Seller -> followers push. Compose (title, message, optional link), review a
 * live notification preview, then send. One broadcast per rolling 24 hours,
 * enforced by the server; this screen shows when the next one opens.
 * Mobbin reference: Instagram "New reel" share form (rows + bottom Share button).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { ListRow } from '@/components/ui/ListRow';
import { OptionSheet } from '@/components/ui/OptionSheet';
import { SectionHeader } from '@/components/SectionHeader';
import { FONT, FS, SP } from '@/lib/theme';
import { formatNextSend } from '@/lib/sellerEngagement';

const TITLE_MAX = 50;
const BODY_MAX = 178;

type LinkOption = { id: string; label: string; type: 'product' | 'drop' | 'post' | 'none'; refId: string | null };

export default function SellerPushBroadcastScreen() {
  const api = useApi();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
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

  const limited = status && !status.canSendNow;
  const valid = title.trim().length > 0 && body.trim().length > 0;
  const payload = useMemo(() => ({
    title: title.trim(), body: body.trim(),
    deeplinkType: link.type === 'none' ? null : link.type, deeplinkId: link.refId,
  }), [title, body, link]);

  async function onReview() {
    setBusy(true); setError(null);
    try {
      setReview(await api.sellerPush.preview(payload));
    } catch (e: any) {
      setError(e?.message || 'Could not review this message.');
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
      setError(e?.message || 'Could not send.');
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
      <ScreenHeader title="Follower push" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 140 }} keyboardShouldPersistTaps="handled">
          {loading ? <ActivityIndicator color={c.foreground} style={{ marginVertical: 40 }} /> : loadError ? (
            <View style={{ gap: SP.sm }}>
              <Text style={[styles.note, { color: c.mutedForeground }]}>Couldn't load your push status.</Text>
              <Button label="Try again" variant="secondary" onPress={() => { setLoading(true); load(); }} />
            </View>
          ) : (
            <>
              <Text style={[styles.lead, { color: c.foreground }]}>
                {limited
                  ? `You can send your next push ${formatNextSend(status.nextSendAt)}.`
                  : `Send one push to your ${status?.audience?.recipients ?? 0} reachable followers. You can send one every 24 hours.`}
              </Text>

              {sent ? (
                <View style={[styles.banner, { borderColor: c.border }]}>
                  <Feather name="check-circle" size={18} color={c.success} />
                  <Text style={[styles.note, { color: c.foreground, flex: 1 }]}>
                    Sent to {sent.delivery.sent} followers. Your next push opens {formatNextSend(sent.nextSendAt)}.
                  </Text>
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
                  <ListRow icon="link" title="Link" value={link.type === 'none' ? 'None' : link.type === 'product' ? 'Product' : link.type === 'drop' ? 'Drop' : 'Post'} chevron onPress={() => setSheet(true)} />
                  <SectionHeader title="Preview" />
                  {previewCard(title, body)}
                </>
              ) : null}

              {review ? (
                <>
                  <SectionHeader title="Review" />
                  {previewCard(review.notification.title, review.notification.body)}
                  <Text style={[styles.note, { color: c.mutedForeground, marginTop: SP.sm }]}>
                    Goes to {review.audience.recipients} of your {review.audience.followers} followers. People who muted brand announcements, turned push off or blocked you are skipped.
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
                    <ListRow key={h.id} title={h.title} subtitle={`${h.sentCount} sent · ${formatNextSend(h.createdAt)}`} chevron
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
  count: { fontSize: FS.xs, fontFamily: FONT.regular, textAlign: 'right', marginTop: 4, marginBottom: SP.sm },
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
});
