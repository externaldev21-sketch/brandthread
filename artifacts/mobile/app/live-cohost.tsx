/**
 * Live Co-host — host screen pushed from seller-live's rail.
 * Search any seller (people you follow come first), invite them, and remove
 * a co-host who has joined. The invitee gets a notification and accepts or
 * declines (app/live-cohost-invite.tsx). `&demo=1` shows sample data, no API.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { ListRow } from '@/components/ui/ListRow';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import type { LiveCohostCandidate, LiveCohostPerson } from '@/lib/live/moderationTypes';

const DEMO_CANDIDATES: LiveCohostCandidate[] = [
  { userId: 'demo-1', username: 'atelier.nord', displayName: 'Atelier Nord', avatarUrl: null, followed: true },
  { userId: 'demo-2', username: 'loomandline', displayName: 'Loom & Line', avatarUrl: null, followed: true },
  { userId: 'demo-3', username: 'stonewashed', displayName: 'Stonewashed Co', avatarUrl: null, followed: false },
];
const DEMO_COHOSTS: LiveCohostPerson[] = [
  { userId: 'demo-9', agoraUid: 1, displayName: 'Rue Studio', username: 'ruestudio', avatarUrl: null },
];

export default function LiveCohostScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const params = useLocalSearchParams<{ streamId?: string; demo?: string }>();
  const demo = params.demo === '1';
  const streamId = params.streamId ? String(params.streamId) : '';
  const live = !demo && !!streamId;

  const [query, setQuery] = useState('');
  const [sellers, setSellers] = useState<LiveCohostCandidate[]>(demo ? DEMO_CANDIDATES : []);
  const [cohosts, setCohosts] = useState<LiveCohostPerson[]>(demo ? DEMO_COHOSTS : []);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(live);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  const search = useCallback(async (q: string) => {
    if (!live) return;
    const mine = ++seq.current;
    setFailed(false);
    try {
      const r = await api.liveCohost.candidates(q);
      if (mine === seq.current) setSellers(r.sellers);
    } catch {
      if (mine === seq.current) setFailed(true);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [api, live]);

  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => void search(query.trim()), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [query, live, search]);

  useEffect(() => {
    if (!live) return;
    api.liveCohost.list(streamId).then((r) => setCohosts(r.cohosts)).catch(() => {});
  }, [api, live, streamId]);

  async function invite(seller: LiveCohostCandidate) {
    setInvited((prev) => new Set(prev).add(seller.userId));
    if (!live) return;
    try {
      await api.liveCohost.invite(streamId, seller.userId);
    } catch (e: any) {
      setInvited((prev) => { const n = new Set(prev); n.delete(seller.userId); return n; });
      Alert.alert('Couldn’t invite', e?.message ?? 'Try again.');
    }
  }

  async function removeCohost(person: LiveCohostPerson) {
    const previous = cohosts;
    setCohosts((prev) => prev.filter((c) => c.userId !== person.userId));
    if (!live) return;
    try {
      await api.liveCohost.remove(streamId, person.userId);
    } catch {
      setCohosts(previous);
      Alert.alert('Couldn’t remove', 'Try again.');
    }
  }

  const s = makeStyles(theme);

  const header = (
    <View>
      <View style={s.searchWrap}>
        <Feather name="search" size={16} color={theme.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search sellers"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={s.searchInput}
          accessibilityLabel="Search sellers"
        />
      </View>
      {cohosts.length > 0 && (
        <>
          <Text style={s.sectionLabel}>On your live</Text>
          {cohosts.map((c) => (
            <ListRow
              key={c.userId}
              avatar={{ uri: c.avatarUrl, name: c.displayName }}
              title={c.displayName}
              subtitle={c.username ? `@${c.username}` : undefined}
              right={<Button label="Remove" variant="secondary" size="compact" onPress={() => void removeCohost(c)} />}
            />
          ))}
        </>
      )}
      <Text style={s.sectionLabel}>Sellers</Text>
    </View>
  );

  return (
    <View style={s.root}>
      <ScreenHeader title="Co-host" onBack={() => goBackOr(router)} />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.text} /></View>
      ) : (
        <FlatList
          data={sellers}
          keyExtractor={(x) => x.userId}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={header}
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + SP.xl }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text style={s.emptyText}>{failed ? 'Couldn’t load sellers.' : 'No sellers found.'}</Text>
          }
          renderItem={({ item }) => (
            <ListRow
              avatar={{ uri: item.avatarUrl, name: item.displayName }}
              title={item.displayName}
              subtitle={item.username ? `@${item.username}` : undefined}
              right={
                <Button
                  label={invited.has(item.userId) ? 'Invited' : 'Invite'}
                  variant={invited.has(item.userId) ? 'secondary' : 'primary'}
                  size="compact"
                  disabled={invited.has(item.userId)}
                  onPress={() => void invite(item)}
                />
              }
            />
          )}
        />
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: SP.md, paddingTop: SP.sm },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, height: 44, borderRadius: RADIUS.md,
    paddingHorizontal: SP.md, backgroundColor: theme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
  },
  searchInput: { flex: 1, color: theme.text, fontFamily: FONT.regular, fontSize: FS.base, height: 44 },
  sectionLabel: {
    color: theme.muted, fontFamily: FONT.semibold, fontSize: FS.meta, letterSpacing: 0.6,
    textTransform: 'uppercase', marginTop: SP.lg, marginBottom: SP.sm,
  },
  emptyText: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', paddingVertical: SP.lg },
});
