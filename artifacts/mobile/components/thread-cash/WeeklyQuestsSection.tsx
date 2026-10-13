/**
 * Weekly quests on the Thread Cash wallet — Duolingo "Quests", reskinned:
 * a section header with the time left, one row per quest (bold title, thick
 * rounded progress bar, "1 / 3" under it, a completion marker on the right),
 * then the reward row with the Thread Cash amount where Duolingo puts the
 * chest. When every quest is done a full-width "Claim $0.50" button appears;
 * after claiming the reward reads as claimed. A small week streak count sits
 * under the card (Duolingo's "Perfect Week").
 *
 * Progress always comes from the server. In the signed-out / dev web preview
 * the protected API is never called: `previewMode` selects local preview data
 * instead ('demo' = a week in progress, 'fresh' = zeros).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { BrandthreadCard } from '@/components/BrandthreadUI';
import { Button, SkeletonBlock } from '@/components/ui';
import { RetryRow } from '@/components/ui/RetryRow';
import {
  allQuestsComplete,
  completedQuestCount,
  isQuestComplete,
  previewWeeklyQuests,
  questFraction,
  timeLeftLabel,
  type WeeklyQuestsStatus,
} from '@/lib/weeklyQuests';

type Props = {
  /** Non-null in the signed-out/dev preview: never call the protected API. */
  previewMode: 'demo' | 'fresh' | null;
  /** Called with the new balance after a claim, so the wallet can refresh. */
  onClaimed?: (balanceCents: number) => void;
};

/** A thick rounded bar whose fill eases to its new width when progress changes. */
function ProgressBar({ fraction, done, styles, theme }: { fraction: number; done: boolean; styles: Styles; theme: AppThemePreset }) {
  const value = useRef(new Animated.Value(fraction)).current;
  useEffect(() => {
    Animated.timing(value, { toValue: fraction, duration: 300, useNativeDriver: false }).start();
  }, [fraction, value]);
  const width = value.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View style={[styles.track, { backgroundColor: theme.borderSubtle }]}>
      <Animated.View style={[styles.fill, { width, backgroundColor: done ? theme.text : theme.muted }]} />
    </View>
  );
}

