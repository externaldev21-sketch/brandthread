/**
 * Story camera settings behind the camera's gear icon (it used to only show a
 * message). Two real camera toggles — rule-of-thirds grid lines over the
 * preview and mirroring the front camera — plus a link to the privacy
 * settings that control who can reply to stories. Remembered per device.
 */
export interface StoryCameraSettings {
  gridLines: boolean;
  mirrorFront: boolean;
}

export const STORY_CAMERA_SETTINGS_KEY = 'bt:story:cameraSettings';

export const DEFAULT_STORY_CAMERA_SETTINGS: StoryCameraSettings = { gridLines: false, mirrorFront: true };

export function parseStoryCameraSettings(raw: string | null | undefined): StoryCameraSettings {
  if (!raw) return { ...DEFAULT_STORY_CAMERA_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<StoryCameraSettings> | null;
    return {
      gridLines: typeof parsed?.gridLines === 'boolean' ? parsed.gridLines : DEFAULT_STORY_CAMERA_SETTINGS.gridLines,
      mirrorFront: typeof parsed?.mirrorFront === 'boolean' ? parsed.mirrorFront : DEFAULT_STORY_CAMERA_SETTINGS.mirrorFront,
    };
  } catch {
    return { ...DEFAULT_STORY_CAMERA_SETTINGS };
  }
}

export function toggleStoryCameraSetting(settings: StoryCameraSettings, key: keyof StoryCameraSettings): StoryCameraSettings {
  return { ...settings, [key]: !settings[key] };
}
