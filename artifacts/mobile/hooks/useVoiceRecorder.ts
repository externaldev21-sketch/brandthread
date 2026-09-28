import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform } from 'react-native';
import {
  useAudioRecorder, useAudioRecorderState, RecordingPresets,
  requestRecordingPermissionsAsync, setAudioModeAsync,
} from 'expo-audio';
import { hapticLight, hapticMedium } from '@/lib/haptics';

/**
 * Instagram DM "Sending an audio message" flow (mobbin.com/flows/125d5a4c-
 * 31d5-4b05-8f08-2de2c6860c23): press-and-hold the mic to record, slide left
 * to cancel, slide up to lock into hands-free recording, release to send.
 *
 * Web has no true press-and-hold-and-drag-from-the-same-gesture parity (a
 * mouse "hold" is just mousedown, and dragging off the target loses pointer
 * capture in a lot of browser/RN-Web combinations), so on web this hook
 * exposes `startWeb()` — a tap toggles recording — instead of `panHandlers`.
 * Slide-to-cancel/lock is native-only; on web the same trash/lock affordances
 * in the recording pill are plain tap targets. See docs/dm-flows.md.
 */

export type VoiceRecorderPhase = 'idle' | 'recording' | 'locked';

// Drag thresholds (px) for the native slide-to-cancel / slide-to-lock gesture.
const CANCEL_THRESHOLD = -90;
const LOCK_THRESHOLD = -70;

const METERING_INTERVAL_MS = 100;
const MIN_RECORDING_MS = 400;
const MAX_WAVEFORM_SAMPLES = 60;

function normalizeMetering(db: number | undefined): number {
  // expo-audio reports dBFS, roughly -160 (silence) to 0 (max). Clamp to a
  // usable window and normalize to 0..1 for bar heights.
  if (db == null || Number.isNaN(db)) return 0.05;
  const clamped = Math.max(-50, Math.min(0, db));
  return (clamped + 50) / 50;
}

export interface UseVoiceRecorderResult {
  phase: VoiceRecorderPhase;
  elapsedMs: number;
  waveform: number[];
  /** Live drag offset while recording (native only) — for the pill's transform. */
  dragX: Animated.Value;
  dragY: Animated.Value;
  isWeb: boolean;
  /** Native: spread onto the mic button's View. */
  panHandlers: Record<string, unknown>;
  /** Web: tap-to-toggle. Call on every mic tap. */
  startWeb: () => Promise<void>;
  /** Explicit lock (web lock-icon tap, or reached via native drag). */
  lock: () => void;
  /** Cancel and discard — no attachment produced. */
  cancel: () => void;
  /** Stop, upload, and resolve with the attachment fields, or null if cancelled/failed. */
  finish: () => Promise<{ uri: string; durationSec: number; waveform: number[] } | null>;
}

