/**
 * Create a group chat — chat details > Create a group chat. A deliberately
 * minimal real flow (see docs/dm-flows.md): pick 2+ people you follow, then
 * create the group and land in the same conversation screen used for 1:1s.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, ICON } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui/Button';
import { hapticPrimaryAction, hapticSelection, hapticSuccessAction } from '@/lib/haptics';
import { useApi } from '@/lib/api';
import { apiErrorMessage } from '@/lib/safety';
import { goBackOr } from '@/lib/navigation/goBackOr';

interface Candidate {
  userId: string; name: string; username: string | null; handle: string; initials: string; color: string;
}

export default function ConversationGroupCreateScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(), []);
  const insets = useSafeAreaInsets();
  const headerTopPad = useHeaderTopInset();
  const router = useRouter();
  const api = useApi();
  const params = useLocalSearchParams<{ role?: string }>();

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const rows = await api.social.following();
        setCandidates(rows ?? []);
      } catch {
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [api]);

  function toggle(userId: string) {
    hapticSelection();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }

  async function createGroup() {
    if (selected.size < 2) return;
    setCreating(true);
    try {
      const chosen = candidates.filter((c) => selected.has(c.userId));
      const conv = await api.conversations.createGroup({
        participants: chosen.map((c) => ({
          userId: c.userId, name: c.name, handle: c.handle, initials: c.initials, color: c.color, accountType: 'buyer',
        })),
      });
      hapticSuccessAction();
      const target = params.role === 'seller' ? '/seller-conversation' : '/buyer-conversation';
      router.replace((`${target}?id=${encodeURIComponent(conv.id)}`) as never);
    } catch (e) {
      Alert.alert('Couldn’t create group', apiErrorMessage(e, 'Please try again.'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <View style={[s.root, { backgroundColor: theme.background }]}>
      <View style={[s.header, { paddingTop: headerTopPad + SP.xs }]}>
        <PressableScale rippleEnabled={false}
          onPress={() => { hapticPrimaryAction(); goBackOr(router); }}
          style={s.roundBtn}
          testID="group-create-back"
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={ICON.md} color={theme.text} />
        </PressableScale>
        <Text style={[s.headerTitle, { color: theme.text }]}>New group</Text>
        <View style={s.roundBtn} />
      </View>

      <Text style={[s.subtitle, { color: theme.muted }]}>Choose at least 2 people you follow</Text>

      {loading ? (
        <ActivityIndicator style={{ marginTop: SP.xl }} color={theme.text} />
      ) : (
        <FlatList
          data={candidates}
          keyExtractor={(c) => c.userId}
          contentContainerStyle={{ paddingBottom: 120 }}
          ListEmptyComponent={<Text style={[s.empty, { color: theme.muted }]}>Follow people to add them to a group</Text>}
          renderItem={({ item }) => {
            const checked = selected.has(item.userId);
            return (
              <PressableScale rippleEnabled={false} onPress={() => toggle(item.userId)} testID={`group-candidate-${item.userId}`}>
                <View style={[s.row, { borderBottomColor: theme.border }]}>
                  <View style={[s.avatar, { backgroundColor: item.color }]}>
                    <Text style={s.avatarInitials}>{item.initials}</Text>
                  </View>
                  <Text style={[s.rowName, { color: theme.text }]}>{item.name}</Text>
                  <Feather name={checked ? 'check-circle' : 'circle'} size={ICON.md} color={checked ? theme.accent : theme.border} />
                </View>
              </PressableScale>
            );
          }}
        />
      )}

      <View style={[s.footer, { paddingBottom: insets.bottom + SP.md, backgroundColor: theme.background, borderTopColor: theme.border }]}>
        <Button
          label={`Create group${selected.size ? ` (${selected.size})` : ''}`}
          onPress={createGroup}
          disabled={selected.size < 2}
          loading={creating}
          fullWidth
          testID="group-create-submit"
        />
      </View>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingBottom: SP.sm },
  roundBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: FONT.semibold, fontSize: FS.md },
  subtitle: { fontFamily: FONT.regular, fontSize: FS.sm, paddingHorizontal: SP.md, marginBottom: SP.sm },
  empty: { textAlign: 'center', marginTop: SP.xl, fontFamily: FONT.regular, fontSize: FS.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.md, paddingVertical: SP.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: FS.sm },
  rowName: { flex: 1, fontFamily: FONT.medium, fontSize: FS.base },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: SP.md, paddingTop: SP.md, borderTopWidth: StyleSheet.hairlineWidth },
});
