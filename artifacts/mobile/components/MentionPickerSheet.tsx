/**
 * Instagram-style people picker for the story @mention sticker.
 *
 *  - MentionPickerSheet: bottom sheet with a "Search" field + people rows
 *    (avatar, username, name). Empty query lists the people I follow; typing
 *    searches everyone (people I follow first).
 *  - MentionSuggestionsBar: the inline strip shown above the keyboard while
 *    typing "@…" in the text tool.
 *
 * Both read api.social.mentionSearch. Signed out (incl. the web preview)
 * `enabled` is false and nothing is ever requested.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CARD, FG, FONT, FS, MUTED, ON_DARK, RADIUS, SP } from '@/lib/theme';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { useApi } from '@/lib/api';
import { withAt } from '@/lib/storyMentionSticker';
import type { MentionPerson } from '@/services/socialTypes';
import { radius } from '@/constants/radii';

/** Follow-first ordering, stable within each group. */
export function sortFollowingFirst(people: MentionPerson[]): MentionPerson[] {
  return [...people.filter((p) => p.isFollowing), ...people.filter((p) => !p.isFollowing)];
}

function useMentionSearch(query: string, active: boolean, enabled: boolean) {
  const api = useApi();
  const [people, setPeople] = useState<MentionPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (!active || !enabled) { setPeople([]); setLoading(false); setFailed(false); return; }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      api.social.mentionSearch(query.trim())
        .then((rows) => { if (seq.current === mine) { setPeople(sortFollowingFirst(rows ?? [])); setFailed(false); } })
        .catch(() => { if (seq.current === mine) { setPeople([]); setFailed(true); } })
        .finally(() => { if (seq.current === mine) setLoading(false); });
    }, query ? 200 : 0);
    return () => clearTimeout(t);
  }, [query, active, enabled, api]);
  return { people, loading, failed };
}

function PersonAvatar({ person, size }: { person: MentionPerson; size: number }) {
  return person.avatarUrl ? (
    <Image source={{ uri: person.avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  ) : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={styles.initials}>{person.initials}</Text>
    </View>
  );
}

export function MentionPickerSheet({
  visible, enabled, onClose, onPick,
}: {
  visible: boolean;
  /** false when signed out — the sheet never calls the API. */
  enabled: boolean;
  onClose: () => void;
  onPick: (person: MentionPerson) => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const { people, loading, failed } = useMentionSearch(query, visible, enabled);

  useEffect(() => { if (!visible) setQuery(''); }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <ModalSafeArea>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={styles.handle} />
          <Text style={styles.title}>Mention</Text>
          <View style={styles.searchWrap}>
            <Feather name="search" size={16} color={MUTED} />
            <TextInput
              style={[styles.searchInput, WEB_INPUT_RESET]}
              placeholder="Search"
              placeholderTextColor={MUTED}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Search people"
              testID="mention-picker-search"
            />
          </View>
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {!enabled ? (
              <Text style={styles.empty}>Sign in to tag people.</Text>
            ) : loading && !people.length ? (
              <ActivityIndicator style={{ marginTop: SP.lg }} color={ON_DARK} />
            ) : failed ? (
              <Text style={styles.empty}>Couldn’t load people. Try again.</Text>
            ) : !people.length ? (
              <Text style={styles.empty}>{query.trim() ? 'No people found.' : 'Search for someone to tag.'}</Text>
            ) : people.map((p) => (
              <TouchableOpacity
                key={p.userId}
                style={styles.row}
                onPress={() => { Keyboard.dismiss(); onPick(p); }}
                accessibilityRole="button"
                accessibilityLabel={`Mention ${withAt(p.username ?? p.handle)}`}
                testID={`mention-person-${p.userId}`}
              >
                <PersonAvatar person={p} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{(p.username ?? p.handle ?? '').replace(/^@+/, '')}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{p.name}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </ModalSafeArea>
    </Modal>
  );
}

/** Suggestions strip for the text tool: shown while the caret is in an "@partial" token. */
export function MentionSuggestionsBar({
  query, active, enabled, onPick,
}: {
  query: string;
  active: boolean;
  enabled: boolean;
  onPick: (person: MentionPerson) => void;
}) {
  const { people, loading } = useMentionSearch(query, active, enabled);
  if (!active) return null;
  return (
    <View style={styles.bar} testID="mention-suggestions">
      {!people.length ? (
        <Text style={styles.barEmpty}>{!enabled ? 'Sign in to tag people.' : loading ? 'Searching…' : 'No people found.'}</Text>
      ) : (
        <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.barContent}>
          {people.map((p) => (
            <TouchableOpacity
              key={p.userId}
              style={styles.barItem}
              onPress={() => onPick(p)}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${withAt(p.username ?? p.handle)}`}
            >
              <PersonAvatar person={p} size={28} />
              <Text style={styles.barItemText} numberOfLines={1}>{(p.username ?? p.handle ?? '').replace(/^@+/, '')}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: '72%',
    backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    borderTopWidth: 1, borderColor: 'rgba(192,192,192,0.28)', padding: SP.md,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: SP.sm },
  title: { color: FG, fontFamily: FONT.semibold, fontSize: FS.md, textAlign: 'center', marginBottom: SP.sm },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: RADIUS.md, paddingHorizontal: SP.sm },
  searchInput: { flex: 1, color: ON_DARK, fontSize: FS.base, fontFamily: FONT.regular, paddingVertical: SP.sm },
  list: { flex: 1, marginTop: SP.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm, minHeight: 56 },
  rowTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.base },
  rowSub: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm },
  initials: { color: ON_DARK, fontSize: 11, fontFamily: FONT.bold },
  empty: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', padding: SP.lg },

  bar: { minHeight: 48, justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
  barContent: { paddingHorizontal: SP.sm, gap: SP.sm, alignItems: 'center' },
  barItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 10, minHeight: 44, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.1)' },
  barItemText: { color: ON_DARK, fontFamily: FONT.semibold, fontSize: FS.sm, maxWidth: 120 },
  barEmpty: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, paddingHorizontal: SP.md },
});
