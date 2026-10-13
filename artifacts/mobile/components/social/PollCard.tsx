/**
 * A Thread's poll, X/Twitter-style (reference: X "Publishing a poll" on
 * Mobbin). Before you vote: one full-width rounded button per choice. After
 * you vote, once the poll ends, or for the author: a bar per choice filled to
 * its share, the percentage on the right, your choice marked with a check,
 * then "N votes · time left" ("Final results" once it ends).
 *
 * `variant="overlay"` sits on the full-screen feed video (white text with the
 * same legibility shadow as the caption above it); `variant="surface"` uses
 * the app theme (post viewer).
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { useSignInGate } from '@/hooks/useSignInGate';
import { formatTimeLeft, formatVotes } from '@/lib/postPolls';
import { usePostPoll, voteInPoll, type PostPoll } from '@/services/postPollService';

type Variant = 'overlay' | 'surface';

export function PollCard({ postId, variant = 'surface', style }: { postId: string; variant?: Variant; style?: any }) {
  const poll = usePostPoll(postId);
  if (!poll) return null;
  return <PollCardView poll={poll} variant={variant} style={style} />;
}

export function PollCardView({ poll, variant = 'surface', style, now }: {
  poll: PostPoll; variant?: Variant; style?: any; now?: number;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme, variant), [theme, variant]);
  const { requireSignIn } = useSignInGate();
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  async function choose(index: number) {
    if (busy !== null || !poll.canVote) return;
    if (!requireSignIn()) return;
    setBusy(index);
    setFailed(false);
    try {
      await voteInPoll(poll.postId, index);
      Haptics.selectionAsync().catch(() => {});
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  const footer = [formatVotes(poll.totalVotes), formatTimeLeft(poll.endsAt, now)].filter(Boolean).join(' · ');

  return (
    <View style={[s.root, style]} testID={`poll-${poll.postId}`}>
      {poll.showResults ? poll.options.map((o, i) => {
        const mine = poll.myVote === i;
        const strong = mine || poll.winner === i;
        return (
          <View key={i} style={s.resultRow} accessible accessibilityLabel={`${o.text}, ${o.percent ?? 0} percent${mine ? ', your vote' : ''}`} testID={`poll-result-${i}`}>
            <View style={[s.fill, strong ? s.fillStrong : s.fillWeak, { width: `${Math.max(o.percent ?? 0, 1.5)}%` }]} />
            <View style={s.resultLabelWrap}>
              <Text style={[s.resultLabel, strong && s.bold]} numberOfLines={1}>{o.text}</Text>
              {mine ? <Feather name="check-circle" size={14} color={s.fg.color} style={s.shadow} /> : null}
            </View>
            <Text style={[s.percent, strong && s.bold]}>{o.percent ?? 0}%</Text>
          </View>
        );
      }) : poll.options.map((o, i) => (
        <Pressable
          key={i}
          onPress={() => { void choose(i); }}
          disabled={busy !== null || !poll.canVote}
          style={({ pressed }) => [s.choice, (pressed || busy === i) && s.choicePressed]}
          accessibilityRole="button"
          accessibilityLabel={`Vote ${o.text}`}
          testID={`poll-choice-${i}`}
        >
          <Text style={s.choiceText} numberOfLines={1}>{o.text}</Text>
        </Pressable>
      ))}
      <Text style={s.footer} testID="poll-footer">{failed ? "Couldn't send your vote. Try again." : footer}</Text>
    </View>
  );
}

function makeStyles(theme: AppThemePreset, variant: Variant) {
  const overlay = variant === 'overlay';
  // Over video the text stays white in every theme (theme.text is white in all presets);
  // scrims use the theme's shadow colour, matching the caption block above it.
  const fg = theme.text;
  const muted = overlay ? theme.text : theme.muted;
  const shadow = overlay
    ? { textShadowColor: `${theme.shadowColor}99`, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }
    : {};
  return StyleSheet.create({
    root: { gap: 8, alignSelf: 'stretch' },
    fg: { color: fg },
    shadow,
    choice: {
      height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: fg,
      alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16,
      backgroundColor: overlay ? `${theme.shadowColor}4D` : 'transparent',
    },
    choicePressed: { backgroundColor: overlay ? `${theme.text}2E` : theme.borderSubtle },
    choiceText: { color: fg, fontFamily: FONT.semibold, fontSize: 15, ...shadow },
    resultRow: { height: 34, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 8 },
    fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 6 },
    fillStrong: { backgroundColor: overlay ? `${theme.text}73` : `${theme.text}47` },
    fillWeak: { backgroundColor: overlay ? `${theme.text}38` : `${theme.text}1F` },
    resultLabelWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
    resultLabel: { color: fg, fontFamily: FONT.medium, fontSize: 15, flexShrink: 1, ...shadow },
    percent: { color: fg, fontFamily: FONT.medium, fontSize: 15, ...shadow },
    bold: { fontFamily: FONT.bold },
    footer: { color: muted, fontFamily: FONT.regular, fontSize: 13, ...shadow, opacity: overlay ? 0.9 : 1 },
  });
}
