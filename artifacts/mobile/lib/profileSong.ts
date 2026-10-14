/**
 * Profile song (Instagram profile music) — shared shape + wording. The server
 * (api-server lib/profileMusic.ts) only serves songs from a licensed preview
 * source and only while it is configured and flagged on.
 */
export interface ProfileSong {
  provider: 'apple_music';
  id: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  previewUrl: string;
  url: string | null;
}

/** "blue · yung kai" — title first, as Instagram shows it under the bio. */
export function profileSongLabel(song: Pick<ProfileSong, 'title' | 'artist'> | null | undefined): string | null {
  if (!song) return null;
  const title = song.title.trim();
  const artist = song.artist.trim();
  if (!title) return null;
  return artist ? `${title} · ${artist}` : title;
}

type Listener = (userId: string, song: ProfileSong | null) => void;
const listeners = new Set<Listener>();

/** The picker calls this after a save so an open profile shows the new song at once. */
export function emitProfileSongChanged(userId: string, song: ProfileSong | null): void {
  listeners.forEach((l) => l(userId, song));
}

export function onProfileSongChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
