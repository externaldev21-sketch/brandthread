/**
 * Shared, side-effect-free helpers for the real-store App Store capture
 * (real-stores.mjs) and the App Preview recording (preview-video.mjs).
 */

/** "galleriadesires, @Second , third" -> ["galleriadesires", "second", "third"] (max 3, de-duplicated). */
export function parseHandles(raw) {
  const out = [];
  for (const part of String(raw ?? '').split(',')) {
    const h = part.trim().replace(/^@/, '').toLowerCase();
    if (/^[a-z0-9._-]{2,40}$/.test(h) && !out.includes(h)) out.push(h);
  }
  return out.slice(0, 3);
}

/** Absolute https origin of the live web app, or null. Plain http is only allowed for localhost. */
export function parseWebOrigin(raw) {
  try {
    const url = new URL(String(raw ?? ''));
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The screens captured per brand, in store order: the storefront, then the
 * brand's first product. Signed-out pages only, so no account, token or paid
 * API is ever involved.
 */
export function shotsFor(handle) {
  return [
    { id: `${handle}-store`, path: `/store/${encodeURIComponent(handle)}`, title: `@${handle} storefront` },
    { id: `${handle}-product`, path: null, from: `/store/${encodeURIComponent(handle)}`, title: `@${handle} product` },
  ];
}

/** App Store App Preview for the 6.9" iPhone slot: 886 × 1920 portrait, 30 fps, 15–30 s. */
export const PREVIEW = { width: 886, height: 1920, fps: 30, minSeconds: 15, maxSeconds: 30 };

/**
 * ffmpeg arguments that turn Playwright's WebM into an App Store-ready H.264 MP4
 * with a silent AAC track. A recording shorter than 15 s holds its last frame
 * up to the minimum; a longer one is cut at 30 s.
 */
export function ffmpegArgs(input, output, seconds) {
  const t = Math.min(PREVIEW.maxSeconds, Math.max(PREVIEW.minSeconds, seconds));
  return [
    '-y', '-i', input,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-t', String(t),
    '-vf', `scale=${PREVIEW.width}:${PREVIEW.height}:force_original_aspect_ratio=decrease,pad=${PREVIEW.width}:${PREVIEW.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${PREVIEW.fps},tpad=stop_mode=clone:stop_duration=${PREVIEW.maxSeconds}`,
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-b:v', '10M',
    '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart',
    output,
  ];
}
