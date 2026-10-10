/**
 * Plan & billing sheets (Shopify "Plan" flows, reskinned black/white/silver):
 *  - PlanOptionCard: one plan in the "Select a plan" list (name, tagline,
 *    price, full-width action, feature rows).
 *  - ChangePlanSheet: "Select a plan" → review what changes → switch.
 *  - CancelPlanSheet: options (cancel / switch to the plan below) → main
 *    reason → confirm with a required checkbox → cancel at period end.
 *  - PlanFeaturesSheet: every feature of the current plan.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet, Button, Icon, IconButton, Input } from '@/components/ui';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { FILL_ELEVATED, TABULAR, TEXT } from '@/lib/theme';
import { SELLER_PLANS, getSellerPlan, type SellerPlanDefinition } from '@/lib/sellerPlans';
import type { PerksResponse } from '@/lib/proPerks';
import {
  CANCEL_COMMENT_MAX,
  CANCEL_REASONS,
  lostFeatures,
  planChangeRows,
  planDirection,
  planPriceLabel,
  productCapWarning,
  prorationNote,
  type PlanState,
} from '@/lib/sellerPlanBilling';
import type { SellerPlanId } from '@/lib/sellerBilling';

function useStyles() {
  const { theme } = useAppTheme();
  return React.useMemo(() => createStyles(theme), [theme]);
}

function SheetHeader({ title, onLeft, leftIcon }: { title: string; onLeft: () => void; leftIcon: 'x' | 'arrow-left' }) {
  const styles = useStyles();
  return (
    <View style={styles.sheetHeader}>
      <View style={styles.sheetHeaderSide}>
        <IconButton
          name={leftIcon}
          onPress={onLeft}
          variant="filled"
          accessibilityLabel={leftIcon === 'x' ? 'Close' : 'Back'}
        />
      </View>
      <Text style={styles.sheetTitle} numberOfLines={1}>{title}</Text>
      <View style={styles.sheetHeaderSide} />
    </View>
  );
}

// ─── Plan option card ────────────────────────────────────────────────────────

export function PlanOptionCard({
  plan, perks, isCurrent, actionLabel, actionVariant, onAction, disabled, testID,
}: {
  plan: SellerPlanDefinition;
  perks: PerksResponse | null;
  isCurrent: boolean;
  actionLabel: string;
  actionVariant: 'primary' | 'secondary';
  onAction?: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const styles = useStyles();
  const features = plan.features;
  return (
    <View style={styles.optionCard} testID={testID ? `${testID}-card` : undefined}>
      <View style={styles.optionTop}>
        <Text style={styles.optionName}>{plan.name}</Text>
        {isCurrent && <Text style={styles.badgeText}>Current plan</Text>}
      </View>
      <Text style={styles.optionTagline}>{plan.tagline}</Text>
      <View style={styles.optionPriceRow}>
        <Text style={styles.optionPrice}>{planPriceLabel(plan.id, perks)}</Text>
        <Text style={styles.optionPeriod}>/mo</Text>
      </View>
      <Button
        label={actionLabel}
        variant={actionVariant}
        onPress={() => onAction?.()}
        disabled={disabled || !onAction}
        fullWidth
        testID={testID}
      />
      <View style={styles.optionFeatures}>
        {features.map((feature, index) => (
          <View key={feature} style={[styles.optionFeature, index > 0 && styles.hairlineTop]}>
            <Text style={styles.optionFeatureText}>{feature}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Change plan ─────────────────────────────────────────────────────────────

export function ChangePlanSheet({
  visible, onClose, currentPlanId, state, perks, initialTargetId, busy, onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  currentPlanId: string;
  state: PlanState;
  perks: PerksResponse | null;
  /** Opens straight on the review step (e.g. "Switch to Starter" from the cancel sheet). */
  initialTargetId?: SellerPlanId | null;
  busy: boolean;
  onConfirm: (planId: SellerPlanId) => void;
}) {
  const styles = useStyles();
  const [targetId, setTargetId] = useState<SellerPlanId | null>(initialTargetId ?? null);

  useEffect(() => {
    if (visible) setTargetId(initialTargetId ?? null);
  }, [visible, initialTargetId]);

  const currentId = getSellerPlan(currentPlanId)?.id ?? currentPlanId;
  const target = targetId ? getSellerPlan(targetId) : undefined;

  return (
    <BottomSheet visible={visible} onClose={onClose} testID="billing-change-plan-sheet">
      {!target ? (
        <View style={styles.sheetBody}>
          <SheetHeader title="Select a plan" leftIcon="x" onLeft={onClose} />
          {SELLER_PLANS.map((plan) => {
            const isCurrent = plan.id === currentId;
            const direction = planDirection(currentId, plan.id);
            return (
              <PlanOptionCard
                key={plan.id}
                plan={plan}
                perks={perks}
                isCurrent={isCurrent}
                actionLabel={isCurrent ? 'Current plan' : `Switch to ${plan.name}`}
                actionVariant={direction === 'upgrade' ? 'primary' : 'secondary'}
                onAction={isCurrent ? undefined : () => setTargetId(plan.id)}
                disabled={isCurrent}
                testID={`billing-pick-${plan.id}`}
              />
            );
          })}
        </View>
      ) : (
        <ChangeReview
          currentId={currentId}
          target={target}
          state={state}
          perks={perks}
          busy={busy}
          onBack={() => (initialTargetId ? onClose() : setTargetId(null))}
          onConfirm={() => onConfirm(target.id)}
        />
      )}
    </BottomSheet>
  );
}

