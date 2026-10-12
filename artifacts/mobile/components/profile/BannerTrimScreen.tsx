/**
 * Banner trim — TikTok's editor trim, copied 1:1 for the profile banner
 * (Mobbin: TikTok "Cropping a video" + editor timeline). A clip of any
 * length goes in; the banner plays a 10s window of it:
 *
 *   ┌──────────────────────────────┐
 *   │                              │  live preview of the window, looping
 *   │          (the clip)          │  muted (tap to pause / play)
 *   │                              │
 *   │ 00:43 / 01:12      ▶         │  clock + play / pause
 *   │ ▯▯▯▯[▯▯▯|▯▯]▯▯▯▯▯▯▯▯▯▯▯▯▯▯ │  filmstrip of the WHOLE clip; the white
 *   │        00:41 – 00:51         │  bracketed 10s window slides along it,
 *   │ Cancel      Trim       Next  │  the playhead inside can be scrubbed
 *   └──────────────────────────────┘
 *
 * Next hands the chosen { start, duration } to the crop screen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, ON_DARK, SP } from '@/lib/theme';
import { hapticSelection } from '@/lib/haptics';
import { filmstripTimes, formatTrimClock, trimWindowLayout } from './profileBannerRules';

export type BannerTrim = { start: number; duration: number };

const STRIP_HEIGHT = 56;
const FRAME_CELL_WIDTH = 40;
const HANDLE_WIDTH = 12;
/** Touches this close to the playhead scrub it instead of moving the window. */
const PLAYHEAD_GRAB = 16;
const nextFrame = (fn: () => void): unknown => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));
const cancelFrame = (id: unknown) => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id as number);
  else clearTimeout(id as ReturnType<typeof setTimeout>);
};

export function BannerTrimScreen({
  source, onCancel, onConfirm,
}: {
  source: { uri: string; durationSeconds: number | null } | null;
  onCancel: () => void;
  onConfirm: (trim: BannerTrim) => void;
}) {
  if (!source || !source.durationSeconds) return null;
  return <TrimEditor uri={source.uri} total={source.durationSeconds} onCancel={onCancel} onConfirm={onConfirm} />;
}

