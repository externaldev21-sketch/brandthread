export type VideoCaptureSpeed = 0.5 | 1 | 2 | 3;
export type VideoCaptureFilter = 'none' | 'warm' | 'cool' | 'mono';

// ─── Text overlay alignment / background style ─────────────────────────────
export type TextOverlayAlign = 'left' | 'center' | 'right';
export type TextOverlayBgStyle = 'none' | 'solid' | 'semi';
export type TextOverlayFontStyle =
  | 'classic'
  | 'elegance'
  | 'retro'
  | 'vintage'
  | 'postcard'
  | 'script'
  | 'technic';

// ─── Text overlay model ────────────────────────────────────────────────────
export interface TextOverlay {
  /** Unique overlay identifier */
  id: string;
  /** Overlay text content (max 200 chars) */
  text: string;
  /** Normalised X position (0–1, left edge of overlay) */
  x: number;
  /** Normalised Y position (0–1, top edge of overlay) */
  y: number;
  /** Text color — hex string, e.g. "#ffffff" */
  color: string;
  /** Font style preset */
  fontStyle: TextOverlayFontStyle;
  /** Text alignment within the overlay */
  align: TextOverlayAlign;
  /** Background style behind the text */
  bgStyle: TextOverlayBgStyle;
  /** Font size in sp/pt (16–64) */
  fontSize: number;
  /** Optional: start time in seconds within the final video (defaults to 0) */
  startTime?: number;
  /** Optional: end time in seconds within the final video (defaults to duration) */
  endTime?: number;
}

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

// ─── TextOverlay helpers ───────────────────────────────────────────────────

/** Clamp normalized position to valid 0–1 range */
export function clampOverlayPosition(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Create a new text overlay with sensible defaults */
export function createTextOverlay(partial: Partial<TextOverlay> & { id: string; text: string }): TextOverlay {
  return {
    x: 0.5,
    y: 0.4,
    color: '#ffffff',
    fontStyle: 'classic',
    align: 'center',
    bgStyle: 'none',
    fontSize: 28,
    ...partial,
  };
}

// ─── Photo Slide types ─────────────────────────────────────────────────────

/**
 * An in-progress editable photo slide, used in the create-post slide-edit step.
 * Tracks local URI (before upload), upload state, and text overlays.
 */
export interface EditablePhotoSlide {
  /** Stable client-side identifier (never changes for the lifetime of this slide) */
  id: string;
  /** Local image URI (from media library / camera) */
  uri: string;
  /** Detected MIME type of the local file */
  mimeType?: string;
  /** Object path returned after raw-slide upload (set after /api/posts/photo-slides succeeds) */
  objectPath?: string;
  /** Per-slide text overlays (edited in slide-edit step) */
  overlays: TextOverlay[];
  /** Upload progress state */
  uploadState: 'idle' | 'uploading' | 'uploaded' | 'error';
  /** Error message if uploadState === 'error' */
  uploadError?: string;
}

/** Per-slide overlay entry as persisted in the DB / sent to the API */
export interface SlideOverlayRecord {
  slideIndex: number;
  overlays: TextOverlay[];
}

/** Result from POST /api/posts/compose-slideshow */
export interface ComposedSlideshowResult {
  mediaPaths: string[];
  mediaUrls: string[];
  thumbnailPath: string;
  thumbnailUrl: string;
  slideCount: number;
}

/** Create a new editable photo slide from a local URI */
export function createPhotoSlide(id: string, uri: string, mimeType?: string): EditablePhotoSlide {
  return { id, uri, mimeType, overlays: [], uploadState: 'idle' };
}

/** Set the upload state for a specific slide */
export function updateSlideUploadState(
  slides: EditablePhotoSlide[],
  id: string,
  state: EditablePhotoSlide['uploadState'],
  objectPath?: string,
  error?: string,
): EditablePhotoSlide[] {
  return slides.map((s) =>
    s.id !== id ? s : {
      ...s,
      uploadState: state,
      ...(objectPath ? { objectPath } : {}),
      ...(error !== undefined ? { uploadError: error } : {}),
    },
  );
}

/** Update overlays for a specific slide */
export function updateSlideOverlays(
  slides: EditablePhotoSlide[],
  id: string,
  overlays: TextOverlay[],
): EditablePhotoSlide[] {
  return slides.map((s) => s.id === id ? { ...s, overlays } : s);
}

/** Remove a slide by id */
export function removePhotoSlide(slides: EditablePhotoSlide[], id: string): EditablePhotoSlide[] {
  return slides.filter((s) => s.id !== id);
}

/** Reorder a slide from one index to another (drag-to-reorder in the carousel strip) */
export function moveSlide(
  slides: EditablePhotoSlide[],
  fromIndex: number,
  toIndex: number,
): EditablePhotoSlide[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 || fromIndex >= slides.length ||
    toIndex < 0 || toIndex >= slides.length
  ) {
    return slides;
  }
  const next = slides.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/** Convert slides to the API payload for compose-slideshow */
export function slidesToComposePayload(
  slides: EditablePhotoSlide[],
): Array<{ objectPath: string; overlays: TextOverlay[] }> {
  return slides
    .filter((s) => s.objectPath)
    .map((s) => ({ objectPath: s.objectPath!, overlays: s.overlays }));
}

/** Convert persisted slideOverlays from DB into a map keyed by slideIndex */
export function buildSlideOverlayMap(
  records: SlideOverlayRecord[],
): Map<number, TextOverlay[]> {
  const m = new Map<number, TextOverlay[]>();
  for (const r of records) m.set(r.slideIndex, r.overlays);
  return m;
}
