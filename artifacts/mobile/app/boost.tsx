/**
 * Paid Promotion Boost Tool
 * Route: /boost?targetType=post|product&targetId=<uuid>
 */
import React, { useState, useCallback, useRef } from 'react';
import { useColors } from '@/hooks/useColors';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, PanResponder, LayoutChangeEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';
import {
  BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, SUCCESS, SUCCESS_DIM,
  ORANGE, RED, GOLD, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { divideCents, formatCents } from '@/lib/money';

type BoostObjective = 'views' | 'likes' | 'followers' | 'profile_visits';

const OBJECTIVES: Array<{
  value: BoostObjective;
  label: string;
  description: string;
  icon: React.ComponentProps<typeof Feather>['name'];
}> = [
  { value: 'views', label: 'More video views', description: 'Reach people likely to watch', icon: 'play-circle' },
  { value: 'likes', label: 'More likes', description: 'Find people likely to engage', icon: 'heart' },
  { value: 'followers', label: 'More followers', description: 'Grow your audience', icon: 'user-plus' },
  { value: 'profile_visits', label: 'More profile visits', description: 'Drive people to your shop', icon: 'user' },
];

type BoostTarget = {
  id: string;
  mediaUrl: string | null;
  mediaType: string | null;
  caption: string | null;
  createdAt: string;
};

type Boost = {
  id: string; status: string; budgetCents: number; spentCents: number;
  impressionsCount: number; durationDays: number; startsAt: string; endsAt: string;
  estimatedImpressions: number; objective: BoostObjective;
};

type Summary = {
  totalImpressions: number;
  spentCentsThisMonth: number;
  activeCount: number;
};

function daysRemaining(endsAt: string): number {
  const ms = new Date(endsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function objectiveLabel(value: BoostObjective): string {
  return OBJECTIVES.find((item) => item.value === value)?.label ?? 'More video views';
}

function PostThumbnail({ target }: { target: BoostTarget }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const isVideo = target.mediaType === 'video';
  const player = useVideoPlayer(isVideo && target.mediaUrl ? target.mediaUrl : null, (instance) => {
    instance.muted = true;
    instance.loop = false;
  });

  if (!target.mediaUrl) {
    return (
      <View style={s.thumbnailFallback}>
        <Feather name="file-text" size={26} color={MUTED} />
      </View>
    );
  }

  if (isVideo) {
    return (
      <View style={StyleSheet.absoluteFill}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
        <View style={s.videoBadge}><Feather name="play" size={10} color="#fff" /></View>
      </View>
    );
  }

  return <Image source={{ uri: target.mediaUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />;
}

function SnapSlider({
  value, min, max, step, onChange, accessibilityLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  accessibilityLabel: string;
}) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const widthRef = useRef(1);
  const startValueRef = useRef(value);
  startValueRef.current = value;

  const snap = useCallback((raw: number) => {
    const clamped = Math.max(min, Math.min(max, raw));
    return Math.round((clamped - min) / step) * step + min;
  }, [max, min, step]);

  const updateFromX = useCallback((x: number) => {
    onChange(snap(min + (Math.max(0, Math.min(widthRef.current, x)) / widthRef.current) * (max - min)));
  }, [max, min, onChange, snap]);

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      startValueRef.current = value;
      Haptics.selectionAsync();
    },
    onPanResponderMove: (_event, gesture) => {
      onChange(snap(startValueRef.current + (gesture.dx / widthRef.current) * (max - min)));
    },
  });

  const fraction = (value - min) / (max - min);
  return (
    <View
      style={s.sliderTouchArea}
      onLayout={(event: LayoutChangeEvent) => { widthRef.current = Math.max(1, event.nativeEvent.layout.width); }}
      onTouchEnd={(event) => updateFromX(event.nativeEvent.locationX)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        onChange(snap(value + (event.nativeEvent.actionName === 'increment' ? step : -step)));
      }}
      {...panResponder.panHandlers}
    >
      <View style={s.sliderTrack}>
        <View style={[s.sliderFill, { width: `${fraction * 100}%` }]} />
      </View>
      <View style={[s.sliderThumb, { left: `${fraction * 100}%` }]} />
    </View>
  );
}

