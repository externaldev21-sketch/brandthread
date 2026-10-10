import React from 'react';
import { View, Text, StyleSheet, Animated, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import type { VoiceRecorderPhase } from '@/hooks/useVoiceRecorder';

/**
 * Replaces the composer while recording — mirrors Instagram DM's recording
 * pill (mobbin.com/screens/1d54bc84-03b2-4f46-8bca-3c6574ac07e1): trash
 * (cancel) on the left, a live waveform in the middle, the timer, and send
 * on the right. Instagram's blue accents are swapped for Brandthread's
 * monochrome (theme.text / theme.onAccent), everything else — layout order,
 * spacing, the "slide to cancel" hint — matches 1:1.
 */
export function VoiceRecordingBar({
  theme, phase, elapsedMs, waveform, dragX, dragY, isWeb,
  onCancel, onLock, onSend,
}: {
  theme: AppThemePreset;
  phase: VoiceRecorderPhase;
  elapsedMs: number;
  waveform: number[];
  dragX: Animated.Value;
  dragY: Animated.Value;
  isWeb: boolean;
  onCancel: () => void;
  onLock: () => void;
  onSend: () => void;
}) {
  const seconds = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  const showLockAffordance = phase === 'recording';
  const showTrashAndSend = phase === 'locked' || isWeb;

  return (
    <View style={rs.wrap} testID="voice-recording-bar">
      {!isWeb && showLockAffordance && (
        <Animated.View
          style={[rs.lockPill, { backgroundColor: theme.cardElevated, transform: [{ translateY: dragY }] }]}
          testID="voice-lock-affordance"
        >
          <Feather name="lock" size={14} color={theme.muted} />
          <Feather name="chevron-up" size={12} color={theme.muted} />
        </Animated.View>
      )}
      <Animated.View style={[rs.pill, { backgroundColor: theme.cardElevated, transform: [{ translateX: isWeb ? 0 : dragX }] }]}>
        {showTrashAndSend ? (
          <Pressable
            onPress={onCancel}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            testID="voice-cancel"
            accessibilityRole="button"
            accessibilityLabel="Cancel recording"
          >
            <Feather name="trash-2" size={18} color={theme.error} />
          </Pressable>
        ) : (
          <Text style={[rs.hint, { color: theme.muted }]}>Slide to cancel</Text>
        )}

        <View style={rs.waveRow} testID="voice-live-waveform">
          {(waveform.length ? waveform : [0.15]).slice(-28).map((amp, i) => (
            <View
              key={i}
              style={[rs.bar, { height: 3 + amp * 18, backgroundColor: theme.text }]}
            />
          ))}
        </View>

        <Text style={[rs.timer, { color: theme.text }]}>{mm}:{ss}</Text>

        {showTrashAndSend ? (
          <Pressable
            onPress={onSend}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            testID="voice-send"
            accessibilityRole="button"
            accessibilityLabel="Send voice message"
          >
            <View style={[rs.sendBtn, { backgroundColor: theme.text }]}>
              <Feather name="arrow-up" size={16} color={theme.onAccent} />
            </View>
          </Pressable>
        ) : (
          <View style={[rs.micGhost, { backgroundColor: theme.text }]}>
            <Feather name="mic" size={14} color={theme.onAccent} />
          </View>
        )}
      </Animated.View>

      {isWeb && phase === 'recording' && (
        <Pressable onPress={onLock} style={rs.webLockRow} testID="voice-lock-web">
          <Feather name="lock" size={12} color={theme.muted} />
          <Text style={[rs.webLockText, { color: theme.muted }]}>Tap to keep recording hands-free</Text>
        </Pressable>
      )}
    </View>
  );
}

const rs = StyleSheet.create({
  wrap: { width: '100%' },
  lockPill: {
    position: 'absolute', right: 4, top: -52, width: 36, height: 44, borderRadius: RADIUS.pill,
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    height: 44, borderRadius: RADIUS.pill, paddingHorizontal: SP.md,
  },
  hint: { fontFamily: FONT.regular, fontSize: FS.xs },
  waveRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, overflow: 'hidden' },
  bar: { width: 2.5, borderRadius: 2 },
  timer: { fontFamily: FONT.medium, fontSize: FS.xs, minWidth: 34, textAlign: 'right' },
  sendBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  micGhost: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', opacity: 0.5 },
  webLockRow: { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center', paddingTop: 6 },
  webLockText: { fontFamily: FONT.regular, fontSize: 11 },
});
