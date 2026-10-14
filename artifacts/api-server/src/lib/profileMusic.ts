/**
 * Profile song (Instagram profile music): a buyer or seller picks one track
 * that shows under their bio and plays its preview on tap — never on its own.
 *
 * Only a licensed preview source may be used. The one supported source is the
 * Apple Music catalog API (30-second previews licensed for in-app promotion,
 * shown with the track's Apple Music link). It is configured entirely from
 * env and is OFF unless every piece is present AND the `profileMusic` feature
 * flag is on:
 *
 *   PROFILE_MUSIC_PROVIDER=apple_music
 *   APPLE_MUSIC_DEVELOPER_TOKEN=<MusicKit developer JWT>
 *   APPLE_MUSIC_STOREFRONT=us            (optional, default "us")
 *   PUT /api/config/features/profileMusic { enabled: true }
 *
 * With none of that set, every endpoint reports "off" and the app hides the
 * Music row and the profile line. A stored song is never served while off.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

export interface ProfileSong {
  provider: "apple_music";
  id: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  previewUrl: string;
  /** Link back to the track on the provider (shown as the attribution). */
  url: string | null;
}

interface Provider {
  search(term: string): Promise<ProfileSong[]>;
  byId(id: string): Promise<ProfileSong | null>;
}

const FLAG_CACHE_MS = 60_000;
let flagCache: { value: boolean; at: number } | null = null;

export function resetProfileMusicFlagCache(): void {
  flagCache = null;
}

async function flagEnabled(): Promise<boolean> {
  if (flagCache && Date.now() - flagCache.at < FLAG_CACHE_MS) return flagCache.value;
  let value = false;
  try {
    const result = await pool.query<{ enabled: boolean }>(
      "SELECT enabled FROM feature_flags WHERE key = 'profileMusic' LIMIT 1",
    );
    value = result.rows[0]?.enabled === true;
  } catch (err) {
    logger.warn({ err }, "Could not read profileMusic flag; treating as off");
  }
  flagCache = { value, at: Date.now() };
  return value;
}

/** Pure: Apple Music song resource → ProfileSong, or null when it has no preview. */
export function songFromAppleMusic(resource: any): ProfileSong | null {
  const a = resource?.attributes;
  const previewUrl = a?.previews?.[0]?.url;
  if (!resource?.id || !a?.name || !a?.artistName || typeof previewUrl !== "string" || !previewUrl.startsWith("https://")) return null;
  const art = typeof a.artwork?.url === "string" ? a.artwork.url.replace("{w}", "120").replace("{h}", "120") : null;
  return {
    provider: "apple_music",
    id: String(resource.id),
    title: String(a.name).slice(0, 200),
    artist: String(a.artistName).slice(0, 200),
    artworkUrl: art,
    previewUrl,
    url: typeof a.url === "string" ? a.url : null,
  };
}

function appleMusicProvider(token: string, storefront: string): Provider {
  const base = `https://api.music.apple.com/v1/catalog/${encodeURIComponent(storefront)}`;
  async function call(path: string): Promise<any | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      if (!res.ok) {
        logger.warn({ status: res.status }, "Apple Music request failed");
        return null;
      }
      return await res.json();
    } catch (err) {
      logger.warn({ err }, "Apple Music request failed");
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async search(term) {
      const body = await call(`/search?types=songs&limit=20&term=${encodeURIComponent(term)}`);
      const songs: any[] = body?.results?.songs?.data ?? [];
      return songs.map(songFromAppleMusic).filter((s): s is ProfileSong => !!s);
    },
    async byId(id) {
      if (!/^[0-9]{1,20}$/.test(id)) return null;
      const body = await call(`/songs/${id}`);
      return songFromAppleMusic(body?.data?.[0]);
    },
  };
}

/** The configured licensed provider, or null when env is incomplete. */
export function configuredProvider(env: NodeJS.ProcessEnv = process.env): Provider | null {
  if (env.PROFILE_MUSIC_PROVIDER !== "apple_music") return null;
  const token = env.APPLE_MUSIC_DEVELOPER_TOKEN?.trim();
  if (!token) return null;
  return appleMusicProvider(token, env.APPLE_MUSIC_STOREFRONT?.trim() || "us");
}

/** On only when a licensed provider is configured AND the feature flag is on. */
export async function profileMusicProvider(): Promise<Provider | null> {
  const provider = configuredProvider();
  if (!provider) return null;
  return (await flagEnabled()) ? provider : null;
}

/** Pure: a stored jsonb value → a ProfileSong, or null when it isn't one. */
export function parseStoredSong(value: unknown): ProfileSong | null {
  const v = value as Partial<ProfileSong> | null;
  if (!v || v.provider !== "apple_music" || typeof v.id !== "string" || typeof v.previewUrl !== "string"
    || typeof v.title !== "string" || typeof v.artist !== "string") return null;
  return {
    provider: "apple_music", id: v.id, title: v.title, artist: v.artist,
    artworkUrl: typeof v.artworkUrl === "string" ? v.artworkUrl : null,
    previewUrl: v.previewUrl, url: typeof v.url === "string" ? v.url : null,
  };
}
