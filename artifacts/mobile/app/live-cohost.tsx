/**
 * Live Co-host — host screen pushed from seller-live's rail.
 * Search any seller (people you follow come first), invite them, and remove
 * a co-host who has joined. The invitee gets a notification and accepts or
 * declines (app/live-cohost-invite.tsx). `&demo=1` shows sample data, no API.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { showAlert } from '@/lib/actionSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { ListRow } from '@/components/ui/ListRow';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import type { LiveCohostCandidate, LiveCohostPerson } from '@/lib/live/moderationTypes';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { friendlyError } from '@/lib/friendlyError';

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
  const demo = isPreviewDemoMode();
  const streamId = params.streamId ? String(params.streamId) : '';
  const live = !demo && !!streamId;

  const [query, setQuery] = useState('');
  const [sellers, setSellers] = useState<LiveCohostCandidate[]>(demo ? DEMO_CANDIDATES : []);
  const [cohosts, setCohosts] = useState<LiveCohostPerson[]>(demo ? DEMO_COHOSTS : []);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(live);
  const [failed, setFailed] = useState(false);
  const [cohostsFailed, setCohostsFailed] = useState(false);
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

  const loadCohosts = useCallback(() => {
    if (!live) return () => {};
    let alive = true;
    setCohostsFailed(false);
    api.liveCohost.list(streamId)
      .then((r) => { if (alive) setCohosts(r.cohosts); })
      .catch(() => { if (alive) setCohostsFailed(true); });
    return () => { alive = false; };
  }, [api, live, streamId]);

  useEffect(() => loadCohosts(), [loadCohosts]);

  async function invite(seller: LiveCohostCandidate) {
    setInvited((prev) => new Set(prev).add(seller.userId));
    if (!live) return;
    try {
      await api.liveCohost.invite(streamId, seller.userId);
    } catch (e: unknown) {
      setInvited((prev) => { const n = new Set(prev); n.delete(seller.userId); return n; });
      showAlert('Couldn’t invite', friendlyError(e, `Couldn’t invite ${seller.displayName}. Try again.`));
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
      showAlert('Couldn’t remove', `${person.displayName} is still on your live. Try again.`);
    }
  }

  const s = makeStyles(theme);

  const header = (
    <View>
      <View style={s.searchWrap}>
        <Icon name="search" size={16} color={theme.muted} />
        <TextInput returnKeyType="search"
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
      {cohostsFailed && (
        <View style={s.errorRow} testID="live-cohost-list-error">
          <Text style={[s.emptyText, { flex: 1, textAlign: 'left', paddingVertical: 0 }]}>Couldn’t load who’s on your live.</Text>
          <Button label="Retry" variant="secondary" size="compact" onPress={() => { loadCohosts(); }} />
        </View>
      )}
      {cohosts.length > 0 && (
        <>
          <Text style={s.sectionLabel}>On your live</Text>
          {cohosts.map((c) => (
            <ListRow
              key={c.userId}
              avatar={{ uri: c.avatarUrl, name: c.displayName }}
              title={c.displayName}
              subtitle={c.username ? `@${c.username}` : undefined}
              right={<View style={s.rowBtn}><Button label="Remove" variant="secondary" size="compact" fullWidth onPress={() => void removeCohost(c)} accessibilityLabel={`Remove ${c.displayName} from your live`} /></View>}
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
            <View>
              <Text style={s.emptyText}>
                {!live && !demo ? 'Open Co-host from your live broadcast.' : failed ? 'Couldn’t load sellers.' : 'No sellers found.'}
              </Text>
              {live && failed && (
                <View style={s.center}>
                  <Button label="Retry" variant="secondary" size="small" onPress={() => void search(query.trim())} />
                </View>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <ListRow
              avatar={{ uri: item.avatarUrl, name: item.displayName }}
              title={item.displayName}
              subtitle={item.username ? `@${item.username}` : undefined}
              right={
                <View style={s.rowBtn}>
                  <Button
                    label={invited.has(item.userId) ? 'Invited' : 'Invite'}
                    variant={invited.has(item.userId) ? 'secondary' : 'primary'}
                    size="compact"
                    fullWidth
                    disabled={invited.has(item.userId)}
                    onPress={() => void invite(item)}
                    accessibilityLabel={invited.has(item.userId) ? `${item.displayName} invited` : `Invite ${item.displayName} to co-host`}
                  />
                </View>
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
  searchInput: { flex: 1, minWidth: 0, color: theme.text, fontFamily: FONT.regular, fontSize: FS.base, height: 44 },
  sectionLabel: {
    color: theme.muted, fontFamily: FONT.semibold, fontSize: FS.meta, marginTop: SP.lg, marginBottom: SP.sm,
  },
  rowBtn: { minWidth: 112 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.md },
  emptyText: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', paddingVertical: SP.lg },
});
