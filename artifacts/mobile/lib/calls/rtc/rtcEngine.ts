/**
 * Native (iOS / Android) RTC engine for DM calls — react-native-agora, the
 * same SDK app/call-screen.tsx already uses for manufacturer calls.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import type { CallMode } from '../types';
import { createRtcStateStore, type RtcCredentials, type RtcEngine, type RtcEngineEvents } from './types';
import { nativeCallKit } from '../native/nativeCallKit';

let AgoraModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  AgoraModule = require('react-native-agora');
} catch {
  AgoraModule = null;
}

async function ensurePermissions(mode: CallMode): Promise<void> {
  if (Platform.OS !== 'android') return; // iOS prompts on first capture (Info.plist strings are in app.json)
  const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (mode === 'video') wanted.push(PermissionsAndroid.PERMISSIONS.CAMERA);
  const result = await PermissionsAndroid.requestMultiple(wanted);
  if (result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Microphone access is needed for calls. Allow it in Settings.');
  }
}

export function isRtcSupported(): boolean {
  return !!AgoraModule?.createAgoraRtcEngine;
}

export function createRtcEngine(mode: CallMode, events: RtcEngineEvents): RtcEngine {
  const store = createRtcStateStore();
  let engine: any = null;
  let channelName = '';

  return {
    mode,
    async join(creds: RtcCredentials) {
      if (!isRtcSupported()) throw new Error('This build of the app can’t place calls. Update Brandthread to call.');
      await ensurePermissions(mode);
      const { createAgoraRtcEngine, ChannelProfileType, ClientRoleType } = AgoraModule;
      engine = createAgoraRtcEngine();
      engine.initialize({ appId: creds.appId, channelProfile: ChannelProfileType.ChannelProfileCommunication });
      engine.registerEventHandler({
        onJoinChannelSuccess: () => store.set({ joined: true }),
        onUserJoined: (_c: unknown, uid: number) => { store.set({ remoteUid: uid }); events.remoteJoined(uid); },
        onUserOffline: (_c: unknown, uid: number) => {
          store.set({ remoteUid: null, remoteVideoOn: false });
          events.remoteLeft(uid);
        },
        // RemoteVideoState: 0 stopped, 1 starting, 2 decoding, 3 frozen, 4 failed.
        onRemoteVideoStateChanged: (_c: unknown, _uid: number, state: number) => {
          const on = state === 1 || state === 2;
          store.set({ remoteVideoOn: on });
          events.remoteVideoChanged(on);
        },
        onTokenPrivilegeWillExpire: () => events.tokenWillExpire(),
        onError: (code: number, msg: string) => events.error(msg || `Call error ${code}`),
      });
      engine.enableAudio();
      // With CallKit owning the iOS audio session (lib/calls/native/), Agora
      // must not deactivate it when it leaves the channel.
      if (Platform.OS === 'ios' && nativeCallKit.available) {
        engine.setAudioSessionOperationRestriction?.(
          AgoraModule.AudioSessionOperationRestriction?.AudioSessionOperationRestrictionDeactivateSession ?? 4,
        );
      }
      if (mode === 'video') {
        engine.enableVideo();
        engine.startPreview();
        store.set({ localVideoOn: true });
      }
      engine.setDefaultAudioRouteToSpeakerphone?.(mode === 'video');
      channelName = creds.channelName;
      engine.joinChannel(creds.token, creds.channelName, creds.uid, {
        clientRoleType: ClientRoleType.ClientRoleBroadcaster,
        publishMicrophoneTrack: true,
        publishCameraTrack: mode === 'video',
        autoSubscribeAudio: true,
        autoSubscribeVideo: mode === 'video',
      });
    },
    async leave() {
      try { engine?.leaveChannel(); } catch { /* already left */ }
      try { engine?.release(); } catch { /* already released */ }
      engine = null;
      store.set({ joined: false, remoteUid: null, remoteVideoOn: false, localVideoOn: false });
    },
    setMuted(muted) { engine?.muteLocalAudioStream(muted); },
    setCameraOff(off) {
      if (mode !== 'video') return;
      engine?.muteLocalVideoStream(off);
      engine?.enableLocalVideo(!off);
      store.set({ localVideoOn: !off });
    },
    setSpeakerOn(on) { engine?.setEnableSpeakerphone(on); },
    switchCamera() { engine?.switchCamera(); },
    renewToken(token) { engine?.renewToken(token); },
    getState: () => store.get(),
    onState: (l) => store.subscribe(l),
    attachVideo() { /* native renders via RtcSurfaceView (components/calls/RtcVideoView.tsx) */ },
    // Exposed for the native video view.
    get channelName() { return channelName; },
  } as RtcEngine & { channelName: string };
}