function ChangeReview({
  currentId, target, state, perks, busy, onBack, onConfirm,
}: {
  currentId: string;
  target: SellerPlanDefinition;
  state: PlanState;
  perks: PerksResponse | null;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const styles = useStyles();
  const direction = planDirection(currentId, target.id);
  const rows = planChangeRows(currentId, target.id, perks);
  const lost = lostFeatures(currentId, target.id);
  const capWarning = productCapWarning(currentId, target.id, perks);
  const currentName = getSellerPlan(currentId)?.name ?? 'Current';

  return (
    <View style={styles.sheetBody} testID="billing-change-review">
      <SheetHeader title={`Switch to ${target.name}`} leftIcon="arrow-left" onLeft={onBack} />

      <View style={styles.table}>
        <View style={styles.tableHead}>
          <Text style={[styles.tableLabel, styles.tableHeadText]} />
          <Text style={[styles.tableValue, styles.tableHeadText]} numberOfLines={1}>{currentName}</Text>
          <Text style={[styles.tableValue, styles.tableHeadText]} numberOfLines={1}>{target.name}</Text>
        </View>
        {rows.map((row) => (
          <View key={row.label} style={[styles.tableRow, styles.hairlineTop]}>
            <Text style={styles.tableLabel}>{row.label}</Text>
            <Text style={[styles.tableValue, styles.tableFrom]} numberOfLines={1}>{row.from}</Text>
            <Text style={[styles.tableValue, styles.tableTo]} numberOfLines={1}>{row.to}</Text>
          </View>
        ))}
      </View>

      {direction === 'downgrade' && lost.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>{`You'll lose`}</Text>
          {lost.map((feature) => (
            <View key={feature} style={styles.bulletRow}>
              <Icon name="minus" size={17} color={styles.muted.color} style={styles.bulletIcon} />
              <Text style={styles.bulletText}>{feature}</Text>
            </View>
          ))}
        </View>
      )}

      {capWarning && (
        <View style={styles.warning} testID="billing-change-cap-warning">
          <Icon name="alert-triangle" size={16} color={styles.strong.color} />
          <Text style={styles.warningText}>{capWarning}</Text>
        </View>
      )}

      <Text style={styles.note}>{prorationNote(direction, state, target.id, perks)}</Text>

      <View style={styles.actions}>
        <Button
          label={`Switch to ${target.name}`}
          onPress={onConfirm}
          loading={busy}
          disabled={busy}
          fullWidth
          testID="billing-change-confirm"
        />
        <Button label="Back" variant="secondary" onPress={onBack} disabled={busy} fullWidth />
      </View>
    </View>
  );
}

// ─── Cancel plan ─────────────────────────────────────────────────────────────

type CancelStep = 'options' | 'reason' | 'confirm';

