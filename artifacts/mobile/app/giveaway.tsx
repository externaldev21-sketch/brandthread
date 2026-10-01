/**
 * Giveaway entry page (buyer / shared link). Mobbin reference: Sweatcoin prize
 * screen, "How does it work?" numbered steps with a bottom CTA.
 * Entries are derived server-side from real follows + comments; this screen
 * only shows status and sends people to the follow / comment actions.
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { FONT, FS, SP } from '@/lib/theme';
import { formatDay, timeLeft } from '@/lib/sellerEngagement';

export default function GiveawayScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const api = useApi();
  const router = useRouter();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [g, setG] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [rules, setRules] = useState(false);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    api.giveaways.get(String(code)).then((r) => { if (!cancelled) { setG(r); setFailed(false); } }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [api, code]));

  if (failed) return <View style={{ flex: 1, backgroundColor: c.background }}><ScreenHeader title="Giveaway" /><Text style={[styles.note, { color: c.mutedForeground, padding: SP.md }]}>This giveaway isn't available.</Text></View>;
  if (!g) return <View style={{ flex: 1, backgroundColor: c.background }}><ScreenHeader title="Giveaway" /><ActivityIndicator color={c.foreground} style={{ marginTop: 40 }} /></View>;

  const me = g.me;
  const live = g.phase === 'live';
  const steps = [
    { label: `Follow ${g.seller.name}`, done: !!me?.followed },
    ...(g.requiresComment ? [{ label: 'Comment on the featured post', done: !!me?.commented }] : []),
    { label: g.winnerCount === 1 ? '1 winner is drawn at random' : `${g.winnerCount} winners are drawn at random`, done: g.phase === 'drawn' },
  ];
  const openSeller = () => router.push(`/buyer-other-profile?userId=${encodeURIComponent(g.seller.id)}` as never);
  const openPost = () => router.push(`/buyer-post-comments?postId=${encodeURIComponent(g.postId)}` as never);
  const cta = !live ? null : !me ? null
    : !me.followed ? { label: `Follow ${g.seller.name}`, onPress: openSeller }
    : g.requiresComment && !me.commented ? { label: 'Comment to enter', onPress: openPost }
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="Giveaway" />
      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 140 }}>
        <Text style={[styles.meta, { color: c.mutedForeground }]}>
          {g.phase === 'live' ? timeLeft(g.endsAt) : g.phase === 'drawn' ? 'Winners drawn' : g.phase === 'upcoming' ? `Starts ${formatDay(g.startsAt)}` : 'Ended'} · {g.winnerCount === 1 ? '1 winner' : `${g.winnerCount} winners`}
        </Text>
        <Text style={[styles.title, { color: c.foreground }]}>{g.title}</Text>
        <Text style={[styles.prize, { color: c.foreground }]}>{g.prizeText}</Text>
        <Text style={[styles.note, { color: c.mutedForeground }]}>Hosted by {g.seller.name}. No purchase necessary.</Text>

        {g.youWon ? (
          <View style={[styles.banner, { borderColor: c.border }]}>
            <Feather name="award" size={18} color={c.foreground} />
            <Text style={[styles.note, { color: c.foreground, flex: 1 }]}>You won. {g.seller.name} will be in touch about your prize.</Text>
          </View>
        ) : null}

        <Text style={[styles.section, { color: c.foreground }]}>How does it work?</Text>
        {steps.map((s, i) => (
          <View key={i} style={styles.step}>
            <View style={[styles.stepDot, { borderColor: c.border, backgroundColor: s.done ? c.foreground : 'transparent' }]}>
              {s.done ? <Feather name="check" size={13} color={c.background} /> : <Text style={[styles.stepNum, { color: c.foreground }]}>{i + 1}</Text>}
            </View>
            <Text style={[styles.stepText, { color: c.foreground }]}>{s.label}</Text>
          </View>
        ))}

        {me && live ? (
          <Text style={[styles.note, { color: c.mutedForeground, marginTop: SP.sm }]}>
            {me.eligible ? "You're entered." : me.excludedReason === 'blocked' || me.excludedReason === 'seller' ? "You can't enter this giveaway." : 'Finish the steps above to be entered.'}
          </Text>
        ) : null}

        {g.winners.length > 0 ? (
          <>
            <Text style={[styles.section, { color: c.foreground }]}>Winners</Text>
            {g.winners.map((w: any, i: number) => <Text key={i} style={[styles.note, { color: c.foreground }]}>{w.name}{w.handle ? `  @${w.handle}` : ''}</Text>)}
          </>
        ) : null}

        {cta ? <View style={{ marginTop: SP.lg }}><Button label={cta.label} fullWidth onPress={cta.onPress} /></View> : null}
        <Button label={rules ? 'Hide official rules' : 'Official rules'} variant="tertiary" onPress={() => setRules((v) => !v)} />
        {rules ? <Text style={[styles.note, { color: c.mutedForeground }]}>{g.rulesText}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  meta: { fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: 8 },
  title: { fontSize: FS.xxl, fontFamily: FONT.bold, lineHeight: 32 },
  prize: { fontSize: FS.base, fontFamily: FONT.semibold, marginTop: 8, marginBottom: 4 },
  note: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
  section: { fontSize: FS.base, fontFamily: FONT.bold, marginTop: SP.lg, marginBottom: SP.sm },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  stepDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepNum: { fontSize: FS.xs, fontFamily: FONT.bold },
  stepText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium },
  banner: { flexDirection: 'row', gap: 10, alignItems: 'center', borderWidth: 1, borderRadius: 12, padding: 14, marginTop: SP.md },
});
