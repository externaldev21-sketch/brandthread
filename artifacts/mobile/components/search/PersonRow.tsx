import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS } from '@/lib/theme';

export type SearchPerson = {
  userId: string;
  name: string;
  username: string | null;
  handle: string;
  initials: string;
  color: string;
  bio: string | null;
  isFollowing: boolean;
};

/**
 * Compact inline follow row for the People tab. Only tracks Follow /
 * Following — the buyer search API (`api.social.search`) doesn't return
 * `isFollowedBy`/`isMutual`, so the richer Friends/Follow-Back states from
 * `buyer-other-profile`'s `renderFollowButton` aren't available here.
 */
export function PersonRow({
  person,
  loading,
  onPress,
  onToggleFollow,
}: {
  person: SearchPerson;
  loading: boolean;
  onPress: () => void;
  onToggleFollow: () => void;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);

  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${person.name}`}
    >
      <View style={[styles.avatar, { backgroundColor: person.color }]}>
        <Text style={styles.avatarText}>{person.initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{person.name}</Text>
        <Text style={[styles.sub, { color: theme.muted }]} numberOfLines={1}>
          {person.handle}{person.bio ? `  ·  ${person.bio.slice(0, 40)}` : ''}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onToggleFollow}
        disabled={loading}
        style={[
          styles.followBtn,
          person.isFollowing
            ? { backgroundColor: 'transparent', borderColor: theme.border, borderWidth: 1 }
            : { backgroundColor: theme.accent },
        ]}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={person.isFollowing ? `Unfollow ${person.name}` : `Follow ${person.name}`}
        testID={`search-follow-${person.userId}`}
      >
        {loading ? (
          <ActivityIndicator size="small" color={person.isFollowing ? theme.text : theme.onAccent} />
        ) : (
          <Text style={[styles.followText, { color: person.isFollowing ? theme.text : theme.onAccent }]}>
            {person.isFollowing ? 'Following' : 'Follow'}
          </Text>
        )}
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: FS.sm, fontFamily: FONT.bold, color: theme.onAccent },
  name: { fontSize: FS.base, fontFamily: FONT.semibold },
  sub: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  followBtn: {
    minWidth: 92, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14,
  },
  followText: { fontSize: FS.xs, fontFamily: FONT.semibold },
});
