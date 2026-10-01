/**
 * Seller > Messages > Quick replies — canned replies the seller can insert
 * from the conversation's attach sheet. List + inline editor (the editor is
 * a second state of this same screen, so back from the editor returns to the
 * list). Route: /quick-replies
 *
 * Layout reference: WhatsApp Business "Quick replies" (list of /shortcut +
 * message preview, add from the header, tap a row to edit), reskinned.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useApi, type SellerQuickReply } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { PressableScale } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/layout';
import { hapticLight, hapticSuccess } from '@/lib/haptics';
import { isSellerDevPreview } from '@/lib/devPreview';
import { apiErrorMessage } from '@/lib/safety';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';

const TITLE_MAX = 40;
const BODY_MAX = 1000;
const SHORTCUT_MAX = 24;

type Draft = { id: string | null; title: string; body: string; shortcut: string };

export default function QuickRepliesScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const { userId } = useAuth();
  const offline = !userId || isSellerDevPreview();

  const [items, setItems] = useState<SellerQuickReply[]>([]);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(!offline);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (offline) { setLoading(false); return; }
    try {
      const res = await api.seller.quickReplies.list();
      setItems(res.quickReplies);
      setLimit(res.limit);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load your quick replies.'));
    } finally {
      setLoading(false);
    }
  }, [api, offline]);

  useEffect(() => { void load(); }, [load]);

  const openNew = () => { hapticLight(); setError(null); setDraft({ id: null, title: '', body: '', shortcut: '' }); };
  const openEdit = (r: SellerQuickReply) => {
    hapticLight(); setError(null);
    setDraft({ id: r.id, title: r.title, body: r.body, shortcut: (r.shortcut ?? '').replace(/^\//, '') });
  };

  async function save() {
    if (!draft) return;
    const title = draft.title.trim();
    const body = draft.body.trim();
    if (!title || !body) { setError('Add a title and a message.'); return; }
    const payload = { title, body, shortcut: draft.shortcut.trim() || null };
    setSaving(true); setError(null);
    try {
      if (offline) {
        const local: SellerQuickReply = {
          id: draft.id ?? `local-${Date.now()}`, title, body,
          shortcut: payload.shortcut ? `/${payload.shortcut.replace(/^\/+/, '').toLowerCase()}` : null,
          updatedAt: new Date().toISOString(),
        };
        setItems((cur) => (draft.id ? cur.map((r) => (r.id === draft.id ? local : r)) : [...cur, local]));
      } else {
        const saved = draft.id
          ? await api.seller.quickReplies.update(draft.id, payload)
          : await api.seller.quickReplies.create(payload);
        setItems((cur) => (draft.id ? cur.map((r) => (r.id === saved.id ? saved : r)) : [...cur, saved]));
      }
      hapticSuccess();
      setDraft(null);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not save this quick reply.'));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft?.id) return;
    setSaving(true); setError(null);
    try {
      if (!offline) await api.seller.quickReplies.remove(draft.id);
      setItems((cur) => cur.filter((r) => r.id !== draft.id));
      setDraft(null);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not delete this quick reply.'));
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = [styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }];

  if (draft) {
    return (
      <View style={[styles.page, { backgroundColor: colors.background }]}>
        <ScreenHeader title={draft.id ? 'Edit quick reply' : 'New quick reply'} onBack={() => setDraft(null)} />
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Shortcut</Text>
          <View style={[styles.shortcutRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.slash, { color: colors.mutedForeground }]}>/</Text>
            <TextInput
              style={[styles.shortcutInput, { color: colors.foreground }]}
              value={draft.shortcut}
              onChangeText={(v) => setDraft({ ...draft, shortcut: v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, SHORTCUT_MAX) })}
              placeholder="shipping"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              testID="quick-reply-shortcut"
            />
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Title</Text>
          <TextInput
            style={inputStyle}
            value={draft.title}
            onChangeText={(v) => setDraft({ ...draft, title: v.slice(0, TITLE_MAX) })}
            placeholder="Shipping times"
            placeholderTextColor={colors.mutedForeground}
            testID="quick-reply-title"
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Message</Text>
          <TextInput
            style={[...inputStyle, styles.bodyInput]}
            value={draft.body}
            onChangeText={(v) => setDraft({ ...draft, body: v.slice(0, BODY_MAX) })}
            placeholder="Orders ship within 2 business days."
            placeholderTextColor={colors.mutedForeground}
            multiline
            textAlignVertical="top"
            testID="quick-reply-body"
          />

          {error ? <Text style={[styles.error, { color: colors.foreground }]}>{error}</Text> : null}

          <View style={styles.actions} testID="quick-reply-actions">
            <Button label="Save" onPress={save} loading={saving} disabled={saving} fullWidth testID="quick-reply-save" />
            {draft.id ? (
              <Button label="Delete" variant="destructive" onPress={remove} disabled={saving} fullWidth testID="quick-reply-delete" />
            ) : null}
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Quick replies"
        onBack={() => goBackOr(router, '/seller-inbox')}
        actions={items.length < limit ? [{ icon: 'plus', onPress: openNew, accessibilityLabel: 'New quick reply' }] : undefined}
      />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.foreground} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon="message-square"
            title="No quick replies"
            message="Save the answers you send most and insert them from any conversation."
          />
          <View style={styles.emptyCta}>
            <Button label="New quick reply" onPress={openNew} testID="quick-replies-empty-new" />
          </View>
          {error ? <Text style={[styles.error, { color: colors.foreground }]}>{error}</Text> : null}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {items.map((r) => (
            <PressableScale
              key={r.id}
              onPress={() => openEdit(r)}
              style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel={`Edit quick reply ${r.title}`}
              testID={`quick-reply-row-${r.id}`}
            >
              <View style={styles.rowHead}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>{r.title}</Text>
                {r.shortcut ? <Text style={[styles.rowShortcut, { color: colors.mutedForeground }]}>{r.shortcut}</Text> : null}
              </View>
              <Text style={[styles.rowBody, { color: colors.mutedForeground }]}>{r.body}</Text>
            </PressableScale>
          ))}
          {error ? <Text style={[styles.error, { color: colors.foreground }]}>{error}</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg },
  emptyCta: { marginTop: SP.md },
  list: { padding: SP.md, gap: SP.sm, paddingBottom: 140 },
  row: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: 16, paddingVertical: 14, gap: 4 },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowTitle: { flex: 1, fontSize: FS.base, fontFamily: FONT.semibold },
  rowShortcut: { fontSize: FS.sm, fontFamily: FONT.medium },
  rowBody: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
  form: { padding: SP.md, paddingBottom: 140 },
  label: { fontSize: FS.xs, fontFamily: FONT.semibold, marginTop: SP.md, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: FS.base, fontFamily: FONT.regular, minHeight: 48 },
  bodyInput: { minHeight: 130 },
  shortcutRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: 14, minHeight: 48 },
  slash: { fontSize: FS.base, fontFamily: FONT.semibold, marginRight: 2 },
  shortcutInput: { flex: 1, fontSize: FS.base, fontFamily: FONT.regular, paddingVertical: 12 },
  error: { fontSize: FS.sm, fontFamily: FONT.regular, marginTop: SP.md },
  actions: { marginTop: SP.lg, gap: SP.sm },
});
