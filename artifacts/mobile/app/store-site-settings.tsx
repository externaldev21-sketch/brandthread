/**
 * My store → Settings: the website's link buttons (up to five), social
 * icons, whether the site is on, and the way to the advanced store tools
 * (Store Builder and the store-* screens are unchanged and still here).
 *
 * Reference: Linktree "Settings" from My Linktree — a plain grouped list;
 * each row edits in a sheet. Same header as the rest of the app.
 */
import React, { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { ListRow } from '@/components/ui/ListRow';
import { ErrorState } from '@/components/ui/ErrorState';
import { useSheetTransition } from '@/components/ui/BottomSheet';
import { ShareStoreToast, useToast } from '@/components/store/ShareStoreSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useStoreSite } from '@/hooks/useStoreSite';
import { useTabBarClearance } from '@/components/buyer-nav/buyerTabBarMetrics';
import { FILL_ELEVATED } from '@/lib/theme';
import { MAX_STORE_SITE_LINKS } from '@/lib/storeSiteDesign';
import { normalizeUrlInput } from '@/lib/growthValidation';
import { addBioLink, deleteBioLink, patchBioLink, saveBio, type BioLink } from '@/services/growthService';
import { RADII } from '@/constants/radii';

const SOCIALS = [
  { key: 'instagram', label: 'Instagram', placeholder: '@handle' },
  { key: 'tiktok', label: 'TikTok', placeholder: '@handle' },
  { key: 'youtube', label: 'YouTube', placeholder: 'youtube.com/@channel' },
  { key: 'x', label: 'X', placeholder: '@handle' },
  { key: 'facebook', label: 'Facebook', placeholder: 'facebook.com/page' },
  { key: 'website', label: 'Website', placeholder: 'yourbrand.com' },
  { key: 'email', label: 'Email', placeholder: 'hello@yourbrand.com' },
] as const;

/** "https://www.instagram.com/acme" → "@acme"; "mailto:a@b.co" → "a@b.co". */
export function socialDisplay(key: string, value: string | undefined): string {
  if (!value) return '';
  if (key === 'email') return value.replace(/^mailto:/i, '');
  if (key === 'website') return value.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const last = value.replace(/\/+$/, '').split('/').pop() ?? value;
  return last.startsWith('@') ? last : `@${last}`;
}

type Editing =
  | { kind: 'link'; link: BioLink | null }
  | { kind: 'social'; key: (typeof SOCIALS)[number]['key'] };

export default function StoreSiteSettingsScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Clear of the floating tab bar.
  const bottomInset = useTabBarClearance(2);
  const { page, failed, reload } = useStoreSite();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [toast, flash] = useToast();

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const header = <ScreenHeader title="Settings" />;
  if (failed && !page) return <View style={[s.root, { backgroundColor: theme.background }]}>{header}<ErrorState onRetry={reload} /></View>;

  const links = page?.links ?? [];
  const canAdd = links.length < MAX_STORE_SITE_LINKS;

  const ensurePage = async () => { if (page && !page.exists) await saveBio({}); };

  const togglePublished = async (published: boolean) => {
    try { await saveBio({ published }); await reload(); } catch { flash("Couldn't save. Try again."); }
  };

  return (
    <View style={[s.root, { backgroundColor: theme.background }]} testID="store-site-settings">
      {header}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset + 24 }} showsVerticalScrollIndicator={false}>
        <Text style={[s.section, { color: theme.text }]}>Links</Text>
        {links.map((l, i) => (
          <ListRow
            key={l.id}
            icon="link"
            title={l.title}
            subtitle={l.url}
            chevron
            divider={i < links.length - 1 || canAdd}
            onPress={() => setEditing({ kind: 'link', link: l })}
            testID={`store-settings-link-${i}`}
          />
        ))}
        {canAdd ? (
          <ListRow icon="plus" title="Add link" onPress={() => setEditing({ kind: 'link', link: null })} testID="store-settings-add-link" />
        ) : null}

        <Text style={[s.section, { color: theme.text }]}>Socials</Text>
        {SOCIALS.map((f, i) => (
          <ListRow
            key={f.key}
            title={f.label}
            value={socialDisplay(f.key, page?.socials?.[f.key]) || 'Add'}
            chevron
            divider={i < SOCIALS.length - 1}
            onPress={() => setEditing({ kind: 'social', key: f.key })}
            testID={`store-settings-social-${f.key}`}
          />
        ))}

        <Text style={[s.section, { color: theme.text }]}>Website</Text>
        <ListRow
          icon="globe"
          title="Show website"
          toggle={{ value: page?.published ?? true, onChange: (v) => { void togglePublished(v); } }}
          divider
          testID="store-settings-published"
        />
        <ListRow icon="bar-chart-2" title="Website stats" chevron divider onPress={() => router.push('/link-in-bio-stats' as never)} testID="store-settings-stats" />
        <ListRow icon="layout" title="Advanced store settings" chevron onPress={() => router.push('/store-builder' as never)} testID="store-settings-advanced" />
      </ScrollView>

      <EditSheet
        editing={editing}
        socials={page?.socials ?? {}}
        onClose={() => setEditing(null)}
        onSaved={async (message) => { setEditing(null); await reload(); if (message) flash(message); }}
        onError={(m) => flash(m)}
        ensurePage={ensurePage}
      />
      <ShareStoreToast message={toast} top={insets.top + 8} />
    </View>
  );
}

