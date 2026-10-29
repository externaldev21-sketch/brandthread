/**
 * The Payouts screen before payouts are live (app/payouts.tsx): what the
 * seller needs, where they are with Stripe, and the one action that moves
 * them forward. The manage page only renders once Stripe says "active".
 * Copy and state live in lib/payoutJourney.ts.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { FONT, FS, SP } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { formatDeadline, type SetupStep } from '@/lib/payoutSetupSteps';
import { SETUP_NEEDS, journeyCopy, type PayoutJourney, type PayoutJourneyState } from '@/lib/payoutJourney';

const STEP_STATUS: Record<SetupStep['status'], string> = { complete: 'Done', needed: 'To do', in_review: 'In review' };

export interface PayoutSetupJourneyProps {
  journey: PayoutJourney & { state: Exclude<PayoutJourneyState, 'active'> };
  onPrimary: () => void;
  onRefresh: () => void;
  busy: boolean;
  refreshing: boolean;
  /** Sales already waiting for a payout (available + pending), when known. */
  waitingCents: number | null;
  /** Staff who can see payouts but not set them up (Connect is owner-only). */
  ownerOnly: boolean;
}

export function PayoutSetupJourney({ journey, onPrimary, onRefresh, busy, refreshing, waitingCents, ownerOnly }: PayoutSetupJourneyProps) {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const { state } = journey;
  const copy = journeyCopy(state, { rejected: journey.rejected });
  const deadline = state === 'action_needed' && !journey.rejected ? formatDeadline(journey.deadline) : null;

  return (
    <View style={styles.wrap} testID={`payouts-journey-${state}`}>
      <Text style={styles.title} testID="payouts-journey-title" accessibilityRole="header">{copy.title}</Text>
      <Text style={styles.body}>{ownerOnly ? ownerOnlyBody(state) : copy.body}</Text>
      {deadline && <Text style={styles.deadline} testID="payouts-journey-deadline">Due by {deadline}</Text>}
      {waitingCents != null && waitingCents > 0 && (
        <Text style={styles.waiting} testID="payouts-journey-waiting">
          {formatCents(waitingCents)} from your sales is waiting to be paid out.
        </Text>
      )}

      {state === 'not_started' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What you'll need</Text>
          {SETUP_NEEDS.map((n, i) => (
            <View key={n.title} style={[styles.row, i === 0 && styles.rowFirst]}>
              <Icon name={n.icon} size={20} color={theme.text} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{n.title}</Text>
                <Text style={styles.rowDetail}>{n.detail}</Text>
              </View>
            </View>
          ))}
          <Text style={styles.footnote}>Takes about 5 minutes. You finish on Stripe's secure form, then come right back here.</Text>
        </View>
      )}

      {(state === 'onboarding_incomplete' || state === 'pending_verification') && journey.steps.length > 0 && (
        <View style={styles.section} testID="payouts-journey-steps">
          <Text style={styles.sectionTitle}>Your progress</Text>
          {journey.steps.map((s, i) => (
            <View key={s.id} style={[styles.row, i === 0 && styles.rowFirst]} accessibilityLabel={`${s.label}: ${STEP_STATUS[s.status]}`}>
              <Icon
                name={s.status === 'complete' ? 'check-circle' : s.status === 'in_review' ? 'clock' : 'circle'}
                size={20}
                color={s.status === 'needed' ? theme.muted : theme.text}
              />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{s.label}</Text>
                <Text style={styles.rowDetail}>{s.detail}</Text>
              </View>
              <Text style={styles.rowValue}>{STEP_STATUS[s.status]}</Text>
            </View>
          ))}
        </View>
      )}

      {state === 'action_needed' && !journey.rejected && journey.actionItems.length > 0 && (
        <View style={styles.section} testID="payouts-journey-action-items">
          <Text style={styles.sectionTitle}>What Stripe needs</Text>
          {journey.actionItems.map((item, i) => (
            <View key={`${item.step}-${i}`} style={[styles.row, i === 0 && styles.rowFirst]}>
              <Icon name="alert-circle" size={20} color={theme.text} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{item.detail || item.label}</Text>
                <Text style={styles.rowDetail}>{item.label}</Text>
              </View>
              {item.pastDue && <Text style={styles.rowValueStrong}>Past due</Text>}
            </View>
          ))}
        </View>
      )}

      {!ownerOnly && copy.cta && (
        <Button
          label={busy ? 'Opening Stripe…' : copy.cta}
          onPress={onPrimary}
          loading={busy}
          fullWidth
          style={styles.cta}
          testID="payouts-journey-cta"
        />
      )}
      {state === 'pending_verification' && (
        <Button
          label={refreshing ? 'Checking…' : 'Check status'}
          variant="secondary"
          onPress={onRefresh}
          loading={refreshing}
          fullWidth
          style={styles.cta}
          testID="payouts-journey-refresh"
        />
      )}
    </View>
  );
}

function ownerOnlyBody(state: Exclude<PayoutJourneyState, 'active'>): string {
  switch (state) {
    case 'not_started': return "Payouts aren't set up yet. The store owner sets them up with Stripe.";
    case 'pending_verification': return "Stripe is verifying the store owner's details. Payouts turn on as soon as it's done.";
    default: return 'The store owner needs to finish payout setup with Stripe.';
  }
}

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  wrap: { paddingHorizontal: SP.md, paddingTop: SP.lg },
  title: { color: theme.text, fontSize: 22, lineHeight: 28, fontFamily: FONT.bold },
  body: { color: theme.muted, fontSize: FS.base, lineHeight: 22, fontFamily: FONT.regular, marginTop: SP.sm },
  deadline: { color: theme.text, fontSize: FS.sm, fontFamily: FONT.semibold, marginTop: SP.sm },
  waiting: { color: theme.text, fontSize: FS.sm, fontFamily: FONT.medium, marginTop: SP.md, fontVariant: ['tabular-nums'] },
  section: { marginTop: SP.xl },
  sectionTitle: { color: theme.text, fontSize: 17, fontFamily: FONT.semibold, marginBottom: SP.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, minHeight: 56, paddingVertical: SP.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  rowFirst: { borderTopWidth: 0 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: theme.text, fontSize: FS.base, fontFamily: FONT.medium },
  rowDetail: { color: theme.muted, fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 2 },
  rowValue: { color: theme.muted, fontSize: FS.sm, fontFamily: FONT.medium },
  rowValueStrong: { color: theme.text, fontSize: FS.sm, fontFamily: FONT.semibold },
  footnote: { color: theme.muted, fontSize: FS.sm, lineHeight: 19, fontFamily: FONT.regular, marginTop: SP.md },
  cta: { marginTop: SP.lg },
});
