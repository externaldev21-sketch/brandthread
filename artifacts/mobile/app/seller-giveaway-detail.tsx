/** Seller view of one giveaway: entries, share link, end / draw, winners, redraw, shipped. */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { ListRow } from '@/components/ui/ListRow';
import { SectionHeader } from '@/components/SectionHeader';
import { FONT, FS, SP } from '@/lib/theme';
import { formatDay, phaseLabel, timeLeft } from '@/lib/sellerEngagement';

export default function SellerGiveawayDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [g, setG] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [redrawFor, setRedrawFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try { setG(await api.sellerGiveaways.get(String(id))); setFailed(false); } catch { setFailed(true); }
  }, [api, id]);
  useEffect(() => { load(); }, [load]);

  async function run(key: string, fn: () => Promise<any>) {
    setBusy(key); setError(null);
    try { const r = await fn(); if (r && r.winners) setG(r); else await load(); } catch (e: any) { setError(e?.message || 'Something went wrong.'); await load(); } finally { setBusy(null); }
  }

  if (failed) return <View style={{ flex: 1, backgroundColor: c.background }}><ScreenHeader title="Giveaway" /><Text style={[styles.note, { color: c.mutedForeground, padding: SP.md }]}>Couldn't load this giveaway.</Text></View>;
  if (!g) return <View style={{ flex: 1, backgroundColor: c.background }}><ScreenHeader title="Giveaway" /><ActivityIndicator color={c.foreground} style={{ marginTop: 40 }} /></View>;

  const active = g.winners.filter((w: any) => w.status === 'active');
  const replaced = g.winners.filter((w: any) => w.status === 'replaced');

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="Giveaway" />
      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: c.foreground }]}>{g.title}</Text>
        <Text style={[styles.note, { color: c.mutedForeground }]}>{g.prizeText}</Text>
        <Text style={[styles.meta, { color: c.mutedForeground }]}>
          {phaseLabel(g.phase)}{g.phase === 'live' ? ` · ${timeLeft(g.endsAt)}` : ` · ends ${formatDay(g.endsAt)}`}
        </Text>

        <View style={[styles.grid, { borderColor: c.border }]}>
          <View style={styles.cell}><Text style={[styles.value, { color: c.foreground }]}>{g.entries.eligible}</Text><Text style={[styles.label, { color: c.mutedForeground }]}>Eligible entries</Text></View>
          <View style={[styles.cell, { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.border }]}><Text style={[styles.value, { color: c.foreground }]}>{g.winnerCount}</Text><Text style={[styles.label, { color: c.mutedForeground }]}>{g.winnerCount === 1 ? 'Winner' : 'Winners'}</Text></View>
        </View>

        <ListRow icon="link" title="Share link" subtitle={g.shareUrl.replace('https://', '')} right={<Button label={copied ? 'Copied' : 'Copy'} size="compact" variant="secondary" onPress={async () => { await Clipboard.setStringAsync(g.shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }} />} />
        <View style={{ height: SP.sm }} />
        <View style={{ marginBottom: SP.md }}><Button label="Share giveaway" icon="share-2" variant="secondary" fullWidth onPress={() => { Share.share({ message: `${g.title} — ${g.shareUrl}` }).catch(() => {}); }} /></View>

        {g.phase === 'live' ? <View style={{ marginTop: SP.md }}><Button label="End now" variant="secondary" fullWidth loading={busy === 'end'} onPress={() => run('end', () => api.sellerGiveaways.end(g.id))} /></View> : null}
        {g.phase === 'ended' ? <View style={{ marginTop: SP.md }}><Button label={`Draw ${g.winnerCount === 1 ? 'winner' : `${g.winnerCount} winners`}`} fullWidth loading={busy === 'draw'} disabled={g.entries.eligible === 0} onPress={() => run('draw', () => api.sellerGiveaways.draw(g.id))} /></View> : null}
        {g.phase === 'ended' && g.entries.eligible === 0 ? <Text style={[styles.note, { color: c.mutedForeground, marginTop: 8 }]}>No one is eligible yet, so there is nothing to draw from.</Text> : null}
        {error ? <Text style={[styles.error, { color: c.destructive }]}>{error}</Text> : null}

        {active.length > 0 ? (
          <>
            <SectionHeader title="Winners" />
            {active.map((w: any) => (
              <View key={w.id}>
                <ListRow avatar={{ uri: w.avatarUrl, name: w.name }} title={w.name} subtitle={w.shippedAt ? `Shipped ${formatDay(w.shippedAt)}` : (w.handle ? `@${w.handle}` : 'Not shipped')}
                  right={<Button label={w.shippedAt ? 'Unmark' : 'Mark shipped'} size="compact" variant="secondary" loading={busy === `ship${w.id}`}
                    onPress={() => run(`ship${w.id}`, () => api.sellerGiveaways.markShipped(g.id, w.id, !w.shippedAt))} />} />
                {redrawFor === w.id ? (
                  <View style={{ gap: 8, paddingBottom: SP.sm }}>
                    <TextInput value={reason} onChangeText={setReason} placeholder="Reason for redrawing" placeholderTextColor={c.mutedForeground}
                      style={[styles.input, { color: c.foreground, borderColor: c.border }]} accessibilityLabel="Redraw reason" />
                    <Button label="Redraw this winner" variant="secondary" loading={busy === `redraw${w.id}`} disabled={reason.trim().length < 3}
                      onPress={() => run(`redraw${w.id}`, async () => { const r = await api.sellerGiveaways.redraw(g.id, w.id, reason.trim()); setRedrawFor(null); setReason(''); return r; })} />
                  </View>
                ) : <Button label="Redraw" variant="tertiary" size="compact" onPress={() => setRedrawFor(w.id)} />}
              </View>
            ))}
          </>
        ) : null}

        {replaced.length > 0 ? (
          <>
            <SectionHeader title="Replaced winners" />
            {replaced.map((w: any) => <ListRow key={w.id} avatar={{ uri: w.avatarUrl, name: w.name }} title={w.name} subtitle={w.replacedReason ?? ''} />)}
          </>
        ) : null}

        {g.draws.length > 0 ? (
          <>
            <SectionHeader title="Draw log" />
            {g.draws.map((d: any) => (
              <Text key={d.id} style={[styles.note, { color: c.mutedForeground, marginBottom: 6 }]}>
                Draw {d.drawNumber} · {new Date(d.drawnAt).toLocaleString('en-US')} · {d.eligibleCount} eligible · fingerprint {d.eligibleHash.slice(0, 12)}{d.reason ? ` · ${d.reason}` : ''}
              </Text>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: FS.lg, fontFamily: FONT.bold, marginBottom: 4 },
  note: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
  meta: { fontSize: FS.xs, fontFamily: FONT.medium, marginTop: 6, marginBottom: SP.md },
  grid: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, marginBottom: SP.md },
  cell: { flex: 1, paddingVertical: 18, alignItems: 'center', gap: 4 },
  value: { fontSize: FS.xl, fontFamily: FONT.bold },
  label: { fontSize: FS.xs, fontFamily: FONT.regular },
  error: { fontSize: FS.sm, fontFamily: FONT.medium, marginTop: SP.md },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: FS.base, fontFamily: FONT.regular },
});
