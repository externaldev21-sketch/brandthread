// ─── Camera-first Create screen (TikTok / Instagram camera, reskinned) ────────
// The first thing a seller (or buyer) sees when they tap Create: a full-bleed
// live camera with floating chrome. Layout follows TikTok's camera 1:1 —
// X top-left, title pill top-center, icon rail on the right, swipeable
// duration chips above a big round shutter, camera-roll thumb bottom-left,
// flip bottom-right — reskinned to black/white/silver (LIVE red only for the
// recording state).
//
// `create-post.tsx` renders this as its opening step and owns what happens
// next: a photo or clip goes straight into the existing editor, the camera
// roll thumb opens the existing picker as a sheet, and the "Thread ⌄"
// dropdown switches between Thread / Post / Story in place.
//
// Web: expo-camera's CameraView streams the webcam (getUserMedia) when the
// browser allows it; recording there goes through MediaRecorder on that same
// stream (expo-camera's own record() is native-only). With no camera at all
// the screen stays a clean black placeholder with the same chrome.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Easing, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { Button } from '@/components/ui/Button';
import { LIVE_RED } from '@/components/live/LiveAvatarRing';
import { FONT, FS } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { FADE_MS, PRESS_SPRING } from '@/constants/motion';
import {
  CHIP_LABELS, CHIP_SECONDS, CREATE_MODE_LABELS, DEFAULT_CHIP,
  chipsForMode, coerceChipForMode, createModeOptions, formatRecordingTime,
  nearestChipIndex, nextTimerSetting, recordingProgress, shouldAutoStop,
  type CaptureChip, type CreateMode, type TimerSetting,
} from '@/lib/createCamera';

// expo-media-library has no web implementation — same lazy require as
// components/create-post/MediaGrid.tsx. Only used for the camera-roll thumb.
let MediaLibrary: typeof import('expo-media-library/legacy') | null = null;
if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  MediaLibrary = require('expo-media-library/legacy');
}

const IS_WEB = Platform.OS === 'web';

// Shutter geometry (TikTok: 84pt outer ring, 64pt inner disc).
const SHUTTER = 84;
const SHUTTER_INNER = 64;
const RING_STROKE = 4;
const RING_R = (SHUTTER - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;
const CHIP_W = 64;
const HOLD_DELAY_MS = 250;
const TICK_MS = 50;

export interface CreateCameraProps {
  isBuyer: boolean;
  mode: CreateMode;
  onModeChange: (mode: CreateMode) => void;
  onClose: () => void;
  /** Camera-roll thumb tapped → the caller opens the existing picker. */
  onOpenLibrary: () => void;
  onPhoto: (uri: string) => void;
  onVideo: (uri: string, durationSeconds: number) => void;
  testID?: string;
}

/** Records the webcam stream behind expo-camera's <video> on web. */
function recordWebStream(root: View | null, maxSeconds: number, stop: { current: (() => void) | null }): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const node = root as unknown as { querySelector?: (sel: string) => HTMLVideoElement | null } | null;
      const video = node?.querySelector?.('video');
      const stream = video?.srcObject as MediaStream | null | undefined;
      const Recorder = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
      if (!stream || !Recorder) { reject(new Error('no-stream')); return; }
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
        .find((m) => Recorder.isTypeSupported?.(m));
      const recorder = new Recorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e: BlobEvent) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onerror = () => reject(new Error('record-failed'));
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
        resolve(URL.createObjectURL(blob));
      };
      const guard = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, (maxSeconds + 1) * 1000);
      stop.current = () => { clearTimeout(guard); if (recorder.state === 'recording') recorder.stop(); };
      recorder.start(250);
    } catch (error) {
      reject(error);
    }
  });
}

