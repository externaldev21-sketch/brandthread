/**
 * Community tile. Always monochrome:
 *   official   → Feather icon (iconKey) on a neutral tile
 *   user group → uploaded photo, else a monogram: the name's initials in
 *                white on a graphite tile with a silver hairline edge
 */
import React from 'react';
import { Feather } from '@expo/vector-icons';
import { Icon, type IconName } from '@/components/ui/Icon';
import { StyleSheet, Text, View } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { useColors } from '@/hooks/useColors';
import { FONT } from '@/lib/theme';

export interface CommunityAvatarProps {
  community: { iconKey?: string; iconUrl?: string; coverUrl?: string; name: string; verified?: boolean };
  size?: number;
}

const FILLER = new Set(['and', '&', '+', 'of', 'the', 'a', 'an', 'for', 'x']);

/** "Cut and Sew Club" → "CS": first letters of the first two meaningful words. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => !FILLER.has(w.toLowerCase()));
  const parts = (meaningful.length ? meaningful : words).slice(0, 2);
  return parts.map((p) => p.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '').join('') || '?';
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
    ? (community.iconKey as IconName)
    : null;
  return (
    <View
      accessibilityLabel={`${community.name} icon`}
      style={{
        width: size, height: size, borderRadius: radius, backgroundColor: colors.secondary,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: icon ? 0 : StyleSheet.hairlineWidth, borderColor: colors.border,
      }}
    >
      {icon ? (
        <Icon name={icon} size={Math.round(size * 0.46)} color={colors.foreground} />
      ) : (
        <Text style={{ fontFamily: FONT.semibold, fontSize: Math.round(size * 0.36), letterSpacing: size >= 64 ? 0.5 : 0, color: colors.foreground }}>
          {initialsOf(community.name)}
        </Text>
      )}
    </View>
  );
}
