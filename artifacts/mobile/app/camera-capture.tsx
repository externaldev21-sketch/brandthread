import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import {
  clampVideoZoom,
  effectiveClipDuration,
  removeVideoClip,
  totalClipDuration,
  type EditableVideoClip,
  type VideoCaptureFilter,
  type VideoCaptureSpeed,
} from '@/lib/videoEditing';
import {
  ACCENT,
  BG,
  FONT,
  FS,
  MUTED,
  ON_DARK,
  RED,
  SP,
  RADIUS,
} from '@/lib/theme';

// ─── Constants ────────────────────────────────────────────────────────────────

const FG      = ON_DARK;           // '#FFFFFF'
const CHROME  = '#000000';         // true-black camera chrome
const GLASS   = 'rgba(0,0,0,0.62)';
const GLASS_LT = 'rgba(0,0,0,0.44)';
const ERROR   = RED;               // '#F87171'

type DurationMode = 15 | 30 | 60 | 600;
type CaptureSpeed = VideoCaptureSpeed;
type CaptureFilter = VideoCaptureFilter;
type CameraVideoClip = EditableVideoClip;

const DURATION_LABELS: Record<DurationMode, string> = {
  15: '15s',
  30: '30s',
  60: '1 min',
  600: '10 min',
};
const SPEEDS: CaptureSpeed[] = [0.5, 1, 2, 3];
const FILTERS: Array<{ id: CaptureFilter; label: string; overlay?: string }> = [
  { id: 'none',  label: 'Original' },
  { id: 'warm',  label: 'Warm',  overlay: 'rgba(249,115,22,0.13)' },
  { id: 'cool',  label: 'Cool',  overlay: 'rgba(59,130,246,0.13)' },
  { id: 'mono',  label: 'Mono',  overlay: 'rgba(15,23,42,0.24)' },
];

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

// ─── Corner bracket framing overlay ──────────────────────────────────────────

function FramingBrackets() {
  const SIZE = 28;
  const THICK = 2.5;
  const COLOR = 'rgba(255,255,255,0.72)';
  const corner = (pos: { top?: number; bottom?: number; left?: number; right?: number }) => (
    <View style={[s.bracketCorner, pos]}>
      {/* horizontal arm */}
      <View style={[s.bracketH, { backgroundColor: COLOR, width: SIZE, height: THICK, top: 0, left: 0, position: 'absolute' }, pos.bottom !== undefined ? { top: undefined, bottom: 0 } : {}]} />
      {/* vertical arm */}
      <View style={[s.bracketV, { backgroundColor: COLOR, width: THICK, height: SIZE, top: 0, left: 0, position: 'absolute' }, pos.right !== undefined ? { left: undefined, right: 0 } : {}, pos.bottom !== undefined ? { top: undefined, bottom: 0 } : {}]} />
    </View>
  );
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={s.framingBox}>
        {corner({ top: 0, left: 0 })}
        {corner({ top: 0, right: 0 })}
        {corner({ bottom: 0, left: 0 })}
        {corner({ bottom: 0, right: 0 })}
      </View>
    </View>
  );
}

// ─── Web fallback ─────────────────────────────────────────────────────────────

