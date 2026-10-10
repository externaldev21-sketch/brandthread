/**
 * Design — the store website editor (My store → Design).
 *
 * Reference, copied 1:1 and reskinned: Linktree design editor
 * (https://mobbin.com/flows/a363eced-9a2f-4bf8-949c-f7d963bb1f98, steps 2, 5
 * and 7): back arrow, undo / redo, Cancel and Save in the header; the live
 * page fills the screen and updates as you change things; a floating toolbar
 * (Theme · Header · Style) opens a bottom sheet with a title, a close button
 * and tabs.
 *
 * Kept simple on purpose (Dev): logo, brand name, one-line bio, optional
 * banner, a theme, button corners and a font. No page builder.
 * Nothing is saved until Save; Cancel leaves without changing the site.
 */
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ErrorState } from '@/components/ui/ErrorState';
import { StoreSitePreview, type StoreSiteView } from '@/components/store/StoreSitePreview';
import { ShareStoreToast, useToast } from '@/components/store/ShareStoreSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useStoreSite } from '@/hooks/useStoreSite';
import { useApi } from '@/lib/api';
import { isSellerDevPreview } from '@/lib/devPreview';
import { hapticSelection } from '@/lib/haptics';
import { pickFromLibrary } from '@/lib/pickProfileImage';
import { FILL_ELEVATED } from '@/lib/theme';
import {
  STORE_SITE_FONTS, STORE_SITE_THEMES, storeSiteFontFamily, storeSiteTheme, type ButtonStyle, type StoreSiteFont,
} from '@/lib/storeSiteDesign';
import { saveBio } from '@/services/growthService';
import { completeSetupTaskWhen } from '@/lib/setupCompletion';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { RADII } from '@/constants/radii';
import { draftHistoryReducer, type DesignDraft } from '@/lib/storeDesignHistory';

type Panel = 'theme' | 'header' | 'style';
function useDraftHistory() {
  const [h, dispatch] = useReducer(draftHistoryReducer, { draft: null, past: [], future: [] });
  return useMemo(() => ({
    draft: h.draft,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    reset: (draft: DesignDraft) => dispatch({ type: 'reset', draft }),
    commit: (patch: Partial<DesignDraft>) => dispatch({ type: 'commit', patch }),
    type: (patch: Partial<DesignDraft>) => dispatch({ type: 'type', patch }),
    checkpoint: () => dispatch({ type: 'checkpoint' }),
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
  }), [h]);
}

