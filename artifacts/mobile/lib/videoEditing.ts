export type VideoCaptureSpeed = 0.5 | 1 | 2 | 3;
export type VideoCaptureFilter = 'none' | 'warm' | 'cool' | 'mono';

export interface EditableVideoClip {
  id: string;
  uri: string;
  duration: number;
  speed: VideoCaptureSpeed;
  filter: VideoCaptureFilter;
  objectPath?: string;
}

export interface TrimBounds {
  start: number;
  end: number;
}

export function effectiveClipDuration(
  clip: Pick<EditableVideoClip, 'duration' | 'speed'>,
): number {
  return clip.duration / clip.speed;
}

export function totalClipDuration(
  clips: Array<Pick<EditableVideoClip, 'duration' | 'speed'>>,
): number {
  return clips.reduce((sum, clip) => sum + effectiveClipDuration(clip), 0);
}

export function removeVideoClip(clips: EditableVideoClip[], id: string): EditableVideoClip[] {
  return clips.filter((clip) => clip.id !== id);
}

export function markVideoClipUploaded(
  clips: EditableVideoClip[],
  id: string,
  objectPath: string,
): EditableVideoClip[] {
  return clips.map((clip) => clip.id === id ? { ...clip, objectPath } : clip);
}

export function normalizeTrimBounds(
  totalDuration: number,
  requestedStart: number,
  requestedEnd: number,
  minimumDuration = 0.1,
): TrimBounds {
  const total = Math.max(minimumDuration, totalDuration);
  const start = Math.max(0, Math.min(requestedStart, total - minimumDuration));
  const end = Math.max(start + minimumDuration, Math.min(requestedEnd, total));
  return { start, end };
}

export function clampVideoZoom(value: number): number {
  return Math.max(0, Math.min(1, value));
}