/**
 * Seller dashboard order globe (the Live map's slot). Behaviour reference:
 * Shopify's admin globe / Live View, reskinned black/white/silver.
 *
 * A dark sphere with a silver dot-matrix landmass slowly auto-rotates; each
 * recent order (GET /api/seller/live-map/today `recent`, the last 7 days of
 * paid orders) is a glowing silver dot at its shipping city. Drag to spin
 * (with a little fling), pinch or scroll to zoom lightly, tap a dot for its
 * order number, item, amount, place and time. A new order arrives over the
 * seller socket (useSellerLiveMap), its city's dot flares and the list
 * refetches; without a socket the hook polls.
 *
 * Rendering is per platform (components/globe/GlobeSurface*.tsx): Skia on
 * native, a 2D canvas on web, both projecting through lib/liveMap/globe.ts so
 * what is drawn is what is tapped. Where 3D can't run (Expo Go, no Skia) the
 * same dots and popovers sit on a flat dotted map (FlatOrderMap).
 *
 * Header ("Live" + today's order count) and the full-screen city list are
 * unchanged from the flat Live map this replaces.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import type { LiveMapPing } from '@/hooks/useSellerLiveMap';
import {
  AUTO_ROTATE_RESUME_MS,
  AUTO_ROTATE_SPEED,
  clampZoom,
  dragView,
  globeRadius,
  hitTest,
  projectLatLng,
  viewCenteredOn,
  type GlobeView,
} from '@/lib/liveMap/globe';
import { globeSpots, liveMapCityLabel, RECENT_ORDERS_LIMIT, recentOrders, type LiveMapRecentOrder, type LiveMapToday } from '@/lib/liveMap/liveMap';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { GlobeSurface, globeSurfaceMode } from '@/components/globe/GlobeSurface';
import { FlatOrderMap, flatHeightFor } from '@/components/globe/FlatOrderMap';
import { OrderGlobePopover } from '@/components/globe/OrderGlobePopover';
import { GLOBE_COLORS } from '@/components/globe/globeColors';

const MAX_GLOBE = 380;
/** Default view before any order: the Atlantic, tilted north. */
const DEFAULT_VIEW: GlobeView = viewCenteredOn(25, -35);
const PING_FLARE_MS = 4000;

interface Selection { order: LiveMapRecentOrder; x: number; y: number }

