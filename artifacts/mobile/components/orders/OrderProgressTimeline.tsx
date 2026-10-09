import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { formatDate } from '@/lib/format';
import type { OrderStatus, TrackingStatus } from '@/services/orderTypes';
import { radius } from '@/constants/radii';

/**
 * Detailed, vertical, timestamped order-progress tracker for the buyer order
 * detail screen: Order placed → Processing → Shipped → Out for delivery →
 * Delivered, with the current step highlighted and animated and future steps
 * dimmed. This is a different (more granular, timestamped) view than the
 * compact horizontal `OrderStatusTimeline` used on list cards and the seller
 * detail screen — it's specific to this screen's "here's exactly where your
 * package is" job, not a replacement for the shared component.
 *
 * Timestamps are only ever real data (order placed / payment confirmed /
 * shipped) — steps we don't have a server timestamp for (out-for-delivery,
 * delivered) render without a clock time rather than showing a fabricated
 * one; a not-yet-delivered order shows the carrier's real estimate on the
 * Delivered step instead.
 *
 * Monochrome (item 107): done / current steps use the theme's text colour,
 * not its accent, so colored themes don't tint the tracker. The current
 * step's pulse is skipped under Reduce Motion.
 */

type StepKey = 'placed' | 'confirmed' | 'shipped' | 'out_for_delivery' | 'delivered';

const STEPS: { key: StepKey; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'placed', label: 'Order placed', icon: 'shopping-bag' },
  { key: 'confirmed', label: 'Confirmed', icon: 'clipboard' },
  { key: 'shipped', label: 'Shipped', icon: 'package' },
  { key: 'out_for_delivery', label: 'Out for delivery', icon: 'truck' },
  { key: 'delivered', label: 'Delivered', icon: 'check-circle' },
];

const EXCEPTION_COPY: Record<'cancelled' | 'refunded' | 'disputed' | 'returned_to_sender' | 'exception', { label: string; icon: keyof typeof Feather.glyphMap }> = {
  cancelled: { label: 'Order cancelled', icon: 'x-circle' },
  refunded: { label: 'Order refunded', icon: 'rotate-ccw' },
  disputed: { label: 'Order disputed', icon: 'alert-triangle' },
  returned_to_sender: { label: 'Returned to sender', icon: 'corner-up-left' },
  exception: { label: 'Delivery problem', icon: 'alert-triangle' },
};

export function stepIndex(status: OrderStatus, trackingStatus: TrackingStatus | undefined, paidAt?: string): number {
  if (status === 'delivered' || trackingStatus === 'delivered') return 4;
  if (trackingStatus === 'out_for_delivery') return 3;
  if (status === 'shipped' || trackingStatus === 'in_transit' || trackingStatus === 'accepted' || trackingStatus === 'label_created') return 2;
  // Confirmed = the seller has it (processing / ready to ship) or payment
  // has been captured for a still-"new" order.
  if (status === 'processing' || status === 'ready_to_ship' || !!paidAt) return 1;
  return 0;
}

/** "Est. Oct 1" from a YYYY-MM-DD (orders.estimated_delivery) or ISO string, read as a calendar date. */
export function fmtEstimate(value: string | undefined): string {
  if (!value) return '';
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = ymd ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `Est. ${formatDate(d, { month: 'short', day: 'numeric' })}`;
}

function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

