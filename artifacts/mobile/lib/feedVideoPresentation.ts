/** Audio may only escape from the active, visible, playing surface. */
export function canPlayFeedAudio(state: {
  active: boolean;
  focused: boolean;
  paused: boolean;
  laidOut: boolean;
  videoVisible: boolean;
}): boolean {
  return state.active && state.focused && !state.paused && state.laidOut && state.videoVisible;
}

/**
 * Observe the element attached to THIS VideoView, not a document-wide player.
 * loadeddata/canplay alone are not evidence that the compositor saw a frame.
 * Arm once per activation/buffer/seek, rather than running JS on every frame.
 */
export function observeFeedVideoFrame(
  video: HTMLVideoElement,
  onFrame: () => void,
  onReset: () => void,
): () => void {
  let disposed = false;
  let confirmed = false;
  let pending: number | undefined;
  let generation = 0;
  let lastTime = video.currentTime;
  const confirm = () => {
    if (disposed || confirmed) return;
    confirmed = true;
    onFrame();
  };
  const arm = () => {
    if (pending != null || !video.requestVideoFrameCallback) return;
    const expectedGeneration = generation;
    pending = video.requestVideoFrameCallback(() => {
      if (disposed || expectedGeneration !== generation) return;
      pending = undefined;
      confirm();
    });
  };
  const reset = () => {
    generation++;
    if (pending != null) video.cancelVideoFrameCallback(pending);
    pending = undefined;
    confirmed = false;
    lastTime = video.currentTime;
    onReset();
    arm();
  };
  const progress = () => {
    // Older WebKit has no frame callback. Require real video dimensions,
    // decoded data AND advancing playback, never merely play()/loadeddata.
    if (!video.requestVideoFrameCallback && video.readyState >= 2 &&
        video.videoWidth > 0 && video.videoHeight > 0 && video.currentTime > lastTime) confirm();
    lastTime = video.currentTime;
  };
  const resets = ['loadstart', 'emptied', 'waiting', 'seeking', 'error'];
  resets.forEach(name => video.addEventListener(name, reset));
  video.addEventListener('timeupdate', progress);
  arm(); // Also covers already-loaded/prepared elements (no load event left).
  return () => {
    disposed = true;
    if (pending != null) video.cancelVideoFrameCallback(pending);
    resets.forEach(name => video.removeEventListener(name, reset));
    video.removeEventListener('timeupdate', progress);
  };
}
