/**
 * Upload Live Activity bridge.
 *
 * Thin wrapper around a native ActivityKit module that drives an iOS Live
 * Activity (Dynamic Island + Lock Screen) showing real upload progress for
 * a Thread (photo/video/slideshow post) or a Story. This is the ONLY file
 * other screens should import from — none of them need to know about the
 * native module, the widget extension, or the config plugin that wires it.
 *
 * iOS 16.1+ only. On Android, web, and iOS < 16.1 every export is a
 * documented no-op: it never throws and never logs, so callers never need
 * their own platform guards.
 *
 * v1 is LOCAL-only: progress is reported from calls already happening in
 * this app process (`api.posts.uploadVideoClip`, `uploadPhotoSlide`,
 * `composeVideo`, `composeSlideshow`, `composeVideoThumbnail`, and the
 * stories equivalent), via `Activity.update(...)` on the native side. That
 * does not require a push-type Live Activity token or an APNs auth key.
 * Remote (server-pushed) updates for backgrounded/killed-app uploads would
 * need a separate "Live Activities" APNs capability — see the native
 * module's own doc comment — and are intentionally out of scope here.
 */
import { Platform } from 'react-native';

export type UploadActivityKind = 'thread' | 'story';

export interface StartUploadActivityOptions {
  /** 'thread' for a photo/video/slideshow post (Brandthread has no separate
   *  "reel" content type — all of those are one Thread), 'story' for a
   *  story upload. Drives the copy shown on the Dynamic Island / Lock
   *  Screen ("Your Thread is uploading…" vs "Your story is uploading…"). */
  kind: UploadActivityKind;
  /** Local file uri or remote url for the small thumbnail shown on the
   *  island/lock-screen card. Optional — the activity still starts without
   *  one, just without a thumbnail. */
  thumbnailUri?: string;
  /** Caller-chosen id (e.g. a draft/upload id) so a later
   *  update/end call targets the right activity. Must be unique per
   *  in-flight upload; reusing an id that's still active restarts that
   *  activity's content rather than starting a second one. */
  id: string;
}

export type UploadActivityResult =
  | { status: 'success' }
  | { status: 'failed'; retryRoute?: string };

interface UploadLiveActivityNativeModule {
  startActivity(options: {
    id: string;
    kind: UploadActivityKind;
    thumbnailUri?: string;
  }): void;
  updateActivity(id: string, progress: number): void;
  endActivity(
    id: string,
    result: { status: 'success' } | { status: 'failed'; retryRoute?: string },
  ): void;
}

/**
 * Live Activities require iOS 16.1+. `Platform.Version` on iOS is a string
 * like "16.1" or "26.0" — compare the major/minor pair numerically rather
 * than lexically (string comparison would put "9" ahead of "16").
 */
function isLiveActivitySupportedIOSVersion(version: unknown): boolean {
  if (typeof version === 'number') return version >= 16.1;
  if (typeof version !== 'string') return false;
  const [majorStr, minorStr = '0'] = version.split('.');
  const major = Number.parseInt(majorStr, 10);
  const minor = Number.parseInt(minorStr, 10);
  if (Number.isNaN(major)) return false;
  return major > 16 || (major === 16 && minor >= 1);
}

function isSupported(): boolean {
  return Platform.OS === 'ios' && isLiveActivitySupportedIOSVersion(Platform.Version);
}

let cachedModule: UploadLiveActivityNativeModule | null | undefined;

/**
 * Lazily resolves the native module. Returns null (never throws) when the
 * module isn't linked — e.g. an iOS build produced without the
 * `with-upload-live-activity` config plugin's prebuild step, or any
 * non-iOS platform — so this file stays safe to import everywhere.
 */
function getNativeModule(): UploadLiveActivityNativeModule | null {
  if (cachedModule !== undefined) return cachedModule;
  if (!isSupported()) {
    cachedModule = null;
    return cachedModule;
  }
  try {
    // Deferred require: expo-modules-core and the native module registration
    // only need to resolve on iOS, and only when we actually get here.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const expoModulesCore = require('expo-modules-core') as {
      requireOptionalNativeModule: (name: string) => UploadLiveActivityNativeModule | null;
    };
    cachedModule = expoModulesCore.requireOptionalNativeModule('UploadLiveActivity') ?? null;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

/**
 * Starts a new Live Activity for an in-flight upload. No-op on
 * Android/web/iOS < 16.1, or if the native module isn't present in this
 * build (e.g. Expo Go, or a build missing the widget extension).
 */
export function startUploadActivity(options: StartUploadActivityOptions): void {
  const native = getNativeModule();
  if (!native) return;
  try {
    // The native side implements this as an Expo `AsyncFunction` (it awaits
    // `Activity.request(...)`), so it returns a promise even though this
    // bridge's own public API is fire-and-forget (`void`). Swallow a
    // rejection the same way a thrown error is swallowed below — starting
    // a Live Activity failing must never surface to, or block, the caller.
    const maybePromise = native.startActivity({
      id: options.id,
      kind: options.kind,
      thumbnailUri: options.thumbnailUri,
    }) as unknown as { catch?: (onRejected: (error: unknown) => void) => void };
    maybePromise?.catch?.(() => {});
  } catch {
    // Never throw from here — a Live Activity failing to start should
    // never affect the actual upload it's just reflecting.
  }
}

/**
 * Updates the progress ring for an already-started activity.
 * @param progress 0-1. Values outside that range are clamped.
 */
export function updateUploadActivity(id: string, progress: number): void {
  const native = getNativeModule();
  if (!native) return;
  const clamped = Math.max(0, Math.min(1, progress));
  try {
    native.updateActivity(id, clamped);
  } catch {
    // Ignore — see startUploadActivity.
  }
}

/**
 * Ends an activity, showing its final state (checkmark on success, or a
 * "tap to retry" failure state that deep-links to `retryRoute` when
 * tapped) before the system dismisses it.
 */
export function endUploadActivity(id: string, result: UploadActivityResult): void {
  const native = getNativeModule();
  if (!native) return;
  try {
    native.endActivity(id, result);
  } catch {
    // Ignore — see startUploadActivity.
  }
}
