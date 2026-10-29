/**
 * Seller dashboard order globe (the Live map's slot). Behaviour reference:
 * Shopify's admin globe / Live View, reskinned black/white/silver.
 *
 * A dark sphere with solid silver continents slowly auto-rotates. Dots mean
 * customer activity and nothing else (GET /api/seller/live-map/today):
 *   - orders: each place with a recent order (`recent`, the last 7 days of
 *     paid orders) glows silver-white; tap for order number, item, amount,
 *     place and time;
 *   - sessions: each place with shoppers on the store right now (`sessions`)
 *     is a softer silver ring; tap for "N sessions · City".
 * Arcs dart across the globe from activity to the store's home (`home`, or
 * to another activity point when the store has no place): a new order over
 * the seller socket fires one at once, and while the globe is on screen the
 * recent activity takes turns firing at a calm cadence (lib/liveMap/arcs.ts
 * caps how many fly at once and recycles slots).
 *
 * Drag to spin (with a little fling), pinch or scroll to zoom about the
 * fingers / cursor. Zooming in fades in country borders and names, then
 * state/province lines and abbreviations (lib/liveMap/globeDetail.ts), so a
 * dot reads to the state; zoomed in, auto-rotation eases off and a vertical
 * drag tilts the globe instead of scrolling the page. A new order also flares
 * its city's dot and refetches; without a socket the hook polls.
 *
 * Rendering is per platform (components/globe/GlobeSurface*.tsx): Skia on
 * native, a 2D canvas on web, both projecting through lib/liveMap/globe.ts so
 * what is drawn is what is tapped. Where 3D can't run (Expo Go, no Skia) the
 * same dots and popovers sit on a flat map (FlatOrderMap), without arcs.
 *
 * Header ("Live" + today's order count) and the full-screen city list are
 * unchanged from the flat Live map this replaces.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, runOnUI, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import type { LiveMapPing } from '@/hooks/useSellerLiveMap';
import {
  AUTO_ROTATE_RESUME_MS,
  AUTO_ROTATE_SPEED,
  autoRotateFactor,
  dragView,
  globeRadius,
  hitTest,
  projectLatLng,
  viewCenteredOn,
  zoomViewAt,
  type GlobeView,
} from '@/lib/liveMap/globe';
import { countryLabelTable, labelLayout, regionLabelTable } from '@/lib/liveMap/globeDetail';
import { AMBIENT_ARC_MS, ambientArcEnds, emptyArcSlots, liveArcCount, makeArc, pushArc, type ArcSlot } from '@/lib/liveMap/arcs';
import {
  globeActivities,
  liveMapCityLabel,
  liveSessions,
  RECENT_ORDERS_LIMIT,
  recentOrders,
  type GlobeActivity,
  type LiveMapHome,
  type LiveMapRecentOrder,
  type LiveMapSession,
  type LiveMapToday,
} from '@/lib/liveMap/liveMap';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { GlobeSurface, globeSurfaceMode } from '@/components/globe/GlobeSurface';
import { FlatOrderMap, flatHeightFor } from '@/components/globe/FlatOrderMap';
import { OrderGlobePopover, SessionGlobePopover } from '@/components/globe/OrderGlobePopover';
import { GLOBE_COLORS } from '@/components/globe/globeColors';

const MAX_GLOBE = 380;
/** Default view before any order: the Atlantic, tilted north. */
const DEFAULT_VIEW: GlobeView = viewCenteredOn(25, -35);
const PING_FLARE_MS = 4000;
/** Past this zoom a vertical drag tilts the globe instead of scrolling the page. */
const ZOOMED_IN = 1.15;

interface Selection { activity: GlobeActivity; x: number; y: number }

/** Runs on the UI thread: stamps the arc with the globe clock and takes a slot. */
function fireArc(arcs: SharedValue<ArcSlot[]>, clock: SharedValue<number>, arc: ArcSlot) {
  'worklet';
  const now = clock.value;
  arcs.value = pushArc(arcs.value, { ...arc, start: now }, now);
}

