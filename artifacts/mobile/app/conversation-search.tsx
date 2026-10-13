/**
 * Search within this specific chat's message history — chat details > Search.
 * Real search: hits the message list filtered to this conversationId only
 * (GET /api/conversations/:id/messages?q=...), never a global search.
 */
import { FlashList } from '@shopify/flash-list';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { LONG_LIST_TUNING } from '@/lib/listTuning';
import { Icon } from '@/components/ui/Icon';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';
import { useApi } from '@/lib/api';
import { isPreviewConversationId, getPreviewMessages } from '@/lib/previewInbox';
import { searchConversationMessages } from '@/services/socialService';
import type { Message } from '@/services/socialTypes';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { UnavailableScreen, isMissingParam } from '@/components/ui/UnavailableScreen';

const SEARCH_DEBOUNCE_MS = 250;
import { setPendingChatFocus } from '@/lib/chatFocus';
import { formatDate } from '@/lib/chatGrouping';
import { hapticPrimaryAction } from '@/lib/haptics';

export default function ConversationSearchScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(), []);
  const insets = useSafeAreaInsets();
  const headerTopPad = useHeaderTopInset();
  const router = useRouter();
  const api = useApi();
  const params = useLocalSearchParams<{ id: string; role?: string }>();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const isPreview = isPreviewConversationId(params.id);

  // Typing fires one search after a short pause, not one per keystroke, and a
  // slower earlier response can never overwrite the latest query's results.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSearch = useRef(0);
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  function openResult(messageId: string) {
    hapticPrimaryAction();
    setPendingChatFocus(params.id, messageId);
    // Search sits on top of Chat details on top of the chat.
    if (router.canDismiss()) router.dismiss(2);
    else goBackOr(router);
  }

  function runSearch(q: string) {
    setQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const trimmed = q.trim();
    const searchId = ++latestSearch.current;
    if (!trimmed) { setResults([]); setLoading(false); return; }
    setLoading(true);
    searchTimer.current = setTimeout(() => { void search(trimmed, searchId); }, SEARCH_DEBOUNCE_MS);
  }

  async function search(trimmed: string, searchId: number) {
    let next: Message[] = [];
    try {
      if (isPreview) {
        const all = getPreviewMessages(params.id);
        next = all.filter((m) => m.text.toLowerCase().includes(trimmed.toLowerCase()));
      } else if (params.role === 'seller') {
        next = (await api.conversations.searchMessages(params.id, trimmed)) as Message[];
      } else {
        next = await searchConversationMessages(params.id, trimmed);
      }
    } catch {
      next = [];
    }
    if (searchId !== latestSearch.current) return;
    setResults(next);
    setLoading(false);
  }

  // Opened without a conversation id — there is no chat to search.
  if (isMissingParam(params.id)) {
    return (
      <UnavailableScreen
        title="Search in chat"
        heading="Conversation not found"
        message="Open search from a chat's details to search its messages."
        icon="message-circle"
        fallback={params.role === 'seller' ? '/seller-inbox' : '/(buyer)/inbox'}
      />
    );
  }

  return (
    <View style={[s.root, { backgroundColor: theme.background }]}>
      <View style={[s.header, { paddingTop: headerTopPad + SP.xs, borderBottomColor: theme.border }]}>
        <PressableScale rippleEnabled={false}
          onPress={() => { goBackOr(router); }}
          style={s.roundBtn}
          testID="conversation-search-back"
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Icon name="arrow-left" size={ICON.md} color={theme.text} />
        </PressableScale>
        <View style={[s.searchPill, { backgroundColor: theme.cardElevated }]}>
          <Icon name="search" size={ICON.sm} color={theme.muted} />
          <TextInput returnKeyType="search"
            style={[s.searchInput, { color: theme.text }, WEB_INPUT_RESET]}
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
        <FlashList
          data={results}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + SP.xl }}
          ListEmptyComponent={query.trim() ? (
            <Text style={[s.empty, { color: theme.muted }]}>No messages found</Text>
          ) : null}
          renderItem={({ item }) => (
            // Tap → back in the chat, scrolled to this message (#164).
            <PressableScale
              rippleEnabled={false}
              style={[s.resultRow, { borderBottomColor: theme.border }]}
              onPress={() => openResult(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`${item.fromName}: ${item.text}`}
              testID="conversation-search-result"
            >
              <View style={s.resultTop}>
                <Text style={[s.resultFrom, { color: theme.text }]} numberOfLines={1}>{item.fromName}</Text>
                {typeof item.ts === 'number' ? (
                  <Text style={[s.resultDate, { color: theme.muted }]}>{formatDate(item.ts)}</Text>
                ) : null}
              </View>
              <Text style={[s.resultText, { color: theme.muted }]} numberOfLines={2}>
                {highlightParts(item.text, query).map((part, i) => (
                  <Text key={i} style={part.match ? { color: theme.text, fontFamily: FONT.semibold } : undefined}>{part.text}</Text>
                ))}
              </Text>
            </PressableScale>
          )}
        />
      )}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  root: { flex: 1 },
  // No divider under the header (app-wide header rule).
  header: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingBottom: SP.sm },
  roundBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  searchPill: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SP.sm, height: 40, borderRadius: RADIUS.pill, paddingHorizontal: SP.md },
  searchInput: { flex: 1, fontFamily: FONT.regular, fontSize: FS.base, height: 40 },
  empty: { textAlign: 'center', marginTop: SP.xl, fontFamily: FONT.regular, fontSize: FS.sm },
  resultRow: { paddingHorizontal: SP.md, paddingVertical: SP.md, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  resultTop: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  resultFrom: { flex: 1, fontFamily: FONT.semibold, fontSize: FS.sm },
  resultDate: { fontFamily: FONT.regular, fontSize: FS.xs },
  resultText: { fontFamily: FONT.regular, fontSize: FS.sm },
});

/** Splits text around case-insensitive matches of the query, for bolding. */
function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + q.length), match: true });
    from = at + q.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}
