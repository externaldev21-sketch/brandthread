/**
 * Shipment tracking header for the buyer order screen (item 107): a
 * "where is it" headline and a static route map placeholder above the
 * OrderProgressTimeline.
 *
 * Reference (Mobbin): Shop's package tracking, which puts a map on top,
 * then "Arrives Jul 31–Aug 1 · In transit", then a carrier card with the
 * tracking number. Careem's order screen is the model for the timestamped
 * vertical timeline.
 *
 * The map is deliberately a static, drawn placeholder. There is no live
 * map or carrier location feed: the app has the carrier, the tracking
 * number, a tracking status and the destination city, and nothing more.
 * So it shows a stylised street grid and a route from the seller to the
 * buyer's city. The package marker's position along the route comes only
 * from the real tracking status (label created → in transit → out for
 * delivery → delivered). It never shows a fabricated location.
 *
 * Everything is derived from GET /api/buyer/orders/:id fields and is
 * monochrome (theme text/muted/border only).
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { formatDate } from '@/lib/format';
import type { OrderStatus, TrackingStatus } from '@/services/orderTypes';

export interface ShipmentInfo {
  status: OrderStatus;
  trackingStatus?: TrackingStatus;
  trackingCarrier?: string;
  estimatedDelivery?: string;
  paidAt?: string;
  sellerName: string;
  destinationCity?: string;
  destinationState?: string;
}

const TERMINAL: OrderStatus[] = ['cancelled', 'refunded', 'disputed'];

/** A YYYY-MM-DD (orders.estimated_delivery) or ISO string as a local calendar date. */
function parseCalendarDate(value: string | undefined): Date | null {
  if (!value) return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = ymd ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function hasShipped(info: Pick<ShipmentInfo, 'status' | 'trackingStatus'>): boolean {
  return info.status === 'shipped' || info.status === 'delivered' || !!info.trackingStatus;
}

/**
 * The headline over the tracker. Returns null for cancelled / refunded /
 * disputed orders, which have their own cards on the screen.
 */
export function trackingHeadline(info: ShipmentInfo, now: Date = new Date()): { title: string; subtitle: string } | null {
  if (TERMINAL.includes(info.status)) return null;
  const carrier = info.trackingCarrier?.trim();
  const withCarrier = (text: string) => (carrier ? `${text} with ${carrier}` : text);
  const ts = info.trackingStatus;

  if (info.status === 'delivered' || ts === 'delivered') {
    return { title: 'Delivered', subtitle: carrier ? `Delivered by ${carrier}` : `From ${info.sellerName}` };
  }
  if (ts === 'exception') {
    return { title: 'Delivery problem', subtitle: carrier ? `${carrier} reported a problem. Check tracking for details.` : 'The carrier reported a problem with this delivery.' };
  }
  if (ts === 'returned_to_sender') {
    return { title: 'Returning to sender', subtitle: withCarrier('On its way back') };
  }
  if (ts === 'out_for_delivery') {
    return { title: 'Arriving today', subtitle: withCarrier('Out for delivery') };
  }
  if (hasShipped(info)) {
    const eta = parseCalendarDate(info.estimatedDelivery);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const subtitle = ts === 'label_created' ? withCarrier('Label created, waiting for pickup') : withCarrier('In transit');
    if (!eta) return { title: 'On its way', subtitle };
    const diffDays = Math.round((eta.getTime() - today.getTime()) / 86_400_000);
    const day = formatDate(eta, { weekday: 'short', month: 'short', day: 'numeric' });
    if (diffDays === 0) return { title: 'Arriving today', subtitle };
    if (diffDays === 1) return { title: 'Arriving tomorrow', subtitle };
    if (diffDays < 0) return { title: `Expected ${day}`, subtitle };
    return { title: `Arriving by ${day}`, subtitle };
  }
  if (info.status === 'processing' || info.status === 'ready_to_ship' || info.paidAt) {
    return { title: 'Preparing to ship', subtitle: `${info.sellerName} is getting your order ready` };
  }
  return { title: 'Order placed', subtitle: `Waiting for ${info.sellerName} to confirm` };
}

/** How far along the route the package marker sits (0 = seller, 1 = buyer). */
export function routeProgress(info: Pick<ShipmentInfo, 'status' | 'trackingStatus'>): number {
  if (info.status === 'delivered' || info.trackingStatus === 'delivered') return 1;
  switch (info.trackingStatus) {
    case 'out_for_delivery': return 0.82;
    case 'in_transit': return 0.5;
    case 'accepted': return 0.22;
    case 'label_created': return 0;
    case 'returned_to_sender': return 0.35;
    case 'exception': return 0.5;
    default: return info.status === 'shipped' ? 0.5 : 0;
  }
}

export function ShipmentHeadline({ info }: { info: ShipmentInfo }) {
  const { theme } = useAppTheme();
  const headline = trackingHeadline(info);
  if (!headline) return null;
  return (
    <View style={styles.headline} accessibilityRole="header" testID="shipment-headline">
      <Text style={[styles.title, { color: theme.text }]}>{headline.title}</Text>
      <Text style={[styles.subtitle, { color: theme.muted }]}>{headline.subtitle}</Text>
    </View>
  );
}

type Pt = { x: number; y: number };
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Splits a cubic Bézier at t (de Casteljau) → [travelled, remaining] path strings + the point at t. */
function splitCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number) {
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
  const d = lerp(a, b, t), e = lerp(b, c, t);
  const m = lerp(d, e, t);
  const f = (p: Pt) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  return {
    done: `M ${f(p0)} C ${f(a)} ${f(d)} ${f(m)}`,
    rest: `M ${f(m)} C ${f(e)} ${f(c)} ${f(p3)}`,
    at: m,
  };
}

