import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, PanResponder, GestureResponderEvent, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { isBarPlayed, remainingTimeLabel } from '@/lib/voicePlayback';

export const TRANSCRIPTION_STUB =
  "Transcription isn't wired up to a real speech-to-text service yet — this is placeholder text standing in for it.";

const SPEEDS = [1, 1.5, 2] as const;

/**
 * Sent/received voice bubble — mirrors Instagram DM's played/unplayed voice
 * note (mobbin.com/screens/db4e29c8-e47e-47ce-8f01-b7a98376c6e7): play/pause,
 * a waveform that fills as it plays and can be scrubbed, the duration, plus
 * (Brandthread additions matching the owner's spec) a playback-speed toggle
 * and a "View transcription" action. Instagram blue → theme.text/onAccent.
 */
export function VoiceMessageBubble({
  theme, waveform, durationSec, isPlaying, progress, isOwn,
  onTogglePlay, onSeek, onSpeedChange, hasTranscription = true, onViewTranscription,
}: {
  theme: AppThemePreset;
  waveform: number[];
  durationSec: number;
  isPlaying: boolean;
  /** 0..1 playthrough fraction. */
  progress: number;
  isOwn: boolean;
  onTogglePlay: () => void;
  onSeek: (fraction: number) => void;
  onSpeedChange?: (speed: number) => void;
  hasTranscription?: boolean;
  /** Screen-owned feedback for the stub, e.g. the screen's Snackbar — falls
   *  back to Alert.alert() when not passed. Needed because Alert.alert() is
   *  a silent no-op on web (react-native-web has no native dialog to defer
   *  to), which otherwise left this a dead button in the web preview. */
  onViewTranscription?: () => void;
}) {
  const [speedIdx, setSpeedIdx] = useState(0);
  const widthRef = useRef(1);

  const bars = waveform.length ? waveform : Array.from({ length: 24 }, (_, i) => 0.3 + Math.abs(Math.sin(i * 0.8)) * 0.5);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (evt: GestureResponderEvent) => {
      const x = evt.nativeEvent.locationX;
      onSeek(Math.max(0, Math.min(1, x / widthRef.current)));
    },
    onPanResponderRelease: (evt: GestureResponderEvent) => {
      const x = evt.nativeEvent.locationX;
      onSeek(Math.max(0, Math.min(1, x / widthRef.current)));
    },
  }), [onSeek]);

  function cycleSpeed() {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    onSpeedChange?.(SPEEDS[next]);
  }

  const clockLabel = remainingTimeLabel(durationSec, progress);
  const onColor = isOwn ? theme.onAccent : theme.text;
  const dim = isOwn ? theme.onAccent + '99' : theme.subtle;

  return (
    <View style={vs.wrap} testID="voice-message-bubble">
      <View style={vs.row}>
        <Pressable
          onPress={onTogglePlay}
          style={[vs.playBtn, { backgroundColor: isOwn ? theme.onAccent + '26' : theme.cardElevated }]}
          testID="voice-play-toggle"
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause voice message' : 'Play voice message'}
        >
          <Feather name={isPlaying ? 'pause' : 'play'} size={14} color={onColor} />
        </Pressable>

        <View
          style={vs.waveTouch}
          onLayout={(e) => { widthRef.current = e.nativeEvent.layout.width; }}
          {...panResponder.panHandlers}
          testID="voice-scrub-track"
        >
          {bars.map((amp, i) => (
            <View
              key={i}
              style={[
                vs.bar,
                { height: 3 + amp * 16, backgroundColor: isBarPlayed(i, progress, bars.length) ? onColor : dim },
              ]}
            />
          ))}
        </View>

        <Text style={[vs.duration, { color: onColor }]}>{clockLabel}</Text>
      </View>

      <View style={vs.footerRow}>
        <Pressable onPress={cycleSpeed} style={[vs.speedPill, { borderColor: dim }]} testID="voice-speed-toggle">
          <Text style={[vs.speedText, { color: onColor }]}>{SPEEDS[speedIdx]}x</Text>
        </Pressable>
        {hasTranscription && (
          <Pressable
            onPress={onViewTranscription ?? (() => Alert.alert('Transcription', TRANSCRIPTION_STUB))}
            testID="voice-view-transcription"
          >
            <Text style={[vs.transcriptionLink, { color: dim }]}>View transcription</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const vs = StyleSheet.create({
  wrap: { minWidth: 200, maxWidth: 240, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  playBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  waveTouch: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 24, paddingVertical: 4 },
  bar: { width: 2.5, borderRadius: 2 },
  duration: { fontSize: FS.xs, fontFamily: FONT.medium, minWidth: 32, textAlign: 'right' },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingLeft: 38 },
  speedPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.pill, borderWidth: 1 },
  speedText: { fontSize: 10, fontFamily: FONT.semibold },
  transcriptionLink: { fontSize: 11, fontFamily: FONT.medium, textDecorationLine: 'underline' },
});
