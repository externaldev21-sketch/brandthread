/**
 * Shown when nobody is live (or every stream in the pager has ended). Never
 * a blank page: an explanation, upcoming scheduled lives with "Remind me",
 * and creators to follow.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { formatUpcomingTime, formatViewerCount } from '@/lib/live/liveOrdering';
import type { SuggestedCreator, UpcomingLive } from '@/lib/live/types';
import { LiveHostAvatar } from './LiveOverlays';

export function LiveEmptyState({
  upcoming, suggested, error, topInset, bottomInset, onRemind, onFollow, onOpenCreator, onRetry,
}: {
  upcoming: UpcomingLive[];
  suggested: SuggestedCreator[];
  error?: boolean;
  topInset: number;
  bottomInset: number;
  onRemind: (id: string, on: boolean) => void;
  onFollow: (hostId: string, following: boolean) => void;
  onOpenCreator: (hostId: string) => void;
  onRetry?: () => void;
}) {
  const { theme } = useAppTheme();
  const now = Date.now();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ paddingTop: topInset + 64, paddingBottom: bottomInset + SP.xl, paddingHorizontal: SP.md }}
      testID="live-empty"
    >
      <View style={styles.hero}>
        <View style={[styles.heroIcon, { borderColor: theme.border }]}>
          <Feather name="radio" size={26} color={theme.text} />
        </View>
        <Text style={[styles.heroTitle, { color: theme.text }]}>No one&apos;s live right now</Text>
        <Text style={[styles.heroSub, { color: theme.muted }]}>
          {error
            ? 'We couldn’t load live streams. Check your connection and try again.'
            : 'Live shopping drops in and out through the day. Set a reminder and we’ll tell you when it starts.'}
        </Text>
        {error && onRetry && (
          <Pressable onPress={onRetry} style={[styles.retry, { borderColor: theme.border }]} accessibilityRole="button">
            <Text style={[styles.retryText, { color: theme.text }]}>Try again</Text>
          </Pressable>
        )}
      </View>

      {upcoming.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Upcoming lives</Text>
          {upcoming.map(u => (
            <View key={u.id} style={[styles.upRow, { borderColor: theme.border }]} testID={`live-upcoming-${u.id}`}>
              <Pressable onPress={() => onOpenCreator(u.host.id)} accessibilityRole="button" accessibilityLabel={`Open ${u.host.name}`}>
                <LiveHostAvatar host={u.host} size={44} />
              </Pressable>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.upWhen, { color: theme.muted }]}>{formatUpcomingTime(u.startsAt, now).toUpperCase()}</Text>
                <Text style={[styles.upTitle, { color: theme.text }]} numberOfLines={1}>{u.title}</Text>
                <Text style={[styles.upHost, { color: theme.muted }]} numberOfLines={1}>{u.host.name}</Text>
              </View>
              <Pressable
                onPress={() => onRemind(u.id, !u.reminderSet)}
                style={[styles.pillBtn, u.reminderSet
                  ? { backgroundColor: 'transparent', borderColor: theme.border, borderWidth: 1 }
                  : { backgroundColor: theme.text }]}
                accessibilityRole="button"
                accessibilityState={{ selected: u.reminderSet }}
                accessibilityLabel={u.reminderSet ? `Reminder set for ${u.title}` : `Remind me about ${u.title}`}
              >
                {u.reminderSet && <Feather name="bell" size={12} color={theme.text} style={{ marginRight: 4 }} />}
                <Text style={[styles.pillText, { color: u.reminderSet ? theme.text : theme.background }]}>
                  {u.reminderSet ? 'Reminder set' : 'Remind me'}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {suggested.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Creators to follow</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm }}>
            {suggested.map(c => (
              <View key={c.host.id} style={[styles.card, { borderColor: theme.border }]}>
                <Pressable onPress={() => onOpenCreator(c.host.id)} style={{ alignItems: 'center' }} accessibilityRole="button" accessibilityLabel={`Open ${c.host.name}`}>
                  <LiveHostAvatar host={c.host} size={56} />
                  <Text style={[styles.cardName, { color: theme.text }]} numberOfLines={1}>{c.host.name}</Text>
                  <Text style={[styles.cardMeta, { color: theme.muted }]}>{formatViewerCount(c.followerCount)} followers</Text>
                </Pressable>
                <Pressable
                  onPress={() => onFollow(c.host.id, !c.following)}
                  style={[styles.cardFollow, c.following
                    ? { borderColor: theme.border, borderWidth: 1 }
                    : { backgroundColor: theme.text }]}
                  accessibilityRole="button"
                  accessibilityLabel={c.following ? `Following ${c.host.name}` : `Follow ${c.host.name}`}
                >
                  <Text style={[styles.pillText, { color: c.following ? theme.text : theme.background }]}>{c.following ? 'Following' : 'Follow'}</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: SP.lg },
  heroIcon: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md },
  heroTitle: { fontFamily: FONT.bold, fontSize: FS.xl, textAlign: 'center' },
  heroSub: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, textAlign: 'center', marginTop: SP.xs, maxWidth: 300 },
  retry: { marginTop: SP.md, borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: SP.md, paddingVertical: SP.xs + 2 },
  retryText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  section: { marginTop: SP.lg, gap: SP.sm },
  sectionTitle: { fontFamily: FONT.bold, fontSize: FS.base, marginBottom: 2 },
  upRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: RADIUS.md, padding: 10 },
  upWhen: { fontFamily: FONT.bold, fontSize: 10, letterSpacing: 0.8 },
  upTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: 2 },
  upHost: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 1 },
  pillBtn: { flexDirection: 'row', alignItems: 'center', height: 32, paddingHorizontal: 12, borderRadius: RADIUS.pill },
  pillText: { fontFamily: FONT.bold, fontSize: FS.xs },
  card: { width: 136, alignItems: 'center', borderWidth: 1, borderRadius: RADIUS.md, padding: 12, gap: 10 },
  cardName: { fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: 8, maxWidth: 110 },
  cardMeta: { fontFamily: FONT.regular, fontSize: 11, marginTop: 1 },
  cardFollow: { alignSelf: 'stretch', height: 30, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
});
