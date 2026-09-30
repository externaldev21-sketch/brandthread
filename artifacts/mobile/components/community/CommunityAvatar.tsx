/**
 * Community tile. Always monochrome:
 *   official   → Feather icon (iconKey) on a neutral tile
 *   user group → uploaded photo, else the name's initials
 */
import React from 'react';
import { Feather } from '@expo/vector-icons';
import { Text, View } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { useColors } from '@/hooks/useColors';
import { FONT } from '@/lib/theme';

export interface CommunityAvatarProps {
  community: { iconKey?: string; iconUrl?: string; coverUrl?: string; name: string; verified?: boolean };
  size?: number;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function CommunityAvatar({ community, size = 52 }: CommunityAvatarProps) {
  const colors = useColors();
  const radius = Math.round(size * 0.28);
  const photo = community.iconUrl || community.coverUrl;
  if (photo) {
    return (
      <CachedImage
        source={{ uri: photo }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.secondary }}
        accessibilityLabel={`${community.name} photo`}
      />
    );
  }
  const icon = community.iconKey && community.iconKey in Feather.glyphMap
    ? (community.iconKey as keyof typeof Feather.glyphMap)
    : null;
  return (
    <View
      accessibilityLabel={`${community.name} icon`}
      style={{
        width: size, height: size, borderRadius: radius, backgroundColor: colors.secondary,
        borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
      }}
    >
      {icon ? (
        <Feather name={icon} size={Math.round(size * 0.46)} color={colors.foreground} />
      ) : (
        <Text style={{ fontFamily: FONT.semibold, fontSize: Math.round(size * 0.36), color: colors.foreground }}>
          {initialsOf(community.name)}
        </Text>
      )}
    </View>
  );
}