function EditSheet({ editing, socials, onClose, onSaved, onError, ensurePage }: {
  editing: Editing | null;
  socials: Record<string, string>;
  onClose: () => void;
  onSaved: (message?: string) => Promise<void>;
  onError: (message: string) => void;
  ensurePage: () => Promise<void>;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Editing | null>(null);
  const visible = !!editing;
  const { modalVisible, sheetStyle, backdropStyle, panGesture, onSheetLayout } = useSheetTransition(visible, onClose);

  // Seed the fields each time a row opens the sheet.
  if (editing && editing !== shown) {
    setShown(editing);
    if (editing.kind === 'link') { setTitle(editing.link?.title ?? ''); setValue(editing.link?.url ?? ''); }
    else { setTitle(''); setValue(socialDisplay(editing.key, socials[editing.key])); }
  }
  const current = editing ?? shown;
  const social = current?.kind === 'social' ? SOCIALS.find((f) => f.key === current.key) : null;

  const save = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      if (current.kind === 'link') {
        const url = normalizeUrlInput(value);
        if (!title.trim() || !url) { onError('Add a title and a valid link'); return; }
        await ensurePage();
        if (current.link) await patchBioLink(current.link.id, { title: title.trim(), url });
        else await addBioLink(title.trim(), url);
      } else {
        await saveBio({ socials: { ...socials, [current.key]: value.trim() } });
      }
      await onSaved();
    } catch (e) {
      onError(e instanceof Error && e.message ? e.message.slice(0, 120) : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!current || current.kind !== 'link' || !current.link || busy) return;
    setBusy(true);
    try { await deleteBioLink(current.link.id); await onSaved(); } catch { onError("Couldn't delete. Try again."); } finally { setBusy(false); }
  };

  return (
    <Modal visible={modalVisible} transparent animationType="none" onRequestClose={onClose}>
      <View style={s.modalRoot}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, opacity: 0.6 }]} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        </Animated.View>
        <GestureDetector gesture={panGesture}>
          <Animated.View onLayout={onSheetLayout} style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }, sheetStyle]} accessibilityViewIsModal testID="store-settings-sheet">
            <View style={s.grabberWrap}><View style={[s.grabber, { backgroundColor: theme.subtle }]} /></View>
            <View style={s.sheetHead}>
              <Text style={[s.sheetTitle, { color: theme.text }]}>
                {current?.kind === 'link' ? (current.link ? 'Edit link' : 'Add link') : social?.label ?? ''}
              </Text>
              <Pressable onPress={onClose} style={[s.close, { backgroundColor: theme.background }]} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="x" size={17} color={theme.text} />
              </Pressable>
            </View>
            <View style={s.form}>
              {current?.kind === 'link' ? (
                <Input label="Title" value={title} onChangeText={setTitle} maxLength={80} testID="store-settings-link-title" />
              ) : null}
              <Input
                label={current?.kind === 'link' ? 'Link' : social?.placeholder ?? ''}
                value={value}
                onChangeText={setValue}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={current?.kind === 'social' && current.key === 'email' ? 'email-address' : 'url'}
                testID="store-settings-value"
              />
              <Button label="Save" onPress={() => { void save(); }} loading={busy} fullWidth testID="store-settings-save" />
              {current?.kind === 'link' && current.link ? (
                <Button label="Delete link" variant="destructive" onPress={() => { void remove(); }} fullWidth testID="store-settings-delete" />
              ) : null}
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  section: { fontSize: 17, fontWeight: '600', marginTop: 24, marginBottom: 4 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: FILL_ELEVATED, borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet },
  grabberWrap: { alignItems: 'center', paddingTop: 6, paddingBottom: 2 },
  grabber: { width: 36, height: 5, borderRadius: 3, opacity: 0.5 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 48 },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  form: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
});
