/**
 * Dev-only perf overlay (speed polish #19): JS frame rate, JS memory and the
 * last screen's timings against its budget (lib/perf.ts), so a regression is
 * visible while developing instead of after release.
 *
 * Renders nothing unless this is a dev build AND EXPO_PUBLIC_PERF_OVERLAY=1,
 * so it never appears in a release build, a preview, or for anyone not
 * explicitly asking for it. It never takes touches (pointerEvents none).
 */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT } from '@/lib/theme';
import { budgetFor, getLatestRoutePerf, overBudget, subscribeRoutePerf } from '@/lib/perf';

export function isPerfOverlayEnabled(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_PERF_OVERLAY === '1';
}

/** Bytes of JS heap in use, where the runtime exposes it (Hermes or Chrome). */
export function readJsHeapBytes(): number | null {
  try {
    const hermes = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } }).HermesInternal;
    const stats = hermes?.getInstrumentedStats?.();
    if (stats && typeof stats.js_allocatedBytes === 'number') return stats.js_allocatedBytes;
    const mem = (globalThis as { performance?: { memory?: { usedJSHeapSize?: number } } }).performance?.memory;
    if (mem && typeof mem.usedJSHeapSize === 'number') return mem.usedJSHeapSize;
  } catch {
    // Not available on this runtime.
  }
  return null;
}

function useJsFps(): number {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frames = 0;
    let raf = 0;
    let windowStart = Date.now();
    const tick = () => {
      frames += 1;
      const now = Date.now();
      if (now - windowStart >= 1000) {
        setFps(Math.round((frames * 1000) / (now - windowStart)));
        frames = 0;
        windowStart = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}

function useHeapMb(): number | null {
  const [mb, setMb] = useState<number | null>(null);
  useEffect(() => {
    const read = () => {
      const bytes = readJsHeapBytes();
      setMb(bytes === null ? null : Math.round(bytes / (1024 * 1024)));
    };
    read();
    const id = setInterval(read, 2000);
    return () => clearInterval(id);
  }, []);
  return mb;
}

function PerfOverlayInner() {
  const insets = useSafeAreaInsets();
  const fps = useJsFps();
  const heapMb = useHeapMb();
  const last = useSyncExternalStore(subscribeRoutePerf, getLatestRoutePerf, getLatestRoutePerf);
  const over = last ? overBudget(last) : [];
  const budget = last ? budgetFor(last.route) : null;

  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 4 }]} testID="perf-overlay">
      <Text style={styles.line}>
        {`${fps} fps · ${heapMb === null ? '—' : `${heapMb} MB`}`}
      </Text>
      {last && budget ? (
        <Text style={styles.line} numberOfLines={1}>
          {`${last.route} ${last.firstRenderMs ?? '…'}/${budget.firstRenderMs} · ${last.dataMs ?? '—'}/${budget.dataMs} ms${over.length ? ' · over budget' : ''}`}
        </Text>
      ) : null}
    </View>
  );
}

export function PerfOverlay() {
  if (!isPerfOverlayEnabled()) return null;
  return <PerfOverlayInner />;
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 8,
    maxWidth: 260,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#000000', // theme-exempt: development-only high-contrast diagnostic overlay
    zIndex: 99999,
  },
  line: {
    color: '#FFFFFF', // theme-exempt: development-only high-contrast diagnostic overlay
    fontFamily: FONT.medium,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});
