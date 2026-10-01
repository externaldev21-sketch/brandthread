/**
 * Recent Searches — dedicated "See all" page (Mobbin "Instagram iOS
 * Clearing search history"): full list, "Clear all" top-right, a
 * confirmation alert before wiping the (server-side, per-user) history,
 * and an empty state with "Clear all" disabled once it's gone.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useApi } from '@/lib/api';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale, EmptyState } from '@/components/BrandthreadUI';
import { RecentSearchRow } from '@/components/search/RecentSearchRow';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { hapticDestructiveConfirm, hapticSelection } from '@/lib/haptics';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { ErrorState } from '@/components/ui/ErrorState';

export default function BuyerSearchHistoryScreen() {
  const router = useRouter();
  const api = useApi();
  const { theme } = useAppTheme();

  const [terms, setTerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const { recent } = await api.public.recent(30);
      setTerms(recent.map((r) => r.query));
      setFailed(false);
    } catch {
      setTerms([]);
      setFailed(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);
  const pull = usePullToRefresh(load);

  function submitTerm(term: string) {
    router.push({ pathname: '/buyer-search', params: { q: term } } as never);
  }

  async function removeTerm(term: string) {
    setTerms((current) => current.filter((t) => t !== term));
    try { await api.public.removeRecent(term); } catch { /* row already optimistically removed */ }
  }

  function confirmClearAll() {
    // Same explanatory copy Instagram uses on this alert — the owner asked
    // for a 1:1 mimic of this exact flow.
    Alert.alert(
      'Clear search history?',
      "You're about to clear your search history. This can't be undone.",
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Clear all',
          style: 'destructive',
          onPress: async () => {
            hapticDestructiveConfirm();
            setTerms([]);
            try { await api.public.clearRecent(); } catch { /* already cleared locally */ }
          },
        },
      ],
    );
  }

  const hasTerms = terms.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader
        title="Recent Searches"
        rightElement={
          <PressableScale
            onPress={() => { hapticSelection(); confirmClearAll(); }}
            disabled={!hasTerms}
            accessibilityRole="button"
            accessibilityLabel="Clear all recent searches"
            accessibilityState={{ disabled: !hasTerms }}
            style={{ opacity: hasTerms ? 1 : 0.4, paddingHorizontal: 4, paddingVertical: 4 }}
          >
            <Text style={[TYPE_SCALE.body, { fontFamily: FONT.semibold, color: theme.text }]}>Clear all</Text>
          </PressableScale>
        }
      />
      {!loading && !hasTerms && failed ? (
        <ErrorState message="Couldn't load your searches." onRetry={() => { void load(); }} style={{ flex: 1 }} />
      ) : !loading && !hasTerms ? (
        <EmptyState icon="clock" title="No search history" description="Searches you make will show up here." />
      ) : (
        <FlatList
          data={terms}
          refreshControl={pull.refreshControl}
          keyExtractor={(term) => term}
          renderItem={({ item }) => (
            <RecentSearchRow term={item} onPress={() => submitTerm(item)} onRemove={() => removeTerm(item)} />
          )}
        />
      )}
    </View>
  );
}
