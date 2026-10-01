/**
 * Step 1 — full-bleed camera (TikTok's capture screen): black canvas, X top
 * left, white tool rail on the right, duration pills above the record button,
 * "Upload" thumbnail bottom-right, swipeable destination bar at the very
 * bottom. Native only — web has no camera, so the flow opens the gallery
 * picker directly there (see app/create-post.tsx).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT } from '@/lib/theme';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { CAPTURE_DURATIONS, type CreateMode } from '@/constants/postLimits';
import { CP, IconButton, PillButton, RailButton, tap } from '@/components/create-post/ui';
import { ModeBar } from '@/components/create-post/ModeBar';
import { MediaThumb } from '@/components/create-post/GalleryPicker';
import { useDeviceMedia } from '@/lib/createPost/useDeviceMedia';
import type { PickedAsset } from '@/lib/createPost/types';

type DurationId = (typeof CAPTURE_DURATIONS)[number]['id'] | 'photo';
const TIMERS = [0, 3, 10] as const;

export function CaptureScreen({ modes, mode, onChangeMode, onClose, onOpenGallery, onCaptured }: {
  modes: CreateMode[];
  mode: CreateMode;
  onChangeMode: (m: CreateMode) => void;
  onClose: () => void;
  onOpenGallery: () => void;
  onCaptured: (asset: PickedAsset) => void;
}) {
  const top = useHeaderTopInset();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraView>(null);
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [timerIdx, setTimerIdx] = useState(0);
  const [duration, setDuration] = useState<DurationId>('1m');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const latest = useDeviceMedia({ pageSize: 1 });
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);

  useEffect(() => () => { if (tick.current) clearInterval(tick.current); }, []);

  const maxSeconds = duration === 'photo' ? 0 : (CAPTURE_DURATIONS.find((d) => d.id === duration)?.seconds ?? 60);
  const ready = camPerm?.granted;

  async function startRecording() {
    if (!camera.current) return;
    if (!micPerm?.granted) {
      const res = await requestMic();
      if (!res.granted) { Alert.alert('Microphone needed', 'Allow microphone access to record video with sound.'); return; }
    }
    setRecording(true);
    setElapsed(0);
    startedAt.current = Date.now();
    tick.current = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 100);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const video = await camera.current.recordAsync({ maxDuration: maxSeconds });
      const seconds = Math.max(0.5, (Date.now() - startedAt.current) / 1000);
      if (video?.uri) onCaptured({ id: `cam-${Date.now()}`, uri: video.uri, kind: 'video', duration: Math.min(seconds, maxSeconds), mimeType: 'video/mp4' });
    } catch {
      /* recording interrupted (e.g. app backgrounded) — nothing to keep */
    } finally {
      if (tick.current) clearInterval(tick.current);
      setRecording(false);
    }
  }

  async function shutter() {
    if (!ready) return;
    if (recording) { camera.current?.stopRecording(); return; }
    const delay = TIMERS[timerIdx];
    if (delay > 0) {
      for (let n = delay; n > 0; n -= 1) { setCountdown(n); await new Promise((r) => setTimeout(r, 1000)); }
      setCountdown(null);
    }
    if (duration === 'photo') {
      const photo = await camera.current?.takePictureAsync({ quality: 1 });
      if (photo?.uri) onCaptured({ id: `cam-${Date.now()}`, uri: photo.uri, kind: 'photo', duration: 0, width: photo.width, height: photo.height, mimeType: 'image/jpeg' });
    } else {
      await startRecording();
    }
  }

  const progress = maxSeconds > 0 ? Math.min(1, elapsed / maxSeconds) : 0;
  const pills: Array<{ id: DurationId; label: string }> = [...CAPTURE_DURATIONS.map((d) => ({ id: d.id, label: d.label })), { id: 'photo', label: 'Photo' }];
  const newest = latest.assets[0];

  return (
    <View style={s.root} testID="capture-screen">
      {ready ? (
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={facing} flash={flash} mode={duration === 'photo' ? 'picture' : 'video'} />
      ) : (
        <View style={[StyleSheet.absoluteFill, s.permission]}>
          <Text style={s.permTitle}>Allow camera access</Text>
          <Text style={s.permBody}>Use the camera to capture a video or photo, or upload from your library below.</Text>
          <PillButton label="Allow camera" onPress={() => requestCam()} flex={false} style={{ marginTop: 16, paddingHorizontal: 28 }} />
        </View>
      )}

      {recording ? <View style={[s.progress, { top: top + 2 }]}><View style={[s.progressFill, { width: `${progress * 100}%` }]} /></View> : null}

      <View style={[s.topRow, { top: top + 8 }]}>
        {!recording ? <IconButton icon="x" label="Close" onPress={onClose} testID="capture-close" /> : <View style={{ width: 44 }} />}
        {recording ? <Text style={s.clock}>{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}</Text> : null}
        <View style={{ width: 44 }} />
      </View>

      {!recording ? (
        <View style={[s.rail, { top: top + 64 }]} testID="capture-rail">
          <RailButton icon="refresh-cw" label="Flip" onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} testID="capture-flip" />
          <RailButton icon={flash === 'on' ? 'zap' : 'zap-off'} label="Flash" onPress={() => setFlash((f) => (f === 'on' ? 'off' : 'on'))} testID="capture-flash" />
          <RailButton icon="clock" label={TIMERS[timerIdx] ? `${TIMERS[timerIdx]}s` : 'Timer'} onPress={() => setTimerIdx((i) => (i + 1) % TIMERS.length)} testID="capture-timer" />
        </View>
      ) : null}

      {countdown !== null ? <View style={s.countdown} pointerEvents="none"><Text style={s.countdownText}>{countdown}</Text></View> : null}

      <View style={[s.bottom, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {!recording ? (
          <View style={s.durations} testID="capture-durations">
            {pills.map((p) => {
              const on = duration === p.id;
              return (
                <Pressable key={p.id} onPress={() => { tap(); setDuration(p.id); }} style={[s.durPill, on && s.durPillOn]} accessibilityRole="button" accessibilityState={{ selected: on }} testID={`capture-duration-${p.id}`}>
                  <Text style={[s.durText, { color: on ? CP.white : CP.silver }]}>{p.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={s.controls}>
          <View style={s.side} />
          <Pressable onPress={shutter} accessibilityRole="button" accessibilityLabel={recording ? 'Stop recording' : duration === 'photo' ? 'Take photo' : 'Start recording'} testID="capture-record" style={s.ring}>
            <View style={[s.inner, recording && s.innerRec]} />
          </Pressable>
          <View style={s.side}>
            {!recording ? (
              <Pressable onPress={() => { tap(); onOpenGallery(); }} accessibilityRole="button" accessibilityLabel="Upload" testID="capture-upload" style={s.upload}>
                {newest ? <MediaThumb asset={newest} style={s.uploadThumb} /> : <View style={[s.uploadThumb, { backgroundColor: CP.surface2 }]} />}
                <Text style={s.uploadLabel}>Upload</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {!recording ? <ModeBar modes={modes} active={mode} onChange={onChangeMode} /> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: CP.black },
  permission: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  permTitle: { color: CP.white, fontFamily: FONT.bold, fontSize: 20, textAlign: 'center' },
  permBody: { color: CP.silver, fontFamily: FONT.regular, fontSize: 14, textAlign: 'center', marginTop: 8 },
  progress: { position: 'absolute', left: 8, right: 8, height: 3, backgroundColor: CP.surface2, borderRadius: 2 },
  progressFill: { height: 3, backgroundColor: CP.white, borderRadius: 2 },
  topRow: { position: 'absolute', left: 8, right: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clock: { color: CP.white, fontFamily: FONT.bold, fontSize: 15, backgroundColor: CP.live, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, overflow: 'hidden' },
  rail: { position: 'absolute', right: 10, gap: 20, alignItems: 'center' },
  countdown: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  countdownText: { color: CP.white, fontFamily: FONT.bold, fontSize: 120 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  durations: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 14 },
  durPill: { paddingHorizontal: 12, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  durPillOn: { backgroundColor: CP.surface2 },
  durText: { fontFamily: FONT.semibold, fontSize: 14 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, marginBottom: 12 },
  side: { width: 72, alignItems: 'center' },
  ring: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: CP.white, alignItems: 'center', justifyContent: 'center' },
  inner: { width: 60, height: 60, borderRadius: 30, backgroundColor: CP.white },
  innerRec: { width: 30, height: 30, borderRadius: 6, backgroundColor: CP.live },
  upload: { alignItems: 'center', gap: 4 },
  uploadThumb: { width: 40, height: 40, borderRadius: 8, borderWidth: 2, borderColor: CP.white },
  uploadLabel: { color: CP.white, fontFamily: FONT.semibold, fontSize: 12 },
});
