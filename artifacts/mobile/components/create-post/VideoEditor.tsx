/**
 * Step 3 (video) — trim editor: the clip full-bleed (tap to pause), a
 * timeline with draggable start/end handles over the clip, "0:00 / 0:11"
 * readout and the Next pill. Videos up to 10 minutes; what's outside the
 * handles is cut on the server when the post is composed.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { Icon } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT } from '@/lib/theme';
import { MAX_VIDEO_SECONDS } from '@/constants/postLimits';
import type { VideoDraft } from '@/lib/createPost/types';
import { CP, IconButton, PillButton } from '@/components/create-post/ui';
import { formatDuration } from '@/components/create-post/GalleryPicker';

const HANDLE_W = 16;
const MIN_LEN = 1;

export function VideoEditor({ video, onChange, onBack, onNext }: {
  video: VideoDraft; onChange: (v: VideoDraft) => void; onBack: () => void; onNext: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [trackW, setTrackW] = useState(0);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(video.trimStart);
  const total = Math.max(MIN_LEN, video.duration);
  const player = useVideoPlayer(video.uri, (p) => { p.loop = false; p.muted = false; p.play(); });
  const ref = useRef(video);
  ref.current = video;

  // Loop inside the trim window and mirror the playhead.
  useEffect(() => {
    const id = setInterval(() => {
      const v = ref.current;
      const t = player.currentTime;
      if (t >= v.trimEnd - 0.05 || t < v.trimStart - 0.3) player.currentTime = v.trimStart;
      setNow(Math.max(v.trimStart, Math.min(v.trimEnd, player.currentTime)));
    }, 120);
    return () => clearInterval(id);
  }, [player]);
  useEffect(() => { if (paused) player.pause(); else player.play(); }, [paused, player]);

  const usable = Math.max(1, trackW - HANDLE_W * 2);
  const startX = useSharedValue(0);
  const endX = useSharedValue(0);
  useEffect(() => {
    startX.value = (video.trimStart / total) * usable;
    endX.value = (video.trimEnd / total) * usable;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackW]);

  function update(nextStart: number, nextEnd: number, seek: number) {
    player.currentTime = seek;
    onChange({ ...ref.current, trimStart: nextStart, trimEnd: nextEnd });
  }

  const minPx = (MIN_LEN / total) * usable;
  const startBase = useSharedValue(0);
  const endBase = useSharedValue(0);
  const startPan = Gesture.Pan()
    .onBegin(() => { startBase.value = startX.value; })
    .onUpdate((e) => {
      const x = Math.max(0, Math.min(endX.value - minPx, startBase.value + e.translationX));
      startX.value = x;
      const t = (x / usable) * total;
      runOnJS(update)(t, (endX.value / usable) * total, t);
    });
  const endPan = Gesture.Pan()
    .onBegin(() => { endBase.value = endX.value; })
    .onUpdate((e) => {
      const x = Math.max(startX.value + minPx, Math.min(usable, endBase.value + e.translationX));
      endX.value = x;
      const t = (x / usable) * total;
      const st = (startX.value / usable) * total;
      runOnJS(update)(st, t, Math.max(st, t - 0.5));
    });

  const selLeft = (video.trimStart / total) * usable;
  const selW = ((video.trimEnd - video.trimStart) / total) * usable + HANDLE_W * 2;
  const tooLong = video.trimEnd - video.trimStart > MAX_VIDEO_SECONDS + 0.01;

  return (
    <View style={s.root} testID="video-editor">
      <View style={s.topBar}>
        <IconButton icon="arrow-left" label="Back" onPress={onBack} testID="edit-back" />
        <View style={{ width: 44 }} />
      </View>

      <Pressable style={s.stage} onPress={() => setPaused((p) => !p)} accessibilityRole="button" accessibilityLabel={paused ? 'Play' : 'Pause'} testID="video-stage">
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
        {paused ? <View style={s.playGlyph} pointerEvents="none"><Icon name="play" size={34} color={CP.white} /></View> : null}
      </Pressable>

      <View style={s.timeRow}>
        <Text style={s.time} testID="trim-readout">{formatDuration(now - video.trimStart)} / {formatDuration(video.trimEnd - video.trimStart)}</Text>
        <Text style={s.timeDim}>{formatDuration(video.duration)} total</Text>
      </View>

      <View style={s.track} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)} testID="trim-track">
        <View style={s.trackBar} />
        {trackW > 0 ? (
          <>
            <View style={[s.window, { left: selLeft, width: selW }]} pointerEvents="none" />
            <GestureDetector gesture={startPan}>
              <View style={[s.handle, { left: selLeft }]} testID="trim-start"><View style={s.grip} /></View>
            </GestureDetector>
            <GestureDetector gesture={endPan}>
              <View style={[s.handle, { left: selLeft + selW - HANDLE_W }]} testID="trim-end"><View style={s.grip} /></View>
            </GestureDetector>
          </>
        ) : null}
      </View>
      <Text style={s.hint}>{tooLong ? 'Videos can be up to 10 minutes.' : 'Drag the handles to trim'}</Text>

      <View style={[s.buttons, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <PillButton label="Next" onPress={onNext} disabled={tooLong} testID="edit-next" />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: CP.black },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 4 },
  stage: { flex: 1, backgroundColor: CP.black, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  playGlyph: { position: 'absolute', width: 72, height: 72, borderRadius: 36, backgroundColor: CP.surface2, alignItems: 'center', justifyContent: 'center' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 14 },
  time: { color: CP.white, fontFamily: FONT.semibold, fontSize: 13 },
  timeDim: { color: CP.silverDim, fontFamily: FONT.regular, fontSize: 13 },
  track: { height: 56, marginHorizontal: 20, marginTop: 8, justifyContent: 'center' },
  trackBar: { position: 'absolute', left: 0, right: 0, height: 44, borderRadius: 6, backgroundColor: CP.surface2 },
  window: { position: 'absolute', height: 52, borderTopWidth: 3, borderBottomWidth: 3, borderColor: CP.white },
  handle: { position: 'absolute', width: HANDLE_W, height: 52, borderRadius: 6, backgroundColor: CP.white, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 3, height: 18, borderRadius: 2, backgroundColor: CP.black },
  hint: { color: CP.silverDim, fontFamily: FONT.regular, fontSize: 12, textAlign: 'center', marginTop: 6, marginBottom: 14 },
  buttons: { flexDirection: 'row', paddingHorizontal: 16 },
});