function OrderGlobeView({
  orders: recent,
  sessions,
  home,
  ping,
  active,
  maxSize = MAX_GLOBE,
  onOpenOrder,
  testID,
}: {
  orders: LiveMapRecentOrder[];
  sessions: LiveMapSession[];
  home: LiveMapHome | null;
  ping: LiveMapPing | null;
  /** Rotation and arcs run only while the globe is on screen. */
  active: boolean;
  maxSize?: number;
  onOpenOrder?: (orderId: string) => void;
  testID?: string;
}) {
  const reduceMotion = useReduceMotion();
  // One dot per place with activity: orders (newest order there; the
  // popover counts the rest), then places with shoppers right now.
  const activities = useMemo(() => globeActivities(recent, sessions), [recent, sessions]);
  const orderCount = useMemo(() => activities.filter((a) => a.kind === 'order').length, [activities]);
  const mode = useMemo(() => globeSurfaceMode(), []);
  const [width, setWidth] = useState(0);
  const size = Math.min(width, maxSize);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [zoomedIn, setZoomedIn] = useState(false);

  const view = useSharedValue<GlobeView>(DEFAULT_VIEW);
  const clock = useSharedValue(0);
  const spin = useSharedValue(0);
  const dragging = useSharedValue(false);
  const paused = useSharedValue(false);
  const still = useSharedValue(reduceMotion);
  const lastTouch = useSharedValue(-1e9);
  // Last drag translation: drags apply step by step so a pinch's zoom (and
  // its focal shift) during the same two-finger gesture isn't overwritten.
  const lastPan = useSharedValue({ x: 0, y: 0 });
  const startZoom = useSharedValue(1);
  const zoomedFlag = useSharedValue(false);
  const arcs = useSharedValue<ArcSlot[]>(emptyArcSlots());
  const centeredRef = useRef(false);
  const arcTickRef = useRef(0);

  useEffect(() => { still.value = reduceMotion; }, [reduceMotion, still]);

  // Face the newest activity the first time it arrives (until the seller turns it).
  useEffect(() => {
    if (centeredRef.current || activities.length === 0) return;
    centeredRef.current = true;
    view.value = { ...viewCenteredOn(activities[0].lat, activities[0].lng), zoom: view.value.zoom };
  }, [activities, view]);

  // A dot that's gone (order fell out of the 7-day window, shopper left) closes its popover.
  useEffect(() => {
    if (selection && !activities.some((a) => a.id === selection.activity.id)) {
      setSelection(null);
      paused.value = false;
    }
  }, [activities, paused, selection]);

  const arcsRun = active && mode === 'globe' && size > 0 && !reduceMotion;

  // A new order: its dot flares and an arc shoots from it right away.
  useEffect(() => {
    if (!ping) return;
    setHighlightKey(ping.key);
    if (arcsRun && ping.lat != null && ping.lng != null) {
      const from = { key: ping.key, lat: ping.lat, lng: ping.lng };
      const ends = home ? { from, to: home } : ambientArcEnds([from, ...activities.filter((a) => a.key !== ping.key)], null, 0);
      if (ends) runOnUI(fireArc)(arcs, clock, makeArc(ends.from, ends.to, 0));
    }
    const id = setTimeout(() => setHighlightKey(null), PING_FLARE_MS);
    return () => clearTimeout(id);
    // Only a new ping fires; activity/home changes alone don't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ping]);

  // Ambient arcs: recent activity takes turns while the globe is on screen.
  useEffect(() => {
    if (!arcsRun || activities.length === 0) return;
    const sources = activities.map((a) => ({ key: a.key, lat: a.lat, lng: a.lng }));
    const fire = () => {
      const ends = ambientArcEnds(sources, home, arcTickRef.current);
      arcTickRef.current += 1;
      if (ends) runOnUI(fireArc)(arcs, clock, makeArc(ends.from, ends.to, 0));
    };
    const first = setTimeout(fire, 400);
    const id = setInterval(fire, AMBIENT_ARC_MS);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [activities, arcs, arcsRun, clock, home]);

  const frame = useFrameCallback((info) => {
    'worklet';
    const dt = Math.min(0.05, (info.timeSincePreviousFrame ?? 16) / 1000);
    clock.value = info.timestamp;
    if (dragging.value) return;
    const v = view.value;
    let yaw = v.yaw;
    if (Math.abs(spin.value) > 0.002) {
      yaw += spin.value * dt;
      spin.value *= Math.pow(0.05, dt);
    } else if (!paused.value && !still.value && info.timestamp - lastTouch.value > AUTO_ROTATE_RESUME_MS) {
      yaw += AUTO_ROTATE_SPEED * autoRotateFactor(v.zoom) * dt;
    }
    if (yaw !== v.yaw) view.value = { yaw, pitch: v.pitch, zoom: v.zoom };
  }, false);

  useEffect(() => {
    frame.setActive(active && mode === 'globe' && size > 0);
  }, [active, frame, mode, size]);

  const close = useCallback(() => {
    setSelection(null);
    paused.value = false;
    lastTouch.value = clock.value;
  }, [clock, lastTouch, paused]);

  const handleTap = useCallback((x: number, y: number) => {
    const v = view.value;
    const hit = hitTest(activities, v, size, x, y);
    if (!hit) { close(); return; }
    const [px, py] = projectLatLng(hit.lat, hit.lng, v, size);
    spin.value = 0;
    paused.value = true;
    setSelection({ activity: hit, x: px, y: py });
  }, [activities, close, paused, size, spin, view]);

  /** Applies a zoom about a focal point; flips `zoomedIn` when it crosses ZOOMED_IN. */
  const zoomTo = useCallback((zoom: number, fx: number, fy: number) => {
    'worklet';
    const next = zoomViewAt(view.value, zoom, fx, fy, size);
    view.value = next;
    const isIn = next.zoom > ZOOMED_IN;
    if (isIn !== zoomedFlag.value) {
      zoomedFlag.value = isIn;
      runOnJS(setZoomedIn)(isIn);
    }
  }, [size, view, zoomedFlag]);

  const gesture = useMemo(() => {
    const base = Gesture.Pan().minDistance(4).activeOffsetX([-8, 8]);
    // At the default zoom horizontal drags spin and a mostly vertical drag is
    // left to the page scroll; zoomed in, a drag either way moves the map.
    const pan = (zoomedIn ? base.activeOffsetY([-8, 8]) : base.failOffsetY([-16, 16]))
      .onStart(() => {
        dragging.value = true;
        spin.value = 0;
        lastPan.value = { x: 0, y: 0 };
        runOnJS(close)();
      })
      .onUpdate((e) => {
        view.value = dragView(view.value, e.translationX - lastPan.value.x, e.translationY - lastPan.value.y, size);
        lastPan.value = { x: e.translationX, y: e.translationY };
      })
      .onEnd((e) => {
        spin.value = e.velocityX / Math.max(1, globeRadius(size, view.value.zoom));
      })
      .onFinalize(() => {
        dragging.value = false;
        lastTouch.value = clock.value;
      });
    const pinch = Gesture.Pinch()
      .onStart(() => {
        startZoom.value = view.value.zoom;
        runOnJS(close)();
      })
      .onUpdate((e) => {
        zoomTo(startZoom.value * e.scale, e.focalX, e.focalY);
      })
      .onFinalize(() => {
        lastTouch.value = clock.value;
      });
    const tap = Gesture.Tap()
      .maxDistance(10)
      .onEnd((e, success) => {
        if (success) runOnJS(handleTap)(e.x, e.y);
      });
    return Gesture.Race(Gesture.Simultaneous(pan, pinch), tap);
  }, [clock, close, dragging, handleTap, lastPan, lastTouch, size, spin, startZoom, view, zoomTo, zoomedIn]);

  // Web: scroll wheel / trackpad pinch zooms about the cursor.
  const boxRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || mode !== 'globe') return;
    const node = boxRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = node.getBoundingClientRect();
      zoomTo(view.value.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - box.left, e.clientY - box.top);
      lastTouch.value = clock.value;
      if (selection) close();
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [clock, close, lastTouch, mode, selection, size, view, zoomTo]);

  // Dev web harness only: lets the Playwright check find a dot on screen.
  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'web' || mode !== 'globe') return;
    const g = globalThis as { __btOrderGlobe?: Record<string, unknown> };
    g.__btOrderGlobe = {
      orders: activities.flatMap((a) => (a.kind === 'order' ? [a.order] : [])),
      activities,
      size,
      view: () => view.value,
      liveArcs: () => liveArcCount(arcs.value, clock.value),
      projectLatLng: (lat: number, lng: number) => projectLatLng(lat, lng, view.value, size),
      labels: () => labelLayout(countryLabelTable(), regionLabelTable(), view.value, size),
      project: (id: string) => {
        const a = activities.find((x) => x.id === id);
        return a ? projectLatLng(a.lat, a.lng, view.value, size) : null;
      },
    };
    return () => { delete g.__btOrderGlobe; };
  }, [activities, arcs, clock, mode, size, view]);

  const flatHeight = flatHeightFor(width);
  const boxHeight = mode === 'globe' ? size : flatHeight;
  const boxWidth = mode === 'globe' ? size : width;

  return (
    <View
      testID={testID}
      onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}
      style={styles.globeRow}
      accessibilityLabel={`Order globe, ${orderCount} ${orderCount === 1 ? 'place' : 'places'} with orders in the last 7 days${activities.length > orderCount ? `, ${activities.length - orderCount} with visitors right now` : ''}. Tap a dot for details.`}
    >
      {width > 0 && (
        <View ref={boxRef} style={{ width: boxWidth, height: boxHeight }} testID="seller-globe-box">
          {mode === 'globe' ? (
            <GestureDetector gesture={gesture}>
              <View style={{ width: size, height: size }} collapsable={false}>
                <GlobeSurface
                  size={size}
                  view={view}
                  clock={clock}
                  activities={activities}
                  arcs={arcs}
                  selectedId={selection?.activity.id ?? null}
                  highlightKey={highlightKey}
                  reduceMotion={reduceMotion}
                />
              </View>
            </GestureDetector>
          ) : (
            <FlatOrderMap
              width={width}
              activities={activities}
              selectedId={selection?.activity.id ?? null}
              onSelect={(activity, x, y) => (activity ? setSelection({ activity, x, y }) : setSelection(null))}
            />
          )}
          {selection?.activity.kind === 'order' && (
            <OrderGlobePopover
              order={selection.activity.order}
              x={selection.x}
              y={selection.y}
              boxWidth={boxWidth}
              boxHeight={boxHeight}
              moreHere={selection.activity.count - 1}
              sessionsHere={selection.activity.sessions}
              onOpen={onOpenOrder}
              onClose={close}
            />
          )}
          {selection?.activity.kind === 'session' && (
            <SessionGlobePopover
              session={selection.activity.session}
              x={selection.x}
              y={selection.y}
              boxWidth={boxWidth}
              boxHeight={boxHeight}
              onClose={close}
            />
          )}
        </View>
      )}
    </View>
  );
}

