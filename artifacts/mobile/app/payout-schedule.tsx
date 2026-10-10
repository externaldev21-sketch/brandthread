import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { AppThemePreset, useAppTheme } from '@/contexts/AppThemeContext';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { LoadingSkeleton } from '@/components/BrandthreadUI';
import { EmptyState } from '@/components/layout';
import { RoleLockedView } from '@/components/RoleLockedView';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { hasPayoutsAccess, isManagerRole } from '@/lib/roleError';
import { useTeamRole } from '@/hooks/useTeamRole';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { formatCents } from '@/lib/money';
import {
  WEEKLY_ANCHORS, cap, choiceFromSchedule, instantFeeLabel, instantUnavailableReason, nextPayoutLabel,
  type PayoutScheduleInfo, type ScheduleChoice, type WeeklyAnchor,
} from '@/lib/payoutScheduleView';
import { crispPx } from '@/lib/crispPixel';

/** Weekday picker: a fixed 4-column grid of equal chips. */
const DAY_COLUMNS = 4;
const DAY_GAP = 8;

const DEMO_INFO: PayoutScheduleInfo = {
  connected: true,
  providerConfigured: true,
  payoutsEnabled: true,
  schedule: { interval: 'daily', weeklyAnchor: null, delayDays: 2 },
  instant: {
    eligible: true,
    reason: null,
    destination: { id: 'card_demo', brand: 'Visa', last4: '4242', funding: 'debit' },
    feeBps: 100,
    minFeeCents: 50,
    maxAmount: { amount: 182_409, formatted: '$1,824.09' },
    quote: { amount: 182_409, fee: 1_824, feeFormatted: '$18.24', total: 184_233, withinBalance: true },
  },
  nextPayoutEstimate: { kind: 'scheduled', date: '2026-10-01T00:00:00.000Z', amount: 184_250, formatted: '$1,842.50' },
};

