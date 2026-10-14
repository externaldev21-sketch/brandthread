/**
 * Seller dashboard Live map. Behaviour reference: Shopify Live View (today's
 * orders as dots on a dark world map, each new order pinging its city).
 * Visual reference: Citizen's dark map, reskinned black/silver.
 *
 * A flat equirectangular world (lib/liveMap/worldLand.ts) in dark gray on
 * black, a silver dot per city with orders today (radius grows gently with
 * count), and "Live" + today's order count above it. Tapping opens a
 * full-screen map with the city list ("Austin, TX · 3").
 *
 * The only motion: when a new order arrives (socket `order_city`), that
 * city's dot pings once, a single ring that expands and fades. It confirms
 * something happened; with Reduce Motion on it is skipped. No sound, no
 * haptic, no gradient, no glow.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import type { LiveMapPing } from '@/hooks/useSellerLiveMap';
import { liveMapCityLabel, liveMapDotRadius, type LiveMapCity, type LiveMapToday } from '@/lib/liveMap/liveMap';
import { WORLD_LAND_PATH, WORLD_VIEWBOX, projectLatLng } from '@/lib/liveMap/worldLand';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

const MAP_BG = '#000000';
const LAND = '#232323';
const DOT = '#C8C8C8';
const DOT_LATEST = '#FFFFFF';
const PING_MS = 1400;

function PingRing({ x, y, size, seq }: { x: number; y: number; size: number; seq: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, { duration: PING_MS, easing: Easing.out(Easing.cubic) });
  }, [seq, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.9 * (1 - progress.value),
    transform: [{ scale: 0.4 + progress.value * 2.6 }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ping,
        { left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: size / 2, borderColor: DOT_LATEST },
        style,
      ]}
    />
  );
}

function WorldMap({ cities, ping, testID }: { cities: LiveMapCity[]; ping: LiveMapPing | null; testID?: string }) {
  const reduceMotion = useReduceMotion();
  const [width, setWidth] = useState(0);
  const height = width * (WORLD_VIEWBOX.height / WORLD_VIEWBOX.width);
  const maxCount = cities.reduce((m, c) => Math.max(m, c.count), 0);
  const latestKey = cities.reduce<LiveMapCity | null>((best, c) => (!best || c.lastAt > best.lastAt ? c : best), null)?.key;
  const pinged = ping ? cities.find((c) => c.key === ping.key) : undefined;
  const pingPoint = pinged ? projectLatLng(pinged.lat, pinged.lng) : null;
  const scale = width / WORLD_VIEWBOX.width;

  // Draw smaller counts last so a big dot never hides a small neighbour.
  const ordered = useMemo(() => [...cities].sort((a, b) => b.count - a.count), [cities]);

  return (
    <View
      testID={testID}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.mapBox, { height: height || undefined, aspectRatio: height ? undefined : WORLD_VIEWBOX.width / WORLD_VIEWBOX.height }]}
    >
      {width > 0 && (
        <Svg width={width} height={height} viewBox={`0 0 ${WORLD_VIEWBOX.width} ${WORLD_VIEWBOX.height}`}>
          <Rect x={0} y={0} width={WORLD_VIEWBOX.width} height={WORLD_VIEWBOX.height} fill={MAP_BG} />
          <Path d={WORLD_LAND_PATH} fill={LAND} fillRule="evenodd" />
          {ordered.map((c) => {
            const p = projectLatLng(c.lat, c.lng);
            return (
              <Circle
                key={c.key}
                cx={p.x}
                cy={p.y}
                r={liveMapDotRadius(c.count, maxCount)}
                fill={c.key === latestKey ? DOT_LATEST : DOT}
                stroke={MAP_BG}
                strokeWidth={0.8}
              />
            );
          })}
        </Svg>
      )}
      {width > 0 && pingPoint && ping && !reduceMotion && (
        <PingRing key={`${ping.key}:${ping.seq}`} x={pingPoint.x * scale} y={pingPoint.y * scale} size={12} seq={ping.seq} />
      )}
    </View>
  );
}

export function SellerLiveMap({
  data,
  ping,
  theme,
}: {
  data: LiveMapToday | null;
  ping: LiveMapPing | null;
  theme: AppThemePreset;
}) {
  const [open, setOpen] = useState(false);
  const total = data?.total ?? 0;
  const cities = data?.cities ?? [];

  return (
    <View testID="seller-dashboard-live-map">
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Live, ${total} ${total === 1 ? 'order' : 'orders'} today. Open full screen`}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={[styles.sectionHeader, { color: theme.muted }]}>Live</Text>
            <Text style={[styles.headerCount, { color: theme.text }]} testID="seller-live-map-count">{data ? total : '–'}</Text>
          </View>
          <Feather name="maximize-2" size={14} color={theme.subtle} />
        </View>
        <View style={[styles.mapFrame, { borderColor: theme.borderSubtle }]}>
          <WorldMap cities={cities} ping={ping} />
          {data && total === 0 && (
            <Text style={[styles.emptyText, { color: theme.muted }]}>No orders today</Text>
          )}
        </View>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setOpen(false)}>
        <ModalSafeArea>
          <View style={[styles.modalRoot, { backgroundColor: theme.background }]} testID="seller-live-map-full">
            <ScreenHeader title="Live" variant="modal" onBack={() => setOpen(false)} />
            <ScrollView contentContainerStyle={styles.modalScroll}>
              <Text style={[styles.fullCount, { color: theme.text }]}>{total}</Text>
              <Text style={[styles.fullCountLabel, { color: theme.muted }]}>{total === 1 ? 'order today' : 'orders today'}</Text>
              <View style={[styles.mapFrame, styles.fullMap, { borderColor: theme.borderSubtle }]}>
                <WorldMap cities={cities} ping={ping} testID="seller-live-map-full-map" />
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
  headerLeft: { flexDirection: 'row', alignItems: 'baseline', gap: SP.sm },
  sectionHeader: { fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 0.8, textTransform: 'uppercase' },
  headerCount: { fontFamily: FONT.bold, fontSize: FS.sm, fontVariant: ['tabular-nums'] },
  mapFrame: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    backgroundColor: MAP_BG,
    paddingVertical: SP.sm,
  },
  mapBox: { width: '100%', position: 'relative' },
  ping: { position: 'absolute', borderWidth: 1.5 },
  emptyText: { position: 'absolute', left: SP.md, bottom: SP.sm, fontFamily: FONT.medium, fontSize: FS.sm },
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
