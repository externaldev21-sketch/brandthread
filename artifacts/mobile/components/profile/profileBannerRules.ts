/**
 * Profile banner (TikTok's profile banner, 1:1) — pure rules shared by the
 * banner header, the Edit profile banner preview and the "Edit banner"
 * action sheet. No React / RN imports, so they're unit-testable.
 *
 * The banner IS the profile cover (server: /api/profile/cover-*): a muted
 * video of at most 10s or a GIF, both looping forever.
 */
import type { ProfileBanner } from '@/lib/profileBannerApi';
import { COVER_MAX_SECONDS } from './profileCoverRules';

export type { ProfileBanner };

/** The banner fills the top of the profile down to ~45% of the screen. */
export const BANNER_HEIGHT_FRACTION = 0.45;
/** Video banners are muted loops of at most 10s (longer clips go through the trim screen). */
export const BANNER_MAX_SECONDS = COVER_MAX_SECONDS;
/** GIF uploads are capped at ~15MB (the server converts them to a looping MP4). */
export const BANNER_GIF_MAX_BYTES = 15 * 1024 * 1024;
/** Container durations are rarely exact (same slack as the server). */
const DURATION_TOLERANCE_SECONDS = 0.25;

export function bannerHeight(windowHeight: number): number {
  return Math.round(windowHeight * BANNER_HEIGHT_FRACTION);
}

/** width ÷ height of the banner on this screen — the crop screen's frame. */
export function bannerAspect(windowWidth: number, windowHeight: number): number {
  const height = bannerHeight(windowHeight);
  return height > 0 ? windowWidth / height : 1;
}

/** A clip longer than 10s opens the trim screen to pick its 10s window. */
export function bannerNeedsTrim(durationSeconds: number | null | undefined): boolean {
  return typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)
    && durationSeconds > BANNER_MAX_SECONDS + DURATION_TOLERANCE_SECONDS;
}

/** True for a picked file that is a GIF (by MIME type, else by file name). */
export function isGifAsset(asset: { mimeType?: string | null; uri?: string | null; fileName?: string | null; name?: string | null }): boolean {
  const mime = (asset.mimeType ?? '').toLowerCase();
  if (mime) return mime === 'image/gif';
  const name = (asset.fileName ?? asset.name ?? asset.uri ?? '').toLowerCase().split('?')[0];
  return name.endsWith('.gif') || name.startsWith('data:image/gif');
}

export type BannerSheetAction = 'gif' | 'video' | 'remove';

/** "Edit banner" native action sheet: Choose GIF, Choose video, Remove banner (only when one is set). */
export function bannerSheetOptions(hasBanner: boolean): Array<{ key: BannerSheetAction; label: string; destructive?: boolean }> {
  const options: Array<{ key: BannerSheetAction; label: string; destructive?: boolean }> = [
    { key: 'gif', label: 'Choose GIF' },
    { key: 'video', label: 'Choose video' },
  ];
  if (hasBanner) options.push({ key: 'remove', label: 'Remove banner', destructive: true });
  return options;
}

/**
 * The banner a profile response carries. Prefers the `profileBanner` field;
 * a response without it (an older API build) still shows a cover video as a
 * video banner. Only http(s) URLs render.
 */
export function resolveProfileBanner(source: {
  profileBanner?: ProfileBanner | null;
  coverVideoUrl?: string | null;
  coverPosterUrl?: string | null;
} | null | undefined): ProfileBanner | null {
  if (!source) return null;
  const http = (value: string | null | undefined) => (typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null);
  if (source.profileBanner !== undefined) {
    const banner = source.profileBanner;
    if (!banner || !http(banner.url) || (banner.type !== 'gif' && banner.type !== 'video' && banner.type !== 'image')) return null;
    return { type: banner.type, url: banner.url, posterUrl: http(banner.posterUrl), gifUrl: http(banner.gifUrl) };
  }
  const video = http(source.coverVideoUrl);
  return video ? { type: 'video', url: video, posterUrl: http(source.coverPosterUrl), gifUrl: null } : null;
}

/**
 * What to play: a video loop (videos, and GIFs converted to MP4) or, for a
 * GIF the server couldn't convert, the animated GIF itself.
 */