function TrimEditor({
  uri, total, onCancel, onConfirm,
}: {
  uri: string;
  total: number;
  onCancel: () => void;
  onConfirm: (trim: BannerTrim) => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const topInset = useHeaderTopInset();
  const window = useWindowDimensions();
  const stripWidth = Math.min(window.width, 560) - SP.md * 2;
  const layout = useMemo(() => trimWindowLayout(stripWidth, total), [stripWidth, total]);
  const cellCount = Math.max(6, Math.round(stripWidth / FRAME_CELL_WIDTH));
  const times = useMemo(() => filmstripTimes(total, cellCount), [total, cellCount]);

  const player = useVideoPlayer(uri, (p) => { p.muted = true; p.loop = false; p.play(); });
  const [start, setStart] = useState(0);
  const startRef = useRef(0);
  const [playing, setPlaying] = useState(true);
  const playingRef = useRef(true);
  const draggingRef = useRef(false);
  const [clock, setClock] = useState(0);
  const [thumbs, setThumbs] = useState<unknown[] | null>(null);

  const left = useSharedValue(0);
  const playhead = useSharedValue(0); // 0..1 inside the window
  const mode = useSharedValue<0 | 1 | 2>(0); // 0 idle · 1 move window · 2 scrub
  const grab = useSharedValue(0);

  // Filmstrip: frames across the whole clip, generated from the picked file.
  useEffect(() => {
    let cancelled = false;
    const generate = async () => {
      try {
        const frames = await player.generateThumbnailsAsync(times, { maxWidth: 160, maxHeight: 160 } as never);
        if (!cancelled) setThumbs(frames as unknown[]);
      } catch {
        if (!cancelled) setThumbs([]);
      }
    };
    if (player.status === 'readyToPlay') { void generate(); return () => { cancelled = true; }; }
    const sub = player.addListener('statusChange', ({ status }) => { if (status === 'readyToPlay') void generate(); });
    return () => { cancelled = true; sub.remove(); };
  }, [player, times]);

  // Loop the window and drive the playhead every frame (no re-render per frame).
  useEffect(() => {
    let frame: unknown = null;
    let lastClock = -1;
    const tick = () => {
      const s = startRef.current;
      const t = player.currentTime;
      if (!draggingRef.current) {
        if (t >= s + layout.length - 0.04 || t < s - 0.3) {
          player.currentTime = s;
          if (playingRef.current) player.play();
        }
        playhead.value = Math.max(0, Math.min(1, (t - s) / layout.length));
      }
      const whole = Math.floor(t);
      if (whole !== lastClock) { lastClock = whole; setClock(t); }
      frame = nextFrame(tick);
    };
    frame = nextFrame(tick);
    return () => cancelFrame(frame);
  }, [player, layout.length, playhead]);

  const lastSeek = useRef(0);
  const seekTo = useCallback((seconds: number, force = false) => {
    const now = Date.now();
    if (!force && now - lastSeek.current < 80) return;
    lastSeek.current = now;
    player.currentTime = seconds;
  }, [player]);

  const beginDrag = useCallback(() => {
    draggingRef.current = true;
    player.pause();
  }, [player]);
  const moveWindow = useCallback((nextLeft: number) => {
    const s = layout.startForLeft(nextLeft);
    startRef.current = s;
    setStart(s);
    seekTo(s);
  }, [layout, seekTo]);
  const scrub = useCallback((fraction: number) => {
    seekTo(startRef.current + fraction * layout.length);
  }, [layout.length, seekTo]);
  const endDrag = useCallback((wasScrub: boolean, fraction: number) => {
    draggingRef.current = false;
    hapticSelection();
    seekTo(startRef.current + (wasScrub ? fraction * layout.length : 0), true);
    if (playingRef.current) player.play();
  }, [layout.length, player, seekTo]);

  const winWidth = layout.width;
  const maxLeft = layout.maxLeft;
  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      const x = event.x;
      const headX = left.value + playhead.value * winWidth;
      if (Math.abs(x - headX) <= PLAYHEAD_GRAB && x >= left.value - 4 && x <= left.value + winWidth + 4) {
        mode.value = 2;
      } else {
        mode.value = 1;
        // Tapping outside the window brings it there (centred under the finger).
        if (x < left.value || x > left.value + winWidth) {
          left.value = Math.max(0, Math.min(maxLeft, x - winWidth / 2));
          runOnJS(moveWindow)(left.value);
        }
        grab.value = x - left.value;
        playhead.value = 0;
      }
      runOnJS(beginDrag)();
    })
    .onUpdate((event) => {
      if (mode.value === 2) {
        playhead.value = Math.max(0, Math.min(1, (event.x - left.value) / winWidth));
        runOnJS(scrub)(playhead.value);
        return;
      }
      left.value = Math.max(0, Math.min(maxLeft, event.x - grab.value));
      runOnJS(moveWindow)(left.value);
    })
    .onFinalize(() => {
      const wasScrub = mode.value === 2;
      mode.value = 0;
      runOnJS(endDrag)(wasScrub, playhead.value);
    });

  const windowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: left.value }] }));
  const dimLeftStyle = useAnimatedStyle(() => ({ width: left.value }));
  const dimRightStyle = useAnimatedStyle(() => ({ left: left.value + winWidth }));
  const playheadStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: left.value + HANDLE_WIDTH + playhead.value * (winWidth - HANDLE_WIDTH * 2) - 1 }],
  }));

  const togglePlay = () => {
    hapticSelection();
    const next = !playingRef.current;
    playingRef.current = next;
    setPlaying(next);
    if (next) player.play(); else player.pause();
  };

  const confirm = () => {
    hapticSelection();
    player.pause();
    onConfirm({ start: Math.round(start * 100) / 100, duration: Math.round(layout.length * 100) / 100 });
  };

  const end = start + layout.length;
  return (
    <Modal visible animationType="slide" onRequestClose={onCancel} presentationStyle="fullScreen">
      <GestureHandlerRootView style={[styles.root, { backgroundColor: theme.background, paddingTop: topInset, paddingBottom: Math.max(insets.bottom, SP.md) }]}>
        <Pressable style={styles.preview} onPress={togglePlay} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} testID="banner-trim">
          <VideoView player={player} style={[StyleSheet.absoluteFill, styles.fill]} contentFit="contain" nativeControls={false} />
        </Pressable>

        <View style={styles.clockRow}>
          <Text style={[styles.clock, { color: theme.text }]} testID="banner-trim-clock">
            {formatTrimClock(clock)}<Text style={{ color: theme.muted }}>{` / ${formatTrimClock(total)}`}</Text>
          </Text>
          <Pressable onPress={togglePlay} hitSlop={12} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} style={styles.playButton} testID="banner-trim-play">
            <Feather name={playing ? 'pause' : 'play'} size={22} color={theme.text} />
          </Pressable>
          <View style={styles.clockSpacer} />
        </View>

        <GestureDetector gesture={pan}>
          <View style={[styles.strip, { width: stripWidth, backgroundColor: theme.card }]} testID="banner-trim-strip">
            <View style={styles.frames} pointerEvents="none">
              {times.map((time, index) => {
                const thumb = thumbs?.[index];
                return thumb
                  ? <Image key={time} source={thumb as never} style={[styles.frame, { width: stripWidth / times.length }]} contentFit="cover" transition={0} />
                  : <View key={time} style={[styles.frame, { width: stripWidth / times.length, borderColor: theme.background }]} />;
              })}
            </View>
            <Animated.View pointerEvents="none" style={[styles.dim, styles.dimLeft, dimLeftStyle]} />
            <Animated.View pointerEvents="none" style={[styles.dim, styles.dimRight, dimRightStyle]} />
            <Animated.View pointerEvents="none" style={[styles.window, { width: winWidth }, windowStyle]} testID="banner-trim-window">
              <View style={[styles.handle, styles.handleLeft]}><View style={styles.grip} /></View>
              <View style={[styles.handle, styles.handleRight]}><View style={styles.grip} /></View>
            </Animated.View>
            <Animated.View pointerEvents="none" style={[styles.playhead, playheadStyle]} />
          </View>
        </GestureDetector>

        <Text style={[styles.range, { color: theme.muted }]} testID="banner-trim-range">
          {`${formatTrimClock(start)} – ${formatTrimClock(end)}`}
        </Text>

        <View style={styles.bar}>
          <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button" style={styles.barSide} testID="banner-trim-cancel">
            <Text style={[styles.barText, { color: theme.text }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.barTitle, { color: theme.text }]} accessibilityRole="header">Trim</Text>
          <Pressable onPress={confirm} hitSlop={10} accessibilityRole="button" style={[styles.barSide, styles.barRight]} testID="banner-trim-next">
            <Text style={[styles.barText, styles.barStrong, { color: theme.text }]}>Next</Text>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  preview: { flex: 1, width: '100%', backgroundColor: '#000000' }, // theme-exempt: media backdrop
  fill: { width: '100%', height: '100%' },
  clockRow: { width: '100%', flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  clock: { flex: 1, fontFamily: FONT.medium, fontSize: 13, fontVariant: ['tabular-nums'] },
  playButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  clockSpacer: { flex: 1 },
  strip: { height: STRIP_HEIGHT, borderRadius: 6, marginTop: SP.xs },
  frames: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', borderRadius: 6, overflow: 'hidden' },
  frame: { height: STRIP_HEIGHT, borderRightWidth: StyleSheet.hairlineWidth },
  dim: { position: 'absolute', top: 0, bottom: 0, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.6)' }, // theme-exempt: outside-the-window dim (TikTok / Instagram trim)
  dimLeft: { left: 0 },
  dimRight: { right: 0 },
  window: {
    position: 'absolute', top: 0, bottom: 0, left: 0,
    borderTopWidth: 3, borderBottomWidth: 3, borderColor: ON_DARK, borderRadius: 6,
  },
  handle: {
    position: 'absolute', top: -3, bottom: -3, width: HANDLE_WIDTH, backgroundColor: ON_DARK,
    alignItems: 'center', justifyContent: 'center',
  },
  handleLeft: { left: 0, borderTopLeftRadius: 6, borderBottomLeftRadius: 6 },
  handleRight: { right: 0, borderTopRightRadius: 6, borderBottomRightRadius: 6 },
  grip: { width: 2, height: 16, borderRadius: 1, backgroundColor: '#000000' }, // theme-exempt: grip on the white handle
  playhead: {
    position: 'absolute', top: -6, bottom: -6, left: 0, width: 2, borderRadius: 1, backgroundColor: ON_DARK,
  },
  range: { fontFamily: FONT.medium, fontSize: 13, marginTop: SP.sm, fontVariant: ['tabular-nums'] },
  bar: { width: '100%', flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingTop: SP.md, minHeight: 52 },
  barSide: { flex: 1, minHeight: 44, justifyContent: 'center' },
  barRight: { alignItems: 'flex-end' },
  barTitle: { fontFamily: FONT.semibold, fontSize: 17 },
  barText: { fontFamily: FONT.regular, fontSize: 17 },
  barStrong: { fontFamily: FONT.semibold },
});