export function useVoiceRecorder(
  uploadMedia: (base64: string, mimeType: string, extension: string) => Promise<string>,
  onRecorded: (result: { uri: string; durationSec: number; waveform: number[] }) => void,
): UseVoiceRecorderResult {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, METERING_INTERVAL_MS);
  const [phase, setPhase] = useState<VoiceRecorderPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [waveform, setWaveform] = useState<number[]>([]);
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (phase !== 'idle' && recorderState.isRecording) {
      setWaveform((w) => (w.length >= MAX_WAVEFORM_SAMPLES ? w : [...w, normalizeMetering(recorderState.metering)]));
    }
  }, [recorderState.metering, recorderState.isRecording, phase]);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const beginRecording = useCallback(async () => {
    cancelledRef.current = false;
    setWaveform([]);
    setElapsedMs(0);
    dragX.setValue(0);
    dragY.setValue(0);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone permission denied');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAtRef.current = Date.now();
      setPhase('recording');
      hapticMedium();
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 100);
      return true;
    } catch {
      return false;
    }
  }, [recorder, dragX, dragY]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stopTimer();
    setPhase('idle');
    void recorder.stop().catch(() => {});
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    dragX.setValue(0);
    dragY.setValue(0);
  }, [recorder, dragX, dragY, stopTimer]);

  const lock = useCallback(() => {
    setPhase('locked');
    Animated.spring(dragY, { toValue: 0, useNativeDriver: true, ...ANIM_SPRING }).start();
    dragX.setValue(0);
    hapticLight();
  }, [dragX, dragY]);

  const finish = useCallback(async () => {
    stopTimer();
    const tooShort = Date.now() - startedAtRef.current < MIN_RECORDING_MS;
    const wasCancelled = cancelledRef.current || tooShort;
    const waveformSnapshot = waveform;
    setPhase('idle');
    dragX.setValue(0);
    dragY.setValue(0);
    if (wasCancelled) {
      void recorder.stop().catch(() => {});
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      return null;
    }
    try {
      await recorder.stop();
      const status = recorder.getStatus();
      const uri = recorder.uri ?? status.url;
      if (!uri) return null;
      const response = await fetch(uri);
      const buf = await response.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const CHUNK = 8192;
      for (let i = 0; i < bytes.byteLength; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.byteLength)));
      }
      const url = await uploadMedia(btoa(binary), 'audio/m4a', 'm4a');
      const durationSec = Math.max(1, Math.round(status.durationMillis / 1000));
      const result = { uri: url, durationSec, waveform: waveformSnapshot.length ? waveformSnapshot : [0.2, 0.4, 0.3, 0.5, 0.2] };
      onRecorded(result);
      return result;
    } catch {
      return null;
    } finally {
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    }
  }, [recorder, uploadMedia, waveform, dragX, dragY, stopTimer, onRecorded]);

  const startWeb = useCallback(async () => {
    if (phase === 'idle') {
      await beginRecording();
    }
  }, [phase, beginRecording]);

  // ── Native press-and-hold + slide-to-cancel / slide-up-to-lock ────────────
  // The PanResponder instance is created once; it calls through a ref to the
  // latest begin/lock/cancel/finish so it never closes over stale callbacks.
  const latestRef = useRef({ beginRecording, lock, cancel, finish });
  latestRef.current = { beginRecording, lock, cancel, finish };
  const lockedRef = useRef(false);
  const panHandlersRef = useRef<Record<string, unknown>>({});
  if (Platform.OS !== 'web' && Object.keys(panHandlersRef.current).length === 0) {
    // Lazily require PanResponder only on native to avoid pulling it into the
    // web bundle's hot path unnecessarily.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PanResponder } = require('react-native');
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        lockedRef.current = false;
        void latestRef.current.beginRecording();
      },
      onPanResponderMove: (_evt: unknown, gesture: { dx: number; dy: number }) => {
        if (lockedRef.current) return;
        const dx = Math.min(0, gesture.dx);
        const dy = Math.min(0, gesture.dy);
        dragX.setValue(dx);
        dragY.setValue(dy);
        if (dy <= LOCK_THRESHOLD && dx > CANCEL_THRESHOLD / 2) {
          lockedRef.current = true;
          latestRef.current.lock();
        }
      },
      onPanResponderRelease: (_evt: unknown, gesture: { dx: number }) => {
        if (lockedRef.current) return; // stays recording — user taps send/trash explicitly
        if (gesture.dx <= CANCEL_THRESHOLD) {
          latestRef.current.cancel();
        } else {
          void latestRef.current.finish();
        }
      },
      onPanResponderTerminate: () => {
        if (!lockedRef.current) latestRef.current.cancel();
      },
    });
    panHandlersRef.current = responder.panHandlers;
  }

  return {
    phase,
    elapsedMs,
    waveform,
    dragX,
    dragY,
    isWeb: Platform.OS === 'web',
    panHandlers: panHandlersRef.current,
    startWeb,
    lock,
    cancel,
    finish,
  };
}

const ANIM_SPRING = { tension: 60, friction: 12 };