export default function PayoutScheduleScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const api = useApi();
  const tabBarMetrics = useTabBarMetrics(2);
  const { isLoaded: authLoaded, isSignedIn, userId } = useAuth();
  const isPreviewMode = isSellerDevPreview();
  const isPreview = (isPreviewMode && !userId) || (isPreviewMode && (!authLoaded || !isSignedIn));
  const { currentRole, isLoadingRole } = useTeamRole();
  const isReadOnly = isManagerRole(currentRole);

  const [info, setInfo] = useState<PayoutScheduleInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [choice, setChoice] = useState<ScheduleChoice | null>(null);
  const [anchor, setAnchor] = useState<WeeklyAnchor>('friday');
  const [gridWidth, setGridWidth] = useState(0);
  const [saving, setSaving] = useState(false);
  const [cashing, setCashing] = useState(false);
  const cashoutKeyRef = useRef<{ key: string; amount: number } | null>(null);

  const applyInfo = useCallback((next: PayoutScheduleInfo) => {
    setInfo(next);
    setChoice(choiceFromSchedule(next));
    const a = next.schedule?.weeklyAnchor;
    if (a && (WEEKLY_ANCHORS as readonly string[]).includes(a)) setAnchor(a as WeeklyAnchor);
  }, []);

  const load = useCallback(async () => {
    if (isPreview) {
      // Signed-out preview never calls the API. Fake data only with &demo=1.
      if (isPreviewDemoMode()) applyInfo(DEMO_INFO);
      else setInfo(null);
      setLoadError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      applyInfo(await api.finance.payoutSchedule());
    } catch {
      setLoadError(true);
    }
    setLoading(false);
  }, [api, applyInfo, isPreview]);

  useEffect(() => { void load(); }, [load]);

  const currentChoice = info ? choiceFromSchedule(info) : null;
  const dirty = choice !== null && (
    choice !== currentChoice
    || (choice === 'weekly' && anchor !== (info?.schedule?.weeklyAnchor ?? null))
  );
  const instantBlocked = info ? instantUnavailableReason(info.instant) : null;
  const canEdit = Boolean(info?.connected && info.payoutsEnabled) && !isReadOnly;

  function pick(next: ScheduleChoice) {
    if (!canEdit) return;
    if (next === 'instant' && instantBlocked) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setChoice(next);
  }

  async function save() {
    if (!choice || saving || !dirty) return;
    if (isPreview) return;
    setSaving(true);
    try {
      await api.finance.setPayoutSchedule(
        choice === 'weekly'
          ? { interval: 'weekly', weeklyAnchor: anchor }
          : { interval: choice === 'instant' ? 'manual' : 'daily' },
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await load();
    } catch (error) {
      const message = error instanceof ApiError && error.status < 500
        ? 'Stripe did not accept this schedule. Check your account and try again.'
        : 'Could not save your schedule. Try again.';
      Alert.alert('Schedule not saved', message);
    } finally {
      setSaving(false);
    }
  }

  function cashOutInstantly() {
    const max = info?.instant.maxAmount?.amount ?? 0;
    const quote = info?.instant.quote;
    if (!info || !quote || max <= 0 || cashing || isPreview) return;
    Alert.alert(
      `Cash out ${formatCents(max)} instantly?`,
      `A ${formatCents(quote.fee)} fee is taken from your balance. The money reaches your debit card ···${info.instant.destination?.last4 ?? ''} in minutes.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Cash out',
          onPress: () => {
            void (async () => {
              if (cashoutKeyRef.current?.amount !== max) {
                cashoutKeyRef.current = {
                  key: `instant_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`,
                  amount: max,
                };
              }
              setCashing(true);
              try {
                const payout = await api.finance.payout({
                  idempotencyKey: cashoutKeyRef.current.key, amount: max, currency: 'usd', method: 'instant',
                });
                cashoutKeyRef.current = null;
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                Alert.alert('Cash out requested', `${payout.formatted ?? formatCents(max)} is on its way to your card.`);
              } catch (error) {
                if (error instanceof ApiError && error.status < 500 && error.code !== 'PAYOUT_REVIEW_REQUIRED') {
                  cashoutKeyRef.current = null;
                }
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
                Alert.alert(
                  'Could not cash out',
                  error instanceof ApiError && error.code === 'BALANCE_CHANGED'
                    ? 'Your balance changed. Review the new amount and try again.'
                    : error instanceof ApiError && error.code === 'INSTANT_PAYOUT_UNAVAILABLE'
                      ? 'Your card is not enabled for instant payouts.'
                      : 'The cash-out could not be confirmed. Try again to safely retry the same request.',
                );
              } finally {
                setCashing(false);
                void load();
              }
            })();
          },
        },
      ],
    );
  }

  const goBack = () => goBackOr(router, '/payouts' as never);

  if (!isPreview && isLoadingRole) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Payout schedule" onBack={goBack} />
        <View style={{ padding: SP.md, gap: SP.sm }}><LoadingSkeleton height={84} /><LoadingSkeleton height={84} /></View>
      </View>
    );
  }
  if (!isPreview && !hasPayoutsAccess(currentRole) && !isReadOnly) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Payout schedule" onBack={goBack} />
        <RoleLockedView screenTitle="payouts" currentRole={currentRole ?? undefined} />
      </View>
    );
  }

  const next = info ? nextPayoutLabel(info.nextPayoutEstimate) : null;
  const showCashOut = Boolean(
    info && currentChoice === 'instant' && choice === 'instant' && !instantBlocked
    && (info.instant.maxAmount?.amount ?? 0) > 0 && !isReadOnly,
  );

  return (
    <View style={styles.root}>
      <ScreenHeader title="Payout schedule" onBack={goBack} />
      <ScrollView
        style={{ marginBottom: tabBarMetrics.occupiedHeight }}
        contentContainerStyle={[styles.content, !info && !loading && !loadError && { flexGrow: 1, justifyContent: 'center' }]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={{ gap: SP.sm }}>{[0, 1, 2].map((i) => <LoadingSkeleton key={i} height={84} />)}</View>
        ) : loadError ? (
          <ErrorState message="Couldn't load your payout schedule." onRetry={() => { void load(); }} />
        ) : !info || !info.connected ? (
          <EmptyState icon="credit-card" title="Connect Stripe to choose a schedule" message="" compact />
        ) : (
          <>
            <Text style={styles.sectionTitle}>When you get paid</Text>

            <OptionCard
              styles={styles} theme={theme} testID="payout-schedule-daily"
              selected={choice === 'daily'} disabled={!canEdit} onPress={() => pick('daily')}
              title="Daily" subtitle="Paid out every business day"
            />

            <OptionCard
              styles={styles} theme={theme} testID="payout-schedule-weekly"
              selected={choice === 'weekly'} disabled={!canEdit} onPress={() => pick('weekly')}
              title="Weekly" subtitle="Paid out once a week"
            >
              {choice === 'weekly' && (
                <View
                  style={styles.dayRow}
                  onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
                >
                  {gridWidth > 0 && WEEKLY_ANCHORS.map((day) => (
                    <TouchableOpacity
                      key={day}
                      testID={`payout-schedule-day-${day}`}
                      style={[styles.dayChip, { width: Math.floor((gridWidth - DAY_GAP * (DAY_COLUMNS - 1)) / DAY_COLUMNS) }, anchor === day && styles.dayChipOn]}
                      onPress={() => { if (canEdit) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); setAnchor(day); } }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: anchor === day }}
                      accessibilityLabel={cap(day)}
                    >
                      <Text style={[styles.dayText, anchor === day && styles.dayTextOn]}>{cap(day).slice(0, 3)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </OptionCard>

            <OptionCard
              styles={styles} theme={theme} testID="payout-schedule-instant"
              selected={choice === 'instant'} disabled={!canEdit || Boolean(instantBlocked)} onPress={() => pick('instant')}
              title="Instant"
              subtitle={instantBlocked ?? `Cash out whenever you want, in minutes. ${instantFeeLabel(info.instant)}.`}
            />

            {next && currentChoice !== null && (
              <View style={styles.summaryRow} testID="payout-schedule-next">
                <Text style={styles.summaryLabel}>Next payout</Text>
                <Text style={styles.summaryValue}>{next}</Text>
              </View>
            )}

            {showCashOut && info.instant.maxAmount && info.instant.quote && (
              <View style={styles.summaryCard} testID="payout-schedule-instant-quote">
                <View style={styles.summaryLine}>
                  <Text style={styles.summaryLabel}>You receive</Text>
                  <Text style={styles.summaryValue}>{info.instant.maxAmount.formatted}</Text>
                </View>
                <View style={styles.summaryLine}>
                  <Text style={styles.summaryLabel}>Instant fee</Text>
                  <Text style={styles.summaryValue}>{info.instant.quote.feeFormatted}</Text>
                </View>
                <View style={styles.summaryLine}>
                  <Text style={styles.summaryLabel}>To card</Text>
                  <Text style={styles.summaryValue}>
                    {`${info.instant.destination?.brand ?? 'Debit'} ···${info.instant.destination?.last4 ?? ''}`}
                  </Text>
                </View>
              </View>
            )}

            {!isReadOnly && (
              <View style={styles.actions} testID="payout-schedule-actions">
                {showCashOut && (
                  <Button
                    label={`Cash out ${info.instant.maxAmount?.formatted ?? ''} instantly`}
                    onPress={cashOutInstantly}
                    loading={cashing}
                    disabled={cashing || saving}
                    fullWidth
                    testID="payout-schedule-cash-out"
                  />
                )}
                <Button
                  label="Save schedule"
                  onPress={() => { void save(); }}
                  variant={showCashOut ? 'secondary' : 'primary'}
                  loading={saving}
                  disabled={!dirty || saving || cashing || !canEdit}
                  fullWidth
                  testID="payout-schedule-save"
                />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function OptionCard(props: {
  styles: ReturnType<typeof createStyles>;
  theme: AppThemePreset;
  testID: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  const { styles, selected, disabled } = props;
  return (
    <TouchableOpacity
      testID={props.testID}
      activeOpacity={0.85}
      onPress={props.onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={props.title}
      style={[styles.card, selected && styles.cardOn, disabled && !selected && styles.cardOff]}
    >
      <View style={styles.cardRow}>
        <View style={[styles.radio, selected && styles.radioOn]}>
          {selected && <View style={styles.radioDot} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{props.title}</Text>
          <Text style={styles.cardSub}>{props.subtitle}</Text>
        </View>
      </View>
      {props.children}
    </TouchableOpacity>
  );
}

const createStyles = (theme: AppThemePreset) => {
  const { text, muted, border, card, onAccent } = theme;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    content: { padding: SP.md, paddingBottom: SP.lg },
    sectionTitle: { color: muted, fontSize: FS.xs, fontFamily: FONT.medium, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SP.sm },
    card: { backgroundColor: card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: border, padding: SP.md, marginBottom: SP.sm },
    cardOn: { borderColor: text, borderWidth: 2, padding: SP.md - 1 },
    cardOff: { opacity: 0.6 },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
    cardTitle: { color: text, fontSize: FS.base, fontFamily: FONT.semibold },
    cardSub: { color: muted, fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 2 },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: crispPx(1.5), borderColor: muted, alignItems: 'center', justifyContent: 'center' },
    radioOn: { borderColor: text },
    radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: text },
    dayRow: { flexDirection: 'row', gap: DAY_GAP, marginTop: SP.md, flexWrap: 'wrap' },
    dayChip: { height: 40, paddingHorizontal: 12, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: border, alignItems: 'center', justifyContent: 'center' },
    dayChipOn: { backgroundColor: text, borderColor: text },
    dayText: { color: text, fontSize: FS.sm, fontFamily: FONT.medium },
    dayTextOn: { color: onAccent },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SP.md, gap: SP.md },
    summaryCard: { backgroundColor: card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: border, paddingHorizontal: SP.md, paddingVertical: SP.xs, marginTop: SP.sm },
    summaryLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SP.sm },
    summaryLabel: { color: muted, fontSize: FS.sm, fontFamily: FONT.regular },
    summaryValue: { color: text, fontSize: FS.sm, fontFamily: FONT.medium, flexShrink: 1, textAlign: 'right' },
    actions: { gap: SP.sm, marginTop: SP.md },
  });
};
