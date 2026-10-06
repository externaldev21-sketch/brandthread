/**
 * Live call video on web (agora-rtc-sdk-ng plays each track into a DOM
 * element). The engine is handed this view's element and plays the track
 * into it; renders nothing until that side's video is flowing.
 */
import React, { useEffect, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useRtcState } from '@/lib/calls/rtc/useRtcState';
import type { RtcEngine } from '@/lib/calls/rtc/types';

export function RtcVideoView({ engine, which, style }: {
  engine: RtcEngine | null;
  which: 'local' | 'remote';
  style?: StyleProp<ViewStyle>;
}) {
  const state = useRtcState(engine);
  const ref = useRef<View>(null);
  const on = which === 'local' ? state.localVideoOn : state.remoteUid != null && state.remoteVideoOn;

  useEffect(() => {
    if (!engine || !on) return undefined;
    engine.attachVideo(which, ref.current as unknown as HTMLElement | null);
    return () => engine.attachVideo(which, null);
  }, [engine, on, which]);

  if (!engine || !on) return null;
  return <View ref={ref} style={[{ overflow: 'hidden', backgroundColor: '#000' }, style]} />;
}

export function useHasVideo(engine: RtcEngine | null, which: 'local' | 'remote'): boolean {
  const state = useRtcState(engine);
  return which === 'local' ? state.localVideoOn : state.remoteUid != null && state.remoteVideoOn;
}