export function bannerHeroMedia(banner: ProfileBanner): { videoUri: string | null; posterUri: string | null; gifUri: string | null } {
  if (banner.type === 'image') return { videoUri: null, posterUri: banner.url, gifUri: null };
  const playsGif = banner.type === 'gif' && (banner.url === banner.gifUrl || /\.gif(\?|$)/i.test(banner.url));
  return playsGif
    ? { videoUri: null, posterUri: banner.posterUrl, gifUri: banner.url }
    : { videoUri: banner.url, posterUri: banner.posterUrl, gifUri: null };
}

/**
 * The still that stands for the banner wherever animation can't play
 * (storefront previews, brand cards, share cards): its poster frame, else the
 * GIF / still itself. Mirrors the server's storefrontCoverUrl().
 */
export function bannerStill(banner: ProfileBanner | null | undefined): string | null {
  if (!banner) return null;
  if (banner.posterUrl) return banner.posterUrl;
  if (banner.type === 'gif') return banner.gifUrl ?? banner.url;
  if (banner.type === 'image') return banner.url;
  return null;
}

/**
 * Scroll slack (points) within which the banner still runs up behind the
 * status bar. Past it, the app's solid status-bar strip returns, so the top
 * bar, name and avatar never slide under the clock / Dynamic Island.
 */
export const BANNER_STATUS_BAR_SLACK = 8;

/** True while the profile is at rest at the top (incl. pull-to-refresh overscroll). */
export function bannerCoversStatusBar(scrollOffset: number): boolean {
  return scrollOffset < BANNER_STATUS_BAR_SLACK;
}

/**
 * Bottom fade (TikTok / Spotify artist header): the banner's bottom ~42%
 * eases into the page background so there's no visible edge. An eased
 * (not linear) ramp avoids the band a two-stop gradient leaves; the last
 * stop is the page colour, fully opaque.
 */
export const BANNER_FADE_FRACTION = 0.42;
const FADE_EASE: Array<[number, number]> = [
  [0, 0], [0.081, 0.013], [0.155, 0.049], [0.225, 0.104], [0.29, 0.175], [0.353, 0.259],
  [0.412, 0.352], [0.471, 0.45], [0.529, 0.55], [0.588, 0.648], [0.647, 0.741], [0.71, 0.825],
  [0.775, 0.896], [0.845, 0.951], [0.919, 0.987], [1, 1],
];

/** Gradient stops for the bottom fade into `background` (a #rgb / #rrggbb colour; anything else fades to black). */
export function bannerFadeStops(background: string): { colors: string[]; locations: number[] } {
  let hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(background.trim())?.[1] ?? '000000';
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return {
    colors: FADE_EASE.map(([, alpha]) => `rgba(${r},${g},${b},${alpha})`),
    locations: FADE_EASE.map(([at]) => at),
  };
}

// ─── Trim screen (TikTok editor: filmstrip + sliding 10s window) ─────────────

/** The window can't shrink below a comfortable drag target on very long clips. */
export const TRIM_WINDOW_MIN_WIDTH = 44;

/**
 * Geometry of the fixed 10s window over a filmstrip that spans the whole
 * clip. Exact (window width = 10s of strip) until the clip is so long the
 * window would be thinner than a finger; then the window keeps its minimum
 * width and its left edge still maps linearly onto start ∈ [0, total − 10].
 */
export function trimWindowLayout(stripWidth: number, totalSeconds: number, windowSeconds = BANNER_MAX_SECONDS) {
  const total = Math.max(totalSeconds, 0.001);
  const length = Math.min(windowSeconds, total);
  const width = Math.min(stripWidth, Math.max(TRIM_WINDOW_MIN_WIDTH, (stripWidth * length) / total));
  const maxLeft = Math.max(0, stripWidth - width);
  const maxStart = Math.max(0, total - length);
  return {
    width,
    maxLeft,
    length,
    startForLeft: (left: number) => (maxLeft > 0 ? (Math.min(maxLeft, Math.max(0, left)) / maxLeft) * maxStart : 0),
    leftForStart: (start: number) => (maxStart > 0 ? (Math.min(maxStart, Math.max(0, start)) / maxStart) * maxLeft : 0),
  };
}

/** `count` evenly spaced frame times across the whole clip (cell centres). */
export function filmstripTimes(totalSeconds: number, count: number): number[] {
  if (!(totalSeconds > 0) || count <= 0) return [];
  return Array.from({ length: count }, (_, i) => Math.round(((i + 0.5) * totalSeconds / count) * 100) / 100);
}

/** 00:07, 01:12, 1:02:05 — the editor's clock. */
export function formatTrimClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
