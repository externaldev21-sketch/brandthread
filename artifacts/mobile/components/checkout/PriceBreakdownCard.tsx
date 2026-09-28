/**
 * The ONE price breakdown on the checkout screen (SSENSE Subtotal / Shipping
 * Total / Order Total; GOAT "Total" block): Subtotal, Shipping, Tax,
 * Discount (only when a promo applies), Rewards (only when used), Total.
 * With Thread Cash applied, Total becomes Order total → Thread Cash →
 * Charged to card.
 *
 * Two presentations of the same lines:
 *  - the card (default), a section in the scrolling page;
 *  - `collapsible` (item 110), used by checkout's sticky footer: a
 *    "Total $X ⌃" row that expands the full breakdown above itself (Shop
 *    "Total $10.82 ⌄" over "Pay now"; Vestiaire "Price details ⌄"). The
 *    footer's "Place order · $X" button is a separate sibling control, never
 *    inside this one. The expand is a plain ease-out (no spring, no bounce)
 *    and is instant with Reduce Motion on.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import type { CheckoutDisplayTotals } from '@/lib/checkoutReadiness';
import { FONT, FS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { CheckoutCard, Hairline } from './CheckoutPrimitives';

const EXPAND_MS = 220;

function Line({ label, value, strong = false, testID }: { label: string; value: string; strong?: boolean; testID?: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.line} testID={testID}>
      <Text style={[strong ? styles.totalLabel : styles.label, { color: strong ? theme.text : theme.muted }]}>{label}</Text>
      <Text style={[strong ? styles.totalValue : styles.value, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

/** Every line above the final strong total. */
function DetailLines({ totals, itemCount }: { totals: CheckoutDisplayTotals; itemCount: number }) {
  return (
    <>
      <Line label={`Subtotal (${itemCount} ${itemCount === 1 ? 'item' : 'items'})`} value={formatCents(totals.subtotalCents)} />
      <Line label="Shipping" value={totals.shippingCents === 0 ? 'Free' : formatCents(totals.shippingCents)} />
      <Line label="Tax" value={totals.taxCents > 0 ? formatCents(totals.taxCents) : 'Calculated at payment'} />
      {totals.promoCents > 0 ? (
        <Line label="Discount" value={`−${formatCents(totals.promoCents)}`} testID="checkout-discount-line" />
      ) : null}
      {totals.rewardsCents > 0 ? (
        <Line label="Rewards" value={`−${formatCents(totals.rewardsCents)}`} />
      ) : null}
      {totals.threadCashCents > 0 ? (
        <>
          <Hairline style={{ marginVertical: SP.sm }} />
          {/* Item 109: Thread Cash pays part of the total, so it comes after
              it; the card line is what Stripe charges (talabat "Pay by card"). */}
          <Line label="Order total" value={formatCents(totals.orderTotalCents)} testID="checkout-order-total-line" />
          <Line label="Thread Cash" value={`−${formatCents(totals.threadCashCents)}`} testID="checkout-thread-cash-line" />
        </>
      ) : null}
    </>
  );
}

function totalLabel(totals: CheckoutDisplayTotals) {
  return totals.threadCashCents > 0 ? 'Charged to card' : 'Total';
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled?.()
      .then(value => { if (active) setReduce(!!value); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', value => setReduce(!!value));
    return () => {
      active = false;
      sub?.remove?.();
    };
  }, []);
  return reduce;
}

/** Item 110: the breakdown folded into the footer's total row. */
function CollapsibleBreakdown({
  totals, itemCount, expanded, onToggle,
}: {
  totals: CheckoutDisplayTotals;
  itemCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { theme } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  const [detailsHeight, setDetailsHeight] = useState(0);

  useEffect(() => {
    const to = expanded ? 1 : 0;
    if (reduceMotion) {
      progress.stopAnimation();
      progress.setValue(to);
      return;
    }
    Animated.timing(progress, {
      toValue: to,
      duration: EXPAND_MS,
      // Ease-out only: no spring, no overshoot.
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [expanded, reduceMotion, progress]);

  const label = totalLabel(totals);
  const amount = formatCents(totals.totalCents);

  return (
    <View testID="checkout-price-breakdown">
      <Animated.View
        style={{
          height: progress.interpolate({ inputRange: [0, 1], outputRange: [0, detailsHeight] }),
          opacity: progress,
          overflow: 'hidden',
        }}
        // Hidden from screen readers while folded away.
        accessibilityElementsHidden={!expanded}
        importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
        pointerEvents={expanded ? 'auto' : 'none'}
        testID="checkout-breakdown-details"
      >
        <View
          style={styles.details}
          onLayout={event => setDetailsHeight(event.nativeEvent.layout.height)}
        >
          <DetailLines totals={totals} itemCount={itemCount} />
          <Hairline style={{ marginTop: SP.sm }} />
        </View>
      </Animated.View>

      <PressableScale
        onPress={onToggle}
        style={styles.totalRow}
        accessibilityRole="button"
        accessibilityLabel={`${label} ${amount}`}
        accessibilityHint={expanded ? 'Hides the price breakdown' : 'Shows the price breakdown'}
        accessibilityState={{ expanded }}
        // react-native-web reads aria-* for the DOM attribute.
        aria-expanded={expanded}
        rippleEnabled={false}
        noMinHeight
        testID="checkout-total-toggle"
      >
        <View style={styles.totalLeft}>
          <Text style={[styles.footerTotalLabel, { color: theme.text }]}>{label}</Text>
          <Animated.View
            style={{
              transform: [{ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }],
            }}
          >
            <Feather name="chevron-up" size={18} color={theme.muted} />
          </Animated.View>
        </View>
        <Text style={[styles.footerTotalValue, { color: theme.text }]} testID="checkout-total-line">{amount}</Text>
      </PressableScale>
    </View>
  );
}

export function PriceBreakdownCard({
  totals, itemCount, collapsible,
}: {
  totals: CheckoutDisplayTotals;
  itemCount: number;
  /** Item 110: render as the sticky footer's collapsible total instead of a page card. */
  collapsible?: { expanded: boolean; onToggle: () => void };
}) {
  if (collapsible) {
    return <CollapsibleBreakdown totals={totals} itemCount={itemCount} expanded={collapsible.expanded} onToggle={collapsible.onToggle} />;
  }
  return (
    <CheckoutCard title="Order total" testID="checkout-price-breakdown">
      <DetailLines totals={totals} itemCount={itemCount} />
      {totals.threadCashCents > 0 ? null : <Hairline style={{ marginVertical: SP.sm }} />}
      <Line label={totalLabel(totals)} value={formatCents(totals.totalCents)} strong testID="checkout-total-line" />
    </CheckoutCard>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: SP.sm, paddingVertical: 5 },
  label: { fontFamily: FONT.regular, fontSize: FS.base, flexShrink: 1 },
  value: { fontFamily: FONT.medium, fontSize: FS.base, ...TABULAR_NUMS },
  totalLabel: { fontFamily: FONT.semibold, fontSize: FS.md },
  totalValue: { fontFamily: FONT.bold, fontSize: FS.lg, ...TABULAR_NUMS },
  details: { position: 'absolute', left: 0, right: 0, top: 0, paddingBottom: SP.xs },
  totalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 44, marginBottom: SP.xs,
  },
  totalLeft: { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  footerTotalLabel: { fontFamily: FONT.semibold, fontSize: FS.md },
  footerTotalValue: { fontFamily: FONT.bold, fontSize: FS.lg, ...TABULAR_NUMS },
});
