/**
 * Discover's People tab card — the exact same DiscoverEntityCard layout the
 * Brands tab uses (Dev asked for the two tabs to match), fed person data:
 * avatar/initials, name, "Followed by X + N others" / "New on Brandthread"
 * subline, Follow button.
 */
import React from 'react';
import { useRouter } from 'expo-router';
import { DiscoverEntityCard } from './DiscoverEntityCard';
import type { DiscoverPersonSuggestion } from '@/lib/discoverFeed';

export function DiscoverPersonCard({ person }: { person: DiscoverPersonSuggestion }) {
  const router = useRouter();
  return (
    <DiscoverEntityCard
      id={person.userId}
      name={person.name}
      imageUri={person.avatarUrl}
      subline={person.reason}
      initials={person.initials}
      avatarColor={person.color}
      onPress={() => router.push(`/buyer-other-profile?userId=${encodeURIComponent(person.userId)}&name=${encodeURIComponent(person.name)}&handle=${encodeURIComponent(person.handle)}&initials=${encodeURIComponent(person.initials)}` as never)}
      followInitial={{ isFollowing: person.isFollowing, isFollowedBy: false, isMutual: false }}
    />
  );
}
