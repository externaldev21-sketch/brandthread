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
    if (!banner || !http(banner.url) || (banner.type !== 'gif' && banner.type !== 'video')) return null;
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
  const playsGif = banner.type === 'gif' && (banner.url === banner.gifUrl || /\.gif(\?|$)/i.test(banner.url));
  return playsGif
    ? { videoUri: null, posterUri: banner.posterUrl, gifUri: banner.url }
    : { videoUri: banner.url, posterUri: banner.posterUrl, gifUri: null };
}