export function CancelPlanSheet({
  visible, onClose, planName, endsOn, lowerPlanId, perks, busy, onSwitchLower, onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  planName: string;
  endsOn: string | null;
  lowerPlanId: SellerPlanId | null;
  perks: PerksResponse | null;
  busy: boolean;
  onSwitchLower: (planId: SellerPlanId) => void;
  onConfirm: (feedback: { reason: string; comment?: string }) => void;
}) {
  const styles = useStyles();
  const [step, setStep] = useState<CancelStep>('options');
  const [reason, setReason] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStep('options');
    setReason(null);
    setComment('');
    setAgreed(false);
  }, [visible]);

  const lower = lowerPlanId ? getSellerPlan(lowerPlanId) : undefined;
  const until = endsOn ? `until ${endsOn}` : 'until the end of this billing period';

  return (
    <BottomSheet visible={visible} onClose={onClose} testID="billing-cancel-sheet">
      {step === 'options' && (
        <View style={styles.sheetBody} testID="billing-cancel-options">
          <SheetHeader title="Cancel plan" leftIcon="x" onLeft={onClose} />
          <Pressable
            accessibilityRole="button"
            onPress={() => setStep('reason')}
            style={styles.optionRow}
            testID="billing-cancel-option-cancel"
          >
            <View style={styles.optionRowBody}>
              <Text style={styles.optionRowTitle}>Cancel plan</Text>
              <Text style={styles.optionRowText}>{`${planName} ends ${endsOn ? `on ${endsOn}` : 'at the end of this billing period'}. Your products and orders are kept.`}</Text>
            </View>
            <Icon name="chevron-right" size={18} color={styles.muted.color} />
          </Pressable>
          {lower && (
            <Pressable
              accessibilityRole="button"
              onPress={() => onSwitchLower(lower.id)}
              style={[styles.optionRow, styles.hairlineTop]}
              testID="billing-cancel-option-switch"
            >
              <View style={styles.optionRowBody}>
                <Text style={styles.optionRowTitle}>{`Switch to ${lower.name}`}</Text>
                <Text style={styles.optionRowText}>{`For ${planPriceLabel(lower.id, perks)}/month. ${lower.tagline}.`}</Text>
              </View>
              <Icon name="chevron-right" size={18} color={styles.muted.color} />
            </Pressable>
          )}
        </View>
      )}

      {step === 'reason' && (
        <View style={styles.sheetBody} testID="billing-cancel-reason">
          <SheetHeader title="Cancel plan" leftIcon="arrow-left" onLeft={() => setStep('options')} />
          <Text style={styles.fieldLabel}>What is the main reason you are cancelling?</Text>
          <View style={styles.reasonList}>
            {CANCEL_REASONS.map((item, index) => {
              const selected = reason === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setReason(item.id)}
                  style={[styles.reasonRow, index > 0 && styles.hairlineTop]}
                  testID={`billing-cancel-reason-${item.id}`}
                >
                  <Text style={[styles.reasonText, selected && styles.strong]}>{item.label}</Text>
                  {selected && <Icon name="check" size={18} color={styles.strong.color} />}
                </Pressable>
              );
            })}
          </View>
          {reason && (
            <View style={{ gap: SPACING.xxs }}>
              <Input
                label="Anything you'd like to add? (Optional)"
                value={comment}
                onChangeText={(text) => setComment(text.slice(0, CANCEL_COMMENT_MAX))}
                multiline
                maxLength={CANCEL_COMMENT_MAX}
                testID="billing-cancel-comment"
              />
              <Text style={styles.counter}>{`${comment.length}/${CANCEL_COMMENT_MAX}`}</Text>
            </View>
          )}
          <View style={styles.actions}>
            <Button label="Continue" onPress={() => setStep('confirm')} disabled={!reason} fullWidth testID="billing-cancel-continue" />
            <Button label="Back" variant="secondary" onPress={() => setStep('options')} fullWidth />
          </View>
        </View>
      )}

      {step === 'confirm' && (
        <View style={styles.sheetBody} testID="billing-cancel-confirm">
          <SheetHeader title="Cancel plan" leftIcon="arrow-left" onLeft={() => setStep('reason')} />
          <View style={styles.block}>
            <Text style={styles.blockTitle}>{`${planName} stays active ${until}`}</Text>
            <Text style={styles.blockText}>
              After that, seller tools are paused until you choose a plan again. Your products and orders are kept.
            </Text>
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            onPress={() => setAgreed((value) => !value)}
            style={styles.checkRow}
            testID="billing-cancel-agree"
          >
            <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
              {agreed && <Icon name="check" size={14} color={styles.onStrong.color} />}
            </View>
            <View style={styles.optionRowBody}>
              <Text style={styles.optionRowTitle}>Cancel my plan</Text>
              <Text style={styles.optionRowText}>{endsOn ? `Plan stays active until ${endsOn}` : 'Plan stays active until the end of this billing period'}</Text>
            </View>
          </Pressable>
          <View style={styles.actions}>
            <Button
              label="Cancel plan"
              variant="destructive"
              onPress={() => reason && onConfirm({ reason, comment: comment.trim() || undefined })}
              disabled={!agreed || busy}
              loading={busy}
              fullWidth
              testID="billing-cancel-submit"
            />
            <Button label="Back" variant="secondary" onPress={() => setStep('reason')} disabled={busy} fullWidth />
          </View>
        </View>
      )}
    </BottomSheet>
  );
}

