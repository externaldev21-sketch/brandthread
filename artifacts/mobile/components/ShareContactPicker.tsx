import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonBlock, SkeletonLine } from '@/components/ui/Skeleton';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS } from '@/lib/theme';
import { OFFICIAL_AVATAR_SOURCE, isOfficialAccountId } from '@/lib/officialAccount';
import { filterShareTargets } from '@/lib/shareContactSearch';
import type { ShareTarget } from '@/lib/shareRecents';

export type ContactLoadStatus = 'signed_out' | 'loading' | 'error' | 'ready';

export interface ShareContactPickerProps {
  status: ContactLoadStatus;
  targets: ShareTarget[];
  busyUserId: string | null;
  onSend: (target: ShareTarget) => void;
  onBack: () => void;
  onRetry: () => void;
}

/** In-sheet "More" picker: all DM contacts, searchable, each row sends the post. */
export function ShareContactPicker({ status, targets, busyUserId, onSend, onBack, onRetry }: ShareContactPickerProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterShareTargets(targets, query), [targets, query]);

  let body: React.ReactNode;
  if (status === 'signed_out') {
    body = <EmptyState title="Sign in to send posts to your friends." testID="share-contacts-signed-out" />;
  } else if (status === 'loading') {
    body = (
      <View testID="share-contacts-loading">
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={styles.row}>
            <SkeletonBlock width={40} height={40} radius={20} />
            <SkeletonLine width="50%" />
          </View>
        ))}
      </View>
    );
  } else if (status === 'error') {
    body = <ErrorState message="Couldn't load your contacts." onRetry={onRetry} />;
  } else {
    body = (
      <FlatList
        data={visible}
        keyExtractor={item => item.userId}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={7}
        style={styles.list}
        scrollEnabled={visible.length > 0}
        ListEmptyComponent={
          <EmptyState
            title={query.trim() ? `No contacts match "${query.trim()}".` : 'No friends or chats yet.'}
            testID="share-contacts-empty"
          />
        }
        renderItem={({ item }) => {
          const official = item.isOfficial || isOfficialAccountId(item.userId);
          const busy = busyUserId === item.userId;
          return (
            <Pressable
              style={styles.row}
              onPress={() => onSend(item)}
              disabled={busyUserId != null}
              accessibilityRole="button"
              accessibilityLabel={`Send to ${item.name}`}
              testID={`share-contact-${item.userId}`}
            >
              <View style={[styles.avatar, { backgroundColor: item.color }]}>
                {official ? (
                  <Image source={OFFICIAL_AVATAR_SOURCE} style={styles.avatarImage} />
                ) : item.avatarUri ? (
                  <Image source={{ uri: item.avatarUri }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarText}>{item.initials}</Text>
                )}
              </View>
              <View style={styles.names}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                {item.handle ? <Text style={styles.handle} numberOfLines={1}>@{item.handle.replace(/^@/, '')}</Text> : null}
              </View>
              {busy ? <ActivityIndicator color={theme.text} /> : <Icon name="send" size={17} color={theme.muted} />}
            </Pressable>
          );
        }}
      />
    );
  }

  return (
    <View style={styles.root} testID="share-contact-picker">
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to share options" testID="share-contacts-back" hitSlop={8}>
          <Icon name="chevron-left" size={24} color={theme.text} />
        </Pressable>
        {status === 'ready' ? (
          <Input label="Search" value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" style={styles.search} testID="share-contacts-search" />
        ) : null}
      </View>
      {body}
    </View>
  );
}

const makeStyles = (theme: { text: string; muted: string; onAccent: string; border: string }) => StyleSheet.create({
  root: { paddingHorizontal: 8, paddingBottom: 8, minHeight: 280 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 8 },
  search: { flex: 1 },
  list: { maxHeight: 360 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 4 },
  avatar: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { color: theme.onAccent, fontFamily: FONT.bold, fontSize: FS.sm },
  names: { flex: 1 },
  name: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm },
  handle: { color: theme.muted, fontFamily: FONT.medium, fontSize: FS.xs },
});