export default function StoreDesignScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const api = useApi();
  const params = useLocalSearchParams<{ panel?: string }>();
  // Full-screen editor with its own toolbar and sheets (Linktree): no tab bar.
  useHideTabBar();
  const insets = useSafeAreaInsets();
  const topInset = useHeaderTopInset();
  const { page, site, failed, reload } = useStoreSite();
  const history = useDraftHistory();
  const { draft } = history;
  const [panel, setPanel] = useState<Panel | null>(params.panel === 'header' ? 'header' : null);
  const [styleTab, setStyleTab] = useState<'buttons' | 'font'>('buttons');
  const [saving, setSaving] = useState(false);
  const [toast, flash] = useToast();
  const seeded = useRef(false);

  useEffect(() => {
    if (!page || seeded.current) return;
    seeded.current = true;
    history.reset({
      displayName: page.displayName ?? '',
      bio: page.bio ?? '',
      siteTheme: storeSiteTheme(page.siteTheme ?? page.theme).key,
      buttonStyle: (page.buttonStyle ?? 'rounded') as ButtonStyle,
      font: (page.font ?? 'system') as StoreSiteFont,
      showBanner: page.showBanner !== false,
      logo: page.logoUrl ?? page.avatarUrl ? { uri: (page.logoUrl ?? page.avatarUrl)! } : null,
      banner: page.bannerUrl ? { uri: page.bannerUrl } : null,
      logoChanged: false,
      bannerChanged: false,
    });
  }, [page, history]);

  const preview: StoreSiteView | null = useMemo(() => (site && draft ? {
    ...site,
    displayName: draft.displayName,
    bio: draft.bio,
    logoUrl: draft.logo?.uri ?? null,
    bannerUrl: draft.showBanner ? draft.banner?.uri ?? null : null,
    themeKey: draft.siteTheme,
    buttonStyle: draft.buttonStyle,
    font: draft.font,
  } : null), [site, draft]);

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/my-store' as never);
  }, [router]);

  const pick = useCallback(async (which: 'logo' | 'banner') => {
    const asset = await pickFromLibrary(which === 'logo' ? [1, 1] : [3, 1]);
    if (!asset) return;
    const img = { uri: asset.uri, mimeType: asset.mimeType ?? null };
    history.commit(which === 'logo' ? { logo: img, logoChanged: true } : { banner: img, bannerChanged: true, showBanner: true });
  }, [history]);

  const save = useCallback(async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      // The signed-out web preview never calls the API (growthService keeps
      // the preview in memory); image uploads only run for real accounts.
      if (!isSellerDevPreview()) {
        if (draft.logoChanged && draft.logo) await api.seller.uploadLogo(draft.logo);
        if (draft.bannerChanged && draft.banner) await api.seller.uploadBanner(draft.banner);
      }
      await saveBio({
        displayName: draft.displayName.trim(),
        bio: draft.bio.trim(),
        siteTheme: draft.siteTheme,
        buttonStyle: draft.buttonStyle,
        font: draft.font,
        showBanner: draft.showBanner,
      });
      void completeSetupTaskWhen('customize_store', true);
      leave();
    } catch {
      flash("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }, [api, draft, flash, leave, saving]);

  const toolbar: { key: Panel; label: string }[] = [
    { key: 'theme', label: 'Theme' },
    { key: 'header', label: 'Header' },
    { key: 'style', label: 'Style' },
  ];

  const header = (
    <View style={[s.header, { paddingTop: topInset }]}>
      <Pressable onPress={leave} style={s.iconBtn} hitSlop={6} accessibilityRole="button" accessibilityLabel="Back" testID="store-design-back">
        <Icon name="chevron-left" size={24} color={theme.text} />
      </Pressable>
      <Pressable onPress={history.undo} disabled={!history.canUndo} style={s.iconBtn} hitSlop={6} accessibilityRole="button" accessibilityLabel="Undo" accessibilityState={{ disabled: !history.canUndo }} testID="store-design-undo">
        <Icon name="corner-up-left" size={20} color={history.canUndo ? theme.text : theme.subtle} />
      </Pressable>
      <Pressable onPress={history.redo} disabled={!history.canRedo} style={s.iconBtn} hitSlop={6} accessibilityRole="button" accessibilityLabel="Redo" accessibilityState={{ disabled: !history.canRedo }} testID="store-design-redo">
        <Icon name="corner-up-right" size={20} color={history.canRedo ? theme.text : theme.subtle} />
      </Pressable>
      <View style={{ flex: 1 }} />
      <View style={s.headerBtns}>
        <Button label="Cancel" variant="secondary" size="small" onPress={leave} testID="store-design-cancel" style={s.headerBtn} />
        <Button label="Save" size="small" onPress={() => { void save(); }} loading={saving} disabled={!draft} testID="store-design-save" style={s.headerBtn} />
      </View>
    </View>
  );

  if (failed && !page) return <View style={[s.root, { backgroundColor: theme.background }]}>{header}<ErrorState onRetry={reload} /></View>;

  const sheetHeight = 360;

  return (
    <View style={[s.root, { backgroundColor: theme.background }]} testID="store-design-screen">
      {header}
      <View style={[s.canvas, { borderColor: theme.borderSubtle }]}>
        <ScrollView contentContainerStyle={{ paddingBottom: (panel ? sheetHeight : 96) + insets.bottom }} showsVerticalScrollIndicator={false}>
          {preview ? <StoreSitePreview site={preview} testID="store-design-preview" /> : null}
        </ScrollView>
      </View>

      {!panel && draft ? (
        <View style={[s.toolbar, { bottom: Math.max(insets.bottom, 16) + 8 }]} testID="store-design-toolbar">
          {toolbar.map((t) => (
            <Pressable key={t.key} onPress={() => { hapticSelection(); setPanel(t.key); }} style={s.tool} accessibilityRole="button" accessibilityLabel={t.label} testID={`store-design-tool-${t.key}`}>
              <ToolGlyph panel={t.key} draft={draft} />
              <Text style={[s.toolLabel, { color: theme.text }]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {panel && draft ? (
        <View style={[s.sheet, { height: sheetHeight + insets.bottom, paddingBottom: insets.bottom }]} testID={`store-design-sheet-${panel}`}>
          <View style={s.grabberWrap}><View style={[s.grabber, { backgroundColor: theme.subtle }]} /></View>
          <View style={s.sheetHead}>
            <Text style={[s.sheetTitle, { color: theme.text }]}>{toolbar.find((t) => t.key === panel)?.label}</Text>
            <Pressable onPress={() => setPanel(null)} style={[s.close, { backgroundColor: theme.background }]} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" testID="store-design-sheet-close">
              <Icon name="x" size={17} color={theme.text} />
            </Pressable>
          </View>

          {panel === 'theme' ? (
            <ScrollView contentContainerStyle={s.themeGrid} showsVerticalScrollIndicator={false}>
              {STORE_SITE_THEMES.map((t) => {
                const on = draft.siteTheme === t.key;
                const ff = storeSiteFontFamily(draft.font, Platform.OS);
                return (
                  <Pressable key={t.key} onPress={() => { hapticSelection(); history.commit({ siteTheme: t.key }); }} style={s.themeCell} accessibilityRole="button" accessibilityLabel={`${t.label} theme`} accessibilityState={{ selected: on }} testID={`store-design-theme-${t.key}`}>
                    <View style={[s.themeTile, { backgroundColor: t.bg, borderColor: on ? theme.text : theme.borderSubtle, borderWidth: on ? 2 : 1 }]}>
                      <Text style={[s.themeAa, { color: t.fg }, ff ? { fontFamily: ff } : null]}>Aa</Text>
                      <View style={[s.themeBtn, { backgroundColor: t.buttonBg, borderRadius: draft.buttonStyle === 'square' ? 0 : 6 }]} />
                    </View>
                    <Text style={[s.themeLabel, { color: on ? theme.text : theme.muted }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {panel === 'header' ? (
            <ScrollView contentContainerStyle={s.panelBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={s.imageRow}>
                {draft.logo
                  ? <Image source={{ uri: draft.logo.uri }} style={[s.logoThumb, { backgroundColor: theme.background }]} />
                  : <View style={[s.logoThumb, s.center, { backgroundColor: theme.background }]}><Icon name="image" size={20} color={theme.muted} /></View>}
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowTitle, { color: theme.text }]}>Logo</Text>
                </View>
                <Button label={draft.logo ? 'Change' : 'Add'} variant="secondary" size="small" onPress={() => { void pick('logo'); }} testID="store-design-logo" />
              </View>
              <View style={s.imageRow}>
                {draft.banner && draft.showBanner
                  ? <Image source={{ uri: draft.banner.uri }} style={[s.bannerThumb, { backgroundColor: theme.background }]} />
                  : <View style={[s.bannerThumb, s.center, { backgroundColor: theme.background }]}><Icon name="image" size={20} color={theme.muted} /></View>}
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowTitle, { color: theme.text }]}>Banner</Text>
                </View>
                {draft.banner && draft.showBanner
                  ? <Button label="Remove" variant="tertiary" size="small" onPress={() => history.commit({ showBanner: false })} testID="store-design-banner-remove" />
                  : null}
                <Button label={draft.banner && draft.showBanner ? 'Change' : 'Add'} variant="secondary" size="small" onPress={() => { if (draft.banner && !draft.showBanner) history.commit({ showBanner: true }); else void pick('banner'); }} testID="store-design-banner" />
              </View>
              <Input
                label="Brand name"
                value={draft.displayName}
                onFocus={history.checkpoint}
                onChangeText={(v) => history.type({ displayName: v })}
                maxLength={60}
                style={s.field}
                testID="store-design-name"
              />
              <Input
                label="Bio"
                value={draft.bio}
                onFocus={history.checkpoint}
                onChangeText={(v) => history.type({ bio: v.replace(/\n/g, ' ') })}
                maxLength={80}
                style={s.field}
                testID="store-design-bio"
              />
            </ScrollView>
          ) : null}

          {panel === 'style' ? (
            <View style={s.panelBody}>
              <SegmentedControl
                variant="underline"
                options={[{ id: 'buttons', label: 'Buttons' }, { id: 'font', label: 'Font' }]}
                selectedId={styleTab}
                onChange={(id) => setStyleTab(id as 'buttons' | 'font')}
                testID="store-design-style-tabs"
              />
              {styleTab === 'buttons' ? (
                <View style={s.optionRow}>
                  {(['rounded', 'square'] as const).map((b) => {
                    const on = draft.buttonStyle === b;
                    const t = storeSiteTheme(draft.siteTheme);
                    return (
                      <Pressable key={b} onPress={() => { hapticSelection(); history.commit({ buttonStyle: b }); }} style={[s.option, { borderColor: on ? theme.text : theme.borderSubtle, borderWidth: on ? 2 : 1, backgroundColor: theme.background }]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={b === 'rounded' ? 'Rounded buttons' : 'Square buttons'} testID={`store-design-buttons-${b}`}>
                        <View style={[s.sampleBtn, { backgroundColor: t.buttonBg === t.bg ? theme.text : t.buttonBg, borderRadius: b === 'square' ? 0 : 10 }]} />
                        <Text style={[s.optionLabel, { color: on ? theme.text : theme.muted }]}>{b === 'rounded' ? 'Rounded' : 'Square'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <View style={s.optionRow}>
                  {STORE_SITE_FONTS.map((f) => {
                    const on = draft.font === f.key;
                    const ff = storeSiteFontFamily(f.key, Platform.OS);
                    return (
                      <Pressable key={f.key} onPress={() => { hapticSelection(); history.commit({ font: f.key }); }} style={[s.option, { borderColor: on ? theme.text : theme.borderSubtle, borderWidth: on ? 2 : 1, backgroundColor: theme.background }]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${f.label} font`} testID={`store-design-font-${f.key}`}>
                        <Text style={[s.fontAa, { color: theme.text }, ff ? { fontFamily: ff } : null]}>Aa</Text>
                        <Text style={[s.optionLabel, { color: on ? theme.text : theme.muted }]}>{f.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}
        </View>
      ) : null}
      <ShareStoreToast message={toast} top={insets.top + 8} />
    </View>
  );
}

function ToolGlyph({ panel, draft }: { panel: Panel; draft: DesignDraft }) {
  const { theme } = useAppTheme();
  if (panel === 'theme') {
    const t = storeSiteTheme(draft.siteTheme);
    return (
      <View style={[s.glyph, { backgroundColor: t.bg, borderColor: theme.borderSubtle }]}>
        <Text style={{ color: t.fg, fontSize: 11, fontWeight: '700' }}>Aa</Text>
      </View>
    );
  }
  if (panel === 'header') {
    return draft.logo
      ? <Image source={{ uri: draft.logo.uri }} style={[s.glyph, s.glyphRound]} />
      : <View style={[s.glyph, s.glyphRound, s.center, { backgroundColor: theme.background }]}><Icon name="user" size={15} color={theme.text} /></View>;
  }
  return <View style={[s.glyph, s.center]}><Icon name="sliders" size={20} color={theme.text} /></View>;
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8, gap: 2 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerBtns: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  headerBtn: { minWidth: 84 },
  canvas: { flex: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', borderWidth: 1, borderBottomWidth: 0, marginHorizontal: 8 },
  toolbar: {
    position: 'absolute', alignSelf: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: FILL_ELEVATED, borderRadius: RADII.sheet,
  },
  tool: { width: 72, alignItems: 'center', gap: 4, paddingVertical: 2 },
  toolLabel: { fontSize: 12, fontWeight: '500' },
  glyph: { width: 28, height: 28, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  glyphRound: { borderRadius: 14, borderWidth: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: FILL_ELEVATED,
    borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet,
  },
  grabberWrap: { alignItems: 'center', paddingTop: 6, paddingBottom: 2 },
  grabber: { width: 36, height: 5, borderRadius: 3, opacity: 0.5 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 48 },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  themeGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingBottom: 24, rowGap: 12 },
  themeCell: { width: '33.33%', alignItems: 'center', paddingHorizontal: 4 },
  themeTile: { width: '100%', aspectRatio: 1, borderRadius: 12, padding: 10, justifyContent: 'space-between' },
  themeAa: { fontSize: 22, fontWeight: '600' },
  themeBtn: { height: 16, width: '100%' },
  themeLabel: { fontSize: 13, marginTop: 6 },
  panelBody: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  imageRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  logoThumb: { width: 48, height: 48, borderRadius: 24 },
  bannerThumb: { width: 96, height: 32, borderRadius: 6 },
  rowTitle: { fontSize: 17 },
  field: { marginTop: 4 },
  optionRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  option: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 18, borderRadius: 12 },
  sampleBtn: { width: '70%', height: 28 },
  optionLabel: { fontSize: 15 },
  fontAa: { fontSize: 28 },
});

