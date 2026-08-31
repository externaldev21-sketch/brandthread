/**
 * In-app camera capture screen.
 * Supports video recording (with selectable max duration) and photo capture.
 *
 * Result is written to (global as any).__cameraCaptureResult before navigating back.
 * The caller reads it via useFocusEffect on return.
 *
 * Usage from create-post.tsx:
 *   router.push('/camera-capture?maxDuration=30');
 *   // on focus return:
 *   const result = (global as any).__cameraCaptureResult;
 *   delete (global as any).__cameraCaptureResult;
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, Platform,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';

// Static text defaults are overridden by the active palette where rendered.
const FG = '#FFFFFF';
const MUTED = '#6B7280';

type DurationMode = 15 | 30 | 60 | 600;

const DURATION_LABELS: Record<DurationMode, string> = {
  15: '15s',
  30: '30s',
  60: '1 min',
  600: '10 min',
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
        Recording and shooting from inside Brandthread are available in the mobile app. On the web, choose photos or video from your device instead.
      </Text>
      <TouchableOpacity
        style={[s.webFallbackButton, { backgroundColor: colors.primary }]}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back to upload options"
      >
        <Text style={s.webFallbackButtonText}>Back to upload options</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CameraCapture() {
  const colors = useColors();
  if (Platform.OS === 'web') return <CameraCaptureWeb />;

  const insets = useSafeAreaInsets();
  const { primary: PURPLE, background: BG } = colors;
  const params = useLocalSearchParams<{ maxDuration?: string }>();

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission]       = useMicrophonePermissions();

  const [facing, setFacing]         = useState<'front' | 'back'>('back');
  const [captureMode, setCaptureMode] = useState<'video' | 'picture'>('video');
  const [durationMode, setDurationMode] = useState<DurationMode>(
    (Number(params.maxDuration) as DurationMode) || 30,
  );
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed]         = useState(0);
  const [flash, setFlash]             = useState<'off' | 'on'>('off');

  const cameraRef    = useRef<CameraView>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef   = useRef(0);
  const recordingRef = useRef(false);

  // Request permissions on mount
  useEffect(() => {
    (async () => {
      if (!cameraPermission?.granted) await requestCameraPermission();
      if (!micPermission?.granted)    await requestMicPermission();
    })();
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const stopRecording = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setIsRecording(false);
    stopTimer();
    cameraRef.current?.stopRecording();
  }, [stopTimer]);

  const startTimer = useCallback(() => {
    elapsedRef.current = 0;
    setElapsed(0);
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
      if (elapsedRef.current >= durationMode) stopRecording();
    }, 1000);
  }, [durationMode, stopRecording]);

  const handleRecord = useCallback(async () => {
    if (!cameraRef.current) return;

    if (isRecording) { stopRecording(); return; }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    recordingRef.current = true;
    setIsRecording(true);
    startTimer();

    try {
      const result = await cameraRef.current.recordAsync({ maxDuration: durationMode });
      if (result?.uri) {
        (global as any).__cameraCaptureResult = {
          uri:      result.uri,
          duration: elapsedRef.current,
          type:     'video',
        };
        router.back();
      }
    } catch {
      recordingRef.current = false;
      setIsRecording(false);
      stopTimer();
    }
  }, [isRecording, durationMode, stopRecording, startTimer, stopTimer]);

  const handlePhoto = useCallback(async () => {
    if (!cameraRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (result?.uri) {
        (global as any).__cameraCaptureResult = { uri: result.uri, type: 'photo' };
        router.back();
      }
    } catch {
      Alert.alert('Error', 'Could not capture photo. Please try again.');
    }
  }, []);

  // ── Permission gate ──────────────────────────────────────────────────────────
  if (!cameraPermission?.granted || !micPermission?.granted) {
    return (
      <View style={[s.root, { backgroundColor: BG, paddingTop: insets.top }]}>
        <View style={s.permBox}>
          <Feather name="camera-off" size={44} color={MUTED} />
          <Text style={s.permTitle}>Camera Access Required</Text>
          <Text style={s.permSub}>
            Brandthread needs camera and microphone access to record videos and take photos.
          </Text>
          <TouchableOpacity
            style={[s.permBtn, { backgroundColor: PURPLE }]}
            onPress={async () => {
              await requestCameraPermission();
              await requestMicPermission();
            }}
          >
            <Text style={s.permBtnText}>Grant Access</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
            <Text style={{ color: MUTED, fontSize: 14 }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const progressPct = durationMode > 0 ? elapsed / durationMode : 0;

  return (
    <View style={[s.root, { backgroundColor: BG }]}>
      {/* Camera preview fills full screen */}
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mode={captureMode}
        flash={flash}
      />

      {/* Top bar: back | timer | flash */}
      <View style={[s.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()}>
          <Feather name="x" size={22} color={FG} />
        </TouchableOpacity>

        {isRecording ? (
          <View style={s.timerPill}>
            <View style={s.timerDot} />
            <Text style={s.timerText}>{formatTime(elapsed)}</Text>
            <Text style={s.timerRemaining}>  /  {formatTime(durationMode)}</Text>
          </View>
        ) : (
          <View />
        )}

        <TouchableOpacity
          style={s.iconBtn}
          onPress={() => setFlash((f) => (f === 'off' ? 'on' : 'off'))}
        >
          <Feather
            name={flash === 'off' ? 'zap-off' : 'zap'}
            size={22}
            color={flash === 'on' ? '#FBBF24' : FG}
          />
        </TouchableOpacity>
      </View>

      {/* Recording progress bar */}
      {isRecording && (
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${progressPct * 100}%` as any, backgroundColor: PURPLE }]} />
        </View>
      )}

      {/* Bottom controls */}
      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 16 }]}>

        {/* Duration selector — hidden while recording */}
        {!isRecording && captureMode === 'video' && (
          <View style={s.durationRow}>
            {([15, 30, 60, 600] as DurationMode[]).map((d) => (
              <TouchableOpacity
                key={d}
                style={[s.durationBtn, durationMode === d && [s.durationBtnActive, { backgroundColor: PURPLE, borderColor: PURPLE }]]}
                onPress={() => { Haptics.selectionAsync(); setDurationMode(d); }}
              >
                <Text style={[s.durationText, durationMode === d && s.durationTextActive]}>
                  {DURATION_LABELS[d]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Mode toggle | Record button | Flip */}
        <View style={s.controlsRow}>
          {/* Photo / Video toggle */}
          <TouchableOpacity
            style={s.sideBtn}
            onPress={() => !isRecording && setCaptureMode((m) => m === 'video' ? 'picture' : 'video')}
            disabled={isRecording}
          >
            <Feather name={captureMode === 'video' ? 'camera' : 'video'} size={24} color={isRecording ? MUTED : FG} />
            <Text style={[s.sideBtnLabel, isRecording && { color: MUTED }]}>
              {captureMode === 'video' ? 'Photo' : 'Video'}
            </Text>
          </TouchableOpacity>

          {/* Main record / capture button */}
          <TouchableOpacity
            style={[s.recordBtn, isRecording && s.recordBtnRecording]}
            activeOpacity={0.85}
            onPress={captureMode === 'picture' ? handlePhoto : handleRecord}
          >
            {isRecording ? (
              <View style={s.stopIcon} />
            ) : (
              <View style={[s.recordInner, { backgroundColor: captureMode === 'picture' ? FG : PURPLE }]} />
            )}
          </TouchableOpacity>

          {/* Flip camera */}
          <TouchableOpacity
            style={s.sideBtn}
            onPress={() => !isRecording && setFacing((f) => f === 'back' ? 'front' : 'back')}
            disabled={isRecording}
          >
            <Feather name="refresh-cw" size={24} color={isRecording ? MUTED : FG} />
            <Text style={[s.sideBtnLabel, isRecording && { color: MUTED }]}>Flip</Text>
          </TouchableOpacity>
        </View>
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
  webFallbackButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  // ── Top bar
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center',
  },
  timerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  timerDot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' },
  timerText:      { color: FG, fontSize: 14, fontWeight: '700' },
  timerRemaining: { color: MUTED, fontSize: 13 },

  // ── Progress bar
  progressTrack: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 3, zIndex: 11,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  progressFill: { height: 3 },

  // ── Bottom bar
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
    alignItems: 'center', gap: 20, paddingHorizontal: 16,
  },
  durationRow:         { flexDirection: 'row', gap: 8 },
  durationBtn:         {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  durationBtnActive:   {},
  durationText:        { color: MUTED, fontSize: 13, fontWeight: '600' },
  durationTextActive:  { color: FG },

  controlsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    width: '100%',
  },
  sideBtn: { alignItems: 'center', gap: 5, width: 64 },
  sideBtnLabel: { color: FG, fontSize: 11, fontWeight: '500' },

  recordBtn: {
    width: 78, height: 78, borderRadius: 39,
    borderWidth: 4, borderColor: FG,
    justifyContent: 'center', alignItems: 'center',
  },
  recordBtnRecording: { borderColor: '#EF4444' },
  recordInner:        { width: 60, height: 60, borderRadius: 30 },
  stopIcon:           { width: 26, height: 26, borderRadius: 5, backgroundColor: '#EF4444' },

  // ── Permission gate
  permBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, gap: 16 },
  permTitle: { color: FG, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  permSub:   { color: MUTED, fontSize: 14, textAlign: 'center', lineHeight: 22 },
  permBtn:   {
    paddingHorizontal: 28, paddingVertical: 13,
    borderRadius: 12, marginTop: 8,
  },
  permBtnText: { color: FG, fontSize: 15, fontWeight: '600' },
});
