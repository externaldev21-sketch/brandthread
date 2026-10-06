/**
 * Live call video on iOS / Android (react-native-agora's RtcSurfaceView).
 * Renders nothing until that side's video is actually flowing, so the call
 * UI's avatar fallback shows underneath until the first frame.
 */
import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useRtcState } from '@/lib/calls/rtc/useRtcState';
import type { RtcEngine } from '@/lib/calls/rtc/types';

let AgoraModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  AgoraModule = require('react-native-agora');
} catch {
  AgoraModule = null;
}

export function RtcVideoView({ engine, which, style }: {
  engine: RtcEngine | null;
  which: 'local' | 'remote';
  style?: StyleProp<ViewStyle>;
}) {
  const state = useRtcState(engine);
  const Surface = AgoraModule?.RtcSurfaceView;
  if (!engine || !Surface) return null;
  if (which === 'local') {
    return state.localVideoOn ? <Surface style={style} canvas={{ uid: 0 }} /> : null;
  }
  if (state.remoteUid == null || !state.remoteVideoOn) return null;
  const channelId = (engine as RtcEngine & { channelName?: string }).channelName;
  return <Surface style={style} canvas={{ uid: state.remoteUid }} connection={channelId ? { channelId } : undefined} />;
}

export function useHasVideo(engine: RtcEngine | null, which: 'local' | 'remote'): boolean {
  const state = useRtcState(engine);
  return which === 'local' ? state.localVideoOn : state.remoteUid != null && state.remoteVideoOn;
}