function OrderGlobeView({
  orders: recent,
  ping,
  active,
  maxSize = MAX_GLOBE,
  onOpenOrder,
  testID,
}: {
  orders: LiveMapRecentOrder[];
  ping: LiveMapPing | null;
  /** Rotation runs only while the globe is on screen. */
  active: boolean;
  maxSize?: number;
  onOpenOrder?: (orderId: string) => void;
  testID?: string;
}) {
  const reduceMotion = useReduceMotion();
  // One dot per place (the newest order there); the popover counts the rest.
  const spots = useMemo(() => globeSpots(recent), [recent]);
  const orders = useMemo(() => spots.map((s) => s.order), [spots]);
  const countByKey = useMemo(() => new Map(spots.map((s) => [s.order.key, s.count])), [spots]);
  const mode = useMemo(() => globeSurfaceMode(), []);
  const [width, setWidth] = useState(0);
  const size = Math.min(width, maxSize);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);

  const view = useSharedValue<GlobeView>(DEFAULT_VIEW);
  const clock = useSharedValue(0);
  const spin = useSharedValue(0);
  const dragging = useSharedValue(false);
  const paused = useSharedValue(false);
  const still = useSharedValue(reduceMotion);
  const lastTouch = useSharedValue(-1e9);
  const startView = useSharedValue<GlobeView>(DEFAULT_VIEW);
  const startZoom = useSharedValue(1);
  const centeredRef = useRef(false);

  useEffect(() => { still.value = reduceMotion; }, [reduceMotion, still]);

  // Face the newest order the first time orders arrive (until the seller turns it).
  useEffect(() => {
    if (centeredRef.current || orders.length === 0) return;
    centeredRef.current = true;
    view.value = { ...viewCenteredOn(orders[0].lat, orders[0].lng), zoom: view.value.zoom };
  }, [orders, view]);

  // A dot that's gone (fell out of the 7-day window) closes its popover.
  useEffect(() => {
    if (selection && !orders.some((o) => o.id === selection.order.id)) {
      setSelection(null);
      paused.value = false;
    }
  }, [orders, paused, selection]);

  useEffect(() => {
    if (!ping) return;
    setHighlightKey(ping.key);
    const id = setTimeout(() => setHighlightKey(null), PING_FLARE_MS);
    return () => clearTimeout(id);
  }, [ping]);

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
      yaw += AUTO_ROTATE_SPEED * dt;
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
    const hit = hitTest(orders, v, size, x, y);
    if (!hit) { close(); return; }
    const [px, py] = projectLatLng(hit.lat, hit.lng, v, size);
    spin.value = 0;
    paused.value = true;
    setSelection({ order: hit, x: px, y: py });
  }, [close, orders, paused, size, spin, view]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .minDistance(4)
      // Horizontal drags spin; a mostly vertical drag is left to the page scroll.
      .activeOffsetX([-8, 8])
      .failOffsetY([-16, 16])
      .onStart(() => {
        dragging.value = true;
        spin.value = 0;
        startView.value = view.value;
        runOnJS(close)();
      })
      .onUpdate((e) => {
        view.value = dragView(startView.value, e.translationX, e.translationY, size);
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
        view.value = { ...view.value, zoom: clampZoom(startZoom.value * e.scale) };
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
  }, [clock, close, dragging, handleTap, lastTouch, size, spin, startView, startZoom, view]);

  // Web: scroll wheel / trackpad pinch zooms lightly.
  const boxRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || mode !== 'globe') return;
    const node = boxRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      view.value = { ...view.value, zoom: clampZoom(view.value.zoom * Math.exp(-e.deltaY * 0.0015)) };
      lastTouch.value = clock.value;
      if (selection) close();
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [clock, close, lastTouch, mode, selection, size, view]);

  // Dev web harness only: lets the Playwright check find a dot on screen.
  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'web' || mode !== 'globe') return;
    const g = globalThis as { __btOrderGlobe?: Record<string, unknown> };
    g.__btOrderGlobe = {
      orders,
      size,
      view: () => view.value,
      project: (id: string) => {
        const o = orders.find((x) => x.id === id);
        return o ? projectLatLng(o.lat, o.lng, view.value, size) : null;
      },
    };
    return () => { delete g.__btOrderGlobe; };
  }, [mode, orders, size, view]);

  const flatHeight = flatHeightFor(width);
  const boxHeight = mode === 'globe' ? size : flatHeight;
  const boxWidth = mode === 'globe' ? size : width;

  return (
    <View
      testID={testID}
      onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}
      style={styles.globeRow}
      accessibilityLabel={`Order globe, ${orders.length} ${orders.length === 1 ? 'order' : 'orders'} in the last 7 days. Tap a dot for details.`}
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
                  orders={orders}
                  selectedId={selection?.order.id ?? null}
                  highlightKey={highlightKey}
                  reduceMotion={reduceMotion}
                />
              </View>
            </GestureDetector>
          ) : (
            <FlatOrderMap
              width={width}
              orders={orders}
              selectedId={selection?.order.id ?? null}
              onSelect={(order, x, y) => (order ? setSelection({ order, x, y }) : setSelection(null))}
            />
          )}
          {selection && (
            <OrderGlobePopover
              order={selection.order}
              x={selection.x}
              y={selection.y}
              boxWidth={boxWidth}
              boxHeight={boxHeight}
              moreHere={(countByKey.get(selection.order.key) ?? 1) - 1}
              onOpen={onOpenOrder}
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
        <OrderGlobeView orders={recent} ping={ping} active={active && !open} onOpenOrder={onOpenOrder} testID="seller-order-globe" />
        <Text style={styles.caption} testID="seller-globe-caption">
          {data && recent.length === 0
            ? 'No orders in the last 7 days'
            : recent.length >= RECENT_ORDERS_LIMIT
              ? `Latest ${recent.length} orders · last 7 days`
              : `${recent.length} ${recent.length === 1 ? 'order' : 'orders'} · last 7 days`}
        </Text>
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
  caption: {
    marginTop: SP.xs,
    marginHorizontal: SP.md,
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
