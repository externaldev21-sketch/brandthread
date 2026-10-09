/**
 * "Get ready to sell" — Shopify's home setup guide, reskinned black / white /
 * silver: a title, a one-line subtitle, a "0 / 6 completed" pill, a grouped
 * list whose rows carry a dashed circle that becomes a check, and a "Select a
 * plan" block under it while the seller has no plan. Shared: the seller
 * dashboard shows it until the first sale, and onboarding routes here too.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Button } from '@/components/ui';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { TYPE_SCALE } from '@/constants/typography';
import {
  READY_TO_SELL_STEPS, READY_TO_SELL_SUBTITLE, READY_TO_SELL_TITLE, completedLabel,
  type ReadyToSellResponse,
} from '@/lib/readyToSell';
import { SELLER_PLANS } from '@/lib/sellerPlans';

interface Props {
  data: ReadyToSellResponse;
  /** null while unknown — the plan block stays hidden rather than flashing. */
  hasPlan: boolean | null;
  onOpen: (route: string) => void;
  testID?: string;
}

const CIRCLE = 20;
const STARTING_PRICE = SELLER_PLANS.reduce((min, p) => Math.min(min, p.priceCents), Infinity);

export function ReadyToSellChecklist({ data, hasPlan, onOpen, testID = 'ready-to-sell' }: Props) {
  const { theme } = useAppTheme();

  return (
    <View testID={testID}>
      <Text style={[styles.title, { color: theme.text }]}>{READY_TO_SELL_TITLE}</Text>
      <Text style={[styles.subtitle, { color: theme.muted }]}>{READY_TO_SELL_SUBTITLE}</Text>
      <View style={[styles.pill, { borderColor: theme.border }]} testID={`${testID}-count`}>
        <Text style={[styles.pillText, { color: theme.muted }]}>{completedLabel(data)}</Text>
      </View>

      <View style={[styles.group, { borderColor: theme.borderSubtle }]}>
        {data.steps.map((step, i) => {
          const meta = READY_TO_SELL_STEPS[step.id];
          return (
            <PressableScale
              key={step.id}
              onPress={() => onOpen(meta.route)}
              style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.borderSubtle }]}
              accessibilityRole="button"
              accessibilityLabel={`${meta.title}${step.done ? ', done' : ''}`}
              testID={`${testID}-${step.id}`}
            >
              {step.done ? (
                <View style={[styles.check, { backgroundColor: theme.text }]}>
                  <Feather name="check" size={13} color={theme.background} />
                </View>
              ) : (
                <View style={[styles.dashed, { borderColor: theme.muted }]} />
              )}
              <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>{meta.title}</Text>
              <Feather name="chevron-right" size={18} color={theme.subtle} />
            </PressableScale>
          );
        })}
      </View>

      {hasPlan === false ? (
        <View style={[styles.plan, { borderColor: theme.borderSubtle }]} testID={`${testID}-plan`}>
          <Text style={[styles.planTitle, { color: theme.text }]}>Start your 5-day free trial</Text>
          <Text style={[styles.planBody, { color: theme.muted }]}>
            {`Plans start at $${STARTING_PRICE / 100}/month.`}
          </Text>
          <Button
            label="Select a plan"
            variant="secondary"
            onPress={() => onOpen('/plans')}
            fullWidth
            style={styles.planButton}
            testID={`${testID}-select-plan`}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { ...TYPE_SCALE.headline },
  subtitle: { ...TYPE_SCALE.footnote, marginTop: 4 },
  pill: {
    alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 999, borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: { ...TYPE_SCALE.caption },
  group: { marginTop: 14, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, paddingHorizontal: 16 },
  dashed: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, borderWidth: 1.5, borderStyle: 'dashed' },
  check: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...TYPE_SCALE.body, flex: 1 },
  plan: { marginTop: 16, borderRadius: 12, borderWidth: 1, padding: 16 },
  planTitle: { ...TYPE_SCALE.headline },
  planBody: { ...TYPE_SCALE.footnote, marginTop: 4 },
  planButton: { marginTop: 14 },
});