export function CreateCamera({
  isBuyer, mode, onModeChange, onClose, onOpenLibrary, onPhoto, onVideo, testID = 'create-camera',
}: CreateCameraProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const topInset = useHeaderTopInset();
  const { width: screenW } = useWindowDimensions();
  useHideTabBar();

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [timer, setTimer] = useState<TimerSetting>(0);
  const [chip, setChip] = useState<CaptureChip>(coerceChipForMode(DEFAULT_CHIP, mode));
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [rollThumb, setRollThumb] = useState<string | null>(null);
  const [webStreamFailed, setWebStreamFailed] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const cameraWrapRef = useRef<View>(null);
  const chipScrollRef = useRef<ScrollView>(null);
  const recordingRef = useRef(false);
  const holdRef = useRef(false);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const webStopRef = useRef<(() => void) | null>(null);
  const chipRef = useRef(chip);
  useEffect(() => { chipRef.current = chip; }, [chip]);

  const chips = chipsForMode(mode);
  const isPhotoChip = chip === 'photo';
  const hasCamera = !!cameraPermission?.granted && !webStreamFailed;

  // ── Permissions: web asks the browser straight away (its own prompt is
  // the native-style one); native shows the inline card first so the OS
  // prompt only appears after a deliberate tap. ──
  useEffect(() => {
    if (!IS_WEB) return;
    void (async () => {
      try {
        if (!cameraPermission?.granted) {
          const result = await requestCameraPermission();
          if (!result.granted) setWebStreamFailed(true);
        }
      } catch {
        setWebStreamFailed(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const askPermission = useCallback(async () => {
    try {
      if (!IS_WEB && cameraPermission?.canAskAgain === false) { await Linking.openSettings(); return; }
      await requestCameraPermission();
      if (!micPermission?.granted) await requestMicPermission();
    } catch {
      // Permission APIs can throw with no camera hardware; the black
      // placeholder already covers that state.
    }
  }, [cameraPermission?.canAskAgain, micPermission?.granted, requestCameraPermission, requestMicPermission]);

  // ── Camera-roll thumb: newest library asset (native only; never asks). ──
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!MediaLibrary) return;
      try {
        const current = await MediaLibrary.getPermissionsAsync();
        if (!current.granted) return;
        const page = await MediaLibrary.getAssetsAsync({
          first: 1, mediaType: ['photo', 'video'],
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        });
        if (active && page.assets[0]?.uri) setRollThumb(page.assets[0].uri);
      } catch {
        // No thumb — the icon tile stays.
      }
    })();
    return () => { active = false; };
  }, []);

  // ── Mode change keeps the chip valid (Post is photo-only). ──
  useEffect(() => {
    setChip((current) => coerceChipForMode(current, mode));
  }, [mode]);

  // ── Shutter inner-disc animation (idle disc ↔ recording square). ──
  const recordAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(recordAnim, { toValue: isRecording ? 1 : 0, useNativeDriver: !IS_WEB, ...PRESS_SPRING }).start();
  }, [isRecording, recordAnim]);

  // ── Dropdown fade/scale. ──
  const menuAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(menuAnim, {
      toValue: menuOpen ? 1 : 0, duration: FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: !IS_WEB,
    }).start();
  }, [menuOpen, menuAnim]);

  const clearTick = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setIsRecording(false);
    clearTick();
    if (IS_WEB) webStopRef.current?.();
    else cameraRef.current?.stopRecording();
  }, [clearTick]);

  useEffect(() => () => {
    clearTick();
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (recordingRef.current) {
      if (IS_WEB) webStopRef.current?.();
      else cameraRef.current?.stopRecording();
    }
  }, [clearTick]);

  const startRecording = useCallback(async () => {
    if (recordingRef.current || !hasCamera) return;
    const activeChip = chipRef.current;
    const maxSeconds = CHIP_SECONDS[activeChip];
    if (maxSeconds <= 0) return;
    setCaptureError(null);
    setMenuOpen(false);
    recordingRef.current = true;
    startedAtRef.current = Date.now();
    setIsRecording(true);
    setElapsed(0);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    tickRef.current = setInterval(() => {
      const seconds = (Date.now() - startedAtRef.current) / 1000;
      setElapsed(seconds);
      if (shouldAutoStop(seconds, activeChip)) stopRecording();
    }, TICK_MS);

    try {
      let uri: string | undefined;
      if (IS_WEB) {
        uri = await recordWebStream(cameraWrapRef.current, maxSeconds, webStopRef);
      } else {
        const result = await cameraRef.current?.recordAsync({ maxDuration: maxSeconds });
        uri = result?.uri;
      }
      const duration = Math.min(maxSeconds, Math.max(0.1, (Date.now() - startedAtRef.current) / 1000));
      if (uri) onVideo(uri, duration);
      else setCaptureError('That clip could not be saved.');
    } catch {
      setCaptureError(IS_WEB ? 'Recording is not available in this browser.' : 'That clip could not be saved.');
    } finally {
      recordingRef.current = false;
      webStopRef.current = null;
      setIsRecording(false);
      setElapsed(0);
      clearTick();
    }
  }, [clearTick, hasCamera, onVideo, stopRecording]);

  const takePhoto = useCallback(async () => {
    if (!hasCamera || recordingRef.current) return;
    setCaptureError(null);
    setMenuOpen(false);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const result = await cameraRef.current?.takePictureAsync({ quality: 0.9 });
      if (result?.uri) onPhoto(result.uri);
      else setCaptureError('That photo could not be saved.');
    } catch {
      setCaptureError('That photo could not be saved.');
    }
  }, [hasCamera, onPhoto]);

  const capture = useCallback(() => {
    if (chipRef.current === 'photo') void takePhoto();
    else void startRecording();
  }, [startRecording, takePhoto]);

  const cancelCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    setCountdown(null);
  }, []);

  /** Tap: photo → snap; video → start/stop. A set timer counts down first. */
  const handleShutterPress = useCallback(() => {
    if (countdown !== null) { cancelCountdown(); return; }
    if (recordingRef.current) { stopRecording(); return; }
    if (timer === 0) { capture(); return; }
    let remaining = timer;
    setCountdown(remaining);
    void Haptics.selectionAsync().catch(() => {});
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        cancelCountdown();
        capture();
        return;
      }
      setCountdown(remaining);
      void Haptics.selectionAsync().catch(() => {});
    }, 1000);
  }, [cancelCountdown, capture, countdown, stopRecording, timer]);

  /** Press-and-hold records for as long as the finger stays down. */
  const handleShutterLongPress = useCallback(() => {
    if (chipRef.current === 'photo' || recordingRef.current || countdown !== null) return;
    holdRef.current = true;
    void startRecording();
  }, [countdown, startRecording]);

  const handleShutterPressOut = useCallback(() => {
    if (!holdRef.current) return;
    holdRef.current = false;
    stopRecording();
  }, [stopRecording]);

  // ── Chip row: tap or swipe to pick; the selected chip sits centered. ──
  const chipPad = Math.max(0, screenW / 2 - CHIP_W / 2);
  const scrollToChip = useCallback((index: number) => {
    chipScrollRef.current?.scrollTo({ x: index * CHIP_W, animated: true });
  }, []);
  const selectChip = useCallback((next: CaptureChip) => {
    if (recordingRef.current) return;
    setChip(next);
    scrollToChip(chips.indexOf(next));
    void Haptics.selectionAsync().catch(() => {});
  }, [chips, scrollToChip]);
  useEffect(() => {
    const index = chips.indexOf(chip);
    const id = setTimeout(() => chipScrollRef.current?.scrollTo({ x: Math.max(0, index) * CHIP_W, animated: false }), 0);
    return () => clearTimeout(id);
    // Re-center when the chip set changes (mode switch); taps scroll themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chips.length]);
  const handleChipScrollEnd = useCallback((offsetX: number) => {
    const index = nearestChipIndex(offsetX, CHIP_W, chips.length);
    const next = chips[index];
    if (next && next !== chipRef.current && !recordingRef.current) {
      setChip(next);
      void Haptics.selectionAsync().catch(() => {});
    }
  }, [chips]);

  const modeOptions = useMemo(() => createModeOptions(isBuyer), [isBuyer]);
  const progress = recordingProgress(elapsed, chip);
  const bottomPad = Math.max(insets.bottom, 12);
  const shadow = {
    textShadowColor: theme.shadowColor, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  } as const;
  const showPrompt = !IS_WEB && !cameraPermission?.granted;

  return (
    <View style={[s.root, { backgroundColor: theme.background }]} testID={testID}>
      {/* ── Live camera (or clean black placeholder) ── */}
      <View ref={cameraWrapRef} style={StyleSheet.absoluteFill} collapsable={false}>
        {hasCamera ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            flash={flash}
            mode={isPhotoChip ? 'picture' : 'video'}
            mute={false}
          />
        ) : null}
      </View>

      {/* ── Native first-run permission card (inline, no OS popup until Allow) ── */}
      {showPrompt ? (
        <View style={s.promptWrap} pointerEvents="box-none">
          <View style={[s.promptCard, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <Feather name="camera" size={22} color={theme.text} />
            <Text style={[s.promptTitle, { color: theme.text }]}>Camera and microphone</Text>
            <Text style={[s.promptBody, { color: theme.muted }]}>Brandthread records video and sound only while you create.</Text>
            <Button
              label={cameraPermission?.canAskAgain === false ? 'Open Settings' : 'Allow'}
              variant="primary" size="small" fullWidth onPress={() => void askPermission()}
            />
          </View>
        </View>
      ) : null}

      {/* ── Timer countdown ── */}
      {countdown !== null ? (
        <View style={s.countdownWrap} pointerEvents="none">
          <Text style={[s.countdownText, { color: theme.text }, shadow]}>{countdown}</Text>
        </View>
      ) : null}

      {/* ── Dropdown backdrop (transparent — tap anywhere to close) ── */}
      {menuOpen ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} accessibilityLabel="Close menu" />
      ) : null}

      {/* ── Top row: X · "Thread ⌄" · (empty) — floats, no bar ── */}
      <View style={[s.topRow, { paddingTop: topInset + 4 }]} pointerEvents="box-none">
        <Pressable
          onPress={onClose}
          style={s.topBtn}
          hitSlop={8}
          accessibilityLabel="Close"
          accessibilityRole="button"
          testID="create-camera-close"
        >
          <Feather name="x" size={24} color={theme.text} style={shadow} />
        </Pressable>
        <View style={s.topTitleWrap} pointerEvents="box-none">
          <Pressable
            onPress={() => { if (!isRecording) { setMenuOpen((v) => !v); void Haptics.selectionAsync().catch(() => {}); } }}
            style={s.topTitleBtn}
            hitSlop={6}
            accessibilityLabel={`${CREATE_MODE_LABELS[mode]}, change what you are creating`}
            accessibilityRole="button"
            accessibilityState={{ expanded: menuOpen }}
            testID="create-camera-mode-title"
          >
            <Text style={[s.topTitle, { color: theme.text }, shadow]}>{CREATE_MODE_LABELS[mode]}</Text>
            <Feather name="chevron-down" size={18} color={theme.text} style={[shadow, { marginTop: 1 }]} />
          </Pressable>
        </View>
        <View style={s.topBtn} />
      </View>

      {/* ── Recording readout ── */}
      {isRecording ? (
        <View style={[s.recordPill, { top: topInset + 52 }]} pointerEvents="none">
          <View style={[s.recordDot, { backgroundColor: LIVE_RED }]} />
          <Text style={[s.recordText, { color: theme.text }, shadow]}>
            {formatRecordingTime(elapsed)} / {formatRecordingTime(CHIP_SECONDS[chip])}
          </Text>
        </View>
      ) : null}

      {/* ── Mode dropdown (small, in place) ── */}
      {menuOpen ? (
        <Animated.View
          style={[
            s.menu,
            { top: topInset + 50, backgroundColor: theme.background, borderColor: theme.border },
            { opacity: menuAnim, transform: [{ scale: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] },
          ]}
          testID="create-camera-mode-menu"
        >
          {modeOptions.map((option) => {
            const selected = option === mode;
            return (
              <Pressable
                key={option}
                style={s.menuRow}
                onPress={() => { setMenuOpen(false); if (!selected) onModeChange(option); }}
                accessibilityRole="menuitem"
                accessibilityState={{ selected }}
                accessibilityLabel={CREATE_MODE_LABELS[option]}
                testID={`create-camera-mode-${option}`}
              >
                <Text style={[s.menuText, { color: theme.text }]}>{CREATE_MODE_LABELS[option]}</Text>
                {selected ? <Feather name="check" size={16} color={theme.text} /> : null}
              </Pressable>
            );
          })}
        </Animated.View>
      ) : null}

      {/* ── Right rail: flip · flash · timer (icons only) ── */}
      {!isRecording ? (
        <View style={[s.rail, { top: topInset + 64 }]} pointerEvents="box-none">
          <Pressable style={s.railBtn} onPress={() => setFacing((v) => (v === 'back' ? 'front' : 'back'))} accessibilityLabel="Flip camera" accessibilityRole="button">
            <Feather name="refresh-cw" size={22} color={theme.text} style={shadow} />
          </Pressable>
          <Pressable style={s.railBtn} onPress={() => setFlash((v) => (v === 'off' ? 'on' : 'off'))} accessibilityLabel={flash === 'off' ? 'Turn flash on' : 'Turn flash off'} accessibilityRole="button">
            <Feather name={flash === 'off' ? 'zap-off' : 'zap'} size={22} color={theme.text} style={shadow} />
          </Pressable>
          <Pressable
            style={s.railBtn}
            onPress={() => { setTimer((v) => nextTimerSetting(v)); void Haptics.selectionAsync().catch(() => {}); }}
            accessibilityLabel={timer === 0 ? 'Timer off' : `Timer ${timer} seconds`}
            accessibilityRole="button"
            testID="create-camera-timer"
          >
            <Feather name="clock" size={22} color={theme.text} style={shadow} />
            {timer > 0 ? <Text style={[s.railBadge, { color: theme.text }, shadow]}>{timer}s</Text> : null}
          </Pressable>
        </View>
      ) : null}

      {/* ── Bottom cluster: error · chips · roll · shutter · flip ── */}
      <View style={[s.bottom, { paddingBottom: bottomPad }]} pointerEvents="box-none">
        {captureError ? (
          <Text style={[s.errorText, { color: theme.muted }, shadow]} accessibilityLiveRegion="polite">{captureError}</Text>
        ) : null}

        {!isRecording && chips.length > 1 ? (
          <ScrollView
            ref={chipScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={CHIP_W}
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: chipPad }}
            onMomentumScrollEnd={(e) => handleChipScrollEnd(e.nativeEvent.contentOffset.x)}
            onScrollEndDrag={(e) => handleChipScrollEnd(e.nativeEvent.contentOffset.x)}
            style={s.chipRow}
            testID="create-camera-chips"
          >
            {chips.map((item) => {
              const selected = item === chip;
              return (
                <Pressable
                  key={item}
                  onPress={() => selectChip(item)}
                  style={s.chip}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={item === 'photo' ? 'Photo' : `${CHIP_LABELS[item]} video`}
                  testID={`create-camera-chip-${item}`}
                >
                  <Text style={[s.chipText, { color: selected ? theme.text : theme.muted }, selected && s.chipTextSelected, shadow]}>
                    {CHIP_LABELS[item]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : <View style={s.chipRow} />}

        <View style={s.shutterRow} pointerEvents="box-none">
          {/* Camera roll (bottom-left) */}
          {!isRecording ? (
            <Pressable
              style={[s.roll, { borderColor: theme.text, backgroundColor: theme.background }]}
              onPress={onOpenLibrary}
              accessibilityLabel="Open camera roll"
              accessibilityRole="button"
              testID="create-camera-roll"
            >
              {rollThumb ? (
                <Image source={{ uri: rollThumb }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Feather name="image" size={18} color={theme.text} />
              )}
            </Pressable>
          ) : <View style={s.rollSpacer} />}

          {/* Shutter */}
          <Pressable
            onPress={handleShutterPress}
            onLongPress={handleShutterLongPress}
            onPressOut={handleShutterPressOut}
            delayLongPress={HOLD_DELAY_MS}
            style={s.shutter}
            accessibilityRole="button"
            accessibilityLabel={isPhotoChip ? 'Take photo' : isRecording ? 'Stop recording' : 'Record'}
            accessibilityState={{ busy: isRecording }}
            testID="create-camera-shutter"
          >
            <Svg width={SHUTTER} height={SHUTTER} style={StyleSheet.absoluteFill}>
              <Circle
                cx={SHUTTER / 2} cy={SHUTTER / 2} r={RING_R}
                stroke={isRecording ? theme.border : theme.text}
                strokeWidth={RING_STROKE} fill="none"
              />
              {isRecording ? (
                <Circle
                  cx={SHUTTER / 2} cy={SHUTTER / 2} r={RING_R}
                  stroke={LIVE_RED} strokeWidth={RING_STROKE} fill="none" strokeLinecap="round"
                  strokeDasharray={`${RING_C} ${RING_C}`}
                  strokeDashoffset={RING_C * (1 - progress)}
                  transform={`rotate(-90 ${SHUTTER / 2} ${SHUTTER / 2})`}
                />
              ) : null}
            </Svg>
            <Animated.View
              style={[
                s.shutterInner,
                {
                  backgroundColor: isRecording ? LIVE_RED : theme.text,
                  borderRadius: recordAnim.interpolate({ inputRange: [0, 1], outputRange: [SHUTTER_INNER / 2, 8] }),
                  transform: [{ scale: recordAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 28 / SHUTTER_INNER] }) }],
                },
              ]}
            />
          </Pressable>

          {/* Flip (bottom-right) */}
          {!isRecording ? (
            <Pressable
              style={[s.flip, { borderColor: theme.border, backgroundColor: theme.background }]}
              onPress={() => setFacing((v) => (v === 'back' ? 'front' : 'back'))}
              accessibilityLabel="Flip camera"
              accessibilityRole="button"
              testID="create-camera-flip"
            >
              <Feather name="refresh-cw" size={20} color={theme.text} />
            </Pressable>
          ) : <View style={s.flipSpacer} />}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },

  promptWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, zIndex: 30 },
  promptCard: {
    width: '100%', maxWidth: 300, borderWidth: StyleSheet.hairlineWidth, borderRadius: RADII.sheet,
    paddingHorizontal: 20, paddingTop: 22, paddingBottom: 18, alignItems: 'center', gap: 8,
  },
  promptTitle: { fontFamily: FONT.bold, fontSize: FS.md, textAlign: 'center', marginTop: 4 },
  promptBody: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20, textAlign: 'center', marginBottom: 8 },

  countdownWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 25 },
  countdownText: { fontFamily: FONT.bold, fontSize: 96, lineHeight: 104 },

  topRow: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 40,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, minHeight: 44,
  },
  topBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitleWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'flex-end' },
  topTitleBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 40, paddingHorizontal: 8 },
  topTitle: { fontFamily: FONT.bold, fontSize: FS.md },

  recordPill: { position: 'absolute', left: 0, right: 0, zIndex: 35, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  recordDot: { width: 8, height: 8, borderRadius: 4 },
  recordText: { fontFamily: FONT.semibold, fontSize: FS.sm, fontVariant: ['tabular-nums'] },

  menu: {
    position: 'absolute', alignSelf: 'center', zIndex: 45, width: 188,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: RADII.card, paddingVertical: 6, overflow: 'hidden',
  },
  menuRow: { height: 44, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  menuText: { fontFamily: FONT.medium, fontSize: FS.base },

  rail: { position: 'absolute', right: 10, zIndex: 35, alignItems: 'center', gap: 6 },
  railBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  railBadge: { position: 'absolute', bottom: 2, fontFamily: FONT.semibold, fontSize: 10 },

  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 35, alignItems: 'center' },
  errorText: { fontFamily: FONT.medium, fontSize: FS.xs, textAlign: 'center', paddingHorizontal: 24, marginBottom: 10 },
  chipRow: { height: 32, flexGrow: 0, marginBottom: 18, width: '100%' },
  chip: { width: CHIP_W, height: 32, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  chipTextSelected: { fontFamily: FONT.bold },

  shutterRow: { width: '100%', height: SHUTTER, alignItems: 'center', justifyContent: 'center' },
  roll: {
    position: 'absolute', left: 28, width: 44, height: 44, borderRadius: 10, borderWidth: 1.5,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  rollSpacer: { position: 'absolute', left: 28, width: 44, height: 44 },
  flipSpacer: { position: 'absolute', right: 28, width: 44, height: 44 },
  shutter: { width: SHUTTER, height: SHUTTER, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: SHUTTER_INNER, height: SHUTTER_INNER },
  flip: {
    position: 'absolute', right: 28, width: 44, height: 44, borderRadius: RADII.full, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
});