const MAP_H = 136;

/** Static route map placeholder: never a live map, never a broken image. */
export function ShipmentMapPlaceholder({ info }: { info: ShipmentInfo }) {
  const { theme } = useAppTheme();
  const [width, setWidth] = useState(0);
  const progress = routeProgress(info);
  const delivered = progress >= 1;
  const destination = [info.destinationCity, info.destinationState].filter(Boolean).join(', ');

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  const p0 = { x: 34, y: MAP_H - 50 };
  const p3 = { x: Math.max(width - 40, 120), y: 38 };
  const p1 = { x: p0.x + (p3.x - p0.x) * 0.35, y: p0.y + 6 };
  const p2 = { x: p0.x + (p3.x - p0.x) * 0.6, y: p3.y - 8 };
  const route = splitCubic(p0, p1, p2, p3, Math.min(Math.max(progress, 0.0001), 0.9999));

  // A deterministic street grid scaled to the card width.
  const cols = width > 0 ? Array.from({ length: Math.ceil(width / 46) }, (_, i) => 18 + i * 46) : [];
  const rows = [20, 52, 84, 116];
  const statusLabel = delivered ? 'Delivered' : info.trackingStatus === 'out_for_delivery' ? 'Out for delivery'
    : info.trackingStatus === 'label_created' ? 'Label created' : 'In transit';

  return (
    <View
      style={[styles.map, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Route overview: from ${info.sellerName}${destination ? ` to ${destination}` : ''}. ${statusLabel}.`}
      testID="shipment-map-placeholder"
    >
      {width > 0 ? (
        <Svg width={width} height={MAP_H}>
          {cols.map((x, i) => (
            <Line key={`c${x}`} x1={x} y1={0} x2={x + (i % 2 ? 10 : -6)} y2={MAP_H} stroke={theme.border} strokeWidth={i % 3 === 1 ? 3 : 1} />
          ))}
          {rows.map((y, i) => (
            <Line key={`r${y}`} x1={0} y1={y} x2={width} y2={y + (i % 2 ? -8 : 5)} stroke={theme.border} strokeWidth={i === 2 ? 3 : 1} />
          ))}
          <Path d={route.rest} stroke={theme.muted} strokeWidth={2} strokeDasharray="4 5" fill="none" strokeLinecap="round" />
          <Path d={route.done} stroke={theme.text} strokeWidth={3} fill="none" strokeLinecap="round" />
          <Circle cx={p0.x} cy={p0.y} r={6} fill={theme.cardElevated} stroke={theme.text} strokeWidth={2} />
          <Circle cx={p3.x} cy={p3.y} r={delivered ? 13 : 9} fill={delivered ? theme.text : theme.cardElevated} stroke={theme.text} strokeWidth={2} />
          {!delivered ? <Circle cx={route.at.x} cy={route.at.y} r={13} fill={theme.text} /> : null}
        </Svg>
      ) : null}
      {width > 0 && !delivered ? (
        <View pointerEvents="none" style={[styles.marker, { left: route.at.x - 8, top: route.at.y - 8 }]}>
          <Feather name="package" size={16} color={theme.background} />
        </View>
      ) : null}
      {width > 0 && delivered ? (
        <View pointerEvents="none" style={[styles.marker, { left: p3.x - 8, top: p3.y - 8 }]}>
          <Feather name="check" size={16} color={theme.background} />
        </View>
      ) : null}
      <View style={[styles.mapLegend, { backgroundColor: theme.cardElevated, borderColor: theme.border }]} pointerEvents="none">
        <Text style={[styles.legendText, { color: theme.muted }]} numberOfLines={1}>
          {info.sellerName}
        </Text>
        <Feather name="arrow-right" size={11} color={theme.muted} />
        <Text style={[styles.legendText, { color: theme.text }]} numberOfLines={1}>
          {destination || 'You'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headline: { marginBottom: SP.md },
  title: { fontFamily: FONT.bold, fontSize: FS.xl, letterSpacing: -0.4 },
  subtitle: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 4, lineHeight: 19 },
  map: {
    height: MAP_H, borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden', marginBottom: SP.md,
  },
  marker: { position: 'absolute', width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  mapLegend: {
    position: 'absolute', left: SP.sm, bottom: SP.sm, maxWidth: '80%',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: RADIUS.pill, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  legendText: { fontFamily: FONT.medium, fontSize: FS.xs, flexShrink: 1 },
});
