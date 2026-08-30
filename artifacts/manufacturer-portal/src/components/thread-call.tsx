import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/react";
import AgoraRTC, { IAgoraRTCClient, ICameraVideoTrack, IMicrophoneAudioTrack } from "agora-rtc-sdk-ng";
import { Camera, CameraOff, Mic, MicOff, Phone, PhoneOff, Video } from "lucide-react";
import { Button } from "@/components/ui/button";

type CallMode = "voice" | "video";
type CallEvent = "started" | "ended" | "declined" | "failed";
type CallCredentials = { appId: string; token: string; channelName: string; uid: number; mode: CallMode };

const errorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Unable to start the call.";
  if (/\((403|503)\)|not configured/i.test(message)) return message;
  if (/NotAllowedError|Permission denied/i.test(message)) return "Microphone or camera permission was denied. Allow it in your browser and try again.";
  if (/NotFoundError|DevicesNotFound/i.test(message)) return "No microphone or camera was found. Connect a device and try again.";
  return `Call SDK error: ${message}`;
};

export function ThreadCall({ threadId }: { threadId: string }) {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const threadIdRef = useRef(threadId);
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const microphoneRef = useRef<IMicrophoneAudioTrack | null>(null);
  const cameraRef = useRef<ICameraVideoTrack | null>(null);
  const remoteVideoRef = useRef<HTMLDivElement | null>(null);
  const localVideoRef = useRef<HTMLDivElement | null>(null);
  const terminalEvents = useRef(new Set<CallEvent>());
  const eventIdsRef = useRef(new Map<CallEvent, string>());
  const joinedRef = useRef(false);
  const callModeRef = useRef<CallMode | null>(null);
  const [mode, setMode] = useState<CallMode | null>(null);
  const [starting, setStarting] = useState<CallMode | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [error, setError] = useState("");
  const [remoteJoined, setRemoteJoined] = useState(false);

  // Keep these current without making call teardown depend on render state.
  getTokenRef.current = getToken;
  threadIdRef.current = threadId;

  const authorizedRequest = useCallback(async <T,>(path: string, body: object): Promise<T> => {
    const clerkToken = await getTokenRef.current();
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${clerkToken}` },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 403) throw new Error("You do not have permission to call in this conversation (403).");
      if (response.status === 503) throw new Error("Calling is not configured right now (503). Please try again later.");
      throw new Error(payload.error || `Call request failed (${response.status}).`);
    }
    return payload as T;
  }, []);

  const record = useCallback(async (type: CallEvent, callMode: CallMode) => {
    if (terminalEvents.current.has(type)) return;
    if (type !== "started") terminalEvents.current.add(type);
    const clientEventId = eventIdsRef.current.get(type) ?? crypto.randomUUID();
    eventIdsRef.current.set(type, clientEventId);
    try {
      await authorizedRequest("/api/call/events", { threadId: threadIdRef.current, type, mode: callMode, clientEventId });
    } catch (eventError) {
      // The call can still be cleaned up if activity logging is temporarily unavailable.
      setError(errorMessage(eventError));
    }
  }, [authorizedRequest]);

  const cleanup = useCallback(async (event?: Exclude<CallEvent, "started">) => {
    const callMode = callModeRef.current;
    const client = clientRef.current;
    const microphone = microphoneRef.current;
    const camera = cameraRef.current;
    clientRef.current = null;
    microphoneRef.current = null;
    cameraRef.current = null;
    joinedRef.current = false;
    callModeRef.current = null;
    if (microphone) microphone.close();
    if (camera) camera.close();
    if (client) {
      try { await client.leave(); } catch { /* client may not have joined */ }
    }
    setMode(null);
    setMuted(false);
    setCameraOff(false);
    setRemoteJoined(false);
    if (event && callMode) void record(event, callMode);
  }, [record]);

  const startCall = async (callMode: CallMode) => {
    if (starting || mode) return;
    setStarting(callMode);
    setError("");
    terminalEvents.current.clear();
    eventIdsRef.current.clear();
    callModeRef.current = callMode;
    try {
      const credentials = await authorizedRequest<CallCredentials>("/api/call/token", {
        threadId,
        conversationId: threadId,
        mode: callMode,
      });
      const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      clientRef.current = client;
      client.on("user-published", async (user, mediaType) => {
        try {
          await client.subscribe(user, mediaType);
          setRemoteJoined(true);
          if (mediaType === "audio") user.audioTrack?.play();
          if (mediaType === "video" && remoteVideoRef.current) user.videoTrack?.play(remoteVideoRef.current);
        } catch (sdkError) {
          setError(errorMessage(sdkError));
        }
      });
      client.on("user-unpublished", (_user, mediaType) => {
        if (mediaType === "video") setRemoteJoined(false);
      });
      client.on("user-left", () => setRemoteJoined(false));

      // These APIs run only after the caller pressed a call button.
      const microphone = await AgoraRTC.createMicrophoneAudioTrack();
      const camera = callMode === "video" ? await AgoraRTC.createCameraVideoTrack() : null;
      microphoneRef.current = microphone;
      cameraRef.current = camera;
      await client.join(credentials.appId, credentials.channelName, credentials.token, credentials.uid);
      joinedRef.current = true;
      await client.publish(camera ? [microphone, camera] : [microphone]);
      setMode(callMode);
      if (camera && localVideoRef.current) camera.play(localVideoRef.current);
      await record("started", callMode);
    } catch (callError) {
      const requestedMode = callMode;
      setError(errorMessage(callError));
      await cleanup("failed");
      if (!terminalEvents.current.has("failed")) void record("failed", requestedMode);
    } finally {
      setStarting(null);
    }
  };

  const endCall = () => { void cleanup("ended"); };

  useEffect(() => () => {
    if (joinedRef.current) void cleanup("ended");
    else if (clientRef.current || microphoneRef.current || cameraRef.current) void cleanup("declined");
  }, [cleanup]);

  const toggleMute = async () => {
    const nextMuted = !muted;
    await microphoneRef.current?.setMuted(nextMuted);
    setMuted(nextMuted);
  };
  const toggleCamera = async () => {
    const nextOff = !cameraOff;
    await cameraRef.current?.setEnabled(!nextOff);
    setCameraOff(nextOff);
  };

  return (
    <div className="flex items-center gap-2">
      {!mode && (
        <>
          <Button variant="ghost" size="icon" aria-label="Start voice call" title="Start voice call" disabled={!!starting} onClick={() => void startCall("voice")} data-testid="button-start-voice-call">
            <Phone className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Start video call" title="Start video call" disabled={!!starting} onClick={() => void startCall("video")} data-testid="button-start-video-call">
            <Video className="h-4 w-4" />
          </Button>
        </>
      )}
      {starting && <span className="text-xs text-muted-foreground">Starting {starting} call…</span>}
      {mode && (
        <div className="flex items-center gap-1">
          <span className="hidden lg:inline text-xs text-muted-foreground">{remoteJoined ? "Connected" : "Waiting for participant…"}</span>
          <Button variant="ghost" size="icon" aria-label={muted ? "Unmute microphone" : "Mute microphone"} onClick={() => void toggleMute()}><>{muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}</></Button>
          {mode === "video" && <Button variant="ghost" size="icon" aria-label={cameraOff ? "Turn camera on" : "Turn camera off"} onClick={() => void toggleCamera()}><>{cameraOff ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}</></Button>}
          <Button variant="destructive" size="icon" aria-label="End call" onClick={endCall} data-testid="button-end-call"><PhoneOff className="h-4 w-4" /></Button>
        </div>
      )}
      {mode === "video" && (
        <div className="fixed inset-0 z-50 bg-black/90 p-4 flex flex-col gap-3" role="dialog" aria-label="Video call">
          <div ref={remoteVideoRef} className="flex-1 min-h-0 bg-black rounded-lg overflow-hidden" />
          {!remoteJoined && <p className="absolute inset-0 flex items-center justify-center text-white text-sm pointer-events-none">Waiting for the other participant…</p>}
          <div ref={localVideoRef} className="absolute right-8 bottom-24 h-36 w-48 overflow-hidden rounded-lg border border-white/30 bg-zinc-900" />
          <div className="flex justify-center gap-2">
            <Button variant="secondary" size="icon" aria-label={muted ? "Unmute microphone" : "Mute microphone"} onClick={() => void toggleMute()}>{muted ? <MicOff /> : <Mic />}</Button>
            <Button variant="secondary" size="icon" aria-label={cameraOff ? "Turn camera on" : "Turn camera off"} onClick={() => void toggleCamera()}>{cameraOff ? <CameraOff /> : <Camera />}</Button>
            <Button variant="destructive" onClick={endCall}><PhoneOff className="mr-2 h-4 w-4" />End call</Button>
          </div>
        </div>
      )}
      {error && <p className="absolute right-4 top-16 z-20 max-w-sm rounded border border-destructive/30 bg-card p-3 text-xs text-destructive shadow" role="alert">{error}</p>}
    </div>
  );
}