export function SellerOrderGlobe({
  data,
  ping,
  theme,
  active = true,
  onOpenOrder,
}: {
  data: LiveMapToday | null;
  ping: LiveMapPing | null;
  theme: AppThemePreset;
  /** False while the dashboard isn't focused: the globe stops rotating. */
  active?: boolean;
  onOpenOrder?: (orderId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const total = data?.total ?? 0;
  const cities = data?.cities ?? [];
  const recent = recentOrders(data);
  const sessions = liveSessions(data);
  const sessionsTotal = Math.max(data?.sessionsTotal ?? 0, sessions.reduce((n, s) => n + s.count, 0));
  const home = data?.home ?? null;

  return (
    <View testID="seller-dashboard-live-map">
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={[styles.sectionHeader, { color: theme.muted }]}>Live</Text>
          <Text style={[styles.headerCount, { color: theme.text }]} testID="seller-live-map-count">{data ? total : '–'}</Text>
          <Text style={[styles.headerCaption, { color: theme.muted }]} numberOfLines={1}>{total === 1 ? 'order today' : 'orders today'}</Text>
        </View>
        <TouchableOpacity
          onPress={() => setOpen(true)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Live, ${total} ${total === 1 ? 'order' : 'orders'} today. Open full screen`}
          testID="seller-live-map-expand"
        >
          <Icon name="maximize-2" size={14} color={theme.subtle} />
        </TouchableOpacity>
      </View>
      <View style={[styles.frame, { borderColor: theme.borderSubtle }]}>
        <OrderGlobeView orders={recent} sessions={sessions} home={home} ping={ping} active={active && !open} onOpenOrder={onOpenOrder} testID="seller-order-globe" />
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            {recent.length > 0 && <View style={styles.orderGlyph} />}
            <Text style={styles.caption} numberOfLines={1} testID="seller-globe-caption">
              {data && recent.length === 0
                ? 'No orders in the last 7 days'
                : recent.length >= RECENT_ORDERS_LIMIT
                  ? `Latest ${recent.length} orders · last 7 days`
                  : `${recent.length} ${recent.length === 1 ? 'order' : 'orders'} · last 7 days`}
            </Text>
          </View>
          {sessionsTotal > 0 && (
            <View style={styles.legendItem}>
              <View style={styles.sessionGlyph} />
              <Text style={styles.caption} numberOfLines={1} testID="seller-globe-sessions-caption">
                {`${sessionsTotal} ${sessionsTotal === 1 ? 'visitor' : 'visitors'} right now`}
              </Text>
            </View>
          )}
        </View>
      </View>

      <Modal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setOpen(false)}>
        <ModalSafeArea>
          <View style={[styles.modalRoot, { backgroundColor: theme.background }]} testID="seller-live-map-full">
            <ScreenHeader title="Live" variant="modal" onBack={() => setOpen(false)} />
            <ScrollView contentContainerStyle={styles.modalScroll}>
              <Text style={[styles.fullCount, { color: theme.text }]}>{total}</Text>
              <Text style={[styles.fullCountLabel, { color: theme.muted }]}>{total === 1 ? 'order today' : 'orders today'}</Text>
              <View style={[styles.frame, styles.fullMap, { borderColor: theme.borderSubtle }]}>
                <OrderGlobeView
                  orders={recent}
                  sessions={sessions}
                  home={home}
                  ping={ping}
                  active={open}
                  maxSize={560}
                  onOpenOrder={onOpenOrder ? (id) => { setOpen(false); onOpenOrder(id); } : undefined}
                  testID="seller-live-map-full-map"
                />
              </View>
              {cities.length === 0 ? (
                <Text style={[styles.listEmpty, { color: theme.muted }]}>No orders today</Text>
              ) : (
                cities.map((c, i) => (
                  <View
                    key={c.key}
                    style={[styles.cityRow, i > 0 && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth }]}
                    accessible
                    accessibilityLabel={`${liveMapCityLabel(c)}, ${c.count} ${c.count === 1 ? 'order' : 'orders'}`}
                  >
                    <Text style={[styles.cityName, { color: theme.text }]} numberOfLines={1}>{liveMapCityLabel(c)}</Text>
                    <Text style={[styles.cityCount, { color: theme.muted }]}>{c.count}</Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </ModalSafeArea>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.md },
  headerLeft: { flexDirection: 'row', alignItems: 'baseline', gap: SP.sm, flexShrink: 1 },
  sectionHeader: { fontFamily: FONT.bold, fontSize: FS.sm },
  headerCount: { fontFamily: FONT.bold, fontSize: FS.sm, fontVariant: ['tabular-nums'] },
  headerCaption: { fontFamily: FONT.medium, fontSize: FS.xs, flexShrink: 1 },
  frame: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    backgroundColor: GLOBE_COLORS.sphereDark,
    paddingTop: SP.sm,
    paddingBottom: SP.md,
  },
  globeRow: { width: '100%', alignItems: 'center' },
  legend: {
    marginTop: SP.xs,
    marginHorizontal: SP.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: SP.md,
    rowGap: 2,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  orderGlyph: { width: 6, height: 6, borderRadius: 3, backgroundColor: GLOBE_COLORS.core },
  sessionGlyph: { width: 8, height: 8, borderRadius: 4, borderWidth: 1, borderColor: GLOBE_COLORS.text },
  caption: {
    flexShrink: 1,
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: GLOBE_COLORS.mutedText,
  },
  modalRoot: { flex: 1 },
  modalScroll: { paddingHorizontal: SP.md, paddingBottom: SP.xl },
  fullCount: { fontFamily: FONT.bold, fontSize: FS.h2, fontVariant: ['tabular-nums'], marginTop: SP.sm },
  fullCountLabel: { fontFamily: FONT.medium, fontSize: FS.sm, marginBottom: SP.md },
  fullMap: { marginBottom: SP.lg },
  listEmpty: { fontFamily: FONT.medium, fontSize: FS.sm, paddingVertical: SP.md },
  cityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, gap: SP.md },
  cityName: { flex: 1, fontFamily: FONT.medium, fontSize: FS.base },
  cityCount: { fontFamily: FONT.semibold, fontSize: FS.base, fontVariant: ['tabular-nums'] },
});