export function OrderProgressTimeline({
  status,
  createdAt,
  paidAt,
  shippedAt,
  estimatedDelivery,
  trackingStatus,
  trackingCarrier,
  trackingNumber,
  onTrackPress,
}: {
  status: OrderStatus;
  createdAt: string;
  /** When payment was captured (orders.paid_at) — the "Confirmed" time. */
  paidAt?: string;
  shippedAt?: string;
  /** Carrier estimate, shown on the Delivered step until it's delivered. */
  estimatedDelivery?: string;
  trackingStatus?: TrackingStatus;
  trackingCarrier?: string;
  trackingNumber?: string;
  onTrackPress?: () => void;
}) {
  const { theme } = useAppTheme();
  const pulse = useRef(new Animated.Value(0.5)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo?.isReduceMotionEnabled?.()
      .then(value => { if (alive) setReduceMotion(value); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const exceptionKey =
    status === 'cancelled' ? 'cancelled'
    : status === 'refunded' ? 'refunded'
    : status === 'disputed' ? 'disputed'
    : trackingStatus === 'returned_to_sender' ? 'returned_to_sender'
    : trackingStatus === 'exception' ? 'exception'
    : null;

  const activeIndex = stepIndex(status, trackingStatus, paidAt);
  const isFullyDelivered = activeIndex === 4;

  useEffect(() => {
    if (exceptionKey || isFullyDelivered || reduceMotion) { pulse.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [exceptionKey, isFullyDelivered, pulse, reduceMotion]);

  if (exceptionKey) {
    const copy = EXCEPTION_COPY[exceptionKey];
    const c = exceptionKey === 'refunded' ? theme.accent : theme.error;
    return (
      <View style={[styles.exceptionWrap, { backgroundColor: theme.surface, borderColor: c }]}>
        <Feather name={copy.icon} size={ICON.md} color={c} />
        <Text style={[styles.exceptionLabel, { color: c }]}>{copy.label}</Text>
      </View>
    );
  }

  return (
    <View>
      {STEPS.map((step, i) => {
        const done = i < activeIndex || (i === activeIndex && isFullyDelivered);
        const active = i === activeIndex && !isFullyDelivered;
        const future = i > activeIndex;
        const dotColor = done || active ? theme.text : theme.border;
        const timestamp = step.key === 'placed' ? createdAt
          : step.key === 'confirmed' ? paidAt
          : step.key === 'shipped' ? shippedAt
          : undefined;
        const estimate = step.key === 'delivered' && !isFullyDelivered ? fmtEstimate(estimatedDelivery) : '';

        return (
          <View key={step.key} style={styles.stepRow} testID={`order-step-${step.key}`} accessibilityState={{ selected: active || (isFullyDelivered && i === 4) }}>
            <View style={styles.railCol}>
              <Animated.View
                style={[
                  styles.dot,
                  {
                    backgroundColor: done ? theme.text : theme.surface,
                    borderColor: dotColor,
                    opacity: active ? pulse : 1,
                  },
                ]}
              >
                <Feather
                  name={done ? 'check' : step.icon}
                  size={13}
                  color={done ? theme.background : active ? theme.text : theme.muted}
                />
              </Animated.View>
              {i < STEPS.length - 1 ? (
                <View style={[styles.connector, { backgroundColor: i < activeIndex ? theme.text : theme.border }]} />
              ) : null}
            </View>

            <View style={styles.stepBody}>
              <Text style={[styles.stepLabel, { color: future ? theme.muted : theme.text }, active && styles.stepLabelActive]}>
                {step.label}
              </Text>
              {timestamp ? (
                <Text style={[styles.stepTimestamp, { color: theme.muted }]}>{fmtTimestamp(timestamp)}</Text>
              ) : active ? (
                <Text style={[styles.stepTimestamp, { color: theme.text }]}>In progress</Text>
              ) : estimate ? (
                <Text style={[styles.stepTimestamp, { color: theme.muted }]}>{estimate}</Text>
              ) : null}

              {step.key === 'shipped' && (done || active) && trackingNumber ? (
                <TouchableOpacity
                  style={[styles.trackChip, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}
                  onPress={onTrackPress}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={`Track package with ${trackingCarrier ?? 'carrier'}, tracking number ${trackingNumber}`}
                >
                  <Feather name="truck" size={ICON.xs} color={theme.text} />
                  <Text style={[styles.trackChipText, { color: theme.text }]} numberOfLines={1}>
                    {trackingCarrier ? `${trackingCarrier} · ` : ''}{trackingNumber}
                  </Text>
                  <Feather name="external-link" size={ICON.xs} color={theme.muted} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stepRow: { flexDirection: 'row' },
  railCol: { alignItems: 'center', width: 32 },
  dot: {
    width: 26, height: 26, borderRadius: RADIUS.pill, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  connector: { width: 2, flex: 1, minHeight: 20, marginVertical: 2, borderRadius: 1 },
  stepBody: { flex: 1, paddingBottom: SP.md, paddingLeft: SP.sm },
  stepLabel: { fontFamily: FONT.semibold, fontSize: FS.sm },
  stepLabelActive: { fontFamily: FONT.bold },
  stepTimestamp: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  trackChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', marginTop: SP.xs,
    paddingHorizontal: SP.sm, paddingVertical: 6,
    borderRadius: radius.sm, borderWidth: 1,
  },
  trackChipText: { fontFamily: FONT.semibold, fontSize: FS.xs, maxWidth: 180 },
  exceptionWrap: {
    flexDirection: 'row', alignItems: 'center', gap: SP.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: SP.sm, paddingVertical: SP.xs,
    borderRadius: RADIUS.pill, borderWidth: 1,
  },
  exceptionLabel: { fontFamily: FONT.bold, fontSize: FS.sm },
});
