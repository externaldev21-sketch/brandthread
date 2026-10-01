import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import type { BuyerDelivery, DeliveryStep } from '@/services/orderTypes';
import {
  autoRefundSummary, formatCalendarDate, formatLocalDate, formatLocalDateTime, guaranteeLine,
} from '@/lib/deliveryGuarantee';
import { PrimaryButton } from '@/components/BrandthreadUI';

/**
 * Buyer delivery tracker (Amazon / Shop pattern): headline date, a five-step
 * bar (Ordered → Preparing → Shipped → Out for delivery → Delivered) driven by
 * `delivery.steps`, carrier + tracking number, the carrier's event feed, and
 * the quiet guarantee line. Monochrome like OrderProgressTimeline: done and
 * current steps use the theme text colour, nothing is tinted.
 */

/** One-line labels that fit five equal columns at 393px without wrapping or ellipsis. */
const SHORT_STEP_LABEL: Partial<Record<DeliveryStep['key'], string>> = { out_for_delivery: 'Delivering' };

function ActionButton({ label, icon, onPress }: { label: string; icon: keyof typeof Feather.glyphMap; onPress: () => void }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => styles(theme), [theme]);
  return (
    <TouchableOpacity style={s.actionBtn} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} activeOpacity={0.8}>
      <Feather name={icon} size={ICON.sm} color={theme.text} />
      <Text style={s.actionBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function StepBar({ steps }: { steps: DeliveryStep[] }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => styles(theme), [theme]);
  return (
    <View style={s.stepRow} accessibilityRole="progressbar">
      {steps.map((step, i) => {
        const done = step.state === 'done';
        const current = step.state === 'current';
        const reached = done || current;
        const prevReached = i > 0 && steps[i - 1].state !== 'upcoming';
        return (
          <View key={step.key} style={s.stepCol} accessibilityLabel={`${step.label}, ${step.state}`}>
            <View style={s.dotRow}>
              <View style={[s.line, i === 0 && s.lineHidden, prevReached && reached && { backgroundColor: theme.text }]} />
              <View style={[s.dot, reached && { backgroundColor: theme.text, borderColor: theme.text }, current && s.dotCurrent]}>
                {done ? <Feather name="check" size={10} color={theme.background} /> : null}
              </View>
              <View style={[s.line, i === steps.length - 1 && s.lineHidden, done && steps[i + 1]?.state !== 'upcoming' && { backgroundColor: theme.text }]} />
            </View>
            <Text style={[s.stepLabel, reached && { color: theme.text, fontFamily: FONT.semibold }]}>
              {SHORT_STEP_LABEL[step.key] ?? step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function DeliveryTrackerCard({
  delivery, status, storeName, onCopyTracking, trackingCopied, onOpenTracking, onConfirmReceipt,
}: {
  delivery: BuyerDelivery;
  status: string;
  /** Shown above the headline now that the screen header carries the title only. */
  storeName?: string;
  onCopyTracking: () => void;
  trackingCopied: boolean;
  onOpenTracking: () => void;
  onConfirmReceipt: () => void;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const delivered = !!delivery.deliveredAt || status === 'delivered';
  const shippedStep = delivery.steps.find(x => x.key === 'shipped');
  const shipped = !!shippedStep && shippedStep.state !== 'upcoming';
  const outForDelivery = delivery.steps.find(x => x.key === 'out_for_delivery')?.state === 'current';
  const eta = delivery.estimatedDelivery ? formatCalendarDate(delivery.estimatedDelivery) : '';

  let headline = 'Order placed';
  if (delivered) {
    const when = formatLocalDate(delivery.deliveredAt);
    headline = when ? `Delivered ${when}` : 'Delivered';
  } else if (outForDelivery) headline = 'Out for delivery';
  else if (shipped) headline = eta ? `Arriving ${eta}` : 'On its way';
  else if (delivery.isPreorder && delivery.promisedShipDate) headline = 'Pre-order confirmed';
  else headline = 'Preparing your order';

  const guarantee = delivered ? null : guaranteeLine(delivery.deliverBy);

  return (
    <View style={s.card}>
      {storeName ? <Text style={s.store} numberOfLines={1}>{storeName}</Text> : null}
      <Text style={s.headline}>{headline}</Text>
      {delivered && delivery.deliveryConfirmedBy ? (
        <Text style={s.sub}>{delivery.deliveryConfirmedBy === 'buyer' ? 'Confirmed by you' : 'Confirmed by the carrier'}</Text>
      ) : null}
      {!shipped && delivery.isPreorder && delivery.promisedShipDate ? (
        <Text style={s.sub}>Seller ships by {formatLocalDate(delivery.promisedShipDate)}</Text>
      ) : null}

      <StepBar steps={delivery.steps} />

      {delivery.disputePaused ? (
        <View style={s.note}>
          <Feather name="pause-circle" size={ICON.sm} color={theme.muted} />
          <Text style={s.noteText}>Dispute open — auto-refund paused until it is resolved.</Text>
        </View>
      ) : null}

      {delivery.trackingNumber ? (
        <View style={s.trackBlock}>
          <View style={{ flex: 1 }}>
            <Text style={s.trackCarrier}>{delivery.carrier ?? 'Carrier'}</Text>
            <Text style={s.trackNumber} selectable numberOfLines={1}>{delivery.trackingNumber}</Text>
          </View>
        </View>
      ) : null}
      {delivery.trackingNumber ? (
        <View style={s.btnRow}>
          <ActionButton
            label={trackingCopied ? 'Copied' : 'Copy'}
            icon={trackingCopied ? 'check' : 'copy'}
            onPress={onCopyTracking}
          />
          {delivery.trackingUrl ? (
            <ActionButton label="Track package" icon="external-link" onPress={onOpenTracking} />
          ) : null}
        </View>
      ) : null}

      {delivery.canConfirmReceipt ? (
        <PrimaryButton
          label="I received it"
          icon="check-circle"
          onPress={onConfirmReceipt}
          style={{ marginTop: SP.md }}
        />
      ) : null}

      {delivery.events.length > 0 ? (
        <View style={s.events}>
          <Text style={s.eventsTitle}>Tracking updates</Text>
          {delivery.events.map((ev, i) => (
            <View key={`${ev.at}-${i}`} style={s.eventRow}>
              <View style={s.eventRail}>
                <View style={[s.eventDot, i === 0 && { backgroundColor: theme.text, borderColor: theme.text }]} />
                {i < delivery.events.length - 1 ? <View style={s.eventLine} /> : null}
              </View>
              <View style={{ flex: 1, paddingBottom: SP.md }}>
                <Text style={[s.eventText, i === 0 && { fontFamily: FONT.semibold }]}>{ev.description}</Text>
                <Text style={s.eventMeta}>
                  {[ev.location, formatLocalDateTime(ev.at)].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {guarantee ? <Text style={s.guarantee}>{guarantee}</Text> : null}
    </View>
  );
}

/** "Refunded, not delivered in time" — amount, partial vs full, and where it went. */
export function AutoRefundCard({ autoRefund }: { autoRefund: NonNullable<BuyerDelivery['autoRefund']> }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => styles(theme), [theme]);
  return (
    <View style={s.card} testID="order-auto-refund">
      <View style={s.refundHead}>
        <Feather name="rotate-ccw" size={ICON.md} color={theme.text} />
        <Text style={s.refundTitle}>{autoRefund.label}</Text>
      </View>
      <Text style={s.refundAmount}>{autoRefund.partial ? 'Partial refund' : 'Full refund'}</Text>
      <Text style={s.sub}>{autoRefundSummary(autoRefund)}</Text>
    </View>
  );
}

function styles(theme: AppThemePreset) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border,
      padding: SP.md, marginHorizontal: SP.md, marginBottom: SP.md,
    },
    headline: { fontFamily: FONT.bold, fontSize: FS.lg, color: theme.text, letterSpacing: -0.3 },
    store: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.muted, marginBottom: 4 },
    sub: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, marginTop: 4, lineHeight: 20 },
    stepRow: { flexDirection: 'row', marginTop: SP.md },
    stepCol: { flex: 1, alignItems: 'center' },
    dotRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
    line: { flex: 1, height: 2, backgroundColor: theme.border },
    lineHidden: { backgroundColor: 'transparent' },
    dot: {
      width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.border,
      backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center',
    },
    dotCurrent: { borderWidth: 5, backgroundColor: theme.card, borderColor: theme.text },
    stepLabel: {
      fontFamily: FONT.medium, fontSize: 12, color: theme.muted, textAlign: 'center',
      marginTop: 6,
    },
    note: {
      flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.md,
      padding: SP.sm, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border,
    },
    noteText: { flex: 1, fontFamily: FONT.medium, fontSize: FS.xs, color: theme.muted },
    trackBlock: {
      flexDirection: 'row', alignItems: 'center', marginTop: SP.md, paddingTop: SP.md,
      borderTopWidth: 1, borderTopColor: theme.border,
    },
    trackCarrier: { fontFamily: FONT.medium, fontSize: FS.xs, color: theme.muted },
    trackNumber: { fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text, marginTop: 2 },
    btnRow: { flexDirection: 'row', gap: SP.sm, marginTop: SP.sm },
    actionBtn: {
      flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm,
      paddingHorizontal: SP.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
    },
    actionBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },
    events: { marginTop: SP.md, paddingTop: SP.md, borderTopWidth: 1, borderTopColor: theme.border },
    eventsTitle: { fontFamily: FONT.bold, fontSize: FS.sm, color: theme.text, marginBottom: SP.sm },
    eventRow: { flexDirection: 'row', gap: SP.sm },
    eventRail: { width: 14, alignItems: 'center' },
    eventDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: theme.border, backgroundColor: theme.card, marginTop: 4 },
    eventLine: { flex: 1, width: 2, backgroundColor: theme.border, marginTop: 2 },
    eventText: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text },
    eventMeta: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted, marginTop: 2 },
    guarantee: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted, marginTop: SP.sm, textAlign: 'center' },
    refundHead: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
    refundTitle: { flex: 1, fontFamily: FONT.bold, fontSize: FS.base, color: theme.text },
    refundAmount: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text, marginTop: SP.sm },
  });
}
