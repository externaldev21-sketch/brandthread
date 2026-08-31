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

const FG = '#FFFFFF';
const MUTED = '#9CA3AF';
const ERROR = '#F87171';

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
  { id: 'none', label: 'Original' },
  { id: 'warm', label: 'Warm', overlay: 'rgba(249,115,22,0.13)' },
  { id: 'cool', label: 'Cool', overlay: 'rgba(59,130,246,0.13)' },
  { id: 'mono', label: 'Mono', overlay: 'rgba(15,23,42,0.24)' },
];

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function CameraCaptureWeb() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.root, s.webFallback, { backgroundColor: colors.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={s.webFallbackIcon}>
        <Feather name="camera-off" size={34} color={colors.primary} />
      </View>
      <Text style={[s.webFallbackTitle, { color: colors.foreground }]}>Camera capture is mobile-only</Text>
      <Text style={[s.webFallbackText, { color: colors.mutedForeground }]}>
        Record multi-clip videos in the mobile app. On the web, choose a video from your device and continue to the same trim editor.
      </Text>
      <TouchableOpacity
        style={[s.webFallbackButton, { backgroundColor: colors.primary }]}
        onPress={() => router.back()}
        accessibilityRole="button"
      >
        <Text style={s.webFallbackButtonText}>Back to upload options</Text>
      </TouchableOpacity>
    </View>
  );
}

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

  if (!cameraPermission?.granted || !micPermission?.granted) {
    return (
      <View style={[s.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={s.permBox}>
          <Feather name="camera-off" size={44} color={MUTED} />
          <Text style={s.permTitle}>Camera access required</Text>
          <Text style={s.permSub}>Brandthread needs camera and microphone access to record video clips.</Text>
          <TouchableOpacity
            style={[s.permBtn, { backgroundColor: colors.primary }]}
            onPress={async () => {
              await requestCameraPermission();
              await requestMicPermission();
            }}
          >
            <Text style={s.permBtnText}>Grant access</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()}><Text style={s.cancelText}>Cancel</Text></TouchableOpacity>
        </View>
      </View>
    );
  }

  const completedDuration = totalClipDuration(clips);
  const displayedDuration = Math.min(durationMode, completedDuration + activeDuration);
  const activeFilter = FILTERS.find((item) => item.id === filter);

  return (
    <View style={[s.root, { backgroundColor: colors.background }]} {...pinchResponder.panHandlers}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mode={captureMode}
        flash={flash}
        zoom={zoom}
      />
      {activeFilter?.overlay ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: activeFilter.overlay }]} /> : null}

      <View style={[s.progressTrack, { top: insets.top + 4 }]}>
        {clips.map((clip) => (
          <View
            key={clip.id}
            style={[
              s.progressSegment,
              { flex: Math.max(0.02, effectiveClipDuration(clip) / durationMode), backgroundColor: colors.primary },
            ]}
          />
        ))}
        {isRecording ? (
          <View style={[s.progressSegment, { flex: Math.max(0.02, activeDuration / durationMode), backgroundColor: ERROR }]} />
        ) : null}
        <View style={{ flex: Math.max(0.02, 1 - displayedDuration / durationMode) }} />
      </View>

      <View style={[s.topBar, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity style={s.iconBtn} onPress={() => {
          if (clips.length === 0) router.back();
          else Alert.alert('Discard clips?', 'Your recorded clips will be lost.', [
            { text: 'Keep editing', style: 'cancel' },
            { text: 'Discard', style: 'destructive', onPress: () => router.back() },
          ]);
        }}>
          <Feather name="x" size={22} color={FG} />
        </TouchableOpacity>
        <View style={s.timerPill}>
          {isRecording ? <View style={s.timerDot} /> : null}
          <Text style={s.timerText}>{formatTime(displayedDuration)}</Text>
          <Text style={s.timerRemaining}> / {formatTime(durationMode)}</Text>
        </View>
        <TouchableOpacity style={s.iconBtn} onPress={() => setFlash((value) => value === 'off' ? 'on' : 'off')}>
          <Feather name={flash === 'off' ? 'zap-off' : 'zap'} size={22} color={flash === 'on' ? '#FBBF24' : FG} />
        </TouchableOpacity>
      </View>

      <View style={s.rightRail}>
        <TouchableOpacity style={s.railButton} disabled={isRecording} onPress={() => setFacing((value) => value === 'back' ? 'front' : 'back')}>
          <Feather name="refresh-cw" size={21} color={isRecording ? MUTED : FG} />
          <Text style={[s.railLabel, isRecording && { color: MUTED }]}>Flip</Text>
        </TouchableOpacity>
        <View style={s.railButton}>
          <Feather name="zoom-in" size={21} color={FG} />
          <Text style={s.railLabel}>{Math.round(zoom * 9 + 1)}x</Text>
        </View>
      </View>

      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 14 }]}>
        {captureError ? (
          <View style={s.errorBanner}>
            <Feather name="alert-circle" size={15} color={ERROR} />
            <Text style={s.errorText}>{captureError}</Text>
            <TouchableOpacity onPress={() => setCaptureError(null)}><Feather name="x" size={15} color={ERROR} /></TouchableOpacity>
          </View>
        ) : null}

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
                    <Feather name="trash-2" size={12} color={ERROR} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={s.durationRow}>
                {([15, 30, 60, 600] as DurationMode[]).map((value) => (
                  <TouchableOpacity
                    key={value}
                    style={[s.durationBtn, durationMode === value && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                    onPress={() => setDurationMode(value)}
                  >
                    <Text style={[s.durationText, durationMode === value && { color: FG }]}>{DURATION_LABELS[value]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <View style={s.optionRow}>
              {SPEEDS.map((value) => (
                <TouchableOpacity key={value} style={[s.optionChip, speed === value && { borderColor: colors.primary }]} onPress={() => setSpeed(value)}>
                  <Text style={[s.optionText, speed === value && { color: colors.primary }]}>{value}x</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.optionRow}>
              {FILTERS.map((item) => (
                <TouchableOpacity key={item.id} style={[s.optionChip, filter === item.id && { borderColor: colors.primary }]} onPress={() => setFilter(item.id)}>
                  <Text style={[s.optionText, filter === item.id && { color: colors.primary }]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

        <View style={s.controlsRow}>
          <TouchableOpacity
            style={s.sideBtn}
            disabled={isRecording || clips.length > 0}
            onPress={() => setCaptureMode((value) => value === 'video' ? 'picture' : 'video')}
          >
            <Feather name={captureMode === 'video' ? 'camera' : 'video'} size={24} color={isRecording || clips.length > 0 ? MUTED : FG} />
            <Text style={[s.sideBtnLabel, (isRecording || clips.length > 0) && { color: MUTED }]}>{captureMode === 'video' ? 'Photo' : 'Video'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.recordBtn, isRecording && s.recordBtnRecording]}
            activeOpacity={0.85}
            onPress={captureMode === 'picture' ? handlePhoto : (isRecording ? stopRecording : startRecording)}
          >
            {isRecording ? <View style={s.stopIcon} /> : <View style={[s.recordInner, { backgroundColor: captureMode === 'picture' ? FG : colors.primary }]} />}
          </TouchableOpacity>
          {captureMode === 'video' ? (
            <TouchableOpacity
              style={[s.sideBtn, clips.length === 0 && { opacity: 0.35 }]}
              disabled={clips.length === 0 || isRecording}
              onPress={() => {
                (global as any).__cameraCaptureResult = {
                  type: 'video',
                  clips,
                  duration: totalClipDuration(clips),
                };
                router.back();
              }}
            >
              <Feather name="check" size={24} color={FG} />
              <Text style={s.sideBtnLabel}>Edit</Text>
            </TouchableOpacity>
          ) : <View style={s.sideBtn} />}
        </View>
        <Text style={s.gestureHint}>{isRecording ? 'Tap to pause' : 'Tap to record · Pinch to zoom'}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  webFallback: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  webFallbackIcon: { width: 76, height: 76, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14,165,233,0.14)', marginBottom: 20 },
  webFallbackTitle: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  webFallbackText: { maxWidth: 520, fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 24 },
  webFallbackButton: { borderRadius: 14, paddingHorizontal: 20, paddingVertical: 14 },
  webFallbackButtonText: { color: FG, fontSize: 15, fontWeight: '700' },
  progressTrack: { position: 'absolute', left: 12, right: 12, zIndex: 12, height: 4, flexDirection: 'row', gap: 2, overflow: 'hidden', borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)' },
  progressSegment: { height: 4, minWidth: 3, borderRadius: 2 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.58)', justifyContent: 'center', alignItems: 'center' },
  timerPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  timerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: ERROR, marginRight: 6 },
  timerText: { color: FG, fontSize: 14, fontWeight: '700' },
  timerRemaining: { color: MUTED, fontSize: 13 },
  rightRail: { position: 'absolute', right: 14, top: '23%', gap: 18, zIndex: 10 },
  railButton: { alignItems: 'center', gap: 4 },
  railLabel: { color: FG, fontSize: 10, fontWeight: '600' },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10, alignItems: 'center', gap: 10, paddingHorizontal: 12 },
  errorBanner: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(15,23,42,0.92)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.5)', borderRadius: 10, padding: 10 },
  errorText: { flex: 1, color: FG, fontSize: 12 },
  durationRow: { flexDirection: 'row', gap: 7 },
  durationBtn: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  durationText: { color: MUTED, fontSize: 12, fontWeight: '600' },
  optionRow: { flexDirection: 'row', gap: 6 },
  optionChip: { minWidth: 50, alignItems: 'center', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.62)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  optionText: { color: FG, fontSize: 11, fontWeight: '600' },
  clipRow: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  clipChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.72)' },
  clipChipText: { color: FG, fontSize: 11, fontWeight: '600' },
  controlsRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  sideBtn: { alignItems: 'center', gap: 5, width: 68 },
  sideBtnLabel: { color: FG, fontSize: 11, fontWeight: '500' },
  recordBtn: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: FG, justifyContent: 'center', alignItems: 'center' },
  recordBtnRecording: { borderColor: ERROR },
  recordInner: { width: 58, height: 58, borderRadius: 29 },
  stopIcon: { width: 25, height: 25, borderRadius: 5, backgroundColor: ERROR },
  gestureHint: { color: 'rgba(255,255,255,0.75)', fontSize: 11 },
  permBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, gap: 16 },
  permTitle: { color: FG, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  permSub: { color: MUTED, fontSize: 14, textAlign: 'center', lineHeight: 22 },
  permBtn: { paddingHorizontal: 28, paddingVertical: 13, borderRadius: 12, marginTop: 8 },
  permBtnText: { color: FG, fontSize: 15, fontWeight: '600' },
  cancelText: { color: MUTED, fontSize: 14 },
});