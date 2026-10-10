/**
 * Video remixes (api-server routes/remix.ts + lib/remix.ts). The server
 * decides who may remix; these helpers only shape what the app shows.
 */

export type RemixRefusalCode = 'NOT_A_VIDEO' | 'OWN_POST' | 'REMIX_NOT_ALLOWED' | 'SOURCE_UNAVAILABLE';

export interface RemixSourceInfo {
  postId: string;
  authorId: string;
  authorUsername: string | null;
}

/** GET /api/remix/posts/:postId */
export interface RemixCheck {
  allowed: boolean;
  /** Video posting (and so remixing) is a seller capability. */
  canPostVideo: boolean;
  code?: RemixRefusalCode;
  message?: string;
  source?: RemixSourceInfo;
}

/** POST /api/remix/posts/:postId/clip */
export interface RemixClip {
  objectPath: string;
  duration: number;
  previewUrl: string;
  source: RemixSourceInfo;
}

/** Show "Remix" in a post's menu only when the server allows it and this account can publish video. */
export function remixActionVisible(check: RemixCheck | null | undefined): boolean {
  return !!check && check.allowed === true && check.canPostVideo === true;
}

/** Route to the create flow with the source video preloaded. */
export function remixRoute(postId: string): { pathname: '/create-post'; params: { remixOf: string } } {
  return { pathname: '/create-post', params: { remixOf: postId } };
}

/** The copied source as the create flow's first (already uploaded) clip. */
export function remixClipToVideoClip(clip: RemixClip): {
  uri: string; duration: number; id: string; speed: 1; filter: 'none'; objectPath: string;
} {
  return {
    uri: clip.previewUrl,
    duration: Number.isFinite(clip.duration) && clip.duration > 0 ? clip.duration : 0,
    id: `remix-${clip.source.postId}`,
    speed: 1,
    filter: 'none',
    objectPath: clip.objectPath,
  };
}

/** The copied source as the create flow's video draft (already uploaded; untrimmed). */
export function remixClipToVideoDraft(clip: RemixClip): {
  uri: string; mimeType: string; duration: number; speed: 1; trimStart: number; trimEnd: number; coverOffset: number; objectPath: string;
} {
  const duration = Number.isFinite(clip.duration) && clip.duration > 0 ? clip.duration : 0;
  return {
    uri: clip.previewUrl,
    mimeType: 'video/mp4',
    duration,
    speed: 1,
    trimStart: 0,
    trimEnd: duration,
    coverOffset: 0,
    objectPath: clip.objectPath,
  };
}

/** Message for a refused publish (403 REMIX_NOT_ALLOWED etc.). */
export function remixErrorMessage(error: unknown): string | null {
  const raw = (error as { body?: unknown; message?: unknown } | null)?.body ?? (error as { message?: unknown } | null)?.message;
  let parsed: { code?: unknown; error?: unknown } | null = null;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  } else if (raw && typeof raw === 'object') {
    parsed = raw as { code?: unknown; error?: unknown };
  }
  if (!parsed || typeof parsed.code !== 'string') return null;
  if (!['REMIX_NOT_ALLOWED', 'NOT_A_VIDEO', 'OWN_POST', 'SOURCE_UNAVAILABLE', 'REMIX_NOT_VIDEO'].includes(parsed.code)) return null;
  return typeof parsed.error === 'string' && parsed.error ? parsed.error : "This video can't be remixed.";
}
