/**
 * "Followed by maya, leo and 3 others" — Instagram's profile-header line
 * under the bio/link, above the buttons, with up to three small overlapping
 * avatars on the left. Tapping it opens the profile's Followers list.
 * Renders nothing when the viewer follows nobody who follows this profile.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PressableScale } from '@/components/BrandthreadUI';
import { Avatar } from '@/components/ui/Avatar';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { mutualFollowerLabel, mutualFollowersSegments } from '@/lib/mutualFollowersText';

export type MutualFollowers = {
  users: Array<{ userId: string; username: string | null; displayName: string | null; avatarUrl: string | null }>;
  count: number;
};

const AVATAR = 24;

export function MutualFollowersLine({ mutual, onPress }: { mutual?: MutualFollowers | null; onPress?: () => void }) {
  const { theme } = useAppTheme();
  const users = mutual?.users ?? [];
  const segments = useMemo(() => mutualFollowersSegments(users, mutual?.count ?? 0), [users, mutual?.count]);
  if (segments.length === 0) return null;
  const label = segments.map((s) => s.text).join('');

  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.row}
      testID="profile-mutual-followers"
    >
      {() => (
        <>
          <View style={[styles.avatars, { width: AVATAR + 4 + (Math.min(users.length, 3) - 1) * (AVATAR - 8) }]}>
            {users.slice(0, 3).map((user, index) => (
              <View
                key={user.userId}
                style={[
                  styles.avatarWrap,
                  { left: index * (AVATAR - 8), zIndex: 3 - index, borderColor: theme.background, backgroundColor: theme.background },
                ]}
              >
                <Avatar uri={user.avatarUrl} name={mutualFollowerLabel(user)} size={AVATAR} />
              </View>
            ))}
          </View>
          <Text style={[styles.text, { color: theme.muted }]} numberOfLines={2}>
            {segments.map((segment, index) => (
              <Text key={index} style={segment.bold ? [styles.bold, { color: theme.text }] : undefined}>{segment.text}</Text>
            ))}
          </Text>
        </>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.sm, alignSelf: 'stretch' },
  avatars: { height: AVATAR + 4 },
  avatarWrap: {
    position: 'absolute', top: 0, width: AVATAR + 4, height: AVATAR + 4, borderRadius: (AVATAR + 4) / 2,
    borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  text: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
  bold: { fontFamily: FONT.semibold },
});