// ─── All features ────────────────────────────────────────────────────────────

export function PlanFeaturesSheet({ visible, onClose, planId }: { visible: boolean; onClose: () => void; planId: string }) {
  const styles = useStyles();
  const plan = getSellerPlan(planId);
  const index = SELLER_PLANS.findIndex((p) => p.id === plan?.id);
  const features = index < 0 ? [] : SELLER_PLANS.slice(0, index + 1)
    .flatMap((p) => p.features.filter((f) => !/^Everything in /i.test(f)));
  return (
    <BottomSheet visible={visible} onClose={onClose} testID="billing-features-sheet">
      <View style={styles.sheetBody}>
        <SheetHeader title={plan ? `${plan.name} features` : 'Features'} leftIcon="x" onLeft={onClose} />
        {features.map((feature, i) => (
          <View key={feature} style={[styles.featureRow, i > 0 && styles.hairlineTop]}>
            <Icon name="check" size={16} color={styles.strong.color} />
            <Text style={styles.bulletText}>{feature}</Text>
          </View>
        ))}
      </View>
    </BottomSheet>
  );
}

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  muted: { color: theme.muted },
  strong: { color: theme.text },
  onStrong: { color: theme.background },
  hairlineTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  sheetBody: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.md, gap: SPACING.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: SPACING.xxs },
  sheetHeaderSide: { width: 44, alignItems: 'flex-start' },
  sheetTitle: { ...TEXT.headline, flex: 1, textAlign: 'center', color: theme.text },
  // Flat plan section: content on the background, plans split by a hairline (no bordered card).
  optionCard: { paddingVertical: SPACING.md, gap: SPACING.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  optionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.xs },
  optionName: { ...TEXT.title2, color: theme.text },
  optionTagline: { ...TEXT.subhead, color: theme.muted },
  optionPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2, marginBottom: SPACING.xxs },
  optionPrice: { ...TEXT.title1, ...TABULAR, color: theme.text },
  optionPeriod: { ...TEXT.subhead, color: theme.muted },
  optionFeatures: { marginTop: SPACING.xxs },
  optionFeature: { paddingVertical: SPACING.sm },
  optionFeatureText: { ...TEXT.subhead, color: theme.text },
  badgeText: { ...TEXT.footnote, color: theme.muted },
  table: {},
  tableHead: { flexDirection: 'row', paddingBottom: SPACING.xs, gap: SPACING.xs },
  tableHeadText: { ...TEXT.footnote, color: theme.muted },
  tableRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: SPACING.xs },
  tableLabel: { ...TEXT.subhead, flex: 1.1, color: theme.muted },
  tableValue: { ...TEXT.subhead, ...TABULAR, flex: 1, textAlign: 'right' },
  tableFrom: { color: theme.muted },
  tableTo: { color: theme.text, fontFamily: TEXT.headline.fontFamily },
  block: { gap: SPACING.xs },
  blockTitle: { ...TEXT.headline, color: theme.text },
  blockText: { ...TEXT.subhead, color: theme.muted },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.xs },
  bulletIcon: { marginTop: 2 },
  bulletText: { ...TEXT.subhead, color: theme.text, flex: 1 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 52, paddingVertical: SPACING.xs },
  warning: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start' },
  warningText: { ...TEXT.footnote, color: theme.text, flex: 1 },
  note: { ...TEXT.footnote, color: theme.muted },
  actions: { gap: SPACING.xs, marginTop: SPACING.xs },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.md },
  optionRowBody: { flex: 1, gap: 2 },
  optionRowTitle: { ...TEXT.headline, color: theme.text },
  optionRowText: { ...TEXT.subhead, color: theme.muted },
  fieldLabel: { ...TEXT.footnote, color: theme.muted },
  reasonList: {},
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 52, paddingVertical: SPACING.xs },
  reasonText: { ...TEXT.subhead, color: theme.muted, flex: 1 },
  counter: { ...TEXT.caption, color: theme.muted, alignSelf: 'flex-end' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: FILL_ELEVATED, borderRadius: RADII.card, padding: SPACING.md },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 1.5, borderColor: theme.muted, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: theme.text, borderColor: theme.text },
});