export default function BoostScreen() {
  const colors = useColors();
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = colors;
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const api     = useApi();
  const params = useLocalSearchParams<{ targetType?: string; targetId?: string }>();
  const initialTargetId = typeof params.targetId === 'string' ? params.targetId : '';
  const initialTargetType = params.targetType === 'product' ? 'product' : 'post';

  const [selectedTargetId, setSelectedTargetId] = useState(initialTargetId);
  const [selectedTargetType, setSelectedTargetType] = useState<'post' | 'product'>(initialTargetType);
  const [showPicker, setShowPicker] = useState(!initialTargetId);
  const [targets, setTargets] = useState<BoostTarget[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(!initialTargetId);
  const [targetError, setTargetError] = useState('');
  const [objective, setObjective] = useState<BoostObjective>('views');
  const [budgetCents, setBudgetCents] = useState(2500);
  const [durationDays, setDurationDays] = useState(7);
  const [launching,        setLaunching]         = useState(false);
  const [existing,         setExisting]          = useState<Boost[]>([]);
  const [loadingExisting,  setLoadingExisting]   = useState(true);
  const [summary,          setSummary]           = useState<Summary | null>(null);
  const [loadingSummary,   setLoadingSummary]    = useState(true);

  const estimatedImpressions = Math.round(budgetCents * 0.4);
  const selectedTarget = targets.find((item) => item.id === selectedTargetId);
  const budgetLabel = formatCents(budgetCents);
  const durationLabel = `${durationDays} ${durationDays === 1 ? 'day' : 'days'}`;

  const loadTargets = useCallback(async () => {
    setLoadingTargets(true);
    setTargetError('');
    try {
      const rows = await api.boosts.targets();
      setTargets(rows ?? []);
    } catch {
      setTargetError('We couldn’t load your posts. Check your connection and try again.');
    } finally {
      setLoadingTargets(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => {
    loadTargets();

    // Load existing boosts for this target
    if (selectedTargetId) {
      setLoadingExisting(true);
      api.boosts.list(selectedTargetId)
        .then((rows: Boost[]) => setExisting(rows ?? []))
        .catch(() => setExisting([]))
        .finally(() => setLoadingExisting(false));
    } else {
      setLoadingExisting(false);
    }

    // Load summary stats
    setLoadingSummary(true);
    api.boosts.summary()
      .then((s: Summary) => setSummary(s))
      .catch(() => setSummary(null))
      .finally(() => setLoadingSummary(false));
  }, [api, loadTargets, selectedTargetId]));

  async function handleLaunch() {
    if (!selectedTargetId) {
      Alert.alert('Choose a post', 'Select the post you want to promote first.'); return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLaunching(true);
    try {
      await api.boosts.create({
        targetType: selectedTargetType,
        targetId: selectedTargetId,
        objective,
        budgetCents,
        durationDays,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        '🚀 Boost Launched!',
        `Your ${selectedTargetType} will be promoted for ${durationLabel} with the goal “${objectiveLabel(objective)}.” You’ll see progress in your Boost history.`,
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (e: any) {
      const msg = e?.message ?? 'Could not launch boost.';
      if (msg.includes('card_declined')) {
        Alert.alert('Card Declined', 'Please update your payment method in Billing settings.');
      } else if (msg.includes('402')) {
        Alert.alert('Payment Required', 'Add a payment method in Billing before boosting.');
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setLaunching(false);
    }
  }

  function statusColor(s: string) {
    return s === 'active' ? SUCCESS : s === 'paused' ? ORANGE : MUTED;
  }
  function statusLabel(s: string) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** Clamp 0–1, guard against division by zero */
  function reachProgress(b: Boost): number {
    if (!b.estimatedImpressions || b.estimatedImpressions <= 0) return 0;
    return Math.min(1, b.impressionsCount / b.estimatedImpressions);
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Promote</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 100 }}>

        {/* ── Summary card ─────────────────────────────────────────────────── */}
        {loadingSummary
          ? <ActivityIndicator color={PURPLE} style={{ marginBottom: SP.md }} />
          : summary && (
            <View style={s.summaryCard}>
              <Text style={s.summaryTitle}>THIS MONTH</Text>
              <View style={s.summaryRow}>
                <View style={s.summaryItem}>
                  <Feather name="eye" size={16} color={PURPLE_LIGHT} />
                  <Text style={s.summaryValue}>{summary.totalImpressions.toLocaleString()}</Text>
                  <Text style={s.summaryLabel}>Impressions</Text>
                </View>
                <View style={s.summarySep} />
                <View style={s.summaryItem}>
                  <Feather name="dollar-sign" size={16} color={GOLD} />
                  <Text style={s.summaryValue}>{formatCents(summary.spentCentsThisMonth)}</Text>
                  <Text style={s.summaryLabel}>Spent</Text>
                </View>
                <View style={s.summarySep} />
                <View style={s.summaryItem}>
                  <Feather name="zap" size={16} color={SUCCESS} />
                  <Text style={s.summaryValue}>{summary.activeCount}</Text>
                  <Text style={s.summaryLabel}>Active</Text>
                </View>
              </View>
            </View>
          )
        }

        {showPicker ? (
          <View>
            <View style={s.pickerHeadingRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.setupTitle}>Choose a post to promote</Text>
                <Text style={s.setupSub}>Select one of your published posts or videos.</Text>
              </View>
              {selectedTargetId ? (
                <TouchableOpacity onPress={() => setShowPicker(false)} style={s.cancelPickerBtn}>
                  <Text style={s.cancelPickerText}>Cancel</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {loadingTargets ? (
              <ActivityIndicator color={PURPLE} style={{ marginVertical: 48 }} />
            ) : targetError ? (
              <View style={s.pickerState}>
                <Feather name="wifi-off" size={24} color={MUTED} />
                <Text style={s.pickerStateText}>{targetError}</Text>
                <TouchableOpacity style={s.retryBtn} onPress={loadTargets}>
                  <Text style={s.retryText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : targets.length === 0 ? (
              <View style={s.pickerState}>
                <Feather name="video" size={26} color={MUTED} />
                <Text style={s.pickerStateTitle}>No posts to promote yet</Text>
                <Text style={s.pickerStateText}>Publish a post or video first, then come back to Promote.</Text>
              </View>
            ) : (
              <View style={s.postGrid}>
                {targets.map((target) => (
                  <TouchableOpacity
                    key={target.id}
                    style={s.postTile}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={`Promote ${target.caption || 'post'}`}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setSelectedTargetId(target.id);
                      setSelectedTargetType('post');
                      setShowPicker(false);
                    }}
                  >
                    <PostThumbnail target={target} />
                    <View style={s.tileScrim} />
                    <Text style={s.tileCaption} numberOfLines={2}>{target.caption || 'Untitled post'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        ) : (
          <>
            {/* Selected promotion target */}
            <View style={s.selectedTargetCard}>
              <View style={s.selectedTargetThumb}>
                {selectedTarget ? (
                  <PostThumbnail target={selectedTarget} />
                ) : (
                  <View style={s.thumbnailFallback}>
                    <Feather name={selectedTargetType === 'product' ? 'shopping-bag' : 'video'} size={22} color={PURPLE_LIGHT} />
                  </View>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.selectedTargetEyebrow}>PROMOTING</Text>
                <Text style={s.selectedTargetTitle} numberOfLines={2}>
                  {selectedTarget?.caption || (selectedTargetType === 'product' ? 'Selected product' : 'Selected post')}
                </Text>
              </View>
              {selectedTargetType === 'post' ? (
                <TouchableOpacity style={s.changeBtn} onPress={() => setShowPicker(true)}>
                  <Text style={s.changeBtnText}>Change</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Goal selector */}
            <Text style={s.sectionLabel}>WHAT IS YOUR GOAL?</Text>
            <View style={s.objectiveList}>
              {OBJECTIVES.map((item) => {
                const active = objective === item.value;
                return (
                  <TouchableOpacity
                    key={item.value}
                    style={[s.objectiveRow, active && s.objectiveRowActive]}
                    onPress={() => { Haptics.selectionAsync(); setObjective(item.value); }}
                    activeOpacity={0.8}
                  >
                    <View style={[s.objectiveIcon, active && s.objectiveIconActive]}>
                      <Feather name={item.icon} size={18} color={active ? PURPLE_LIGHT : MUTED} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.objectiveTitle, active && s.objectiveTitleActive]}>{item.label}</Text>
                      <Text style={s.objectiveDescription}>{item.description}</Text>
                    </View>
                    <View style={[s.radioOuter, active && s.radioOuterActive]}>
                      {active ? <View style={s.radioInner} /> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Budget slider */}
            <View style={s.sliderSection}>
              <View style={s.sliderHeading}>
                <Text style={s.sectionLabelInline}>BUDGET</Text>
                <Text style={s.sliderValue}>{budgetLabel}</Text>
              </View>
              <SnapSlider
                value={budgetCents}
                min={500}
                max={25000}
                step={500}
                onChange={setBudgetCents}
                accessibilityLabel="Promotion budget"
              />
              <View style={s.sliderRange}><Text style={s.sliderRangeText}>$5</Text><Text style={s.sliderRangeText}>$250</Text></View>
            </View>

            {/* Duration slider */}
            <View style={s.sliderSection}>
              <View style={s.sliderHeading}>
                <Text style={s.sectionLabelInline}>HOW MANY DAYS?</Text>
                <Text style={s.sliderValue}>{durationLabel}</Text>
              </View>
              <SnapSlider
                value={durationDays}
                min={1}
                max={30}
                step={1}
                onChange={setDurationDays}
                accessibilityLabel="Promotion duration in days"
              />
              <View style={s.sliderRange}><Text style={s.sliderRangeText}>1 day</Text><Text style={s.sliderRangeText}>30 days</Text></View>
            </View>

            {/* Estimated reach */}
            <View style={s.reachCard}>
              <View style={s.reachRow}>
                <Feather name="eye" size={18} color={PURPLE_LIGHT} />
                <View style={{ flex: 1 }}>
                  <Text style={s.reachTitle}>Estimated Reach</Text>
                  <Text style={s.reachValue}>~{estimatedImpressions.toLocaleString()} impressions</Text>
                </View>
              </View>
              <View style={s.divider} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={s.reachStat}>
                  <Text style={s.reachStatLabel}>Total Charge</Text>
                  <Text style={s.reachStatValue}>{budgetLabel}</Text>
                </View>
                <View style={s.reachStat}>
                  <Text style={s.reachStatLabel}>Duration</Text>
                  <Text style={s.reachStatValue}>{durationLabel}</Text>
                </View>
                <View style={s.reachStat}>
                  <Text style={s.reachStatLabel}>Per Day</Text>
                  <Text style={s.reachStatValue}>{formatCents(divideCents(budgetCents, durationDays))}</Text>
                </View>
              </View>
            </View>

            {/* Launch button */}
            <TouchableOpacity
              style={[s.launchBtn, launching && { opacity: 0.6 }]}
              onPress={handleLaunch}
              disabled={launching}
              activeOpacity={0.85}
            >
              {launching
                ? <ActivityIndicator color="#fff" />
                : <>
                    <Feather name="zap" size={18} color="#fff" />
                    <Text style={s.launchBtnText}>Launch Boost — Pay {budgetLabel}</Text>
                  </>
              }
            </TouchableOpacity>

            <Text style={s.disclaimer}>
              Your stored payment method will be charged {budgetLabel}. Boosts can be paused from your Boost history.
            </Text>
          </>
        )}

        {/* ── Boost history ─────────────────────────────────────────────────── */}
        {(loadingExisting ? true : existing.length > 0) && (
          <>
            <Text style={[s.sectionLabel, { marginTop: SP.xl }]}>BOOST HISTORY</Text>
            {loadingExisting
              ? <ActivityIndicator color={PURPLE} style={{ marginTop: SP.sm }} />
              : existing.map(b => {
                  const progress   = reachProgress(b);
                  const daysLeft   = daysRemaining(b.endsAt);
                  const estimated  = b.estimatedImpressions;

                  return (
                    <View key={b.id} style={s.boostRow}>
                      {/* Status + meta */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <View style={[s.statusDot, { backgroundColor: statusColor(b.status) }]} />
                        <Text style={s.boostStatus}>{statusLabel(b.status)}</Text>
                        <Text style={s.boostMeta}>{objectiveLabel(b.objective || 'views')}</Text>
                        {b.status === 'active' && (
                          <Text style={[s.boostMeta, { marginLeft: 'auto' }]}>
                            {daysLeft === 0 ? 'Ends today' : `${daysLeft}d left`}
                          </Text>
                        )}
                      </View>

                      {/* Impressions + spend */}
                      <View style={{ flexDirection: 'row', gap: SP.md, marginBottom: 8 }}>
                        <View style={s.statPill}>
                          <Feather name="eye" size={11} color={PURPLE_LIGHT} />
                          <Text style={s.statPillText}>
                            {b.impressionsCount.toLocaleString()}
                            <Text style={{ color: MUTED }}> / ~{estimated.toLocaleString()}</Text>
                          </Text>
                        </View>
                        <View style={s.statPill}>
                          <Feather name="dollar-sign" size={11} color={GOLD} />
                          <Text style={s.statPillText}>
                            {formatCents(b.spentCents)}
                            <Text style={{ color: MUTED }}> / {formatCents(b.budgetCents)}</Text>
                          </Text>
                        </View>
                      </View>

                      {/* Reach progress bar */}
                      <View style={s.progressTrack}>
                        <View style={[s.progressFill, { width: `${Math.round(progress * 100)}%` as any }]} />
                      </View>
                      <Text style={s.progressLabel}>
                        {Math.round(progress * 100)}% of estimated reach fulfilled
                      </Text>
                    </View>
                  );
                })
            }
          </>
        )}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => {
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT } = colors;
  return StyleSheet.create({
  root:          { flex: 1, backgroundColor: 'transparent' },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerBack:    { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle:   { fontSize: FS.md, fontFamily: FONT.bold, color: FG },

  // ── Summary card ──────────────────────────────────────────────────────────
  summaryCard:  { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md },
  summaryTitle: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, letterSpacing: 1, textTransform: 'uppercase', marginBottom: SP.sm },
  summaryRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  summaryItem:  { alignItems: 'center', gap: 4 },
  summaryValue: { fontSize: FS.lg, fontFamily: FONT.bold, color: FG, marginTop: 2 },
  summaryLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  summarySep:   { width: 1, height: 40, backgroundColor: BORDER },

  setupTitle: { color: FG, fontFamily: FONT.bold, fontSize: FS.xl, marginBottom: 5 },
  setupSub: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19 },
  pickerHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: SP.md },
  cancelPickerBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  cancelPickerText: { color: PURPLE_LIGHT, fontFamily: FONT.semibold, fontSize: FS.sm },
  postGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginBottom: SP.xl },
  postTile: {
    width: '32.6%',
    aspectRatio: 0.76,
    backgroundColor: CARD_ELEVATED,
    overflow: 'hidden',
    position: 'relative',
  },
  tileScrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.16)' },
  tileCaption: {
    position: 'absolute', left: 7, right: 7, bottom: 7,
    color: '#fff', fontFamily: FONT.semibold, fontSize: 11, lineHeight: 14,
    textShadowColor: 'rgba(0,0,0,0.85)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  videoBadge: {
    position: 'absolute', top: 7, right: 7, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.62)',
  },
  thumbnailFallback: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD_ELEVATED,
  },
  pickerState: {
    minHeight: 220, alignItems: 'center', justifyContent: 'center',
    padding: SP.xl, backgroundColor: CARD, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER, marginBottom: SP.xl,
  },
  pickerStateTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.base, marginTop: 12, marginBottom: 5 },
  pickerStateText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', lineHeight: 19, marginTop: 10 },
  retryBtn: { marginTop: 16, borderRadius: RADIUS.sm, backgroundColor: PURPLE, paddingHorizontal: 18, paddingVertical: 10 },
  retryText: { color: '#fff', fontFamily: FONT.semibold, fontSize: FS.sm },

  selectedTargetCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    borderRadius: RADIUS.md, padding: 10, marginBottom: SP.lg,
  },
  selectedTargetThumb: {
    width: 58, height: 72, borderRadius: RADIUS.sm, overflow: 'hidden',
    backgroundColor: CARD_ELEVATED, position: 'relative',
  },
  selectedTargetEyebrow: { color: MUTED, fontFamily: FONT.semibold, fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  selectedTargetTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm, lineHeight: 18 },
  changeBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  changeBtnText: { color: PURPLE_LIGHT, fontFamily: FONT.semibold, fontSize: FS.sm },

  objectiveList: { gap: 8, marginBottom: SP.lg },
  objectiveRow: {
    minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 10,
  },
  objectiveRowActive: { borderColor: PURPLE, backgroundColor: PURPLE_DIM },
  objectiveIcon: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: CARD_ELEVATED,
  },
  objectiveIconActive: { backgroundColor: PURPLE_DIM },
  objectiveTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm, marginBottom: 3 },
  objectiveTitleActive: { color: PURPLE_LIGHT },
  objectiveDescription: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs },
  radioOuter: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: MUTED,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOuterActive: { borderColor: PURPLE },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: PURPLE },

  sectionLabel:  { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, letterSpacing: 1, textTransform: 'uppercase', marginBottom: SP.sm, marginTop: SP.sm },
  sectionLabelInline: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, letterSpacing: 1, textTransform: 'uppercase' },
  sliderSection: {
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md,
  },
  sliderHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  sliderValue: { color: FG, fontFamily: FONT.bold, fontSize: FS.lg },
  sliderTouchArea: { height: 38, justifyContent: 'center', position: 'relative' },
  sliderTrack: { height: 5, borderRadius: 3, backgroundColor: SUBTLE, overflow: 'hidden' },
  sliderFill: { height: 5, borderRadius: 3, backgroundColor: PURPLE },
  sliderThumb: {
    position: 'absolute', top: 7, width: 24, height: 24, borderRadius: 12,
    marginLeft: -12, backgroundColor: '#fff', borderWidth: 5, borderColor: PURPLE,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  sliderRange: { flexDirection: 'row', justifyContent: 'space-between' },
  sliderRangeText: { color: MUTED, fontFamily: FONT.regular, fontSize: 11 },

  reachCard:   { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md },
  reachRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: SP.sm },
  reachTitle:  { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  reachValue:  { fontSize: FS.xl, fontFamily: FONT.bold, color: PURPLE_LIGHT },
  divider:     { height: 1, backgroundColor: BORDER, marginVertical: SP.sm },
  reachStat:   { alignItems: 'center' },
  reachStatLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginBottom: 2 },
  reachStatValue: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },

  launchBtn:      { backgroundColor: PURPLE, borderRadius: RADIUS.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, marginBottom: SP.sm },
  launchBtnText:  { fontSize: FS.base, fontFamily: FONT.bold, color: '#fff' },
  disclaimer:     { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 16, marginBottom: SP.xl },

  // ── Boost history rows ────────────────────────────────────────────────────
  boostRow:     { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, padding: SP.md, marginBottom: SP.sm },
  statusDot:    { width: 8, height: 8, borderRadius: 4 },
  boostStatus:  { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  boostMeta:    { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },

  statPill:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.xs, paddingHorizontal: 8, paddingVertical: 4 },
  statPillText: { fontSize: FS.xs, fontFamily: FONT.medium, color: FG },

  progressTrack: { height: 4, backgroundColor: SUBTLE, borderRadius: 2, overflow: 'hidden', marginBottom: 4 },
  progressFill:  { height: 4, backgroundColor: PURPLE, borderRadius: 2 },
  progressLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  });
};
