/**
 * Search within this specific chat's message history — chat details > Search.
 * Real search: hits the message list filtered to this conversationId only
 * (GET /api/conversations/:id/messages?q=...), never a global search.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, Platform, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';
import { hapticPrimaryAction } from '@/lib/haptics';
import { useApi } from '@/lib/api';
import { isPreviewConversationId, getPreviewMessages } from '@/lib/previewInbox';
import { searchConversationMessages } from '@/services/socialService';
import type { Message } from '@/services/socialTypes';
import { goBackOr } from '@/lib/navigation/goBackOr';

export default function ConversationSearchScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(), []);
  const insets = useSafeAreaInsets();
  const headerTopPad = Platform.OS === 'web' ? Math.max(insets.top, 54) : insets.top;
  const router = useRouter();
  const api = useApi();
  const params = useLocalSearchParams<{ id: string; role?: string }>();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const isPreview = isPreviewConversationId(params.id);

  async function runSearch(q: string) {
    setQuery(q);
    const trimmed = q.trim();
    if (!trimmed) { setResults([]); return; }
    setLoading(true);
    try {
      if (isPreview) {
        const all = getPreviewMessages(params.id);
        setResults(all.filter((m) => m.text.toLowerCase().includes(trimmed.toLowerCase())));
      } else if (params.role === 'seller') {
        const msgs = await api.conversations.searchMessages(params.id, trimmed);
        setResults(msgs as Message[]);
      } else {
        setResults(await searchConversationMessages(params.id, trimmed));
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={[s.root, { backgroundColor: theme.background }]}>
      <View style={[s.header, { paddingTop: headerTopPad + SP.xs, borderBottomColor: theme.border }]}>
        <PressableScale rippleEnabled={false}
          onPress={() => { hapticPrimaryAction(); goBackOr(router); }}
          style={s.roundBtn}
          testID="conversation-search-back"
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={ICON.md} color={theme.text} />
        </PressableScale>
        <View style={[s.searchPill, { backgroundColor: theme.cardElevated }]}>
          <Feather name="search" size={ICON.sm} color={theme.muted} />
          <TextInput
            style={[s.searchInput, { color: theme.text }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
            value={query}
            onChangeText={runSearch}
            placeholder="Search in this chat"
            placeholderTextColor={theme.muted}
            autoFocus
            testID="conversation-search-input"
          />
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: SP.xl }} color={theme.text} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + SP.xl }}
          ListEmptyComponent={query.trim() ? (
            <Text style={[s.empty, { color: theme.muted }]}>No messages found</Text>
          ) : (
            <Text style={[s.empty, { color: theme.muted }]}>Search this conversation’s messages</Text>
          )}
          renderItem={({ item }) => (
            <View style={[s.resultRow, { borderBottomColor: theme.border }]} testID="conversation-search-result">
              <Text style={[s.resultFrom, { color: theme.text }]}>{item.fromName}</Text>
              <Text style={[s.resultText, { color: theme.muted }]} numberOfLines={2}>{item.text}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingBottom: SP.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  roundBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  searchPill: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SP.sm, height: 40, borderRadius: RADIUS.pill, paddingHorizontal: SP.md },
  searchInput: { flex: 1, fontFamily: FONT.regular, fontSize: FS.base, height: 40 },
  empty: { textAlign: 'center', marginTop: SP.xl, fontFamily: FONT.regular, fontSize: FS.sm },
  resultRow: { paddingHorizontal: SP.md, paddingVertical: SP.md, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  resultFrom: { fontFamily: FONT.semibold, fontSize: FS.sm },
  resultText: { fontFamily: FONT.regular, fontSize: FS.sm },
});
