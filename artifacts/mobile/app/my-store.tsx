/**
 * My store — the seller's simple store website (brandthread.app/@handle),
 * what "Customize your store" opens.
 *
 * Reference, copied 1:1 and reskinned: Linktree "My Linktree" + "Your setup
 * checklist" (https://mobbin.com/flows/a363eced-9a2f-4bf8-949c-f7d963bb1f98,
 * steps 1 and 3): the name large at the top, the link with a copy icon under
 * it, a row of three pills (Products / Design / Settings), a live preview of
 * the page, a share icon top-right, and the setup checklist as a sheet over
 * the bottom with a progress bar, struck-through done steps and the current
 * step expanded with its action and Skip.
 *
 * The advanced store tools (Store Builder and the store-* screens) stay where
 * they were and are linked from Settings here.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ListRow } from '@/components/ui/ListRow';
import { ErrorState } from '@/components/ui/ErrorState';
import { StoreSiteThumbnail } from '@/components/store/StoreSitePreview';
import { ShareStoreToast, useToast } from '@/components/store/ShareStoreSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useStoreLink } from '@/hooks/useStoreLink';
import { useStoreSite } from '@/hooks/useStoreSite';
import { useScreenBottomInset } from '@/hooks/useScreenBottomInset';
import { FILL_ELEVATED } from '@/lib/theme';
import { displayStoreLink } from '@/lib/storeShare';
import { openShareStoreSheet } from '@/lib/shareStoreSheet';
import { checklistProgress, currentStep, storeSiteChecklist, type StoreSiteStepId } from '@/lib/storeSiteChecklist';
import { readStoreSiteFlags, updateStoreSiteFlags, type StoreSiteFlags } from '@/lib/storeSiteFlags';
import { RADII } from '@/constants/radii';
import { leaveSetupFlow } from '@/lib/setupNavigation';
import { useHideTabBar } from '@/lib/tabBarVisibility';

const PREVIEW_HEIGHT_RATIO = 1.9;

export default function MyStoreScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  // The setup checklist is a bottom sheet (Linktree): the tab bar steps aside.
  useHideTabBar();
  const insets = useSafeAreaInsets();
  const bottomInset = useScreenBottomInset();
  const { width } = useWindowDimensions();
  const link = useStoreLink();
  const { page, site, failed, reload } = useStoreSite();
  const [flags, setFlags] = useState<StoreSiteFlags | null>(null);
  const [toast, flash] = useToast();
  const username = page?.username ?? link.username;

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  useEffect(() => {
    let alive = true;
    readStoreSiteFlags(username).then((f) => { if (alive) setFlags(f); });
    return () => { alive = false; };
  }, [username, page]);

  const steps = useMemo(() => (page && flags ? storeSiteChecklist({
    hasLogo: !!(page.logoUrl ?? page.avatarUrl),
    bio: page.bio ?? '',
    productCount: page.products?.length ?? 0,
    socialCount: Object.values(page.socials ?? {}).filter(Boolean).length,
    designSaved: page.exists,
    linkShared: flags.linkShared,
    skipped: flags.skipped,
  }) : null), [page, flags]);
  const progress = steps ? checklistProgress(steps) : null;
  const current = steps ? currentStep(steps) : null;
  const showChecklist = !!steps && !!progress && !progress.complete && !flags?.checklistClosed;

  const copy = useCallback(async () => {
    if (!link.url) return;
    await link.copy();
    flash('Link copied');
    setFlags(await updateStoreSiteFlags(username, { linkShared: true }));
  }, [flash, link, username]);

  const runStep = useCallback((id: StoreSiteStepId) => {
    switch (id) {
      case 'logo_bio': router.push('/store-design?panel=header' as never); break;
      case 'products': router.push('/add-product' as never); break;
      case 'socials': router.push('/store-site-settings' as never); break;
      case 'design': router.push('/store-design' as never); break;
      case 'share':
        openShareStoreSheet();
        void updateStoreSiteFlags(username, { linkShared: true }).then(setFlags);
        break;
    }
  }, [router, username]);

  const skip = useCallback(async (id: StoreSiteStepId) => {
    setFlags(await updateStoreSiteFlags(username, { skipped: [...(flags?.skipped ?? []), id] }));
  }, [flags, username]);

  const name = (page?.displayName || link.brandName || (username ? `@${username}` : '')).trim();
  const thumbW = Math.min(width - 32, 430) * 0.62;
  const thumbH = thumbW * PREVIEW_HEIGHT_RATIO;

  const header = (
    <ScreenHeader
      title=""
      backAccessibilityLabel="Back"
      // Opened from the setup checklist too: pop back to wherever it came from.
      onBack={() => leaveSetupFlow(router, params.from)}
      actions={link.url ? [{ icon: 'share', onPress: () => openShareStoreSheet(), accessibilityLabel: 'Share store' }] : []}
    />
  );

  if (failed && !page) return <View style={[s.root, { backgroundColor: theme.background }]}>{header}<ErrorState onRetry={reload} /></View>;

  return (
    <View style={[s.root, { backgroundColor: theme.background }]} testID="my-store-screen">
      {header}
      <ScrollView
        contentContainerStyle={[s.body, { paddingBottom: (showChecklist ? 360 : 24) + bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[s.name, { color: theme.text }]} numberOfLines={2} accessibilityRole="header">{name}</Text>
        {link.url ? (
          <Pressable onPress={copy} style={s.linkRow} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Copy ${displayStoreLink(link.url)}`} testID="my-store-link">
            <Text style={[s.link, { color: theme.text }]} numberOfLines={1} ellipsizeMode="middle">{displayStoreLink(link.url)}</Text>
            <Icon name="copy" size={15} color={theme.text} />
          </Pressable>
        ) : !link.loading ? (
          <Pressable onPress={() => router.push('/edit-profile' as never)} style={s.linkRow} accessibilityRole="button" testID="my-store-set-username">
            <Text style={[s.link, { color: theme.muted }]}>Pick a username to get your link</Text>
          </Pressable>
        ) : <View style={s.linkRow} />}

        <View style={s.pills}>
          {([
            { key: 'products', label: 'Products', icon: 'package', go: () => router.push('/(tabs)/products' as never) },
            { key: 'design', label: 'Design', icon: 'edit-3', go: () => router.push('/store-design' as never) },
            { key: 'settings', label: 'Settings', icon: 'settings', go: () => router.push('/store-site-settings' as never) },
          ] as const).map((p) => (
            <View key={p.key} style={s.pill}>
              <Button label={p.label} icon={p.icon} variant="secondary" size="compact" onPress={p.go} fullWidth style={s.pillBtn} testID={`my-store-${p.key}`} />
            </View>
          ))}
        </View>

        <Pressable
          onPress={() => router.push('/store-design' as never)}
          style={s.previewWrap}
          accessibilityRole="button"
          accessibilityLabel="Edit your store website design"
          testID="my-store-preview"
        >
          {site ? (
            <View style={[s.previewFrame, { borderColor: theme.borderSubtle }]}>
              <StoreSiteThumbnail site={site} width={thumbW} height={thumbH} radius={20} />
            </View>
          ) : <View style={{ width: thumbW, height: thumbH }} />}
        </Pressable>

        {progress && !progress.complete && flags?.checklistClosed ? (
          <ListRow
            icon="check-circle"
            title="Setup checklist"
            value={`${progress.done}/${progress.total}`}
            chevron
            onPress={() => { void updateStoreSiteFlags(username, { checklistClosed: false }).then(setFlags); }}
            style={s.reopen}
            testID="my-store-checklist-row"
          />
        ) : null}
      </ScrollView>

      {showChecklist && steps && progress ? (
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]} testID="my-store-checklist">
          <View style={s.grabberWrap}><View style={[s.grabber, { backgroundColor: theme.subtle }]} /></View>
          <View style={s.sheetHead}>
            <Text style={[s.sheetTitle, { color: theme.text }]}>Your setup checklist</Text>
            <View style={[s.count, { backgroundColor: theme.text }]}>
              <Text style={[s.countText, { color: theme.background }]}>{progress.done}/{progress.total}</Text>
            </View>
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={() => { void updateStoreSiteFlags(username, { checklistClosed: true }).then(setFlags); }}
              style={[s.close, { backgroundColor: theme.background }]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close checklist"
              testID="my-store-checklist-close"
            >
              <Icon name="x" size={17} color={theme.text} />
            </Pressable>
          </View>
          <View style={[s.track, { backgroundColor: theme.background }]}>
            <View style={[s.fill, { backgroundColor: theme.text, width: `${(progress.done / progress.total) * 100}%` }]} />
          </View>
          <ScrollView style={{ maxHeight: 300 }} bounces={false}>
            {steps.map((step, i) => {
              const open = current?.id === step.id;
              return (
                <View key={step.id} style={[s.step, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.borderSubtle }]} testID={`my-store-step-${step.id}`}>
                  <View style={s.stepRow}>
                    <View style={[s.check, step.done ? { backgroundColor: theme.text, borderColor: theme.text } : { borderColor: theme.muted }]}>
                      {step.done ? <Icon name="check" size={13} color={theme.background} /> : null}
                    </View>
                    <Text
                      style={[s.stepTitle, { color: step.done ? theme.muted : theme.text }, step.done && s.struck]}
                      numberOfLines={1}
                    >
                      {step.title}
                    </Text>
                  </View>
                  {open ? (
                    <View style={s.stepBody}>
                      <Text style={[s.stepDetail, { color: theme.muted }]}>{step.detail}</Text>
                      <View style={s.stepActions}>
                        <Button label={step.action} size="small" onPress={() => runStep(step.id)} testID={`my-store-step-${step.id}-action`} />
                        <Button label="Skip" variant="tertiary" size="small" onPress={() => { void skip(step.id); }} testID={`my-store-step-${step.id}-skip`} />
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
      <ShareStoreToast message={toast} top={insets.top + 8} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 4 },
  name: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, marginTop: 4, alignSelf: 'flex-start', maxWidth: '100%' },
  link: { fontSize: 17, flexShrink: 1 },
  pills: { flexDirection: 'row', gap: 8, marginTop: 16 },
  pill: { flex: 1, minWidth: 0 },
  pillBtn: { paddingHorizontal: 8 },
  previewWrap: { alignItems: 'center', marginTop: 24 },
  previewFrame: { borderWidth: 1, borderRadius: 22, padding: 1 },
  reopen: { marginTop: 24 },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: FILL_ELEVATED,
    borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet, paddingHorizontal: 16,
  },
  grabberWrap: { alignItems: 'center', paddingTop: 6, paddingBottom: 4 },
  grabber: { width: 36, height: 5, borderRadius: 3, opacity: 0.5 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  sheetTitle: { fontSize: 17, fontWeight: '600' },
  count: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  countText: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 8, marginBottom: 8 },
  fill: { height: '100%', borderRadius: 3 },
  step: { paddingVertical: 14 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontSize: 17, flex: 1 },
  struck: { textDecorationLine: 'line-through' },
  stepBody: { paddingLeft: 34, paddingTop: 8, gap: 12 },
  stepDetail: { fontSize: 15, lineHeight: 20 },
  stepActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