function CameraCaptureWeb() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.root, s.webFallback, { backgroundColor: colors.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={[s.webFallbackIcon, { backgroundColor: `${ACCENT}22` }]}>
        <Feather name="camera-off" size={34} color={ACCENT} />
      </View>
      <Text style={[s.webFallbackTitle, { color: colors.foreground }]}>Camera capture is mobile-only</Text>
      <Text style={[s.webFallbackText, { color: colors.mutedForeground }]}>
        Record multi-clip videos in the mobile app. On the web, choose a video from your device and continue to the same trim editor.
      </Text>
      <TouchableOpacity
        style={[s.webFallbackButton, { backgroundColor: ACCENT }]}
        onPress={() => router.back()}
        accessibilityRole="button"
      >
        <Text style={s.webFallbackButtonText}>Back to upload options</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function CameraCapture() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ maxDuration?: string }>();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [captureMode, setCaptureMode] = useState<'video' | 'picture'>('video');
  const [durationMode, setDurationMode] = useState<DurationMode>(
    (Number(params.maxDuration) as DurationMode) || 30,
  );
  const [clips, setClips] = useState<CameraVideoClip[]>([]);
  const [speed, setSpeed] = useState<CaptureSpeed>(1);
  const [filter, setFilter] = useState<CaptureFilter>('none');
  const [zoom, setZoom] = useState(0);
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [isRecording, setIsRecording] = useState(false);
  const [activeDuration, setActiveDuration] = useState(0);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const cameraRef = useRef<CameraView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef = useRef(false);
  const startedAtRef = useRef(0);
  const activeSpeedRef = useRef<CaptureSpeed>(1);
  const activeDurationRef = useRef(0);
  const zoomRef = useRef(0);
  const pinchDistanceRef = useRef<number | null>(null);
  const pinchZoomStartRef = useRef(0);
  const clipsRef = useRef<CameraVideoClip[]>([]);

  useEffect(() => { clipsRef.current = clips; }, [clips]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  useEffect(() => {
    void (async () => {
      if (!cameraPermission?.granted) await requestCameraPermission();
      if (!micPermission?.granted) await requestMicPermission();
    })();
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setIsRecording(false);
    clearTimer();
    cameraRef.current?.stopRecording();
  }, [clearTimer]);

  useEffect(() => () => {
    clearTimer();
    if (recordingRef.current) cameraRef.current?.stopRecording();
  }, [clearTimer]);

  const startRecording = useCallback(async () => {
    if (!cameraRef.current || recordingRef.current) return;
    const completedDuration = totalClipDuration(clipsRef.current);
    const remainingOutputSeconds = durationMode - completedDuration;
    if (remainingOutputSeconds <= 0.05) {
      setCaptureError('Delete a clip or choose a longer duration to record more.');
      return;
    }

    setCaptureError(null);
    activeSpeedRef.current = speed;
    activeDurationRef.current = 0;
    startedAtRef.current = Date.now();
    recordingRef.current = true;
    setIsRecording(true);
    setActiveDuration(0);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    timerRef.current = setInterval(() => {
      const outputSeconds = ((Date.now() - startedAtRef.current) / 1000) / activeSpeedRef.current;
      activeDurationRef.current = outputSeconds;
      setActiveDuration(outputSeconds);
      if (totalClipDuration(clipsRef.current) + outputSeconds >= durationMode) stopRecording();
    }, 100);

    try {
      const result = await cameraRef.current.recordAsync({
        maxDuration: Math.max(1, Math.ceil(remainingOutputSeconds * speed)),
      });
      const rawDuration = Math.max(0.1, (Date.now() - startedAtRef.current) / 1000);
      if (result?.uri) {
        setClips((current) => [
          ...current,
          {
            id: `clip_${Date.now()}_${current.length}`,
            uri: result.uri,
            duration: rawDuration,
            speed,
            filter,
          },
        ]);
      }
    } catch {
      setCaptureError('That clip could not be saved. Your earlier clips are still here.');
    } finally {
      recordingRef.current = false;
      setIsRecording(false);
      setActiveDuration(0);
      activeDurationRef.current = 0;
      clearTimer();
    }
  }, [clearTimer, durationMode, filter, speed, stopRecording]);

  const handlePhoto = useCallback(async () => {
    if (!cameraRef.current) return;
    setCaptureError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (result?.uri) {
        (global as any).__cameraCaptureResult = { uri: result.uri, type: 'photo' };
        router.back();
      }
    } catch {
      setCaptureError('Could not capture that photo. Please try again.');
    }
  }, []);

  const pinchResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2,
    onMoveShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2,
    onPanResponderGrant: (event) => {
      const [a, b] = event.nativeEvent.touches;
      if (!a || !b) return;
      pinchDistanceRef.current = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
      pinchZoomStartRef.current = zoomRef.current;
    },
    onPanResponderMove: (event) => {
      const [a, b] = event.nativeEvent.touches;
      if (!a || !b || !pinchDistanceRef.current) return;
      const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
      setZoom(clampVideoZoom(pinchZoomStartRef.current + (distance - pinchDistanceRef.current) / 300));
    },
    onPanResponderRelease: () => { pinchDistanceRef.current = null; },
    onPanResponderTerminate: () => { pinchDistanceRef.current = null; },
  }), []);

  if (Platform.OS === 'web') return <CameraCaptureWeb />;

  // ─── Permissions gate ──────────────────────────────────────────────────────
  if (!cameraPermission?.granted || !micPermission?.granted) {
    return (
      <View style={[s.root, { backgroundColor: CHROME, paddingTop: insets.top }]}>
        <View style={s.permBox}>
          <View style={s.permIconWrap}>
            <Feather name="camera-off" size={28} color={MUTED} />
          </View>
          <Text style={s.permTitle}>Camera access required</Text>
          <Text style={s.permSub}>Brandthread needs camera and microphone access to record video clips.</Text>
          <TouchableOpacity
            style={[s.permBtn, { backgroundColor: ACCENT }]}
            onPress={async () => {
              await requestCameraPermission();
              await requestMicPermission();
            }}
          >
            <Text style={s.permBtnText}>Grant access</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const completedDuration = totalClipDuration(clips);
  const displayedDuration = Math.min(durationMode, completedDuration + activeDuration);
  const activeFilter = FILTERS.find((item) => item.id === filter);

  return (
    <View style={[s.root, { backgroundColor: CHROME }]} {...pinchResponder.panHandlers}>
      {/* Live camera feed */}
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mode={captureMode}
        flash={flash}
        zoom={zoom}
      />

      {/* Filter colour overlay */}
      {activeFilter?.overlay ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: activeFilter.overlay }]} />
      ) : null}

      {/* Corner framing brackets */}
      <FramingBrackets />

      {/* ── Progress track ─────────────────────────────────────────────── */}
      <View style={[s.progressTrack, { top: insets.top + SP.xs }]}>
        {clips.map((clip) => (
          <View
            key={clip.id}
            style={[
              s.progressSegment,
              { flex: Math.max(0.02, effectiveClipDuration(clip) / durationMode), backgroundColor: ACCENT },
            ]}
          />
        ))}
        {isRecording ? (
          <View style={[s.progressSegment, { flex: Math.max(0.02, activeDuration / durationMode), backgroundColor: ERROR }]} />
        ) : null}
        <View style={{ flex: Math.max(0.02, 1 - displayedDuration / durationMode) }} />
      </View>

      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <View style={[s.topBar, { paddingTop: insets.top + SP.sm }]}>
        {/* Close / discard */}
        <TouchableOpacity
          style={s.iconBtn}
          onPress={() => {
            if (clips.length === 0) router.back();
            else Alert.alert('Discard clips?', 'Your recorded clips will be lost.', [
              { text: 'Keep editing', style: 'cancel' },
              { text: 'Discard', style: 'destructive', onPress: () => router.back() },
            ]);
          }}
          accessibilityLabel="Close camera"
        >
          <Feather name="x" size={20} color={FG} />
        </TouchableOpacity>

        {/* Timer pill */}
        <View style={[s.timerPill, isRecording && s.timerPillActive]}>
          {isRecording ? <View style={s.timerDot} /> : null}
          <Text style={s.timerText}>{formatTime(displayedDuration)}</Text>
          <Text style={s.timerRemaining}> / {formatTime(durationMode)}</Text>
        </View>

        {/* Flash toggle */}
        <TouchableOpacity
          style={s.iconBtn}
          onPress={() => setFlash((v) => v === 'off' ? 'on' : 'off')}
          accessibilityLabel={flash === 'off' ? 'Turn flash on' : 'Turn flash off'}
        >
          <Feather
            name={flash === 'off' ? 'zap-off' : 'zap'}
            size={20}
            color={flash === 'on' ? '#FBBF24' : FG}
          />
        </TouchableOpacity>
      </View>

      {/* ── Right-side vertical tool rail ──────────────────────────────── */}
      <View style={[s.rightRail, { top: insets.top + 80 }]}>
        {/* Flip camera */}
        <TouchableOpacity
          style={[s.railBtn, isRecording && s.railBtnDisabled]}
          disabled={isRecording}
          onPress={() => setFacing((v) => v === 'back' ? 'front' : 'back')}
          accessibilityLabel="Flip camera"
        >
          <Feather name="refresh-cw" size={20} color={isRecording ? MUTED : FG} />
          <Text style={[s.railLabel, isRecording && { color: MUTED }]}>Flip</Text>
        </TouchableOpacity>

        {/* Zoom indicator */}
        <View style={s.railBtn}>
          <Feather name="zoom-in" size={20} color={FG} />
          <Text style={s.railLabel}>{Math.round(zoom * 9 + 1)}x</Text>
        </View>
      </View>

      {/* ── Bottom bar ─────────────────────────────────────────────────── */}
      <View style={[s.bottomBar, { paddingBottom: insets.bottom + SP.md }]}>

        {/* Error banner */}
        {captureError ? (
          <View style={s.errorBanner}>
            <Feather name="alert-circle" size={14} color={ERROR} />
            <Text style={s.errorText}>{captureError}</Text>
            <TouchableOpacity onPress={() => setCaptureError(null)} accessibilityLabel="Dismiss error">
              <Feather name="x" size={14} color={ERROR} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Clip chips / duration selector */}
        {captureMode === 'video' && !isRecording ? (
          <>
            {clips.length > 0 ? (
              <View style={s.clipRow}>
                {clips.map((clip, index) => (
                  <TouchableOpacity
                    key={clip.id}
                    style={s.clipChip}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setClips((current) => removeVideoClip(current, clip.id));
                    }}
                    accessibilityLabel={`Delete clip ${index + 1}`}
                  >
                    <Text style={s.clipChipText}>{index + 1} · {effectiveClipDuration(clip).toFixed(1)}s</Text>
                    <Feather name="trash-2" size={11} color={ERROR} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={s.durationRow}>
                {([15, 30, 60, 600] as DurationMode[]).map((value) => (
                  <TouchableOpacity
                    key={value}
                    style={[s.durationBtn, durationMode === value && s.durationBtnActive]}
                    onPress={() => setDurationMode(value)}
                  >
                    <Text style={[s.durationText, durationMode === value && s.durationTextActive]}>
                      {DURATION_LABELS[value]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        ) : null}

        {/* Filter / mode selector strip */}
        {!isRecording ? (
          <View style={s.filterStrip}>
            {FILTERS.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[s.filterChip, filter === item.id && s.filterChipActive]}
                onPress={() => setFilter(item.id)}
              >
                <Text style={[s.filterText, filter === item.id && s.filterTextActive]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}

            {/* Speed chips */}
            {captureMode === 'video' ? (
              <>
                <View style={s.filterDivider} />
                {SPEEDS.map((value) => (
                  <TouchableOpacity
                    key={value}
                    style={[s.filterChip, speed === value && s.filterChipActive]}
                    onPress={() => setSpeed(value)}
                  >
                    <Text style={[s.filterText, speed === value && s.filterTextActive]}>{value}x</Text>
                  </TouchableOpacity>
                ))}
              </>
            ) : null}
          </View>
        ) : null}

        {/* Main controls row */}
        <View style={s.controlsRow}>
          {/* Mode toggle */}
          <TouchableOpacity
            style={[s.sideBtn, (isRecording || clips.length > 0) && s.sideBtnDisabled]}
            disabled={isRecording || clips.length > 0}
            onPress={() => setCaptureMode((v) => v === 'video' ? 'picture' : 'video')}
            accessibilityLabel={captureMode === 'video' ? 'Switch to photo' : 'Switch to video'}
          >
            <Feather
              name={captureMode === 'video' ? 'camera' : 'video'}
              size={22}
              color={isRecording || clips.length > 0 ? MUTED : FG}
            />
            <Text style={[s.sideBtnLabel, (isRecording || clips.length > 0) && { color: MUTED }]}>
              {captureMode === 'video' ? 'Photo' : 'Video'}
            </Text>
          </TouchableOpacity>

          {/* Shutter */}
          <TouchableOpacity
            style={[s.shutter, isRecording && s.shutterRecording]}
            activeOpacity={0.82}
            onPress={captureMode === 'picture' ? handlePhoto : (isRecording ? stopRecording : startRecording)}
            accessibilityLabel={
              captureMode === 'picture' ? 'Take photo'
                : isRecording ? 'Stop recording' : 'Start recording'
            }
          >
            {isRecording ? (
              <View style={s.stopIcon} />
            ) : (
              <View style={[
                s.shutterInner,
                { backgroundColor: captureMode === 'picture' ? FG : ACCENT },
              ]} />
            )}
          </TouchableOpacity>

          {/* Use / Tag product */}
          {captureMode === 'video' ? (
            <TouchableOpacity
              style={[s.sideBtn, (clips.length === 0 || isRecording) && s.sideBtnDisabled]}
              disabled={clips.length === 0 || isRecording}
              onPress={() => {
                (global as any).__cameraCaptureResult = {
                  type: 'video',
                  clips,
                  duration: totalClipDuration(clips),
                };
                router.back();
              }}
              accessibilityLabel="Use clips"
            >
              <Feather name="check" size={22} color={clips.length === 0 || isRecording ? MUTED : FG} />
              <Text style={[s.sideBtnLabel, (clips.length === 0 || isRecording) && { color: MUTED }]}>Use</Text>
            </TouchableOpacity>
          ) : (
            <View style={s.sideBtn} />
          )}
        </View>

        {/* Tag Product Listing entry */}
        {captureMode === 'video' && clips.length > 0 && !isRecording ? (
          <TouchableOpacity
            style={s.tagProductBtn}
            onPress={() => {
              (global as any).__cameraCaptureResult = {
                type: 'video',
                clips,
                duration: totalClipDuration(clips),
              };
              router.back();
            }}
            accessibilityLabel="Tag product listing"
          >
            <Feather name="tag" size={14} color={ACCENT} />
            <Text style={s.tagProductText}>Tag Product Listing</Text>
            <Feather name="chevron-right" size={14} color={ACCENT} />
          </TouchableOpacity>
        ) : null}

        {/* Gesture hint */}
        <Text style={s.gestureHint}>
          {isRecording ? 'Tap to stop  ·  Pinch to zoom' : 'Tap to record  ·  Pinch to zoom'}
        </Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },

  // ── Web fallback ──
  webFallback: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  webFallbackIcon: { width: 76, height: 76, borderRadius: RADIUS.xl, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md },
  webFallbackTitle: { fontSize: FS.xl, fontFamily: FONT.bold, textAlign: 'center', marginBottom: SP.xs },
  webFallbackText: { maxWidth: 520, fontSize: FS.base, lineHeight: 22, textAlign: 'center', marginBottom: SP.lg },
  webFallbackButton: { borderRadius: RADIUS.md, paddingHorizontal: SP.md, paddingVertical: 14 },
  webFallbackButtonText: { color: FG, fontSize: FS.base, fontFamily: FONT.bold },

  // ── Progress bar ──
  progressTrack: {
    position: 'absolute', left: SP.md, right: SP.md, zIndex: 12,
    height: 3, flexDirection: 'row', gap: 2, overflow: 'hidden',
    borderRadius: RADIUS.xs,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  progressSegment: { height: 3, minWidth: 3, borderRadius: 1 },

  // ── Top bar ──
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: SP.md,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: GLASS,
    justifyContent: 'center', alignItems: 'center',
  },
  timerPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: GLASS,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm + 4, paddingVertical: 6,
  },
  timerPillActive: { backgroundColor: 'rgba(0,0,0,0.78)' },
  timerDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: ERROR, marginRight: 5 },
  timerText: { color: FG, fontSize: FS.sm, fontFamily: FONT.bold },
  timerRemaining: { color: MUTED, fontSize: FS.xs },

  // ── Right rail ──
  rightRail: {
    position: 'absolute', right: SP.md, zIndex: 20,
    gap: SP.md + SP.xs,
  },
  railBtn: { alignItems: 'center', gap: 4 },
  railBtnDisabled: { opacity: 0.38 },
  railLabel: { color: FG, fontSize: FS.xs, fontFamily: FONT.semibold },

  // ── Framing brackets ──
  framingBox: {
    position: 'absolute',
    top: '16%', bottom: '14%',
    left: '8%', right: '8%',
  },
  bracketCorner: { position: 'absolute', width: 28, height: 28 },
  bracketH: {},
  bracketV: {},

  // ── Bottom bar ──
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
    alignItems: 'center', gap: SP.sm,
    paddingHorizontal: SP.md,
  },
  errorBanner: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    backgroundColor: 'rgba(0,0,0,0.88)',
    borderWidth: 1, borderColor: `${ERROR}55`,
    borderRadius: RADIUS.sm, padding: SP.sm,
  },
  errorText: { flex: 1, color: FG, fontSize: FS.xs },

  // ── Duration selector ──
  durationRow: { flexDirection: 'row', gap: 6 },
  durationBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: GLASS,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  durationBtnActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  durationText: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.semibold },
  durationTextActive: { color: FG },

  // ── Filter / mode strip ──
  filterStrip: {
    flexDirection: 'row', alignItems: 'center',
    gap: 5, flexWrap: 'wrap', justifyContent: 'center',
  },
  filterChip: {
    paddingHorizontal: 11, paddingVertical: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: GLASS_LT,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  filterChipActive: { borderColor: ACCENT, backgroundColor: `${ACCENT}22` },
  filterText: { color: 'rgba(255,255,255,0.72)', fontSize: FS.xs, fontFamily: FONT.semibold },
  filterTextActive: { color: FG },
  filterDivider: { width: 1, height: 14, backgroundColor: 'rgba(255,255,255,0.18)', marginHorizontal: 2 },

  // ── Clip chips ──
  clipRow: {
    width: '100%', flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'center', gap: 6,
  },
  clipChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: SP.sm, paddingVertical: 5,
    borderRadius: RADIUS.sm,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  clipChipText: { color: FG, fontSize: FS.xs, fontFamily: FONT.semibold },

  // ── Controls row ──
  controlsRow: {
    width: '100%', flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-around',
  },
  sideBtn: { alignItems: 'center', gap: 5, width: 64, minHeight: 44 },
  sideBtnDisabled: { opacity: 0.35 },
  sideBtnLabel: { color: FG, fontSize: FS.xs, fontFamily: FONT.medium },

  // Shutter button — large white circle
  shutter: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 3, borderColor: FG,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'transparent',
  },
  shutterRecording: { borderColor: ERROR },
  shutterInner: { width: 62, height: 62, borderRadius: 31 },
  stopIcon: { width: 24, height: 24, borderRadius: 5, backgroundColor: ERROR },

  // ── Tag Product Listing ──
  tagProductBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: SP.md, paddingVertical: SP.xs + 2,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: 1, borderColor: `${ACCENT}55`,
  },
  tagProductText: {
    color: FG, fontSize: FS.xs, fontFamily: FONT.semibold, letterSpacing: 0.3,
  },

  // ── Gesture hint ──
  gestureHint: { color: 'rgba(255,255,255,0.55)', fontSize: FS.xs },

  // ── Permissions gate ──
  permBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, gap: SP.md },
  permIconWrap: {
    width: 68, height: 68, borderRadius: RADIUS.xl,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center', alignItems: 'center',
  },
  permTitle: { color: FG, fontSize: FS.md, fontFamily: FONT.bold, textAlign: 'center' },
  permSub: { color: MUTED, fontSize: FS.sm, textAlign: 'center', lineHeight: 22 },
  permBtn: { paddingHorizontal: 28, paddingVertical: 13, borderRadius: RADIUS.md, marginTop: SP.sm },
  permBtnText: { color: FG, fontSize: FS.base, fontFamily: FONT.semibold },
  cancelText: { color: MUTED, fontSize: FS.sm },
});