export function WeeklyQuestsSection({ previewMode, onClaimed }: Props) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const api = useApi();
  const [status, setStatus] = useState<WeeklyQuestsStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Seller-only accounts get 403: the section simply isn't theirs.
  const [hidden, setHidden] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (previewMode) {
      setStatus(previewWeeklyQuests(previewMode === 'demo'));
      setLoadError(false);
      return;
    }
    try {
      setStatus(await api.threadCash.weeklyQuests());
      setLoadError(false);
    } catch (error: any) {
      if (error?.status === 403) setHidden(true);
      else setLoadError(true);
    }
  }, [api, previewMode]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const claim = useCallback(async () => {
    if (previewMode || claiming) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const result = await api.threadCash.claimWeeklyQuests();
      setStatus({
        weekKey: result.weekKey,
        endsAt: result.endsAt,
        quests: result.quests,
        rewardCents: result.rewardCents,
        claimed: result.claimed,
        weekStreak: result.weekStreak,
      });
      onClaimed?.(result.balanceCents);
    } catch (error: any) {
      setClaimError(typeof error?.message === 'string' && error.message ? error.message : "Couldn't claim. Try again.");
    } finally {
      setClaiming(false);
    }
  }, [api, claiming, onClaimed, previewMode]);

  const header = (
    <View style={styles.headerRow}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>Weekly quests</Text>
      {status ? (
        <View style={styles.timeLeft} accessibilityLabel={`${timeLeftLabel(status.endsAt)} left`}>
          <Feather name="clock" size={14} color={theme.muted} />
          <Text style={[styles.timeLeftText, TABULAR_NUMS, { color: theme.muted }]}>{timeLeftLabel(status.endsAt)}</Text>
        </View>
      ) : null}
    </View>
  );

  if (hidden) return null;

  if (!status) {
    return (
      <View testID="weekly-quests">
        {header}
        {loadError ? (
          <RetryRow label="Couldn't load quests" onRetry={() => void load()} />
        ) : (
          <BrandthreadCard>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeletonRow}>
                <SkeletonBlock width="60%" height={14} />
                <SkeletonBlock width="100%" height={14} radius={RADIUS.pill} />
              </View>
            ))}
          </BrandthreadCard>
        )}
      </View>
    );
  }

  const done = completedQuestCount(status);
  const total = status.quests.length;
  const complete = allQuestsComplete(status);
  const amount = formatCents(status.rewardCents);

  return (
    <View testID="weekly-quests">
      {header}
      <BrandthreadCard style={styles.card}>
        {status.quests.map((quest) => {
          const questDone = isQuestComplete(quest);
          return (
            <View
              key={quest.id}
              style={[styles.row, { borderBottomColor: theme.borderSubtle }]}
              accessible
              accessibilityLabel={`${quest.title}, ${Math.min(quest.progress, quest.target)} of ${quest.target}${questDone ? ', done' : ''}`}
            >
              <Text style={[styles.questTitle, { color: theme.text }]}>{quest.title}</Text>
              <View style={styles.barRow}>
                <View style={styles.barColumn}>
                  <ProgressBar fraction={questFraction(quest)} done={questDone} styles={styles} theme={theme} />
                  <Text style={[styles.count, TABULAR_NUMS, { color: theme.muted }]}>
                    {Math.min(quest.progress, quest.target)} / {quest.target}
                  </Text>
                </View>
                <Feather
                  name={questDone ? 'check-circle' : 'circle'}
                  size={ICON.md}
                  color={questDone ? theme.text : theme.subtle}
                  style={styles.marker}
                />
              </View>
            </View>
          );
        })}

        {/* Reward: the Thread Cash amount takes the place of Duolingo's chest. */}
        <View style={styles.rewardRow} testID="weekly-quests-reward">
          <Text style={[styles.questTitle, { color: theme.text }]}>
            {status.claimed ? 'Reward claimed' : `Complete all ${total}`}
          </Text>
          <View style={styles.barRow}>
            <View style={styles.barColumn}>
              <ProgressBar fraction={total ? done / total : 0} done={complete} styles={styles} theme={theme} />
              <Text style={[styles.count, TABULAR_NUMS, { color: theme.muted }]}>{done} / {total}</Text>
            </View>
            <View style={[styles.rewardMarker, { borderColor: theme.border }]}>
              {status.claimed ? <Feather name="check" size={14} color={theme.success} /> : null}
              <Text style={[styles.rewardAmount, TABULAR_NUMS, { color: theme.success }]}>{amount}</Text>
            </View>
          </View>
        </View>

        {complete && !status.claimed ? (
          <View style={styles.claimWrap}>
            <Button
              label={`Claim ${amount}`}
              onPress={() => void claim()}
              loading={claiming}
              disabled={claiming || previewMode != null}
              fullWidth
              testID="weekly-quests-claim"
            />
            {claimError ? <Text style={[styles.claimError, { color: theme.error }]}>{claimError}</Text> : null}
          </View>
        ) : null}
      </BrandthreadCard>

      <View style={styles.streakRow} testID="weekly-quests-streak">
        <Feather name="calendar" size={14} color={theme.muted} />
        <Text style={[styles.streakText, TABULAR_NUMS, { color: theme.muted }]}>
          Week streak <Text style={{ color: theme.text, fontFamily: FONT.semibold }}>{status.weekStreak}</Text>
        </Text>
      </View>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (_theme: AppThemePreset) => StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.lg, marginBottom: SP.sm },
  sectionTitle: { fontSize: 20, fontFamily: FONT.semibold },
  timeLeft: { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  timeLeftText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  card: { padding: 0, overflow: 'hidden' },
  row: { paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: SP.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  rewardRow: { paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: SP.md },
  questTitle: { fontSize: FS.base, fontFamily: FONT.bold, marginBottom: SP.sm },
  barRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  barColumn: { flex: 1 },
  track: { height: 14, borderRadius: RADIUS.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: RADIUS.pill },
  count: { fontSize: FS.meta, fontFamily: FONT.semibold, marginTop: SP.xs },
  marker: { marginTop: -3 },
  rewardMarker: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    minHeight: 24, marginTop: -5, paddingHorizontal: SP.sm,
    borderRadius: RADIUS.pill, borderWidth: 1,
  },
  rewardAmount: { fontSize: FS.sm, fontFamily: FONT.bold },
  claimWrap: { paddingHorizontal: SP.md, paddingBottom: SP.md },
  claimError: { fontSize: FS.meta, fontFamily: FONT.regular, marginTop: SP.sm, textAlign: 'center' },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginTop: SP.sm, paddingHorizontal: SP.xs },
  streakText: { fontSize: FS.meta, fontFamily: FONT.regular },
  skeletonRow: { gap: SP.sm, paddingVertical: SP.sm },
});
