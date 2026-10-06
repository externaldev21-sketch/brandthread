/**
 * Web RTC engine for DM calls — agora-rtc-sdk-ng (Agora's Web SDK), the same
 * Agora project/tokens as native, so a web caller and a phone callee land in
 * the same channel.
 */
import type { CallMode } from '../types';
import { createRtcStateStore, type RtcCredentials, type RtcEngine, type RtcEngineEvents } from './types';

type AgoraRTCModule = typeof import('agora-rtc-sdk-ng').default;
type Client = import('agora-rtc-sdk-ng').IAgoraRTCClient;
type LocalAudio = import('agora-rtc-sdk-ng').IMicrophoneAudioTrack;
type LocalVideo = import('agora-rtc-sdk-ng').ICameraVideoTrack;
type RemoteVideo = import('agora-rtc-sdk-ng').IRemoteVideoTrack;

let sdk: AgoraRTCModule | null = null;
async function loadSdk(): Promise<AgoraRTCModule> {
  if (!sdk) {
    const mod = await import('agora-rtc-sdk-ng');
    sdk = (mod as any).default ?? (mod as any);
    try { sdk!.setLogLevel(3); } catch { /* optional */ }
  }
  return sdk!;
}

export function isRtcSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).RTCPeerConnection === 'function';
}

export function createRtcEngine(mode: CallMode, events: RtcEngineEvents): RtcEngine {
  const store = createRtcStateStore();
  let client: Client | null = null;
  let mic: LocalAudio | null = null;
  let cam: LocalVideo | null = null;
  let remoteVideo: RemoteVideo | null = null;
  const elements: { local: HTMLElement | null; remote: HTMLElement | null } = { local: null, remote: null };

  const playLocal = () => { if (cam && elements.local) cam.play(elements.local, { fit: 'cover', mirror: true }); };
  const playRemote = () => { if (remoteVideo && elements.remote) remoteVideo.play(elements.remote, { fit: 'cover' }); };

  return {
    mode,
    async join(creds: RtcCredentials) {
      if (!isRtcSupported()) throw new Error('This browser can’t place calls.');
      const AgoraRTC = await loadSdk();
      client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      client.on('user-joined', (user) => {
        store.set({ remoteUid: Number(user.uid) });
        events.remoteJoined(Number(user.uid));
      });
      client.on('user-left', (user) => {
        remoteVideo = null;
        store.set({ remoteUid: null, remoteVideoOn: false });
        events.remoteLeft(Number(user.uid));
      });
      client.on('user-published', async (user, mediaType) => {
        if (!client) return;
        await client.subscribe(user, mediaType);
        if (mediaType === 'audio') user.audioTrack?.play();
        if (mediaType === 'video') {
          remoteVideo = user.videoTrack ?? null;
          store.set({ remoteVideoOn: true });
          events.remoteVideoChanged(true);
          playRemote();
        }
      });
      client.on('user-unpublished', (_user, mediaType) => {
        if (mediaType !== 'video') return;
        remoteVideo = null;
        store.set({ remoteVideoOn: false });
        events.remoteVideoChanged(false);
      });
      client.on('token-privilege-will-expire', () => events.tokenWillExpire());

      try {
        mic = await AgoraRTC.createMicrophoneAudioTrack();
      } catch {
        throw new Error('Microphone access is needed for calls. Allow it in your browser settings.');
      }
      if (mode === 'video') {
        try {
          cam = await AgoraRTC.createCameraVideoTrack();
          store.set({ localVideoOn: true });
          playLocal();
        } catch {
          cam = null; // camera denied: the call continues as audio from this side
        }
      }
      await client.join(creds.appId, creds.channelName, creds.token, creds.uid);
      store.set({ joined: true });
      await client.publish(cam ? [mic, cam] : [mic]);
    },
    async leave() {
      try { mic?.close(); } catch { /* closed */ }
      try { cam?.close(); } catch { /* closed */ }
      try { await client?.leave(); } catch { /* left */ }
      mic = null; cam = null; remoteVideo = null; client = null;
      store.set({ joined: false, remoteUid: null, remoteVideoOn: false, localVideoOn: false });
    },
    setMuted(muted) { void mic?.setMuted(muted); },
    setCameraOff(off) {
      if (!cam) return;
      void cam.setMuted(off);
      store.set({ localVideoOn: !off });
    },
    setSpeakerOn() { /* browsers route audio to the system output; nothing to switch */ },
    switchCamera() {
      if (!cam || !sdk) return;
      void sdk.getCameras().then((cams) => {
        if (cams.length < 2 || !cam) return;
        const current = cam.getTrackLabel();
        const next = cams.find((c) => c.label !== current) ?? cams[0];
        return cam.setDevice(next.deviceId);
      }).catch(() => {});
    },
    renewToken(token) { void client?.renewToken(token); },
    getState: () => store.get(),
    onState: (l) => store.subscribe(l),
    attachVideo(which, element) {
      elements[which] = (element as HTMLElement | null) ?? null;
      if (which === 'local') playLocal(); else playRemote();
    },
  };
}
