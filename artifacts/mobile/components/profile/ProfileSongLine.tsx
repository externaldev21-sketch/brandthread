/**
 * Profile song line under the bio (Instagram profile music, 1:1): a music
 * glyph + "title · artist" in 13pt that plays the licensed preview on tap
 * (see ProfileSongPlayButton). Renders nothing unless profile music is on
 * and the person has a song.
 */
import React, { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useProfileMusicEnabled } from '@/hooks/useProfileMusic';
import { onProfileSongChanged, profileSongLabel, type ProfileSong } from '@/lib/profileSong';

export function ProfileSongLine({ userId }: { userId?: string | null }) {
  const api = useApi();
  const enabled = useProfileMusicEnabled();
  const [song, setSong] = useState<ProfileSong | null>(null);

  useEffect(() => {
    setSong(null);
    if (!enabled || !userId) return;
    let active = true;
    api.profileMusic.forUser(userId)
      .then((res) => { if (active) setSong(res.song); })
      .catch(() => {});
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, userId]);

  useEffect(() => onProfileSongChanged((changedId, next) => {
    if (changedId === userId) setSong(next);
  }), [userId]);

  const label = profileSongLabel(song);
  if (!enabled || !song || !label) return null;
  // Required here, not imported, so the audio module only loads once a song is shown.
  const { ProfileSongPlayButton } = require('./ProfileSongPlayButton') as typeof import('./ProfileSongPlayButton');
  return <ProfileSongPlayButton song={song} label={label} />;
}
